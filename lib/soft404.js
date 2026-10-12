// Soft-404 rule. A soft 404 is a page that says "not found" to a visitor but
// answers 200 OK to a crawler, so search engines keep it in the index.
//
// No single signal is trusted on its own. A page is flagged only when it SAYS it
// is an error page (a strong signal: title or H1) AND at least one supporting
// signal agrees (almost no text, no H1, noindex, or many links redirect into it). Pure functions, no network.

export const LIMITS = { lowWordCount: 150 };

// Wording that error pages use. "404" on its own counts, because many sites
// use the bare status code as the whole title.
const NOT_FOUND =
    /\b(404|not found|no longer exists|(does not|doesn'?t) exist|(cannot|can'?t) be found|page unavailable|content unavailable|nothing here)\b/i;

export function visibleWordCount(html) {
    const text = (html || "")
        .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ");
    return text.split(/\s+/).filter(Boolean).length;
}

// page: { title, h1s, wordCount, robots, redirectsIn }
//   redirectsIn = how many other links redirect to this page (2 or more is a signal)
export function analyzeSoft404(page, limits = LIMITS) {
    const signals = [];
    const add = (name, strength, detail) => signals.push({ name, strength, detail });

    if (page.title && NOT_FOUND.test(page.title)) add("title-not-found", "strong", `Title is "${page.title}"`);
    const h1s = (page.h1s || []).filter(Boolean);
    const badH1 = h1s.find((h) => NOT_FOUND.test(h));
    if (badH1) add("h1-not-found", "strong", `H1 is "${badH1}"`);

    if (h1s.length === 0) add("no-h1", "supporting", "No <h1>");
    if (page.wordCount != null && page.wordCount < limits.lowWordCount)
        add("low-word-count", "supporting", `${page.wordCount} words (under ${limits.lowWordCount})`);
    if (page.robots && /noindex/.test(page.robots)) add("noindex", "supporting", "robots meta says noindex");
    if ((page.redirectsIn || 0) >= 2) add("redirect-target", "supporting", `${page.redirectsIn} links redirect to this page`);

    // Title and H1 both saying "not found" still count as ONE kind of evidence
    // (the page says it is an error). Something else must agree with it.
    const saysError = signals.some((s) => s.strength === "strong");
    const agreeing = signals.filter((s) => s.strength === "supporting").length;
    const flagged = saysError && agreeing >= 1;
    return { flagged, signals };
}