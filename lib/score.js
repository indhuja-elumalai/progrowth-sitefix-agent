// The site score: 0 to 100, from the issues the crawl measured. Rule-based on purpose,
// so the same site always gets the same score, every point can be explained, and
// fixing an issue raises the score by exactly the points it costs.
//
// siteScore(issues, fixed) -> { score, exact (unrounded), areas: { "on-page", technical, "off-page" }, byType }
//   issues: [{ id, type, severity, priority, evidence, foundOn } or { …, pages: a count }]
//   fixed: Set or array of issue ids
//   An issue's pages: a broken link, image or redirect is on the pages it was found on
//   (foundOn); any other issue is on its own page only (foundOn there lists the pages
//   that link to it, which says nothing about how widespread the problem is).
//   score is the weighted mean of the three areas; each area starts at 100 and loses
//   points per kind of problem: per issue by severity (high 6, medium 3, low 1), a
//   little more when it is on many pages, levelling off below a cap per kind (high 20,
//   medium 10, low 4), so one problem repeated on 170 pages can't sink the score. An
//   area's score is 100 / (1 + lost / 100): 0 lost is 100, 100 lost is 50, and it never
//   reaches 0, so every fix shows as a gain.
// areaOf(type) -> "on-page" | "technical" | "off-page"
// pointsOf / projected / fmtPoints: points per kind and per issue, for selections (below)
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
        const on = i.evidence && ["image", "http", "redirect"].indexOf(i.evidence.kind) !== -1;
        const pages = i.pages || (on && i.foundOn && i.foundOn.length) || 1;
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
    const areas = {}, areasExact = {};
    let score = 0;
    for (const a in lost) {
        areasExact[a] = 100 / (1 + lost[a] / 100);
        areas[a] = Math.round(areasExact[a]);
        score += areasExact[a] * WEIGHT[a];
    }
    return { score: Math.round(score), exact: score, areas, areasExact, byType };
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

// Points each kind of problem, and each issue in it, gives back, so that a selection of
// single issues shows its share. Each area's points still to win (100 minus its score)
// are shared out between its kinds of problem by how much each costs on its own; a
// kind's points are shared equally between its issues. So fixing everything adds up to
// exactly 100, a whole kind adds its points, and part of it adds that part.
// pointsOf(issues, fixed) -> { now, types: { [type]: { area, ids, points, areaPoints } }, perIssue: { [id]: { points, areaPoints, area } } }
// projected(P, selectedIds) -> { score, exact, areas, areasExact } with those issues fixed too
export function pointsOf(issues, fixed) {
    const done = fixed instanceof Set ? fixed : new Set(fixed || []);
    const WEIGHT = { technical: 0.45, "on-page": 0.4, "off-page": 0.15 };
    const now = siteScore(issues, done);
    const open = {};
    for (const i of issues || []) if (!done.has(i.id)) (open[i.type] || (open[i.type] = [])).push(i.id);
    const alone = {}, sum = { "on-page": 0, technical: 0, "off-page": 0 };
    for (const t in open) {
        const area = areaOf(t);
        const with1 = siteScore(issues, [...done].concat(open[t]));
        alone[t] = Math.max(0, with1.areasExact[area] - now.areasExact[area]);
        sum[area] += alone[t];
    }
    const types = {}, perIssue = {};
    for (const t in open) {
        const area = areaOf(t);
        const areaPoints = sum[area] > 0 ? (100 - now.areasExact[area]) * alone[t] / sum[area] : 0;
        types[t] = { area, ids: open[t], areaPoints, points: areaPoints * WEIGHT[area] };
        for (const id of open[t]) perIssue[id] = { area, points: types[t].points / open[t].length, areaPoints: areaPoints / open[t].length };
    }
    return { now, types, perIssue };
}

export function projected(P, selectedIds) {
    const WEIGHT = { technical: 0.45, "on-page": 0.4, "off-page": 0.15 };
    const areasExact = { "on-page": P.now.areasExact["on-page"], technical: P.now.areasExact.technical, "off-page": P.now.areasExact["off-page"] };
    const seen = new Set();
    for (const id of selectedIds || []) {
        const x = P.perIssue[id];
        if (!x || seen.has(id)) continue;
        seen.add(id);
        areasExact[x.area] += x.areaPoints;
    }
    const areas = {};
    let exact = 0;
    for (const a in areasExact) { areasExact[a] = Math.min(100, areasExact[a]); areas[a] = Math.round(areasExact[a]); exact += areasExact[a] * WEIGHT[a]; }
    return { score: Math.round(exact), exact, areas, areasExact };
}

// Points as people read them: whole numbers from 10 up, else one decimal ("2", "1.8",
// "0.2"); something too small to show is "<0.1".
export function fmtPoints(x) {
    if (x >= 10) return String(Math.round(x));
    const r = Math.round(x * 10) / 10;
    return r === 0 && x > 0 ? "<0.1" : String(r);
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
