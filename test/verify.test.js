import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, checkKind, verifyIssues, checkAddress, followAddress, MAX_PAGES } from "../lib/verify.js";

const head = (o = {}) => ({ title: "A good page title for this page", titleCount: 1, description: "A".repeat(120), descriptionCount: 1, robots: null, canonicals: ["https://e.com/a"], og: { "og:title": "t", "og:description": "d", "og:image": "https://e.com/s.png" }, twitter: {}, viewport: "width=device-width", lang: "en", h1s: ["Hello"], headings: [{ level: 1, text: "Hello" }, { level: 2, text: "Sub" }], ...o });
const page = (o = {}) => ({ url: "https://e.com/a", status: 200, head: head(), xRobotsTag: null, textLines: ["Welcome to our shop."], hrefs: [], images: [], ...o });
const iss = (type, o = {}) => ({ id: "ISS-0000000001", type, affectedUrl: "https://e.com/a", foundOn: ["https://e.com/"], evidence: {}, ...o });

test("each kind of problem is checked the way the crawl found it; the rest wait for the next inspection", () => {
    assert.equal(checkKind("title-missing"), "page");
    assert.equal(checkKind("copy-spelling"), "page");
    assert.equal(checkKind("http-4xx-internal"), "target");
    assert.equal(checkKind("image-alt-missing"), "target");
    assert.equal(checkKind("redirect-chain"), "redirect");
    assert.equal(checkKind("speed-lcp-slow"), "speed");
    for (const t of ["title-duplicate", "content-duplicate", "soft-404", "content-thin", "https-missing-redirect", "metadata-js-only"]) assert.equal(checkKind(t), "manual", t);
    assert.equal(judge(iss("soft-404")).status, "manual");
});

test("page rules: fixed only when the live page passes the same rule", () => {
    assert.equal(judge(iss("title-missing"), { page: page({ head: head({ title: null, titleCount: 0 }) }) }).status, "still");
    assert.equal(judge(iss("title-missing"), { page: page() }).status, "fixed");
    assert.equal(judge(iss("lang-missing"), { page: page({ head: head({ lang: null }) }) }).status, "still");
    assert.equal(judge(iss("robots-noindex"), { page: page({ xRobotsTag: "noindex" }) }).status, "still");
    assert.equal(judge(iss("robots-noindex"), { page: page() }).status, "fixed");
    assert.equal(judge(iss("og-missing"), { page: page({ head: head({ og: {} }) }) }).status, "still");
    assert.equal(judge(iss("content-placeholder"), { page: page({ textLines: ["Lorem ipsum dolor sit amet"] }) }).status, "still");
    assert.equal(judge(iss("content-placeholder"), { page: page() }).status, "fixed");
    assert.equal(judge(iss("title-missing"), { page: page({ status: 500 }) }).status, "still", "a broken page is not a fix");
    assert.equal(judge(iss("title-missing"), { page: { status: null } }).status, "unknown");
    assert.equal(judge(iss("title-missing"), {}).status, "unknown");
});

test("spelling: fixed when the quoted mistakes are gone from the page", () => {
    const i = iss("copy-spelling", { evidence: { matches: [{ text: "We recieve  orders daily." }, { text: "Our adress is below." }] } });
    assert.equal(judge(i, { page: page({ textLines: ["We recieve orders daily.", "Our address is below."] }) }).detail, "1 of 2 still on the page.");
    assert.equal(judge(i, { page: page({ textLines: ["We receive orders daily.", "Our address is below."] }) }).status, "fixed");
});

test("links and images: fixed when the address works again, or when it is no longer used", () => {
    const link = iss("http-4xx-internal", { affectedUrl: "https://e.com/gone" });
    assert.equal(judge(link, { target: { status: 200 } }).status, "fixed");
    assert.equal(judge(link, { target: { status: 404 }, pages: [page({ hrefs: ["https://e.com/gone#top"] })] }).status, "still");
    assert.equal(judge(link, { target: { status: 404 }, pages: [page({ hrefs: ["https://e.com/new"] })] }).status, "fixed");
    assert.equal(judge(link, { target: { status: 404 }, pages: [{ status: null }] }).status, "still", "can't open the page: not proof it was removed");
    assert.equal(judge(link, {}).status, "unknown");
    const img = iss("image-alt-missing", { affectedUrl: "https://e.com/i.png" });
    assert.equal(judge(img, { pages: [page({ images: [{ src: "https://e.com/i.png", alt: null }] })] }).status, "still");
    assert.equal(judge(img, { pages: [page({ images: [{ src: "https://e.com/i.png", alt: "Our team" }] })] }).status, "fixed");
    assert.equal(judge(img, { pages: [page({ images: [{ src: "https://e.com/i.png", alt: null, decorative: true }] })] }).status, "fixed");
    assert.equal(judge(iss("image-alt-unhelpful", { affectedUrl: "https://e.com/i.png" }), { pages: [page({ images: [{ src: "https://e.com/i.png", alt: "IMG_0042.jpg" }] })] }).status, "still");
    const big = iss("image-oversized", { affectedUrl: "https://e.com/i.png" });
    assert.equal(judge(big, { target: { status: 200, bytes: 900 * 1024 }, pages: [page({ images: [{ src: "https://e.com/i.png" }] })] }).status, "still");
    assert.equal(judge(big, { target: { status: 200, bytes: 90 * 1024 }, pages: [page({ images: [{ src: "https://e.com/i.png" }] })] }).status, "fixed");
    const og = iss("og-image-broken", { affectedUrl: "https://e.com/s.png", foundOn: ["https://e.com/a"] });
    assert.equal(judge(og, { target: { status: 404 }, page: page() }).status, "still");
    assert.equal(judge(og, { target: { status: 404 }, page: page({ head: head({ og: { "og:image": "/new.png" } }) }) }).status, "fixed");
});

test("redirects and speed", () => {
    assert.equal(judge(iss("redirect-chain"), { redirect: { hops: 3, loop: false, finalStatus: 200 } }).status, "still");
    assert.equal(judge(iss("redirect-chain"), { redirect: { hops: 1, loop: false, finalStatus: 200 } }).status, "fixed");
    assert.equal(judge(iss("redirect-loop"), { redirect: { hops: 2, loop: true, finalStatus: null } }).status, "still");
    assert.equal(judge(iss("redirect-to-error"), { redirect: { hops: 1, loop: false, finalStatus: 404 } }).status, "still");
    assert.equal(judge(iss("redirect-to-error"), { redirect: { hops: 1, loop: false, finalStatus: 200 } }).status, "fixed");
    const speed = (lcpMs) => ({ ok: true, url: "https://e.com/a", metrics: { lcpMs, cls: 0, tbtMs: 0, ttfbMs: 100, bytes: 1000, requests: 3 }, ratings: { lcp: lcpMs > 4000 ? "poor" : "good", cls: "good", tbt: "good", ttfb: "good", bytes: "good" }, shifts: [], biggest: [] });
    assert.equal(judge(iss("speed-lcp-slow"), { speed: speed(6000) }).status, "still");
    assert.equal(judge(iss("speed-lcp-slow"), { speed: speed(1200) }).status, "fixed");
    assert.equal(judge(iss("speed-lcp-slow"), { speed: { ok: false } }).status, "unknown");
});

const fakeFetch = (routes) => async (url, opts = {}) => {
    const r = routes[url] || { status: 404 };
    if (r.throws) throw Object.assign(new Error("fetch failed"), { cause: { code: r.throws } });
    const headers = new Map(Object.entries(r.headers || {}));
    return { status: opts.method === "HEAD" && r.noHead ? 405 : r.status, headers: { get: (k) => headers.get(k) ?? null }, body: null, arrayBuffer: async () => new ArrayBuffer(r.size || 0) };
};

test("HTTP checks: HEAD, then GET when refused; redirects are followed hop by hop", async () => {
    assert.deepEqual(await checkAddress("https://e.com/x", { fetch: fakeFetch({ "https://e.com/x": { status: 200, noHead: true, headers: { "content-length": "10" } } }) }), { status: 200, bytes: 10 });
    assert.equal((await checkAddress("https://e.com/x", { fetch: fakeFetch({ "https://e.com/x": { throws: "ENOTFOUND" } }) })).error, "ENOTFOUND");
    const hops = { "https://e.com/1": { status: 301, headers: { location: "/2" } }, "https://e.com/2": { status: 302, headers: { location: "https://e.com/3" } }, "https://e.com/3": { status: 200 } };
    assert.deepEqual(await followAddress("https://e.com/1", { fetch: fakeFetch(hops) }), { hops: 2, loop: false, finalStatus: 200 });
    const loop = { "https://e.com/a": { status: 301, headers: { location: "/b" } }, "https://e.com/b": { status: 301, headers: { location: "/a" } } };
    assert.equal((await followAddress("https://e.com/a", { fetch: fakeFetch(loop) })).loop, true);
});

test("verifyIssues opens each page once, at most a few pages per check, and never throws", async () => {
    const opened = [];
    const renderPage = async (url) => { opened.push(url); if (url.endsWith("/boom")) throw new Error("crash"); return page({ url }); };
    const issues = [
        iss("title-missing", { id: "ISS-a", affectedUrl: "https://e.com/p" }),
        iss("lang-missing", { id: "ISS-b", affectedUrl: "https://e.com/p" }),
        iss("og-missing", { id: "ISS-c", affectedUrl: "https://e.com/boom" }),
        iss("soft-404", { id: "ISS-d" }),
        ...Array.from({ length: MAX_PAGES + 3 }, (_, k) => iss("h1-missing", { id: `ISS-p${k}`, affectedUrl: `https://e.com/q${k}` })),
    ];
    const out = await verifyIssues(issues, { renderPage, fetch: fakeFetch({}) });
    assert.equal(out["ISS-a"].status, "fixed");
    assert.equal(out["ISS-b"].status, "fixed");
    assert.equal(out["ISS-c"].status, "unknown");
    assert.equal(out["ISS-d"].status, "manual");
    assert.equal(opened.filter((u) => u === "https://e.com/p").length, 1);
    assert.ok(opened.length <= MAX_PAGES);
    assert.ok(Object.values(out).filter((x) => x.status === "skipped").length >= 3, "the rest are sent again by the page");
});
