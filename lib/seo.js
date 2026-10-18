// Metadata and canonical rules. Pure functions: HTML text in, facts and issues out.
// No network and no browser in here, so every rule can be unit-tested.
//
// extractHead(html)   -> facts about the page (title, description, H1s, canonicals, robots)
// headIssues(head)    -> issues that need only this one page
// findDuplicates(...) -> issues that need all pages (same title / description on 2+ pages)
// canonicalTargetIssue(...) -> issue from the status of the canonical's target
// jsDependence(...)   -> fields that exist only after JavaScript runs

export const LIMITS = {
    titleMin: 10,
    titleMax: 60,
    descriptionMin: 50,
    descriptionMax: 160,
};

const ENTITIES = [
    [/&amp;/g, "&"], [/&quot;/g, '"'], [/&#39;/g, "'"], [/&apos;/g, "'"],
    [/&lt;/g, "<"], [/&gt;/g, ">"], [/&nbsp;/g, " "],
];
function decode(s) {
    let out = s;
    for (const [re, to] of ENTITIES) out = out.replace(re, to);
    return out;
}
const clean = (s) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// Reads attributes out of one tag, whatever the quote style or order.
function parseAttrs(tag) {
    const attrs = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let m;
    const inner = tag.replace(/^<\w+/, "").replace(/\/?>$/, "");
    while ((m = re.exec(inner))) {
        attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    return attrs;
}

export function extractHead(html) {
    const text = html || "";
    // Title, meta and link tags only count inside <head>. This stops an inline
    // <svg><title> in the body from being mistaken for the page title.
    const headEnd = text.search(/<\/head\s*>/i);
    const head = headEnd === -1 ? text : text.slice(0, headEnd);

    const titles = [...head.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => clean(m[1]));
    const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => parseAttrs(m[0]));
    const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => parseAttrs(m[0]));

    const metaByName = (name) =>
        metas.filter((a) => (a.name || "").toLowerCase() === name).map((a) => clean(a.content || ""));
    const descriptions = metaByName("description");
    const robots = metaByName("robots").join(", ").toLowerCase() || null;

    const canonicals = links
        .filter((a) => (a.rel || "").toLowerCase().split(/\s+/).includes("canonical"))
        .map((a) => (a.href || "").trim());

    const h1s = [...text.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1]));

    return {
        title: titles[0] ?? null,
        titleCount: titles.length,
        description: descriptions[0] ?? null,
        descriptionCount: descriptions.length,
        h1s,
        canonicals,
        robots,
    };
}

const issue = (type, severity, detail) => ({ type, severity, detail });

// Rules that need only one page's head.
export function headIssues(head, limits = LIMITS) {
    const out = [];

    if (!head.title) {
        out.push(issue("title-missing", "high", head.titleCount ? "The <title> tag is empty" : "No <title> tag"));
    } else {
        if (head.titleCount > 1) out.push(issue("title-multiple", "medium", `${head.titleCount} <title> tags`));
        if (head.title.length > limits.titleMax)
            out.push(issue("title-too-long", "low", `${head.title.length} characters (limit ${limits.titleMax})`));
        else if (head.title.length < limits.titleMin)
            out.push(issue("title-too-short", "low", `${head.title.length} characters (minimum ${limits.titleMin})`));
    }

    if (!head.description) {
        out.push(issue("description-missing", "medium", head.descriptionCount ? "The meta description is empty" : "No meta description"));
    } else {
        if (head.descriptionCount > 1) out.push(issue("description-multiple", "low", `${head.descriptionCount} meta descriptions`));
        if (head.description.length > limits.descriptionMax)
            out.push(issue("description-too-long", "low", `${head.description.length} characters (limit ${limits.descriptionMax})`));
        else if (head.description.length < limits.descriptionMin)
            out.push(issue("description-too-short", "low", `${head.description.length} characters (minimum ${limits.descriptionMin})`));
    }

    const h1s = head.h1s.filter(Boolean);
    if (h1s.length === 0) out.push(issue("h1-missing", "medium", head.h1s.length ? "The <h1> is empty" : "No <h1>"));
    else if (h1s.length > 1) out.push(issue("h1-multiple", "low", `${h1s.length} <h1> tags`));

    if (head.canonicals.length === 0) out.push(issue("canonical-missing", "medium", "No canonical tag"));
    else if (new Set(head.canonicals).size > 1)
        out.push(issue("canonical-multiple", "high", `${head.canonicals.length} canonical tags that disagree`));
    else if (head.canonicals.length > 1)
        out.push(issue("canonical-multiple", "low", `${head.canonicals.length} identical canonical tags`));
    else if (!head.canonicals[0]) out.push(issue("canonical-missing", "medium", "Canonical tag has no href"));

    return out;
}

// Used to compare URLs without caring about a trailing slash or a #fragment.
export function sameUrl(a, b) {
    const n = (u) => { try { const x = new URL(u); x.hash = ""; return x.href.replace(/\/$/, ""); } catch { return u; } };
    return n(a) === n(b);
}

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

// pages: [{ url, head, canonical }]. A page whose canonical points elsewhere is
// declaring itself a copy, so it is left out: sharing a title with its original is expected.
export function findDuplicates(pages) {
    const out = new Map(); // url -> [issue]
    for (const [field, type] of [["title", "title-duplicate"], ["description", "description-duplicate"]]) {
        const groups = new Map();
        for (const p of pages) {
            const value = p.head?.[field];
            if (!value) continue;
            if (p.canonical && !sameUrl(p.canonical, p.url)) continue;
            const key = norm(value);
            if (!groups.has(key)) groups.set(key, new Map());
            groups.get(key).set(p.url.replace(/\/$/, ""), p.url); // same page under two spellings counts once
        }
        for (const urls of groups.values()) {
            if (urls.size < 2) continue;
            for (const url of urls.values()) {
                const others = [...urls.values()].filter((u) => u !== url);
                if (!out.has(url)) out.set(url, []);
                out.get(url).push(issue(type, "medium", `Same ${field} as ${others.slice(0, 3).join(", ")}${others.length > 3 ? ` (+${others.length - 3} more)` : ""}`));
            }
        }
    }
    return out;
}

// result is what the link checker returned for the canonical's target:
// { classification: "ok" | "redirect" | "broken" | "unverified" | "unreachable", status }
export function canonicalTargetIssue(canonicalUrl, result) {
    if (!result) return null;
    if (result.classification === "broken")
        return issue("canonical-broken-target", "high", `Canonical points at ${canonicalUrl}, which returns ${result.status}`);
    if (result.classification === "redirect")
        return issue("canonical-redirect", "medium", `Canonical points at ${canonicalUrl}, which redirects (${result.status})`);
    if (result.classification === "unreachable")
        return issue("canonical-broken-target", "high", `Canonical points at ${canonicalUrl}, which cannot be reached`);
    return null; // ok, or blocked/timed out: not proof of a problem
}

// Fields that are empty in the raw HTML but filled in after JavaScript runs.
export function jsDependence(rawHead, renderedHead) {
    if (!rawHead || !renderedHead) return [];
    const out = [];
    if (!rawHead.title && renderedHead.title) out.push("title");
    if (!rawHead.description && renderedHead.description) out.push("description");
    if (rawHead.h1s.filter(Boolean).length === 0 && renderedHead.h1s.filter(Boolean).length > 0) out.push("h1");
    if (rawHead.canonicals.length === 0 && renderedHead.canonicals.length > 0) out.push("canonical");
    return out;
}