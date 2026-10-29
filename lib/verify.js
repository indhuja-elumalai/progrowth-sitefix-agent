// "Check it now" in the live report: checks the live site again for the issues the
// client says are fixed, with the same rules the crawl used, and says for each one
// whether it is fixed, still there, or can only be confirmed by the next inspection.
//
// verifyIssues(issues, { fetch, renderPage, measure, timeBudgetMs }) -> { [id]: { status, detail } }
//   status: "fixed" | "still" | "manual" (this kind is confirmed on the next inspection)
//           | "unknown" (the site could not be reached just now) | "skipped" (too many pages for
//           one check: the page sends the rest again)
//   fetch:      the global fetch, or a fake in tests
//   renderPage: (url) -> { status, head, xRobotsTag, textLines, hrefs, images } or null
//               (createRenderer below opens the page in Chromium, like the crawl does)
//   measure:    (url) -> one lib/speed.js result, for the speed issues
//
// judge(issue, facts) decides one issue from facts already gathered; pure, so every
// rule is unit-tested without a network or a browser.

import { headIssues, robotsIssues, headingIssues } from "./seo.js";
import { socialIssues } from "./social.js";
import { pageSetupIssues } from "./page-setup.js";
import { placeholderIssue, repeatedWordIssue } from "./content.js";
import { isUnhelpfulAlt, IMAGE_LIMITS } from "./images.js";
import { speedFindings } from "./speed.js";
import { extractHead } from "./head.js";

export const MAX_VERIFY = 60; // issues per check
export const MAX_PAGES = 20; // pages opened per check; issues on further pages are skipped (check again)

// What each kind needs: the page itself (head, text), the pages it is found on (links,
// images), the address itself over HTTP, the redirects, or a speed test.
const HEAD_TYPES = new Set(["title-missing", "title-multiple", "title-too-long", "title-too-short", "description-missing", "description-multiple", "description-too-long", "description-too-short",
    "h1-missing", "h1-multiple", "heading-skip", "canonical-missing", "canonical-multiple", "robots-noindex", "robots-nofollow", "og-missing", "og-incomplete", "viewport-missing", "lang-missing"]);
const TEXT_TYPES = new Set(["content-placeholder", "content-repeated-word", "copy-spelling", "copy-grammar"]);
const LINK_TYPES = new Set(["http-4xx-internal", "http-4xx-external", "link-unreachable"]);
const IMAGE_TYPES = new Set(["image-broken", "image-oversized", "image-mixed-content", "image-alt-missing", "image-alt-unhelpful", "image-alt-too-long", "og-image-broken"]);
const REDIRECT_TYPES = new Set(["redirect-chain", "redirect-loop", "redirect-to-error"]);
const SPEED_TYPES = new Set(["speed-lcp-slow", "speed-cls-high", "speed-tbt-high", "speed-ttfb-slow", "speed-page-heavy"]);

export function checkKind(type) {
    if (HEAD_TYPES.has(type) || TEXT_TYPES.has(type)) return "page";
    if (LINK_TYPES.has(type) || IMAGE_TYPES.has(type)) return "target";
    if (REDIRECT_TYPES.has(type)) return "redirect";
    if (SPEED_TYPES.has(type)) return "speed";
    return "manual";
}

const r = (status, detail) => ({ status, detail });
const sameAddr = (a, b) => { try { const x = new URL(a), y = new URL(b); x.hash = y.hash = ""; return x.href.replace(/\/$/, "") === y.href.replace(/\/$/, ""); } catch { return a === b; } };

// facts: { page, pages: [rendered foundOn pages], target: { status, bytes, error }, redirect: { hops, loop, finalStatus }, speed }
export function judge(issue, facts = {}) {
    const type = issue.type;
    const kind = checkKind(type);
    if (kind === "manual") return r("manual", "This kind of problem is confirmed by the next inspection.");

    if (kind === "page") {
        const p = facts.page;
        if (!p || p.status == null) return r("unknown", "The page could not be opened just now.");
        if (p.status >= 400) return r("still", `The page answers ${p.status}.`);
        if (HEAD_TYPES.has(type)) {
            const found = [...headIssues(p.head), ...robotsIssues(p.head, p.xRobotsTag), ...headingIssues(p.head), ...socialIssues(p.head), ...pageSetupIssues(p.head)].map((i) => i.type);
            return found.includes(type) ? r("still", "Still found on the live page.") : r("fixed", "Not found on the live page any more.");
        }
        const lines = p.textLines || [];
        if (type === "content-placeholder") return placeholderIssue(lines) ? r("still", "Placeholder text is still on the page.") : r("fixed", "No placeholder text on the page now.");
        if (type === "content-repeated-word") return repeatedWordIssue(lines) ? r("still", "A repeated word is still on the page.") : r("fixed", "No repeated words on the page now.");
        // Spelling and grammar: the quoted mistakes must be gone from the page.
        const norm = (x) => String(x || "").replace(/\s+/g, " ").trim().toLowerCase();
        const text = norm(lines.join(" "));
        const wrong = (issue.evidence?.matches || []).map((m) => norm(m.text)).filter(Boolean);
        if (!wrong.length) return r("manual", "Confirmed by the next inspection.");
        const left = wrong.filter((w) => text.includes(w));
        return left.length ? r("still", `${left.length} of ${wrong.length} still on the page.`) : r("fixed", "The mistakes are gone from the page.");
    }

    if (kind === "redirect") {
        const d = facts.redirect;
        if (!d) return r("unknown", "The address could not be reached just now.");
        if (type === "redirect-loop") return d.loop ? r("still", "Still redirects in a loop.") : r("fixed", "No redirect loop now.");
        if (type === "redirect-chain") return d.hops > 1 ? r("still", `Still ${d.hops} redirects.`) : r("fixed", "One redirect or none now.");
        return d.finalStatus != null && d.finalStatus < 400 ? r("fixed", "The redirect now ends on a working page.") : r("still", `The redirect still ends on ${d.finalStatus ?? "an error"}.`);
    }

    if (kind === "speed") {
        const s = facts.speed;
        if (!s || !s.ok) return r("unknown", "The speed test could not run just now.");
        return speedFindings([s]).some((f) => f.type === type) ? r("still", "The speed test still finds it.") : r("fixed", "The speed test passes this now.");
    }

    // Links and images: fixed when the address works again, or when the pages it was
    // found on no longer use it (the link or image was removed or replaced).
    const pages = (facts.pages || []).filter((p) => p && p.status != null && p.status < 400);
    const usedOn = pages.filter((p) => (IMAGE_TYPES.has(type) && type !== "og-image-broken" ? (p.images || []).some((i) => sameAddr(i.src, issue.affectedUrl)) : (p.hrefs || []).some((h) => sameAddr(h, issue.affectedUrl))));
    const gone = pages.length > 0 && usedOn.length === 0;
    const t = facts.target;
    if (LINK_TYPES.has(type) || type === "image-broken" || type === "og-image-broken") {
        if (t && t.status != null && t.status < 400) return r("fixed", `It works now (answers ${t.status}).`);
        if (type === "og-image-broken") {
            const og = facts.page?.head?.og?.["og:image"];
            if (facts.page?.head && (!og || !sameAddr(new URL(og, issue.foundOn?.[0] || issue.affectedUrl).href, issue.affectedUrl))) return r("fixed", "The sharing image was replaced.");
        } else if (gone) return r("fixed", "It is no longer used on the pages it was found on.");
        if (!t) return r("unknown", "It could not be checked just now.");
        return r("still", t.status ? `It still answers ${t.status}.` : `It still can't be reached${t.error ? ` (${t.error})` : ""}.`);
    }
    if (type === "image-oversized") {
        if (gone) return r("fixed", "The image is no longer used on those pages.");
        if (!t || typeof t.bytes !== "number") return r("unknown", "The image could not be checked just now.");
        return t.bytes > IMAGE_LIMITS.maxBytes ? r("still", `Still ${Math.round(t.bytes / 1024)} KB.`) : r("fixed", `Now ${Math.round(t.bytes / 1024)} KB.`);
    }
    if (!pages.length) return r("unknown", "The pages could not be opened just now.");
    if (gone) return r("fixed", "The image is no longer used on those pages.");
    const imgs = usedOn.flatMap((p) => (p.images || []).filter((i) => sameAddr(i.src, issue.affectedUrl)).map((i) => ({ ...i, pageUrl: p.url })));
    const bad = imgs.filter((i) => {
        if (type === "image-mixed-content") return /^http:/i.test(i.src) && /^https:/i.test(i.pageUrl || "https:");
        if (i.decorative) return false;
        const alt = typeof i.alt === "string" ? i.alt.trim() : null;
        if (type === "image-alt-missing") return alt === null;
        if (type === "image-alt-unhelpful") return alt !== null && isUnhelpfulAlt(alt);
        return alt !== null && alt.length > IMAGE_LIMITS.altMax;
    });
    return bad.length ? r("still", `Still on ${bad.length === 1 ? "one page" : `${new Set(bad.map((b) => b.pageUrl)).size} pages`}.`) : r("fixed", "Fixed on the pages it was found on.");
}

// One HTTP check, like the crawl's: HEAD, then GET when HEAD is refused.
export async function checkAddress(url, { fetch: get = fetch, timeoutMs = 10000, wantBytes = false } = {}) {
    const once = async (method) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
            const res = await get(url, { method, redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "SiteFix-verify/1.0" } });
            let bytes = Number(res.headers.get("content-length")) || null;
            if (method === "GET" && wantBytes && bytes == null) bytes = (await res.arrayBuffer()).byteLength;
            else if (method === "GET") res.body?.cancel?.().catch(() => {});
            return { status: res.status, bytes };
        } finally { clearTimeout(timer); }
    };
    try {
        let x = await once("HEAD");
        if ([403, 405, 501].includes(x.status) || (wantBytes && x.bytes == null)) x = await once("GET");
        return x;
    } catch (err) {
        return { status: null, error: err.name === "AbortError" ? "timed out" : String(err.cause?.code || err.message) };
    }
}

export async function followAddress(url, { fetch: get = fetch, maxHops = 10, timeoutMs = 10000 } = {}) {
    const seen = new Set();
    let cur = url, hops = 0;
    try {
        for (;;) {
            if (seen.has(cur)) return { hops, loop: true, finalStatus: null };
            seen.add(cur);
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), timeoutMs);
            const res = await get(cur, { method: "GET", redirect: "manual", signal: ctl.signal, headers: { "User-Agent": "SiteFix-verify/1.0" } }).finally(() => clearTimeout(timer));
            res.body?.cancel?.().catch(() => {});
            const loc = res.headers.get("location");
            if (res.status >= 300 && res.status < 400 && loc) {
                if (++hops > maxHops) return { hops, loop: true, finalStatus: null };
                cur = new URL(loc, cur).href;
                continue;
            }
            return { hops, loop: false, finalStatus: res.status };
        }
    } catch {
        return null;
    }
}

// Opens pages in Chromium and reads the same facts the crawl reads.
export function createRenderer({ chromium }) {
    let launching = null; // one browser, however many pages open at once
    return {
        async render(url) {
            launching ||= chromium.launch();
            const browser = await launching;
            const page = await browser.newPage();
            try {
                const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
                await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
                const head = extractHead(await page.content());
                const facts = await page.evaluate(() => ({
                    textLines: (document.body?.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5000),
                    hrefs: Array.from(document.querySelectorAll("a[href]")).map((a) => a.href),
                    images: Array.from(document.querySelectorAll("img")).map((i) => ({
                        src: i.currentSrc || i.src || "", alt: i.getAttribute("alt"),
                        decorative: i.getAttribute("alt") === "" || ["presentation", "none"].includes((i.getAttribute("role") || "").toLowerCase()) || i.getAttribute("aria-hidden") === "true",
                    })),
                }));
                return { url, status: res ? res.status() : null, xRobotsTag: res ? res.headers()["x-robots-tag"] || null : null, head, ...facts };
            } catch {
                return { url, status: null };
            } finally {
                await page.close().catch(() => {});
            }
        },
        async close() { const b = launching; launching = null; if (b) await (await b.catch(() => null))?.close().catch(() => {}); },
    };
}

const SKIPPED = { skipped: true };

export async function verifyIssues(issues, { fetch: get = fetch, renderPage, measure = null, timeBudgetMs = 60000 } = {}) {
    const list = issues.slice(0, MAX_VERIFY);
    const t0 = Date.now();
    const late = () => Date.now() - t0 > timeBudgetMs;
    const pages = new Map(); // url -> promise of facts
    const open = (url) => {
        if (!pages.has(url)) {
            if (pages.size >= MAX_PAGES || late()) return Promise.resolve(SKIPPED);
            pages.set(url, renderPage(url).catch(() => null));
        }
        return pages.get(url);
    };
    const out = {};
    // A few at a time, so a big check doesn't open everything at once.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
        while (next < list.length) {
            const issue = list[next++];
            const kind = checkKind(issue.type);
            const facts = {};
            try {
                if (late()) { out[issue.id] = r("unknown", "Out of time for this check; try again."); continue; }
                if (kind === "page") facts.page = await open(issue.affectedUrl);
                else if (kind === "redirect") facts.redirect = await followAddress(issue.affectedUrl, { fetch: get });
                else if (kind === "speed") facts.speed = measure ? await measure(issue.affectedUrl) : null;
                else if (kind === "target") {
                    facts.target = await checkAddress(issue.affectedUrl, { fetch: get, wantBytes: issue.type === "image-oversized" });
                    if (issue.type === "og-image-broken") facts.page = issue.foundOn?.[0] ? await open(issue.foundOn[0]) : null;
                    else if (!(facts.target?.status != null && facts.target.status < 400 && issue.type !== "image-oversized")) facts.pages = await Promise.all((issue.foundOn || []).slice(0, 3).map(open));
                    if (["image-mixed-content", "image-alt-missing", "image-alt-unhelpful", "image-alt-too-long"].includes(issue.type) && !facts.pages) facts.pages = await Promise.all((issue.foundOn || []).slice(0, 3).map(open));
                }
                const skipped = facts.page === SKIPPED || (facts.pages || []).some((p) => p === SKIPPED);
                out[issue.id] = skipped ? r("skipped", "Not checked this time (too many pages at once); check again for the rest.") : judge(issue, facts);
            } catch (err) {
                out[issue.id] = r("unknown", "It could not be checked just now.");
            }
        }
    }));
    return out;
}
