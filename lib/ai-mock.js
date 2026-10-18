// The mock AI (AI_PROVIDER=mock): answers in exactly the shape the real model must,
// built only from the request data. No key, no network, same answer every time.
// Used for demos, the fixture run in CI, and the end-to-end tests.

const words = (s) => String(s || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").replace(/\b\d+\b/g, "").replace(/\s+/g, " ").trim();
const fileName = (u) => { try { return decodeURIComponent(new URL(u).pathname.split("/").pop() || ""); } catch { return ""; } };
const fit = (s, min, max) => {
    let v = s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, "") : s;
    while (v.length < min) v = `${v} | Overview`.trim();
    return v.slice(0, max);
};

function suggested(request, inst) {
    if (!request.wantsValue) return null;
    const { min, max } = request.valueRules;
    const head = inst.evidence?.head || {};
    if (request.type.startsWith("image-alt")) {
        const name = words(fileName(inst.affectedUrl));
        return name ? fit(`${name[0].toUpperCase()}${name.slice(1)} image`, min, max) : null;
    }
    const base = head.h1s?.[0] || head.title || words(fileName(inst.affectedUrl)) || "Page";
    if (request.type.startsWith("description")) return fit(`${base}: ${head.headings?.map((h) => h.text).slice(1, 3).join(", ") || "what this page covers and why it matters to visitors"}.`, min, max);
    return fit(base, min, max);
}

function explain(request) {
    const g = request.standardGuidance;
    return {
        type: request.type,
        summary: `${g.summary} SiteFix found ${request.totalInstances} on this site.`,
        why: g.why,
        fixSteps: g.fix,
        instances: request.instances.map((i) => ({
            id: i.id,
            explanation: `${i.detail} (${i.affectedUrl}).`,
            suggestedValue: suggested(request, i),
        })),
    };
}

// The mock cannot understand questions; it shows which issues match the question's
// words, and says plainly when nothing matched (the real model answers properly).
function chat({ question, data }) {
    const top = data.issues.slice(0, 3);
    const lines = top.map((i) => `- ${i.title} (${i.priority}): ${i.explanation}`);
    if (!data.matched) {
        return {
            answer: `[Mock AI] No issue in the report of ${data.site} matches "${question}". The ${top.length} highest-priority issues are:\n${lines.join("\n")}`,
            issueIds: top.map((i) => i.id),
        };
    }
    return {
        answer: `[Mock AI] Issues in the report of ${data.site} (${data.totals.issues} in total) that match "${question}":\n${lines.join("\n")}`,
        issueIds: top.map((i) => i.id),
    };
}

export function mockRespond({ user }) {
    if (user && typeof user.question === "string") return chat(user);
    return explain(user);
}
