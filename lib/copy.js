// Spelling and grammar in page copy. Two layers:
//   1. A built-in list of common misspellings: no key, no cost, same answer every time.
//   2. AI proofreading of each page's own text (menus and footers removed), behind
//      guardrails: every flagged phrase must appear word for word on the page, and a
//      word the site uses on several pages is treated as a brand or term, not a typo.
//
// dictionaryFindings(text)                   -> common misspellings found in a text
// siteVocabulary(texts)                      -> how many pages use each word
// buildCopyRequest(url, text)                -> the exact JSON the AI sees
// validateCopyAnswer(raw, text, opts)        -> cleaned findings + problems
// checkCopy({ pages, provider, cache })      -> registry drafts for every page

import { createHash } from "node:crypto";

export const COPY_LIMITS = {
    maxCharsPerPage: 6000, // text sent to the AI per page
    maxFindingsPerPage: 8,
    brandPages: 3, // a word on this many pages or more is the site's own vocabulary
    concurrency: 8, // pages proofread by the AI at the same time
};

// wrong -> right. Only words that are never correct English, so no false alarms.
export const COMMON_MISSPELLINGS = {
    accomodate: "accommodate", accomodation: "accommodation", acheive: "achieve", acheived: "achieved", acknowlege: "acknowledge",
    adress: "address", agressive: "aggressive", allready: "already", alot: "a lot", amature: "amateur", apparantly: "apparently",
    appearence: "appearance", arguement: "argument", assesment: "assessment", basicly: "basically", beacuse: "because",
    becuase: "because", beggining: "beginning", begining: "beginning", beleive: "believe", belive: "believe", buisness: "business",
    bussiness: "business", calender: "calendar", catagory: "category", cemetary: "cemetery", collegue: "colleague",
    comming: "coming", commited: "committed", commitee: "committee", completly: "completely", concious: "conscious",
    definately: "definitely", definatly: "definitely", dissapoint: "disappoint", embarass: "embarrass", enviroment: "environment",
    equiptment: "equipment", excercise: "exercise", existance: "existence", experiance: "experience", familar: "familiar",
    finaly: "finally", foriegn: "foreign", fourty: "forty", freind: "friend", goverment: "government", gaurantee: "guarantee",
    guarentee: "guarantee", happend: "happened", harrass: "harass", immediatly: "immediately", independant: "independent",
    infomation: "information", knowlege: "knowledge", liason: "liaison", libary: "library", lisence: "license",
    maintainance: "maintenance", maintenence: "maintenance", managment: "management", millenium: "millennium",
    mispell: "misspell", neccessary: "necessary", necessery: "necessary", noticable: "noticeable", occassion: "occasion",
    occured: "occurred", occurence: "occurrence", occurrance: "occurrence", oppurtunity: "opportunity", opportunites: "opportunities",
    persistant: "persistent", posession: "possession", potentialy: "potentially", prefered: "preferred", presense: "presence",
    privelege: "privilege", priviledge: "privilege", probaly: "probably", profesional: "professional", proffesional: "professional",
    publically: "publicly", realy: "really", recieve: "receive", recieved: "received", reccomend: "recommend", recomend: "recommend",
    recommand: "recommend", refered: "referred", relevent: "relevant", responsability: "responsibility", resturant: "restaurant",
    seperate: "separate", seperately: "separately", sieze: "seize", sincerly: "sincerely", succesful: "successful",
    successfull: "successful", sucessful: "successful", supercede: "supersede", suprise: "surprise", tecnology: "technology",
    teh: "the", tendancy: "tendency", thier: "their", threshhold: "threshold", tommorow: "tomorrow", tomorow: "tomorrow",
    truely: "truly", untill: "until", wether: "whether", wierd: "weird", wich: "which", writting: "writing",
};

const matchCase = (wrong, right) => (wrong[0] === wrong[0].toUpperCase() ? right[0].toUpperCase() + right.slice(1) : right);

// The sentence around a match: from the previous sentence end (or line start) to the
// next one, at most ~60 characters each side, never cutting a word in half.
const snippet = (text, index, len) => {
    const lineStart = text.lastIndexOf("\n", index) + 1;
    let lineEnd = text.indexOf("\n", index + len);
    if (lineEnd === -1) lineEnd = text.length;
    const before = text.slice(Math.max(lineStart, index - 60), index);
    const sentenceStart = before.search(/[.!?]\s+[^.!?]*$/);
    let start = sentenceStart === -1 ? Math.max(lineStart, index - 60) : index - before.length + sentenceStart + 1;
    if (sentenceStart === -1 && start > lineStart) start = text.indexOf(" ", start) + 1 || start;
    const after = text.slice(index + len, Math.min(lineEnd, index + len + 60));
    const sentenceEnd = after.search(/[.!?](\s|$)/);
    let end = sentenceEnd === -1 ? index + len + after.length : index + len + sentenceEnd + 1;
    if (sentenceEnd === -1 && end < lineEnd) { const sp = text.lastIndexOf(" ", end); if (sp > index + len) end = sp; }
    return text.slice(start, end).trim();
};

export function dictionaryFindings(text) {
    const out = [];
    const seen = new Set();
    for (const m of String(text || "").matchAll(/[A-Za-z]+/g)) {
        const right = COMMON_MISSPELLINGS[m[0].toLowerCase()];
        if (!right || seen.has(m[0].toLowerCase())) continue;
        seen.add(m[0].toLowerCase());
        const context = snippet(text, m.index, m[0].length);
        out.push({
            kind: "spelling",
            text: context,
            correction: context.replace(m[0], matchCase(m[0], right)),
            explanation: `"${m[0]}" is a common misspelling of "${right}".`,
            source: "dictionary",
            word: m[0].toLowerCase(),
        });
    }
    return out;
}

// ---------- site vocabulary (brand names, product names, local terms) ----------
const wordsOf = (s) => String(s || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || [];
export function siteVocabulary(texts) {
    const pages = new Map();
    for (const t of texts) for (const w of new Set(wordsOf(t))) pages.set(w, (pages.get(w) || 0) + 1);
    return pages;
}

// ---------- AI request ----------
export const COPY_SYSTEM = `You proofread website copy for a business. You receive the visible text of ONE web page (menus and footers removed).

Report ONLY clear mistakes a professional editor would definitely fix:
- "spelling": a misspelled word.
- "grammar": a clear grammar error (wrong verb form, subject-verb agreement, wrong word such as "their/there", missing or doubled word).

Do NOT report: brand, product, company, people or place names; technical terms and acronyms; URLs, emails, code; British vs American spelling (both are correct); style, tone or word choice that is already correct; optional commas; spacing around punctuation or symbols; capitalisation; missing full stops; marketing sentence fragments; headings, buttons or list items that are not full sentences; text cut off mid-word; anything you are not sure about.

For each mistake:
- "text": the erroneous phrase copied EXACTLY from the input, character for character (about 4 to 15 words, enough to find it).
- "correction": the same phrase with only the mistake fixed.
- "kind": "spelling" or "grammar".
- "explanation": one short sentence in plain language.

At most 8 findings. If there are no clear mistakes, return an empty list. Reply with JSON only:
{"findings": [{"text": "...", "correction": "...", "kind": "spelling", "explanation": "..."}]}`;

// The page text sent to the AI: at most maxCharsPerPage, cut at a sentence or word end
// so the model never sees (and "corrects") a half word.
export function copyText(text, limits = COPY_LIMITS) {
    const t = String(text || "");
    if (t.length <= limits.maxCharsPerPage) return t;
    const head = t.slice(0, limits.maxCharsPerPage);
    const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("\n"), head.lastIndexOf("! "), head.lastIndexOf("? "));
    if (sentence > limits.maxCharsPerPage * 0.6) return head.slice(0, sentence + 1);
    const space = head.lastIndexOf(" ");
    return space > 0 ? head.slice(0, space) : head;
}

export function buildCopyRequest(url, text, limits = COPY_LIMITS) {
    return { task: "proofread", url, text: copyText(text, limits) };
}

// ---------- guardrails ----------
// Same characters in the same order: curly quotes, dashes, non-breaking and zero-width spaces evened out.
const tidy = (s) => String(s || "").normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, "-");
const squash = (s) => tidy(s).replace(/\s+/g, " ").trim();

// British and American spellings of the same word map to one form (realise/realize,
// colour/color, centre/center, travelled/traveled, licence/license, analyse/analyze).
const usForm = (w) => (w.length < 5 ? w : w
    .replace(/is(ation|ations|e|es|ed|ing|er|ers)$/, "iz$1")
    .replace(/ys(e|es|ed|ing)$/, "yz$1")
    .replace(/our(s|ed|ing|ful|ite|ites|able)?$/, "or$1")
    .replace(/tre(s)?$/, "ter$1")
    .replace(/^(travel|cancel|model|label|level|signal|fuel|channel|total|counsel|marvel|jewel)l(ed|ing|er|ers)$/, "$1$2")
    .replace(/ogue(s)?$/, "og$1")
    .replace(/^(lic|def|off|pret)ence(s)?$/, "$1ense$2"));

// The words alone: spacing, case, punctuation, symbols and UK/US spelling ignored. If a
// "correction" has the same words as the original, it is a style choice (350 % / 350%,
// b2b / B2B, "problem , they're", a missing full stop), not a mistake. Words keep their
// boundaries, so "atleast" → "at least" still counts as a real fix.
const skeleton = (s) => (squash(s).toLowerCase().match(/[a-z0-9']+/g) || []).map(usForm).join(" ");

// options: { siteVocab: Map, allowWords: Set (lowercase), limits }
export function validateCopyAnswer(raw, text, { siteVocab = new Map(), allowWords = new Set(), limits = COPY_LIMITS } = {}) {
    let a;
    try { a = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return { ok: false, findings: [], problems: ["answer was not valid JSON"] }; }
    if (!a || !Array.isArray(a.findings)) return { ok: false, findings: [], problems: ["answer has no findings list"] };
    const page = squash(text);
    const problems = [];
    const findings = [];
    for (const f of a.findings) {
        const quote = squash(f?.text);
        const fix = squash(f?.correction);
        if (!["spelling", "grammar"].includes(f?.kind)) { problems.push(`unknown kind "${f?.kind}"`); continue; }
        if (quote.length < 3 || quote.length > 300) { problems.push("quote too short or too long"); continue; }
        if (!page.includes(quote)) { problems.push(`quote not found on the page: "${quote.slice(0, 60)}"`); continue; }
        if (!fix || fix === quote) { problems.push(`no real correction for "${quote.slice(0, 60)}"`); continue; }
        if (skeleton(fix) === skeleton(quote)) { problems.push(`style only, not a mistake: "${quote.slice(0, 60)}" → "${fix.slice(0, 60)}"`); continue; }
        if (fix.length > quote.length * 2 + 20 || fix.length < quote.length / 2) { problems.push(`correction rewrites too much: "${quote.slice(0, 60)}"`); continue; }
        // Words the AI wants to change: if the site uses one on several pages, or it is
        // on the allow list, it is the site's own vocabulary (a brand or term), not a typo.
        const fixWords = new Set(wordsOf(fix));
        const quoteWords = wordsOf(quote);
        const changed = quoteWords.filter((w) => !fixWords.has(w));
        // A cut-off last word ("Monthly Packa" → "Monthly Package") is truncated text, not a typo.
        const last = quoteWords[quoteWords.length - 1];
        if (changed.length === 1 && changed[0] === last && [...fixWords].some((w) => w.startsWith(last) && w !== last)) { problems.push(`cut-off word, not a typo: "${quote.slice(-30)}"`); continue; }
        const own = changed.find((w) => allowWords.has(w) || (siteVocab.get(w) || 0) >= limits.brandPages);
        if (own) { problems.push(`"${own}" is used across the site (brand or term), skipped`); continue; }
        if (findings.some((x) => x.text === quote)) continue;
        findings.push({ kind: f.kind, text: quote, correction: fix, explanation: squash(f.explanation).slice(0, 200) || null, source: "ai" });
        if (findings.length >= limits.maxFindingsPerPage) break;
    }
    return { ok: true, findings, problems };
}

// ---------- orchestration ----------
async function mapPool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
    }));
    return out;
}

const TYPE = { spelling: "copy-spelling", grammar: "copy-grammar" };

function drafts(page, findings) {
    const out = [];
    for (const kind of ["spelling", "grammar"]) {
        const list = findings.filter((f) => f.kind === kind);
        if (!list.length) continue;
        const first = list[0];
        const shared = new Set(list.flatMap((f) => f.alsoOn || [])).size;
        out.push({
            type: TYPE[kind],
            affectedUrl: page.url,
            foundOn: page.foundOn || [],
            detail: `${list.length} ${kind} mistake${list.length === 1 ? "" : "s"}, e.g. "${first.text.slice(0, 80)}" → "${first.correction.slice(0, 80)}"${shared ? ` (also on ${shared} other page${shared === 1 ? "" : "s"})` : ""}`,
            evidence: { kind: "content", matches: list.map((f) => ({ name: f.kind, text: f.text, correction: f.correction, explanation: f.explanation, source: f.source, alsoOn: (f.alsoOn || []).slice(0, 20) })) },
        });
    }
    return out;
}

// pages: [{ url, foundOn, text }]  (text = the page's own text, boilerplate removed)
// provider: AI provider or null (dictionary only). cache: { get, set } or null.
// budgetMs: no new AI call after that long (pages already answered, and cached answers,
// still count); the remaining pages get the dictionary check only. 0 = no limit.
// shouldStop: () => true once the inspection was stopped: no new AI call either.
export async function checkCopy({ pages, provider = null, cache = null, allowWords = new Set(), limits = COPY_LIMITS, budgetMs = 0, shouldStop = () => false, onProgress = () => {} }) {
    const siteVocab = siteVocabulary(pages.map((p) => p.text));
    const stats = { pagesChecked: pages.length, aiPagesChecked: 0, aiFailures: 0, aiSkipped: 0, problems: [] };
    const t0 = Date.now();
    let done = 0;
    const perPage = await mapPool(pages, limits.concurrency, async (page) => {
        const found = dictionaryFindings(page.text).filter((f) => !allowWords.has(f.word));
        if (provider && page.text.trim()) {
            const request = buildCopyRequest(page.url, page.text, limits);
            const key = createHash("sha1").update(`${provider.name}|${provider.model}|${COPY_SYSTEM}|${request.text}`).digest("hex");
            try {
                let raw = cache?.get(key);
                const cached = Boolean(raw);
                if (!raw && ((budgetMs && Date.now() - t0 > budgetMs) || shouldStop())) { stats.aiSkipped++; throw Object.assign(new Error("skipped"), { skipped: true }); }
                if (!raw) raw = await provider.complete({ system: COPY_SYSTEM, user: JSON.stringify(request), maxTokens: 900 });
                const v = validateCopyAnswer(raw, page.text, { siteVocab, allowWords, limits });
                if (v.ok) {
                    stats.aiPagesChecked++;
                    if (!cached) cache?.set(key, raw);
                    // Skip AI repeats of what other rules already report: the dictionary's own
                    // spots, doubled words ("the the": content-repeated-word) and placeholder
                    // text such as {{ name }} or lorem ipsum (content-placeholder).
                    for (const f of v.findings) {
                        const overlaps = found.some((d) => d.text.includes(f.text) || f.text.includes(d.text));
                        const doubled = /\b([a-z]{2,})\s+\1\b/i.test(f.text);
                        const placeholder = /\{\{|\{%|\$\{|lorem ipsum|dolor sit amet/i.test(f.text); // content-placeholder covers it
                        if (!overlaps && !doubled && !placeholder) found.push(f);
                    }
                } else stats.aiFailures++;
                stats.problems.push(...v.problems.map((p) => `${page.url}: ${p}`));
            } catch (err) {
                if (!err.skipped) {
                    stats.aiFailures++;
                    stats.problems.push(`${page.url}: ${err.message}`);
                }
            }
        }
        onProgress({ done: ++done, total: pages.length, url: page.url });
        return found;
    });
    // Text shared by several pages (a blog card, a sidebar) is reported once, on the first
    // page, with the other pages listed, instead of as a new issue on every page.
    const first = new Map();
    const kept = perPage.map((found, i) => found.filter((f) => {
        const key = `${f.text}|${f.correction}`;
        const owner = first.get(key);
        if (!owner) { first.set(key, f); f.alsoOn = []; return true; }
        owner.alsoOn.push(pages[i].url);
        return false;
    }));
    stats.sharedRepeats = perPage.flat().length - kept.flat().length;
    const findings = kept.flatMap((found, i) => drafts(pages[i], found.slice(0, limits.maxFindingsPerPage)));
    stats.spelling = findings.filter((f) => f.type === "copy-spelling").length;
    stats.grammar = findings.filter((f) => f.type === "copy-grammar").length;
    return { findings, stats };
}
