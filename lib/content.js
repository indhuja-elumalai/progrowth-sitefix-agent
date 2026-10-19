// Content rules: what a reader sees in the page text. Pure functions: the
// rendered text of each page in, issues out. No network, no browser, no AI.
//
// Input per page: { url, lines } where lines is document.body.innerText split
// into non-empty lines (one line is roughly one paragraph, heading or menu item).
//
// wordCount(text)                 -> number of words
// findBoilerplate(pages)          -> lines repeated on most pages (menus, footers)
// mainText(lines, boilerplate)    -> the page's own text, without the boilerplate
// thinIssue(words)                -> fewer than CONTENT_LIMITS.minWords words
// placeholderIssue(lines)         -> lorem ipsum, unfilled {{template}} tags, "your text here", ...
// repeatedWordIssue(lines)        -> the same word twice in a row ("the the")
// findNearDuplicates(pages)       -> pages whose own text is (almost) the same
// contentFindings(...)            -> all of the above as drafts for the issue registry

export const CONTENT_LIMITS = {
    minWords: 200, // common "low word count" threshold in SEO audit tools; counts all visible text
    nearDuplicate: 0.85, // share of identical 5-word phrases (Jaccard) to call two pages near-duplicates; 85% is a common audit-tool threshold
    minWordsForDuplicate: 50, // pages with less text of their own are left to the thin-page rule
    boilerplateShare: 0.5, // a line on at least half the pages is menu / footer text
    boilerplateMinPages: 4, // below this, there is not enough to tell boilerplate apart
};

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
export const wordCount = (text) => (String(text || "").match(WORD) || []).length;

// ---------- boilerplate ----------
export function findBoilerplate(pages, limits = CONTENT_LIMITS) {
    if (pages.length < limits.boilerplateMinPages) return new Set();
    const seenOn = new Map();
    for (const p of pages) {
        for (const line of new Set(p.lines)) seenOn.set(line, (seenOn.get(line) || 0) + 1);
    }
    const min = Math.max(2, Math.ceil(pages.length * limits.boilerplateShare));
    return new Set([...seenOn].filter(([, n]) => n >= min).map(([line]) => line));
}

export const mainText = (lines, boilerplate) => lines.filter((l) => !boilerplate.has(l)).join("\n");

const issue = (type, severity, detail, evidence = {}) => ({ type, severity, detail, evidence });

// ---------- thin ----------
export function thinIssue(words, limits = CONTENT_LIMITS) {
    if (words >= limits.minWords) return null;
    return issue("content-thin", "low", `${words} words of text (minimum ${limits.minWords})`, { words });
}

// ---------- placeholder text ----------
// Each pattern is something that is almost never meant to be live.
const PLACEHOLDERS = [
    { name: "lorem ipsum", re: /\blorem ipsum\b|\bdolor sit amet\b/i },
    { name: "unfilled template tag", re: /\{\{\s*[\w.\- ]{1,40}\s*\}\}|\{%\s*[\w.\- ]{1,40}\s*%\}|\$\{[\w.]{1,40}\}/ },
    { name: "fill-in bracket", re: /\[\s*(insert|add|your|enter|placeholder)\b[^\]]{0,40}\]/i },
    { name: "\"your text here\"", re: /\byour (text|content|title|headline|description|copy) (goes )?here\b/i },
    { name: "sample text", re: /\b(sample|dummy|placeholder|filler) (text|copy|content)\b/i },
    { name: "under construction", re: /\b(page|site|website|section) (is )?(currently )?under construction\b/i },
    { name: "TODO / FIXME note", re: /\b(TODO|FIXME|TBD|XXX):/ },
    // A script printed a broken value: a whole line that is just "undefined" / "NaN", or "[object Object]", "$NaN", "NaN%".
    { name: "script output bug", re: /\[object Object\]|^(undefined|NaN|null)$|\$NaN\b|\bNaN%/ },
];

const snippet = (line, index, len) => {
    const start = Math.max(0, index - 30);
    const end = Math.min(line.length, index + len + 30);
    return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
};

export function placeholderIssue(lines) {
    const found = [];
    for (const line of lines) {
        for (const p of PLACEHOLDERS) {
            const m = line.match(p.re);
            if (m && !found.some((f) => f.name === p.name)) found.push({ name: p.name, text: snippet(line, m.index, m[0].length) });
        }
    }
    if (!found.length) return null;
    return issue("content-placeholder", "high", `Placeholder text on the live page: ${found.map((f) => f.name).join(", ")}`, { matches: found });
}

// ---------- repeated words ----------
// Words that are legitimately doubled ("had had", "that that", "bye bye").
const OK_TWICE = new Set(["had", "that", "is", "bye", "no", "ha", "very", "so", "do", "go", "knock", "tut", "chop", "night", "ding", "yes", "boo", "pom", "aye", "mi", "la", "cha"]);

export function repeatedWordIssue(lines) {
    const found = [];
    const re = /(?<![\p{L}\p{N}])([\p{L}]{2,})\s+\1(?![\p{L}\p{N}])/giu;
    for (const line of lines) {
        for (const m of line.matchAll(re)) {
            const [a, b] = m[0].split(/\s+/);
            if (OK_TWICE.has(a.toLowerCase())) continue;
            if (a.toLowerCase() === "object" && line[m.index - 1] === "[") continue; // "[object Object]" is reported as placeholder text
            if (/^\p{Lu}/u.test(a) && /^\p{Lu}/u.test(b)) continue; // place names like "Walla Walla", "Bora Bora"
            found.push({ word: a.toLowerCase(), text: snippet(line, m.index, m[0].length) });
            if (found.length >= 5) break;
        }
        if (found.length >= 5) break;
    }
    if (!found.length) return null;
    const words = [...new Set(found.map((f) => `"${f.word} ${f.word}"`))];
    return issue("content-repeated-word", "low", `Word repeated twice in a row: ${words.slice(0, 3).join(", ")}${found.length > 3 ? ` (${found.length} found)` : ""}`, { matches: found });
}

// ---------- near-duplicates (MinHash over 5-word phrases) ----------
const fnv1a = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
};
const fmix = (h) => {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
};
const HASHES = 64, BANDS = 16, ROWS = HASHES / BANDS;
const SEEDS = Array.from({ length: HASHES }, (_, i) => fmix(0x9e3779b9 + i * 0x85ebca6b));

export function shingles(text, k = 5) {
    const words = (String(text).toLowerCase().match(WORD) || []);
    const out = new Set();
    if (words.length < k) { if (words.length) out.add(fnv1a(words.join(" "))); return out; }
    for (let i = 0; i + k <= words.length; i++) out.add(fnv1a(words.slice(i, i + k).join(" ")));
    return out;
}

export function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    let both = 0;
    for (const x of small) if (big.has(x)) both++;
    return both / (a.size + b.size - both);
}

function signature(set) {
    const sig = new Uint32Array(HASHES).fill(0xffffffff);
    for (const s of set) {
        for (let i = 0; i < HASHES; i++) {
            const v = fmix(s ^ SEEDS[i]);
            if (v < sig[i]) sig[i] = v;
        }
    }
    return sig;
}

// pages: [{ url, text }] (text = mainText). Returns Map url -> [{ url, similarity }], most similar first.
// MinHash with banding finds candidate pairs without comparing every page with
// every other page; each candidate is then confirmed with the exact Jaccard score.
export function findNearDuplicates(pages, limits = CONTENT_LIMITS) {
    const items = pages
        .filter((p) => wordCount(p.text) >= limits.minWordsForDuplicate)
        .map((p) => ({ url: p.url, set: shingles(p.text) }));
    const buckets = new Map();
    items.forEach((it, idx) => {
        const sig = signature(it.set);
        for (let b = 0; b < BANDS; b++) {
            const key = `${b}:${Array.from(sig.subarray(b * ROWS, b * ROWS + ROWS)).join(",")}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(idx);
        }
    });
    const checked = new Set();
    const out = new Map();
    const link = (from, to, similarity) => {
        if (!out.has(from)) out.set(from, []);
        out.get(from).push({ url: to, similarity });
    };
    for (const members of buckets.values()) {
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                const key = members[i] < members[j] ? `${members[i]}-${members[j]}` : `${members[j]}-${members[i]}`;
                if (checked.has(key)) continue;
                checked.add(key);
                const a = items[members[i]], b = items[members[j]];
                const sim = jaccard(a.set, b.set);
                if (sim >= limits.nearDuplicate) {
                    const rounded = Math.round(sim * 100) / 100;
                    link(a.url, b.url, rounded);
                    link(b.url, a.url, rounded);
                }
            }
        }
    }
    for (const list of out.values()) list.sort((x, y) => y.similarity - x.similarity || x.url.localeCompare(y.url));
    return out;
}

export function duplicateIssue(similar) {
    if (!similar?.length) return null;
    const top = similar[0];
    const more = similar.length > 1 ? ` (+${similar.length - 1} more)` : "";
    const how = top.similarity >= 1 ? "Same text as" : `${Math.round(top.similarity * 100)}% the same text as`;
    return issue("content-duplicate", "medium", `${how} ${top.url}${more}`, { similarTo: similar.slice(0, 10) });
}

// ---------- everything together ----------
// pages: [{ url, foundOn, lines, skipThin }]  (skipThin: e.g. already reported as a soft 404)
// Returns { findings: registry drafts, pages: per-page summary for content.json, boilerplateLines }.
export function contentFindings(pages, limits = CONTENT_LIMITS) {
    const boilerplate = findBoilerplate(pages, limits);
    const withText = pages.map((p) => {
        const text = mainText(p.lines, boilerplate);
        return { ...p, words: wordCount(p.lines.join("\n")), mainWords: wordCount(text), text };
    });
    const dups = findNearDuplicates(withText, limits);
    const findings = [];
    const summary = [];
    for (const p of withText) {
        const issues = [
            p.skipThin ? null : thinIssue(p.words, limits),
            duplicateIssue(dups.get(p.url)),
            placeholderIssue(p.lines),
            repeatedWordIssue(p.lines),
        ].filter(Boolean);
        for (const i of issues) {
            findings.push({
                type: i.type, severity: i.severity, affectedUrl: p.url, foundOn: p.foundOn || [], detail: i.detail,
                evidence: { kind: "content", words: p.words, mainWords: p.mainWords, ...i.evidence },
            });
        }
        summary.push({ url: p.url, words: p.words, mainWords: p.mainWords, issues: issues.map((i) => i.type), similarTo: dups.get(p.url) || [] });
    }
    // mainTexts: each page's own text (boilerplate removed), for the spelling and grammar check.
    return { findings, pages: summary, boilerplateLines: boilerplate.size, mainTexts: new Map(withText.map((p) => [p.url, p.text])) };
}
