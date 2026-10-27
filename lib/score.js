// The site score: 0 to 100, from the issues the crawl measured. Rule-based on purpose,
// so the same site always gets the same score, every point can be explained, and
// fixing an issue raises the score by exactly the points it costs.
//
// siteScore(issues, fixed) -> { score, exact (unrounded), areas: { "on-page", technical, "off-page" }, byType }
//   issues: [{ id, type, severity, priority, foundOn (or pages: a count) }]   fixed: Set or array of issue ids
//   score is the weighted mean of the three areas; each area starts at 100 and loses
//   points per kind of problem: per issue by severity (high 6, medium 3, low 1), a
//   little more when it is on many pages, levelling off below a cap per kind (high 20,
//   medium 10, low 4), so one problem repeated on 170 pages can't sink the score. An
//   area's score is 100 / (1 + lost / 100): 0 lost is 100, 100 lost is 50, and it never
//   reaches 0, so every fix shows as a gain.
// areaOf(type) -> "on-page" | "technical" | "off-page"
// gainOf(issues, fixed, ids) -> points gained by fixing ids (one decimal); gainText(g) -> "3" or "less than 1"
// levelOf(issues, fixed) -> { level, name, open: {P1, P2, P3}, total: {P1, P2, P3} }
//
// The same functions run in the web report (lib/web-report.js copies their source into
// the page), so they must stay self-contained: no imports, no outside variables.

export function areaOf(type) {
    // Off-page: how the site looks and links beyond its own pages (what this tool can
    // measure: sharing tags and links out). Backlinks and reviews need outside data.
    if (/^og-/.test(type) || type === "http-4xx-external") return "off-page";
    // On-page: what is on the page for people and search engines to read.
    if (/^(title-|description-|h1-|heading-|content-|copy-|image-alt-)/.test(type)) return "on-page";
    // Technical: links, redirects, indexing, security, mobile set-up, images loading, speed.
    return "technical";
}

export function siteScore(issues, fixed) {
    const done = fixed instanceof Set ? fixed : new Set(fixed || []);
    const PER = { high: 6, medium: 3, low: 1 };
    const CAP = { high: 20, medium: 10, low: 4 };
    const WEIGHT = { technical: 0.45, "on-page": 0.4, "off-page": 0.15 };
    const byType = {};
    for (const i of issues || []) {
        if (done.has(i.id)) continue;
        const sev = PER[i.severity] ? i.severity : "low";
        const pages = i.pages || (i.foundOn && i.foundOn.length) || 1;
        const reach = 1 + Math.min(1, Math.log2(pages) / 5); // 1 page: x1, 32+ pages: x2
        const t = byType[i.type] || (byType[i.type] = { area: areaOf(i.type), penalty: 0, cap: 0 });
        t.cap = Math.max(t.cap, CAP[sev]);
        t.penalty += PER[sev] * reach;
    }
    const lost = { "on-page": 0, technical: 0, "off-page": 0 };
    for (const k in byType) {
        const t = byType[k];
        t.penalty = t.cap * (1 - Math.exp(-t.penalty / t.cap)); // levels off near the cap, so each fixed issue still counts
        lost[t.area] += t.penalty;
    }
    // Each area: 100 with nothing lost, falling more slowly the more is lost (100 points
    // lost gives 50), so it never hits 0 and every fix still shows as a gain.
    const areas = {};
    let score = 0;
    for (const a in lost) {
        areas[a] = Math.round(100 / (1 + lost[a] / 100));
        score += (100 / (1 + lost[a] / 100)) * WEIGHT[a];
    }
    return { score: Math.round(score), exact: score, areas, byType };
}

// Points gained by fixing these issues (on top of what is already fixed): exactly how
// far the score shown will move, so the promise and the result always match. When the
// shown score wouldn't move (a small problem), the gain to one decimal, under 1.
export function gainOf(issues, fixed, ids) {
    const a = siteScore(issues, fixed);
    const b = siteScore(issues, [...(fixed instanceof Set ? fixed : new Set(fixed || []))].concat(ids));
    return b.score - a.score >= 1 ? b.score - a.score : Math.min(0.9, Math.max(0, Math.round((b.exact - a.exact) * 10) / 10));
}

// A gain as people read it: "3", or "less than 1" for the small ones.
export function gainText(g) {
    return g >= 0.95 ? String(Math.round(g)) : "less than 1";
}

// Levels follow priority: level 1 while urgent (P1) problems are open, then P2, then P3.
export function levelOf(issues, fixed) {
    const done = fixed instanceof Set ? fixed : new Set(fixed || []);
    const open = { P1: 0, P2: 0, P3: 0 }, total = { P1: 0, P2: 0, P3: 0 };
    for (const i of issues || []) {
        if (!(i.priority in total)) continue;
        total[i.priority]++;
        if (!done.has(i.id)) open[i.priority]++;
    }
    const level = open.P1 ? 1 : open.P2 ? 2 : open.P3 ? 3 : 4;
    const name = ["", "Urgent fixes", "Important fixes", "Polish", "Top shape"][level];
    return { level, name, open, total };
}
