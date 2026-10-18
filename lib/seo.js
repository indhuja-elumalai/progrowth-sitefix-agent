// SEO rules: what search engines read. Pure functions: facts from lib/head.js in, issues out.
// No network and no browser in here, so every rule can be unit-tested.
//
// Two categories (see the CATALOG in lib/issues.js):
//   SEO: titles & descriptions  title, meta description, H1, heading order, tags that need JavaScript
//   SEO: indexing               canonical tag, robots noindex / nofollow
//
// headIssues(head)          -> title, description, H1 and canonical issues for one page
// robotsIssues(head, xRobotsTag) -> noindex / nofollow from the meta tag or the X-Robots-Tag header
// headingIssues(head)       -> heading levels that skip (H2 straight to H4)
// findDuplicates(pages)     -> same title / description on 2+ pages
// canonicalTargetIssue(...) -> issue from the status of the canonical's target
// jsDependence(...)         -> fields that exist only after JavaScript runs
import { sameUrl } from "./head.js";

export const LIMITS = {
    titleMin: 10,
    titleMax: 60,
    descriptionMin: 50,
    descriptionMax: 160,
};

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

// noindex keeps the page out of Google; nofollow stops Google following its links.
// "none" means both. Read from <meta name="robots"> and the X-Robots-Tag header.
// Often deliberate (thank-you pages, internal search), so a human decides.
export function robotsIssues(head, xRobotsTag = null) {
    const sources = [];
    if (head.robots) sources.push({ where: "meta robots", value: head.robots.toLowerCase() });
    if (xRobotsTag) sources.push({ where: "X-Robots-Tag header", value: xRobotsTag.toLowerCase() });
    // Directives are comma-separated; one may be aimed at a single crawler ("googlebot: noindex").
    const directives = (value) => value.split(/\s*,\s*/).map((d) => d.replace(/\s*:\s*/, ":").trim());
    const has = (word) => sources.find((s) => directives(s.value).some((d) => d === word || d === "none" || d.endsWith(`:${word}`) || d.endsWith(":none")));
    const out = [];
    const noindex = has("noindex");
    if (noindex) out.push(issue("robots-noindex", "medium", `Page asks search engines not to index it (${noindex.where}: "${noindex.value}")`));
    const nofollow = has("nofollow");
    if (nofollow) out.push(issue("robots-nofollow", "low", `Page asks search engines not to follow its links (${nofollow.where}: "${nofollow.value}")`));
    return out;
}

// A heading should go at most one level deeper than the one before it
// (H2 then H3, not H2 then H4). Going back up any number of levels is fine.
// Pages with no H1 are left to h1-missing.
export function headingIssues(head) {
    const hs = head.headings || [];
    if (!hs.some((h) => h.level === 1)) return [];
    const skips = [];
    for (let i = 1; i < hs.length; i++) {
        if (hs[i].level > hs[i - 1].level + 1) skips.push({ from: hs[i - 1], to: hs[i] });
    }
    if (!skips.length) return [];
    const first = skips[0];
    const label = (h) => `H${h.level}${h.text ? ` "${h.text.slice(0, 40)}"` : ""}`;
    const more = skips.length > 1 ? ` (+${skips.length - 1} more)` : "";
    return [issue("heading-skip", "low", `Heading levels skip: ${label(first.from)} then ${label(first.to)}${more}`)];
}
