// List answers: "which images are broken?", "what should I fix first?", "where are the
// spelling mistakes?". They are answered straight from the report, the same with or
// without AI, as a short lead line plus the actual issues; the chat shows each one as a
// card with a screenshot of the page (the problem outlined in red) and a link into the
// web report.
//
// listAnswer(question, report) -> { answer, lead, tail, issueIds, moreIds, more, display: "cards" } or null
//   answer  plain text of the whole answer (lead, one line per issue, tail): saved with
//           the chat and shown where cards can't be
//   lead    the opening line; tail: how to fix it, and what else the report has
//   moreIds the rest of the list (up to MORE_MAX), shown in the chat on "Show more"
//   more    how many were not listed; reportHash: the web report filtered to the full list
//   scope   { types, noun } for a topic of one kind of problem ("broken images")

export const LIST_MAX = 3;
export const MORE_MAX = 60;

// What a question is about. Order matters: the first topic that matches wins, so the
// narrower ones ("links to other sites") come before the broader ones ("broken links").
const TOPICS = [
    { re: /\b(fix|do|tackle|start|work on)\b.*\bfirst\b|\b(most )?(urgent|important|critical|serious)\b|\bpriorit|\bp1\b|\btop (issues|problems|fixes)\b|\bwhere (do|should) i start\b/, pick: (i) => i.priority === "P1", sort: "priority", lead: (n) => (n === 1 ? "This is the one I'd fix first" : "I'd fix these first"), name: "fix-first", none: "Nothing is urgent: no problems were rated P1 (fix first)." },
    { re: /\bquick (wins?|fix(es)?)\b|\beasy (wins?|fix(es)?)\b|\blow[- ]hanging\b/, pick: (i) => i.quickWin, sort: "priority", lead: (n) => `${n === 1 ? "This is a quick win" : "These are quick wins"}, easy to fix and worth doing soon`, name: "quick-wins", none: "No quick wins this time: none of the easy fixes is rated P1 or P2." },
    { re: /\b(links?|urls?)\b.*\b(other|external|outside|third[- ]party) (sites?|websites?|domains?)\b|\bexternal links?\b|\boutbound\b/, noun: "broken links to other sites", types: ["http-4xx-external", "link-unreachable"], lead: (n) => (n === 1 ? "This link to another website is broken" : "These links to other websites are broken"), none: "No broken links to other websites were found." },
    { re: /\b(broken|dead|missing|not loading|404)\b.*\b(images?|pictures?|photos?|imgs?)\b|\b(images?|pictures?|photos?)\b.*\b(broken|missing|not (load|show)\w*|404)\b/, noun: "broken images", types: ["image-broken", "og-image-broken"], lead: (n) => `${n === 1 ? "This image doesn't" : "These images don't"} load`, none: "No broken images were found: every image loaded." },
    { re: /\b(broken|dead|bad|404|not working)\b.*\blinks?\b|\blinks?\b.*\b(broken|dead|404|not working)\b|\blink to (broken|missing)\b|\b404s?\b/, noun: "broken links", types: ["http-4xx-internal", "redirect-to-error", "canonical-broken-target"], lead: (n) => `${n === 1 ? "This link goes" : "These links go"} to a page that doesn't exist`, none: "No broken links to your own pages were found." },
    { re: /\b(error|empty|soft[- ]?404) pages?\b|\blook like (an )?error\b/, noun: "error-like pages", types: ["soft-404"], lead: (n) => `${n === 1 ? "This page looks" : "These pages look"} like an error page to Google`, none: "No pages look like error pages." },
    { re: /\bplaceholder|lorem|dummy text|sample text\b/, noun: "placeholder text", types: ["content-placeholder"], lead: () => "Placeholder text is still showing here", none: "No placeholder text was found on the live pages." },
    { re: /\bredirect/, noun: "redirects", types: ["redirect-loop", "redirect-chain"], lead: (n) => `${n === 1 ? "This redirect needs" : "These redirects need"} fixing`, none: "No redirect loops or chains were found." },
    { re: /\bspell|\bgrammar|\btypos?\b|\bmistakes?\b|\brepeated words?\b/, noun: "spelling and grammar mistakes", types: ["copy-spelling", "copy-grammar", "content-repeated-word"], lead: () => "Here are the spelling and grammar mistakes", none: "No spelling or grammar mistakes were found." },
    { re: /\balt\b|\balternative text\b/, noun: "alt text problems", types: ["image-alt-missing", "image-alt-unhelpful", "image-alt-too-long"], lead: (n) => `${n === 1 ? "This image needs" : "These images need"} better alt text`, none: "Every image has helpful alt text." },
    { re: /\b(images?|pictures?|photos?)\b.*\b(large|big|heavy|oversized|size|slow|compress)\w*|\b(large|big|heavy|oversized)\b.*\b(images?|pictures?|photos?)\b/, noun: "large images", types: ["image-oversized"], lead: (n) => `${n === 1 ? "This image is" : "These images are"} larger than they need to be`, none: "No images are over the size limit." },
    // Page speed (lib/speed.js). The narrow ones first; "how fast / slow / speed" is the whole picture.
    { re: /\b(layout|content) (shift|jump|mov)\w*|\bjump(s|ing)? around\b|\bcls\b/, noun: "pages whose layout jumps", types: ["speed-cls-high"], lead: () => "", none: "No page's layout jumps noticeably while it loads." },
    { re: /\b(heavy|page (size|weight)|data (use|usage)|megabytes?|mb)\b/, noun: "heavy pages", types: ["speed-page-heavy"], lead: () => "", none: "No page is heavier than 3 MB." },
    { re: /\b(server|hosting|ttfb|time to first byte)\b.*\b(slow|response|fast|speed)\w*|\bttfb\b/, noun: "pages with a slow server response", types: ["speed-ttfb-slow"], lead: () => "", none: "The server answers quickly on every page tested." },
    { re: /\b(blocking|unresponsive|freez\w*|frozen|tbt|inp|interactiv\w*)\b/, noun: "pages too busy to respond", types: ["speed-tbt-high"], lead: () => "", none: "No page tested is too busy to respond while it loads." },
    { re: /\b(speed|slow|fast|quick(ly)?|load(ing)? (time|speed)|takes? (long|ages) to load|performance|core web vitals?|web vitals|lcp|page ?speed|lighthouse)\b/, noun: "slow pages", types: ["speed-lcp-slow", "speed-cls-high", "speed-tbt-high", "speed-ttfb-slow", "speed-page-heavy"], speed: true, lead: () => "", none: "" },
    { re: /\btitles?\b/, noun: "title problems", types: ["title-missing", "title-duplicate", "title-too-long", "title-too-short", "title-multiple"], lead: (n) => `${n === 1 ? "This page title needs" : "These page titles need"} fixing`, none: "All page titles look good." },
    { re: /\b(meta )?descriptions?\b/, noun: "meta description problems", types: ["description-missing", "description-duplicate", "description-too-long", "description-too-short", "description-multiple"], lead: (n) => `${n === 1 ? "This meta description needs" : "These meta descriptions need"} fixing`, none: "All meta descriptions look good." },
    { re: /\bhidden\b|\bnoindex\b|\bnofollow\b|\bnot (indexed|in google|showing (up )?in google)\b|\bindex(ing|ed)?\b/, noun: "hidden pages", types: ["robots-noindex", "robots-nofollow"], lead: (n) => `${n === 1 ? "This page is" : "These pages are"} hidden from Google`, none: "No pages are hidden from Google." },
    { re: /\bthin\b|\bduplicate (content|pages?)\b|\bnear[- ]duplicate\b|\blittle text\b/, noun: "thin or duplicate pages", types: ["content-thin", "content-duplicate"], lead: (n) => `${n === 1 ? "This page has" : "These pages have"} thin or duplicate content`, none: "No thin or near-duplicate pages were found." },
    { re: /\bh1\b|\bheadings?\b/, noun: "heading problems", types: ["h1-missing", "h1-multiple", "heading-skip"], lead: (n) => `${n === 1 ? "This page has" : "These pages have"} heading problems`, none: "No heading problems were found." },
    { re: /\bsocial\b|\bshar(e|ed|ing)\b|\bopen graph\b|\bog\b|\bfacebook\b|\blinkedin\b/, noun: "social sharing problems", types: ["og-missing", "og-incomplete", "og-image-broken"], lead: (n) => `${n === 1 ? "This page doesn't" : "These pages don't"} look right when shared on social media`, none: "Your pages are set up for sharing on social media." },
    { re: /\bviewport\b|\bmobile\b|\blanguage\b|\blang\b|\bpage setup\b/, noun: "page setup problems", types: ["viewport-missing", "lang-missing"], lead: (n) => `${n === 1 ? "This page setup problem was" : "These page setup problems were"} found`, none: "No page setup problems were found." },
];

// "How many…" is a count (lib/chat.js factAnswer); "why…" and "how do I…" need an explanation.
const NOT_A_LIST = /\b(how many|number of|count|total)\b|\bwhy\b|\bhow (do|can|should|would|to)\b|\bwhat (is|does|are) (a|an|the meaning)\b|\bexplain\b|\bmean\b/;

// How to count each topic's issues: [one, many].
const COUNT = {
    "broken links to other sites": ["broken link to another site", "broken links to other sites"],
    "broken images": ["broken image", "broken images"],
    "broken links": ["broken link", "broken links"],
    "error-like pages": ["page that looks like an error page", "pages that look like error pages"],
    "placeholder text": ["page with placeholder text", "pages with placeholder text"],
    redirects: ["redirect problem", "redirect problems"],
    "spelling and grammar mistakes": ["page with spelling or grammar mistakes", "pages with spelling or grammar mistakes"],
    "alt text problems": ["image that needs better alt text", "images that need better alt text"],
    "large images": ["image that is too large", "images that are too large"],
    "title problems": ["page title to fix", "page titles to fix"],
    "meta description problems": ["meta description to fix", "meta descriptions to fix"],
    "hidden pages": ["page hidden from Google", "pages hidden from Google"],
    "thin or duplicate pages": ["thin or duplicate page", "thin or duplicate pages"],
    "heading problems": ["page with heading problems", "pages with heading problems"],
    "social sharing problems": ["page that doesn't look right when shared", "pages that don't look right when shared"],
    "page setup problems": ["page setup problem", "page setup problems"],
    "slow pages": ["slow page", "slow pages"],
    "pages with speed problems": ["page with speed problems", "pages with speed problems"],
    "pages whose layout jumps": ["page whose layout jumps while loading", "pages whose layout jumps while loading"],
    "heavy pages": ["page heavier than 3 MB", "pages heavier than 3 MB"],
    "pages with a slow server response": ["page with a slow server response", "pages with a slow server response"],
    "pages too busy to respond": ["page too busy to respond while loading", "pages too busy to respond while loading"],
};
const counted = (n, noun) => { const c = COUNT[noun] || [noun, noun]; return `${n} ${n === 1 ? c[0] : c[1]}`; };

// The opening line: how many there are, and which ones follow.
function leadLine(topic, total, shown, scopeNoun) {
    const top = total > shown ? ` The ${shown} most urgent:` : "";
    if (scopeNoun) {
        if (topic.name === "quick-wins") return `Of the ${scopeNoun}, ${total === 1 ? "this is the quick win" : `${total} are quick wins`}.${top || (total === 1 ? "" : " Here they are:")}`.replace(/\.$/, ":");
        return total > shown ? `Of the ${scopeNoun}, I'd fix these ${shown} first:` : `Of the ${scopeNoun}, I'd fix ${total === 1 ? "this one" : "these"} first:`;
    }
    if (topic.name === "fix-first") return total > shown ? `${total} problems are urgent. I'd start with these ${shown}:` : `I'd fix ${total === 1 ? "this one" : "these"} first:`;
    if (topic.name === "quick-wins") return `I found ${total} quick win${total === 1 ? "" : "s"}, easy to fix and worth doing soon.${top || ""}`.replace(/\.$/, ":");
    return `I found ${counted(total, topic.noun)}.${top}`.replace(/\.$/, ":");
}

const ORDER = { P1: 0, P2: 1, P3: 2 };
// A page on the site as its path; an address on another site with its host.
const short = (u, site) => {
    try {
        const x = new URL(u);
        const own = !site || x.host.replace(/^www\./, "") === new URL(site).host.replace(/^www\./, "");
        return (own ? "" : x.host.replace(/^www\./, "")) + x.pathname + x.search;
    } catch { return u || ""; }
};
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function listTopic(question) {
    const q = String(question || "").toLowerCase().replace(/[?!.,]/g, " ");
    if (NOT_A_LIST.test(q)) return null;
    return TOPICS.find((t) => t.re.test(q)) || null;
}

// One line for an issue: what is wrong, and where.
// withTitle: name the kind of problem too (a list of mixed kinds).
export function issueLine(i, title, site, withTitle) {
    const on = ["image", "http", "redirect"].includes(i.evidence?.kind);
    const pages = i.foundOn?.length ? `on ${short(i.foundOn[0], site)}${i.foundOn.length > 1 ? ` and ${plural(i.foundOn.length - 1, "other page")}` : ""}` : "";
    const where = on ? `${short(i.affectedUrl, site)}${pages ? ` ${pages}` : ""}` : short(i.affectedUrl, site);
    return `${withTitle ? `${title}: ` : ""}${where}. ${String(i.detail || "").slice(0, 160)}`;
}

// scope: issue types to stay within, for a follow-up like "what should I fix first?"
// right after "which images are broken?" (the chat asks which one the person means).
// Within a scope, "fix first" is the most urgent of those, whatever their priority.
export function listAnswer(question, report, { scope } = {}) {
    if (!report?.types) return null;
    const topic = listTopic(question);
    if (!topic) return null;
    const all = report.types.flatMap((t) => t.issues.map((i) => ({ ...i, _t: t })));
    const scoped = !topic.types && Array.isArray(scope) && scope.length ? new Set(scope) : null;
    const scopeNoun = scoped ? (TOPICS.find((t) => t.types && t.types.some((x) => scoped.has(x)))?.noun || "those problems") : null;
    let found = scoped ? all.filter((i) => scoped.has(i.type) && (topic.name !== "quick-wins" || i.quickWin))
        : all.filter((i) => (topic.types ? topic.types.includes(i.type) : topic.pick(i)));
    if (scoped && !found.length) {
        const none = topic.name === "quick-wins" ? `None of the ${scopeNoun} is a quick win.` : `There are no ${scopeNoun}.`;
        return { answer: none, lead: none, tail: "", issueIds: [], moreIds: [], more: 0, display: "cards", topic: topic.name };
    }
    // Speed: one entry per page (its most telling problem, the slow main content first),
    // slowest pages first, with the site-wide picture in the lead.
    if (topic.speed) return speedAnswer(found, report, topic);
    if (!found.length) return { answer: topic.none, lead: topic.none, tail: "", issueIds: [], moreIds: [], more: 0, display: "cards", topic: topic.name || topic.types[0] };
    // Most serious first; within that, the problems on the most pages. For "fix first"
    // and "quick wins", one per kind of problem first so the list isn't all one kind.
    const pages = (i) => i.foundOn?.length || 0;
    found.sort((a, b) => (ORDER[a.priority] ?? 3) - (ORDER[b.priority] ?? 3) || pages(b) - pages(a));
    if (topic.sort === "priority") {
        const seen = new Set();
        const firsts = found.filter((i) => !seen.has(i.type) && seen.add(i.type));
        found = [...firsts, ...found.filter((i) => !firsts.includes(i))];
    }
    const shown = found.slice(0, LIST_MAX);
    const more = found.length - shown.length;
    const lead = leadLine(topic, found.length, shown.length, scopeNoun);
    // Where the full list is in the web report (lib/web-report.js reads these).
    const reportHash = scoped ? `type=${[...scoped].join(",")}` : topic.types ? `type=${topic.types.join(",")}` : topic.name === "fix-first" ? "p=P1" : "qw=1";
    // How to fix: the steps of the kind of problem when the list is all one kind.
    const kinds = new Set(shown.map((i) => i.type));
    const steps = kinds.size === 1 ? shown[0]._t.fixSteps || [] : [];
    const tail = [
        steps.length ? `To fix: ${steps.slice(0, 2).map((s, k) => (k ? s.replace(/^./, (c) => c.toLowerCase()) : s).replace(/\.$/, "")).join(", then ")}.` : "",
    ].filter(Boolean).join(" ");
    const site = report.run?.startUrl;
    const lines = shown.map((i) => `- ${issueLine(i, i._t.title, site, kinds.size > 1)}`);
    return {
        answer: [lead, ...lines, tail, more ? `And ${more} more.` : ""].filter(Boolean).join("\n"),
        lead, tail, more, display: "cards", reportHash,
        moreLabel: more ? `See all ${scoped ? counted(found.length, scopeNoun) : topic.noun ? counted(found.length, topic.noun) : topic.name === "fix-first" ? `${found.length} urgent problems` : `${found.length} quick wins`}` : "",
        issueIds: shown.map((i) => i.id),
        moreIds: found.slice(LIST_MAX, LIST_MAX + MORE_MAX).map((i) => i.id),
        topic: topic.name || topic.types[0],
        // A topic of one kind of problem: the chat can offer it as the scope of a follow-up.
        ...(topic.types ? { scope: { types: topic.types, noun: topic.noun } } : {}),
    };
}

const sec = (ms) => `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
const LAB = "Tested as a visitor on a mid-range phone over 4G would see it, like Google's PageSpeed Insights.";

// "How fast are my pages?": the site-wide picture from report.summaries.speed, then the
// slowest pages, one card each.
function speedAnswer(found, report, topic) {
    const s = report.summaries?.speed;
    if (!s?.pagesTested) {
        const none = "Page speed wasn't tested in this inspection. Run it again to include it.";
        return { answer: none, lead: none, tail: "", issueIds: [], moreIds: [], more: 0, display: "cards", topic: "speed" };
    }
    const tested = s.pagesTested;
    const picture = `On a phone over 4G, your pages show their main content in about ${sec(s.median.lcpMs ?? 0)} (good: under 2.5 s).`;
    // Why pages fail Core Web Vitals: the most widespread of the three measures.
    const bad = (k) => (s[k]?.["needs-improvement"] || 0) + (s[k]?.poor || 0);
    const REASON = {
        lcp: (n) => `${n} show their main content slowly`,
        cls: (n) => `${n} have a layout that jumps while loading`,
        tbt: (n) => `${n} ${n === 1 ? "is" : "are"} too busy to respond while loading (about ${Math.round(s.median.tbtMs ?? 0)} ms; good: under 200 ms)`,
    };
    const worst = ["lcp", "cls", "tbt"].filter((k) => bad(k) > 0).sort((x, y) => bad(y) - bad(x));
    const pass = s.passing === tested ? `All ${tested} pages tested pass Google's Core Web Vitals.`
        : `${s.passing === 0 ? "None" : s.passing} of the ${tested} pages tested pass${s.passing === 1 ? "es" : ""} Google's Core Web Vitals${worst.length ? `, mostly because ${REASON[worst[0]](bad(worst[0]))}` : ""}.`;
    const picture2 = `${picture} ${pass}`;
    // One card per page: its most serious problem, the rarer kind first (a problem every
    // page shares says less than one only this page has). Pages with the most, and most
    // serious, problems first.
    const typeCount = {};
    for (const i of found) typeCount[i.type] = (typeCount[i.type] || 0) + 1;
    const weight = (i) => (i.severity === "medium" ? 2 : 1);
    const byPage = new Map();
    for (const i of found) {
        const e = byPage.get(i.affectedUrl) || { issues: [], score: 0 };
        e.issues.push(i); e.score += weight(i);
        byPage.set(i.affectedUrl, e);
    }
    const pagesList = [...byPage.values()]
        .sort((a, b) => b.score - a.score || (b.issues[0].evidence?.lcpMs ?? 0) - (a.issues[0].evidence?.lcpMs ?? 0))
        .map((e) => e.issues.sort((x, y) => weight(y) - weight(x) || typeCount[x.type] - typeCount[y.type])[0]);
    if (!pagesList.length) {
        const lead = `${picture2} No page tested has a speed problem.`;
        return { answer: `${lead}\n${LAB}`, lead, tail: LAB, issueIds: [], moreIds: [], more: 0, display: "cards", topic: "speed" };
    }
    const shown = pagesList.slice(0, LIST_MAX);
    const more = pagesList.length - shown.length;
    const lead = `${picture2} ${pagesList.length > shown.length ? `The ${shown.length} pages with the most to fix:` : pagesList.length === 1 ? "The page to fix:" : "The pages to fix:"}`;
    const site = report.run?.startUrl;
    return {
        answer: [lead, ...shown.map((i) => `- ${short(i.affectedUrl, site)}. ${String(i.detail || "").slice(0, 160)}`), LAB, more ? `And ${more} more.` : ""].filter(Boolean).join("\n"),
        lead, tail: LAB, more, display: "cards",
        reportHash: `type=${topic.types.join(",")}`,
        moreLabel: more ? `See all ${counted(pagesList.length, "pages with speed problems")}` : "",
        issueIds: shown.map((i) => i.id),
        moreIds: pagesList.slice(LIST_MAX, LIST_MAX + MORE_MAX).map((i) => i.id),
        topic: "speed",
        scope: { types: topic.types, noun: "slow pages" },
    };
}
