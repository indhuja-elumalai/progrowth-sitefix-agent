// Triage: how urgent an issue is, who fixes it, and how much work the fix is.
// Rule-based on purpose (no AI), so the same issue always gets the same answer.
//
// triage(issue, { startUrl }) -> { priority: "P1"|"P2"|"P3", priorityReason, owner, effort, quickWin }
//
// Priority starts from severity (high P1, medium P2, low P3) and goes up one level
// when the problem reaches many pages (10 or more) or sits on the home page.
// Effort is the usual size of the fix for that issue type.

export const OWNERS = { developer: "Developer", content: "Content writer", seo: "SEO" };

// type -> [owner, effort]
const RULES = {
    "http-4xx-internal": ["developer", "easy"],
    "http-4xx-external": ["content", "easy"],
    "link-unreachable": ["developer", "medium"],
    "redirect-loop": ["developer", "medium"],
    "redirect-chain": ["developer", "easy"],
    "redirect-to-error": ["developer", "medium"],
    "https-missing-redirect": ["developer", "medium"],
    "www-variant-not-redirected": ["developer", "medium"],
    "soft-404": ["developer", "medium"],
    "title-missing": ["content", "easy"],
    "title-multiple": ["developer", "easy"],
    "title-too-long": ["content", "easy"],
    "title-too-short": ["content", "easy"],
    "title-duplicate": ["content", "easy"],
    "description-missing": ["content", "easy"],
    "description-multiple": ["developer", "easy"],
    "description-too-long": ["content", "easy"],
    "description-too-short": ["content", "easy"],
    "description-duplicate": ["content", "easy"],
    "h1-missing": ["content", "easy"],
    "h1-multiple": ["developer", "easy"],
    "heading-skip": ["developer", "medium"],
    "metadata-js-only": ["developer", "hard"],
    "canonical-missing": ["seo", "easy"],
    "canonical-multiple": ["developer", "easy"],
    "canonical-broken-target": ["seo", "easy"],
    "canonical-redirect": ["seo", "easy"],
    "robots-noindex": ["seo", "easy"],
    "robots-nofollow": ["seo", "easy"],
    "og-missing": ["seo", "easy"],
    "og-incomplete": ["seo", "easy"],
    "og-image-broken": ["developer", "easy"],
    "viewport-missing": ["developer", "easy"],
    "lang-missing": ["developer", "easy"],
    "content-thin": ["content", "hard"],
    "content-duplicate": ["content", "hard"],
    "content-placeholder": ["content", "easy"],
    "content-repeated-word": ["content", "easy"],
    "copy-spelling": ["content", "easy"],
    "copy-grammar": ["content", "easy"],
    "image-broken": ["developer", "easy"],
    "image-alt-missing": ["content", "easy"],
    "image-alt-unhelpful": ["content", "easy"],
    "image-alt-too-long": ["content", "easy"],
    "image-mixed-content": ["developer", "easy"],
    "image-oversized": ["developer", "medium"],
};

export const WIDE_REACH = 10; // pages
const LEVELS = ["P1", "P2", "P3"];
const BASE = { high: 0, medium: 1, low: 2 };

const sameUrl = (a, b) => {
    const n = (u) => { try { const x = new URL(u); x.hash = ""; return x.href.replace(/\/$/, ""); } catch { return u; } };
    return n(a) === n(b);
};

// The home page is affected when it IS the affected page, or when a broken link /
// image / redirect appears on it. (For page-level issues, foundOn lists the pages
// that link to the page, so the home page linking to it does not count.)
const SHOWN_ON = new Set(["http", "redirect", "image"]);
function onHomePage(issue, startUrl) {
    if (sameUrl(issue.affectedUrl, startUrl)) return true;
    return SHOWN_ON.has(issue.evidence?.kind) && (issue.foundOn || []).some((u) => sameUrl(u, startUrl));
}

export function triage(issue, { startUrl = null } = {}) {
    const [owner, effort] = RULES[issue.type] || ["developer", "medium"];
    let level = BASE[issue.severity] ?? 2;
    const reasons = [`${issue.severity} severity`];
    const reach = (issue.foundOn || []).length;
    if (reach >= WIDE_REACH && level > 0) { level--; reasons.push(`on ${reach} pages`); }
    else if (startUrl && level > 0 && onHomePage(issue, startUrl)) { level--; reasons.push("on the home page"); }
    const priority = LEVELS[level];
    return {
        priority,
        priorityReason: reasons.join(", "),
        owner: OWNERS[owner],
        effort,
        quickWin: effort === "easy" && priority !== "P3",
    };
}

export const hasRule = (type) => type in RULES;

// Counts for the summary card and the PDF cover.
export function triageSummary(items) {
    const count = (key) => items.reduce((acc, i) => ((acc[i[key]] = (acc[i[key]] || 0) + 1), acc), {});
    return {
        byPriority: { P1: 0, P2: 0, P3: 0, ...count("priority") },
        byEffort: { easy: 0, medium: 0, hard: 0, ...count("effort") },
        byOwner: count("owner"),
        quickWins: items.filter((i) => i.quickWin).length,
    };
}
