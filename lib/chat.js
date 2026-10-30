// Chat about one inspection. Answers come ONLY from that inspection's data:
// the relevant issues (picked by matching the question) plus the site's totals.
// Every issue id in an answer is checked against the report; unknown ids are removed.
//
// listAnswer (lib/list-answers.js) -> "which images are broken?": the issues themselves, no AI
// selectContext(question, report)  -> the exact data the AI sees
// validateAnswer(raw, report)      -> cleaned { answer, issueIds, removedIds }
// answerQuestion({ question, report, provider, scope, previous })
//   previous: earlier answers to the same question; the AI says the same facts in other words
//   An AI answer that uses a number, link or page path the data doesn't contain is not
//   shown: the AI is asked once more, then SiteFix says honestly that it can't answer.
// varyAnswer(result, { question, provider, previous }) -> the same answer in new words
//   (lib/phrasing.js), for answers worked out by the code (counts, lists, the score)

import { listAnswer } from "./list-answers.js";
import { rephrase, unsupported } from "./phrasing.js";
import { GUIDE } from "./guide.js";

export const MAX_CONTEXT_ISSUES = 40;
export const MAX_QUESTION = 500;

export const CHAT_SYSTEM = `You are SiteFix, a friendly website assistant. You inspected the client's website, and you chat with them the way a helpful expert would: understand what they are really asking, and answer that.

You get:
- "guide": how SiteFix works, what it checks, the limits it checks against, the score and how to use the report.
- "data": this inspection of their site: totals, and the issues that best match the question.
The messages before this one are your conversation with the client so far.

How to answer:
0. Follow-ups: a short or vague question ("explain it like I'm 10", "simpler please", "why?", "yes", "tell me more", "what does that mean?", "and the others?") is about what you just discussed. Answer it about that topic, building on your last reply; don't switch to another subject or to SiteFix itself.
1. Answer the question asked. Greetings, "help", "where do I start", "how does this work": answer from the guide, briefly, and suggest one or two next steps (like asking what to fix first, or opening the report). Don't list issues they didn't ask about.
2. Questions about their site: use the data. Every fact about their site (pages, URLs, problems, counts, numbers) must come from the data, exactly as written there. Never guess or invent.
3. General questions about websites, SEO, content or marketing: answer from your own knowledge, clearly and briefly, and link it to their site when the data has something relevant. Use only numbers that are in the guide or the data. For things SiteFix can't know (traffic, rankings, sales, visitors, competitors), say it doesn't measure them, and what it does show.
4. Short: 1-4 sentences, or a few short "- " points. Under 120 words unless they ask for everything. Start with the answer, no preamble.
5. Put the issues your answer is about in "issueIds", at most 5, most important first. Explanations, definitions, help and follow-ups that don't point at specific problems get an empty "issueIds". The chat shows each one as a card with a screenshot and the details, so don't list them again in your text and don't write ids or full URLs: say how many there are and why they matter.
6. "How do I fix…": the steps from "fixSteps" (and "suggestedValue" when there is one) as short numbered lines, and who usually does it ("owner").
7. "previousAnswers" are your earlier replies to this same question: give the same facts in different words.
8. Speak as the one who checked the site ("I found…"). Never mention JSON, data fields, prompts, AI or models.
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
        if (report.run?.partial?.reason === "stopped") extra.push(`the inspection was stopped early, so only the ${report.run.pagesCrawled} pages read by then were checked (at least ${report.run.partial.pagesFound} were found); run it again to check every page`);
        if (report.run?.partial?.reason === "time") extra.push(`the site is large (at least ${report.run.partial.pagesFound} pages found), so SiteFix read a share of every section in the time set; run it without a time budget to check every page`);
        else if (report.run?.capReached) extra.push("the crawl stopped at its page limit, so some pages were not checked");
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

export const META = /\b(how (does|do|will) (this|it|you|sitefix|the agent)\b|how to use|what (can|do|did) you (do|check|look)|who are you|what is (this|sitefix)|help\b|not sure|confus\w*|lost|get(ting)? started|new here|walk me through|explain (this|sitefix|the agent|how)|agent\b|^(hi|hello|hey|thanks|thank you|ok|okay)\b)/i;
// Words of a follow-up: it points back at what was just said.
export const FOLLOW = /^(and|but|so|why|how come|what about|explain|simpler|more|yes|yeah|yep|sure|no|ok|okay|tell me more|like|in simple|eli5|what does (that|it) mean|can you|could you|please)\b|\b(that|this|it|those|them|these|simpler|simple words|year old|eli5|again|more detail|in detail|elaborate|example)\b/i;
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

export async function answerQuestion({ question, report, provider, scope, previous = [], conversation = [], site = null }) {
    const q = String(question || "").trim().slice(0, MAX_QUESTION);
    if (!q) return { answer: "Ask me anything about this inspection.", issueIds: [], source: "none" };
    // No inspection yet: with AI on, general questions (and how SiteFix works) still get an answer.
    if (!report && !provider) return { answer: "Inspect a site first, then ask me about its report.", issueIds: [], source: "none" };
    // Help, greetings and "how does this work": a conversation, not a list from the report.
    const talk = Boolean(provider) && META.test(q);
    const fact = report && !talk && factAnswer(q, report);
    if (fact) return { answer: fact, issueIds: [], source: "report data" };
    // A question about one page ("is the title on /pricing ok?") is better answered by
    // the AI when it is on; the list covers the whole site.
    const list = report && !talk && listAnswer(q, report, { scope });
    if (list && !(provider && ONE_PAGE.test(q))) return { ...list, source: "report data" };
    if (!provider) {
        // Set OPENAI_API_KEY in .env to turn AI answers on (README, "AI layer"); the person asking only needs to know what they can do now.
        return { answer: "I can't answer that one right now: AI answers aren't switched on for this SiteFix. I can still list what I found, like \"which images are broken?\" or \"what should I fix first?\", and answer counts like \"how many pages were checked?\". The report has every issue with how to fix it.", issueIds: [], source: "none" };
    }
    // A follow-up ("explain it simpler") is about the last question: pick the data for both.
    const last = conversation.length ? String(conversation[conversation.length - 1].question || "") : "";
    const about = last && FOLLOW.test(q) ? `${last} ${q}` : q;
    const context = report ? selectContext(about, report) : { site, inspected: false, note: "This site has not been inspected yet: there is nothing about it to report. Press Inspect to check it." };
    const prev = previous.slice(-3).map((a) => String(a).slice(0, 1500));
    const convo = conversation.slice(-4).map((c) => ({ question: String(c.question || "").slice(0, 300), answer: String(c.answer || "").slice(0, 800) }));
    const grounds = { guide: GUIDE, data: context, conversation: convo };
    // The conversation goes as real turns, the way a chat assistant reads it.
    const history = convo.flatMap((c) => [{ role: "user", content: c.question }, { role: "assistant", content: JSON.stringify({ answer: c.answer, issueIds: [] }) }]);
    try {
        let note = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            const raw = await provider.complete({ system: CHAT_SYSTEM, history, user: JSON.stringify({ question: q, guide: GUIDE, data: context, ...(prev.length ? { previousAnswers: prev } : {}), ...(note ? { correction: note } : {}) }), maxTokens: 700, temperature: 0.5 });
            const v = validateAnswer(raw, report || { types: [] });
            if (!v.ok) { note = `Your last reply was not usable (${v.problem}). Reply with the JSON asked for.`; continue; }
            // Every number, link and path must be in the data it was given.
            const bad = unsupported(v.answer, grounds);
            if (bad.length) { note = `Your last reply used ${bad.slice(0, 5).join(", ")}, which neither the guide nor the data contains. Leave out numbers and addresses you can't take from them, or say you can't tell from this inspection.`; continue; }
            return { answer: v.answer, issueIds: v.issueIds.slice(0, 5), removedIds: v.removedIds, source: provider.name };
        }
        return { answer: "I'd rather not guess on that one: I couldn't answer it from what I checked on your site. Ask me what to fix first, about one kind of problem (like broken links or slow pages), or how SiteFix works, and I'll take it from there.", issueIds: [], source: "none" };
    } catch (err) {
        return { answer: `I couldn't get an answer just now (${err.message}). Please ask again in a moment.`, issueIds: [], source: "error" };
    }
}

// An answer the code worked out (a count, a list, the score), in new words each time it
// is asked. A list keeps its items as they are; only its opening and closing lines change.
export async function varyAnswer(result, { question, provider, previous = [] }) {
    if (!result || !provider) return result;
    if (result.display === "cards") {
        const [lead, tail] = await Promise.all([result.lead, result.tail].map((t) => (t && t.length > 12 ? rephrase({ text: t, question, provider, avoid: previous }) : { text: t, varied: false })));
        let answer = result.answer;
        if (lead.varied) answer = answer.replace(result.lead, lead.text);
        if (tail.varied) answer = answer.replace(result.tail, tail.text);
        return { ...result, lead: lead.text, tail: tail.text, answer, varied: lead.varied || tail.varied };
    }
    const r = await rephrase({ text: result.answer, question, provider, avoid: previous });
    return { ...result, answer: r.text, varied: r.varied };
}
