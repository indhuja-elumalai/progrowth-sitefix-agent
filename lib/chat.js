// Chat about one inspection. Answers come ONLY from that inspection's data:
// the relevant issues (picked by matching the question) plus the site's totals.
// Every issue id in an answer is checked against the report; unknown ids are removed.
//
// listAnswer (lib/list-answers.js) -> "which images are broken?": the issues themselves, no AI
// selectContext(question, report)  -> the exact data the AI sees
// validateAnswer(raw, report)      -> cleaned { answer, issueIds, removedIds }
// answerQuestion({ question, report, provider })

import { listAnswer } from "./list-answers.js";

export const MAX_CONTEXT_ISSUES = 40;
export const MAX_QUESTION = 500;

export const CHAT_SYSTEM = `You are SiteFix, the assistant who just inspected this website. You answer the client's questions about ONE inspection, using ONLY the JSON data you are given.

Rules:
1. Every fact (pages, URLs, problems, fixes, numbers) must come from the data. Never guess or invent.
2. Start with the direct answer in one short sentence. No preamble, no "Based on the data".
3. When you name specific problems, write one "- " line each: what is wrong and the page path (e.g. "/pricing"), in plain words. Put every issue you mention in "issueIds": the chat shows each one as a card with a screenshot of the page and a link to the report, so do not write ids or full URLs in the text.
4. For "how do I fix…", give the steps from "fixSteps" (and "suggestedValue" when there is one) as short numbered lines, and say who usually does it ("owner").
5. Do not repeat totals or counts unless asked. Keep it under 120 words unless the user asks for everything.
6. If the data does not contain the answer, say so in one sentence and say what the inspection does cover. No generic advice.
7. "issues" may be a selection; if "omittedIssues" > 0 and it matters, say the full list is in the report.
8. Speak as the one who checked the site ("I found…"). Never mention JSON, data fields, AI or models.
9. Reply with JSON only: {"answer": "...", "issueIds": ["ISS-..."]}`;

const STOP = new Set(["the", "and", "for", "are", "was", "were", "been", "being", "will", "what", "which", "where", "when", "how", "why", "who", "whom", "does", "did", "doing", "can", "should", "would", "could", "there", "their", "they", "them", "then", "than", "this", "that", "these", "those", "with", "from", "have", "has", "had", "any", "all", "about", "into", "onto", "your", "you", "our", "its", "site", "website", "page", "pages", "issue", "issues", "problem", "problems", "tell", "show", "list", "give", "please", "found", "many", "much", "most", "more", "some", "fix", "fixed", "also", "just", "get", "got", "use", "used", "need", "needs", "want", "wrong", "thing", "things", "know", "explain", "inspection", "report"]);
// Words of 3+ letters, minus filler words; plurals also match their singular ("images" -> "image").
const tokens = (s) => {
    const words = (String(s || "").toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []).filter((t) => !STOP.has(t));
    return [...new Set(words.flatMap((t) => (t.length > 4 && t.endsWith("s") ? [t, t.slice(0, -1)] : [t])))];
};

// Whole words in a text, plus singular forms, so "were" never matches "powered".
const wordSet = (text) => {
    const words = String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return new Set(words.flatMap((w) => (w.length > 4 && w.endsWith("s") ? [w, w.slice(0, -1)] : [w])));
};

const URGENT = /\b(first|urgent|priorit|important|critical|worst|serious|p1|top)\w*/i;
const QUICK = /\b(quick|easy|simple|fast|low[- ]hanging)\w*/i;

const flatIssues = (report) => report.types.flatMap((t) => t.issues.map((i) => ({ ...i, title: t.title, fixSteps: t.fixSteps })));

// The facts behind an issue, small enough for the AI: status codes, sizes, the quoted
// mistakes and their corrections; never whole page heads or long lists.
export function compactEvidence(e) {
    if (!e || typeof e !== "object") return null;
    const out = {};
    for (const k of ["kind", "status", "bytes", "hops", "finalUrl", "finalStatus", "words", "title", "error"]) if (e[k] != null && e[k] !== "") out[k] = e[k];
    if (Array.isArray(e.matches)) out.matches = e.matches.slice(0, 5).map((m) => ({ text: m.text, correction: m.correction ?? undefined }));
    if (Array.isArray(e.chain)) out.chain = e.chain.slice(0, 6).map((c) => (typeof c === "string" ? c : { url: c.url, status: c.status }));
    return out;
}

export function selectContext(question, report, limit = MAX_CONTEXT_ISSUES) {
    const all = flatIssues(report);
    const q = tokens(question);
    const urgent = URGENT.test(question), quick = QUICK.test(question);
    const scored = all.map((i) => {
        const hay = {
            strong: wordSet(`${i.type} ${i.title} ${i.category}`),
            url: wordSet(i.affectedUrl),
            weak: wordSet(`${i.detail} ${i.explanation}`),
        };
        let score = 0;
        for (const t of q) {
            if (hay.strong.has(t)) score += 3;
            if (hay.url.has(t)) score += 2;
            if (hay.weak.has(t)) score += 1;
        }
        if (urgent && i.priority === "P1") score += 3;
        if (quick && i.quickWin) score += 3;
        return { i, score };
    });
    const order = { P1: 0, P2: 1, P3: 2 };
    const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || order[a.i.priority] - order[b.i.priority]);
    const pick = (matched.length ? matched.map((s) => s.i) : [...all].sort((a, b) => order[a.priority] - order[b.priority])).slice(0, limit);

    const count = (key) => all.reduce((acc, i) => ((acc[i[key]] = (acc[i[key]] || 0) + 1), acc), {});
    return {
        site: report.run?.startUrl || null,
        inspectedAt: report.run?.finishedAt || report.run?.startedAt || null,
        pagesCrawled: report.run?.pagesCrawled ?? null,
        totals: { issues: all.length, byPriority: count("priority"), byCategory: count("category"), byType: count("type"), quickWins: all.filter((i) => i.quickWin).length },
        detectorSummaries: report.summaries || {},
        issues: pick.map((i) => ({
            id: i.id, type: i.type, title: i.title, category: i.category, severity: i.severity, priority: i.priority,
            effort: i.effort, owner: i.owner, quickWin: i.quickWin, affectedUrl: i.affectedUrl,
            foundOnCount: (i.foundOn || []).length, foundOn: (i.foundOn || []).slice(0, 3), detail: i.detail,
            explanation: i.explanation, fixSteps: i.fixSteps, suggestedValue: i.suggestedValue || null,
            evidence: compactEvidence(i.evidence), hasScreenshot: Boolean(i.screenshot),
        })),
        omittedIssues: Math.max(0, all.length - pick.length),
        matched: matched.length > 0, // false: no issue matched the question's words; "issues" are the top priorities instead
    };
}

// ---------- questions with an exact answer in the data ----------
// Counts are answered straight from the report: exact, free, and the same with or without AI.
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export function factAnswer(question, report) {
    const q = String(question || "").toLowerCase();
    if (!/\b(how many|number of|count|total)\b/.test(q)) return null;
    const all = flatIssues(report);
    const site = report.run?.startUrl || "the site";
    const s = report.summaries || {};
    if (/\bpages?\b/.test(q) && /\b(crawl|scan|inspect|check|visit|analy)\w*/.test(q) || /\bhow many pages\b/.test(q)) {
        const n = report.run?.pagesCrawled;
        if (n == null) return null;
        const extra = [];
        if (s.links?.sitemapUrls) extra.push(`${s.links.sitemapUrls} URLs were listed in its sitemap`);
        if (report.run?.capReached) extra.push("the crawl stopped at its page limit, so some pages were not checked");
        return `SiteFix crawled ${plural(n, "page")} on ${site}${extra.length ? `; ${extra.join("; ")}` : ""}.`;
    }
    if (/\blinks?\b/.test(q) && s.links?.linksChecked != null) {
        return `SiteFix checked ${plural(s.links.linksChecked, "distinct link")} on ${site}: ${s.links.ok ?? 0} working, ${s.links.broken ?? 0} broken, ${s.links.redirecting ?? 0} redirecting, ${s.links.unverified ?? 0} could not be verified.`;
    }
    if (/\bimages?\b/.test(q) && s.images?.imagesFound != null) {
        return `SiteFix found ${plural(s.images.imagesFound, "distinct image")} on ${site}: ${s.images.broken ?? 0} broken, ${s.images.altMissing ?? 0} missing alt text, ${s.images.oversized ?? 0} over the size limit.`;
    }
    const pr = { P1: 0, P2: 0, P3: 0 };
    for (const i of all) pr[i.priority] = (pr[i.priority] || 0) + 1;
    const m = q.match(/\bp([123])\b/);
    if (m) return `${plural(pr[`P${m[1]}`], "issue")} on ${site} ${pr[`P${m[1]}`] === 1 ? "is" : "are"} P${m[1]} (${{ 1: "fix first", 2: "fix soon", 3: "when you can" }[m[1]]}).`;
    if (/\bquick wins?\b/.test(q)) return `${site} has ${plural(all.filter((i) => i.quickWin).length, "quick win")} (easy fixes rated P1 or P2).`;
    if (/\b(issues?|problems?|errors?)\b/.test(q)) {
        const cats = {};
        for (const i of all) cats[i.category] = (cats[i.category] || 0) + 1;
        const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(", ");
        return `SiteFix found ${plural(all.length, "issue")} on ${site}: ${pr.P1} P1 (fix first), ${pr.P2} P2, ${pr.P3} P3. By category: ${top}.`;
    }
    return null;
}

const ONE_PAGE = /(^|\s)\/[a-z0-9]|\bhome ?page\b|\b(on|of|for) (the|my|our) [a-z0-9-]+ page\b/i;
const ID_RE = /ISS-[0-9a-f]{10}/g;

export function validateAnswer(raw, report) {
    let a;
    try { a = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return { ok: false, problem: "answer was not valid JSON" }; }
    if (!a || typeof a.answer !== "string" || !a.answer.trim()) return { ok: false, problem: "answer was empty" };
    const known = new Set(flatIssues(report).map((i) => i.id));
    const removed = new Set();
    let answer = a.answer.trim().slice(0, 3000).replace(ID_RE, (id) => {
        if (known.has(id)) return id;
        removed.add(id);
        return "(unknown issue)";
    });
    const ids = [...new Set([...(Array.isArray(a.issueIds) ? a.issueIds : []), ...(answer.match(ID_RE) || [])])];
    for (const id of ids) if (!known.has(id)) removed.add(id);
    return { ok: true, answer, issueIds: ids.filter((id) => known.has(id)), removedIds: [...removed] };
}

export async function answerQuestion({ question, report, provider, scope }) {
    const q = String(question || "").trim().slice(0, MAX_QUESTION);
    if (!q) return { answer: "Ask me anything about this inspection.", issueIds: [], source: "none" };
    if (!report) return { answer: "Inspect a site first, then ask me about its report.", issueIds: [], source: "none" };
    const fact = factAnswer(q, report);
    if (fact) return { answer: fact, issueIds: [], source: "report data" };
    // A question about one page ("is the title on /pricing ok?") is better answered by
    // the AI when it is on; the list covers the whole site.
    const list = listAnswer(q, report, { scope });
    if (list && !(provider && ONE_PAGE.test(q))) return { ...list, source: "report data" };
    if (!provider) {
        // Set OPENAI_API_KEY in .env to turn AI answers on (README, "AI layer"); the person asking only needs to know what they can do now.
        return { answer: "I can't answer that one right now: AI answers aren't switched on for this SiteFix. I can still list what I found, like \"which images are broken?\" or \"what should I fix first?\", and answer counts like \"how many pages were checked?\". The report has every issue with how to fix it.", issueIds: [], source: "none" };
    }
    const context = selectContext(q, report);
    try {
        const raw = await provider.complete({ system: CHAT_SYSTEM, user: JSON.stringify({ question: q, data: context }), maxTokens: 700 });
        const v = validateAnswer(raw, report);
        if (!v.ok) return { answer: `I could not produce a reliable answer (${v.problem}). Please try rephrasing.`, issueIds: [], source: "error" };
        return { answer: v.answer, issueIds: v.issueIds, removedIds: v.removedIds, source: provider.name };
    } catch (err) {
        return { answer: `The AI service did not answer: ${err.message}`, issueIds: [], source: "error" };
    }
}
