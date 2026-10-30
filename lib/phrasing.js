// The words of the chat's answers. The facts always come from the inspection (the code
// works them out: counts, lists, the score, how far along an inspection is); AI only
// says them in its own words, so the same question isn't answered word for word the
// same way twice. A rewording is used only when it keeps every fact and adds none:
//   every number, link, page path and **bold** name of the original is still there,
//   no number, link or path is new, and the "- " lines are the same in number.
// Otherwise (or when AI is off, slow or fails) the original words are used: an answer
// is never made less exact to make it sound different.
//
// rephrase({ text, question, provider, avoid, timeoutMs }) -> { text, varied }
//   avoid: earlier answers to the same question, to be worded differently
// factsKept(original, rewrite) -> { ok, problem }
// unsupported(answer, data) -> the numbers, links and paths in an AI answer that the data
//   it was given doesn't contain (an answer with any is not shown)
// sameQuestion(a, b) -> true for the same question asked again ("What's my score?" / "whats my score")

export const PHRASE_TIMEOUT_MS = 2500;
export const MAX_PHRASE = 2500;

export const PHRASE_SYSTEM = `You reword one chat message from SiteFix, the assistant who inspected a website, so the client doesn't get word-for-word the same reply twice.

Rules:
1. Keep every fact exactly: every number, time, percentage, URL, page path (like /pricing) and every text between ** ** must appear unchanged (keep the ** **).
2. Add nothing: no new facts, numbers, pages, examples or advice. Leave out nothing that carries information.
3. Keep each "- " line as its own "- " line, in the same order, with the same facts. Keep the line breaks between parts.
4. About the same length or shorter, plain friendly words, speaking as "I" (the one who checked the site). Never mention AI, data or JSON.
5. "avoid" lists earlier replies to the same question: word this one differently from them.
Reply with JSON only: {"text": "..."}`;

const NUM = /\d+(?:[.,]\d+)*/g;
const LINK = /https?:\/\/[^\s)"'<>*]+|(?<![\w.:/])\/[a-z0-9][^\s)"'<>*,]*/gi;
const BOLD = /\*\*(.+?)\*\*/g;
const trimEnd = (s) => s.replace(/[.,;:!?]+$/, "");

function factsOf(text) {
    const t = String(text || "");
    return {
        numbers: new Set((t.match(NUM) || []).map((n) => n.replace(/,/g, ""))),
        links: new Set((t.match(LINK) || []).map(trimEnd)),
        bold: [...t.matchAll(BOLD)].map((m) => m[1].trim()),
        bullets: t.split("\n").filter((l) => /^\s*-\s+/.test(l)).length,
    };
}

export function factsKept(original, rewrite) {
    const a = factsOf(original), b = factsOf(rewrite);
    const o = String(original || ""), r = String(rewrite || "");
    if (!r.trim()) return { ok: false, problem: "empty" };
    for (const n of a.numbers) if (!b.numbers.has(n)) return { ok: false, problem: `lost the number ${n}` };
    for (const n of b.numbers) if (!a.numbers.has(n)) return { ok: false, problem: `added the number ${n}` };
    for (const l of a.links) if (!b.links.has(l)) return { ok: false, problem: `lost ${l}` };
    for (const l of b.links) if (!a.links.has(l)) return { ok: false, problem: `added ${l}` };
    for (const x of a.bold) if (!r.includes(x)) return { ok: false, problem: `lost "${x}"` };
    if (a.bullets !== b.bullets) return { ok: false, problem: "changed the list" };
    if (r.length > o.length * 1.6 + 40 || r.length < o.length * 0.45) return { ok: false, problem: "length" };
    return { ok: true };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("too slow")), ms))]);

export async function rephrase({ text, question = "", provider, avoid = [], timeoutMs = PHRASE_TIMEOUT_MS }) {
    const original = String(text || "");
    if (!provider || !original.trim() || original.length > MAX_PHRASE) return { text: original, varied: false };
    try {
        const raw = await withTimeout(provider.complete({
            system: PHRASE_SYSTEM,
            user: JSON.stringify({ task: "rephrase", question: String(question).slice(0, 500), message: original, avoid: avoid.slice(-3).map((a) => String(a).slice(0, 1500)) }),
            maxTokens: 700,
            temperature: 0.8,
        }), timeoutMs);
        const out = String(JSON.parse(raw)?.text || "").trim();
        if (!factsKept(original, out).ok) return { text: original, varied: false };
        return { text: out, varied: out !== original };
    } catch {
        return { text: original, varied: false };
    }
}

// An AI answer may only use numbers, links and paths that are in the data it was given.
// Small whole numbers (under 10) are let through: list positions and counts of the
// items it was shown.
export function unsupported(answer, data) {
    const hay = typeof data === "string" ? data : JSON.stringify(data);
    const nums = new Set((hay.match(NUM) || []).map((n) => n.replace(/,/g, "")));
    const out = [];
    for (const raw of String(answer || "").match(NUM) || []) {
        const n = raw.replace(/,/g, "");
        if (!n.includes(".") && Number(n) < 10) continue;
        if (!nums.has(n) && !hay.includes(n)) out.push(n);
    }
    for (const l of (String(answer || "").match(LINK) || []).map(trimEnd)) if (!hay.includes(l)) out.push(l);
    return [...new Set(out)];
}

const norm = (q) => String(q || "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(s|is|the|a|an|my|me)\b/g, " ").replace(/\s+/g, " ").trim();
export function sameQuestion(a, b) {
    const x = norm(a);
    return Boolean(x) && x === norm(b);
}
