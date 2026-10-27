// Suggested questions for the chat, based on the kinds of problems found so far.
// The same function runs in the browser (ui/build-index.js copies its source into
// the page), so it must stay self-contained: no imports, no outside variables.
//
// suggestQuestions(types, asked, max) -> up to max questions
//   types: issue types in the order they were found (repeats are fine)
//   asked: questions already asked, so they are not offered again

export function suggestQuestions(types, asked, max) {
    max = max || 4;
    const done = new Set([].concat(asked || []).map(function (q) { return String(q).toLowerCase(); }));
    // One question per group of problems; the most serious groups first.
    const GROUPS = [
        [["http-4xx-internal", "redirect-to-error", "canonical-broken-target"], "Which pages link to broken pages?"],
        [["image-broken", "og-image-broken"], "Which images are broken?"],
        [["soft-404"], "Which pages look like error pages?"],
        [["title-missing", "title-duplicate", "title-too-long", "title-too-short", "title-multiple"], "Which page titles need fixing?"],
        [["robots-noindex", "robots-nofollow"], "Which pages are hidden from Google?"],
        [["content-placeholder"], "Where is placeholder text still showing?"],
        [["redirect-loop", "redirect-chain"], "Which redirects should be fixed?"],
        [["http-4xx-external", "link-unreachable"], "Which links to other sites are broken?"],
        [["description-missing", "description-duplicate", "description-too-long", "description-too-short", "description-multiple"], "Which meta descriptions need fixing?"],
        [["copy-spelling", "copy-grammar", "content-repeated-word"], "Where are the spelling and grammar mistakes?"],
        [["speed-lcp-slow", "speed-cls-high", "speed-tbt-high", "speed-ttfb-slow", "speed-page-heavy"], "How fast are my pages?"],
        [["image-oversized"], "Which images are too large?"],
        [["image-alt-missing", "image-alt-unhelpful", "image-alt-too-long"], "Which images need better alt text?"],
        [["content-thin", "content-duplicate"], "Which pages have thin or duplicate content?"],
        [["h1-missing", "h1-multiple", "heading-skip"], "Which pages have heading problems?"],
        [["og-missing", "og-incomplete"], "How will my pages look when shared on social media?"],
        [["viewport-missing", "lang-missing"], "What page setup problems were found?"],
    ];
    const seen = new Set(types || []);
    const specific = [];
    for (let i = 0; i < GROUPS.length; i++) {
        const g = GROUPS[i];
        if (g[0].some(function (t) { return seen.has(t); })) specific.push(g[1]);
    }
    const order = ["What should I fix first?"].concat(specific.slice(0, 2), ["What are the quick wins?"], specific.slice(2), ["How many pages were checked?"]);
    const out = [];
    for (let i = 0; i < order.length && out.length < max; i++) {
        if (!done.has(order[i].toLowerCase()) && out.indexOf(order[i]) === -1) out.push(order[i]);
    }
    return out;
}
