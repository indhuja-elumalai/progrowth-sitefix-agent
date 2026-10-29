// Page speed: a lab test of each page as a visitor on a mid-range phone over 4G
// would get it, the way Google's PageSpeed Insights tests "mobile":
//   - a phone screen (412 x 823), the CPU slowed 4x, the network slowed to "slow 4G"
//     (150 ms latency, 1.6 Mbit/s down), an empty cache, and everything loaded:
//     images, fonts, video, tracking scripts (nothing is blocked, unlike the crawl).
//   - measured in the page with the browser's own timings:
//       LCP   when the main content (largest image or text block) appears
//       CLS   how much the layout jumps while it loads
//       TBT   how long the page is too busy to respond to a tap (stands in for INP,
//             which needs a real visitor's taps)
//       TTFB  how long the server takes to start answering
//       FCP   when anything first appears; page weight and requests; readyMs, when
//             the first screen was finished
// These are lab numbers from one run on this machine: close to PageSpeed Insights,
// not the same as Google's field data from real Chrome users.
//
// Faster (Day 27): the network is slowed only until the first screen is finished
// (everything LCP, FCP and TTFB depend on); the rest of the page then loads at full
// speed with the CPU still slowed, so CLS, TBT and the page weight are still measured
// in full. A page takes about its first-screen time instead of its whole slow-4G
// download (8 s for a 1.5 MB page). Pages run as many at a time as the machine has
// cores to spare, and the test can be given a time budget (the most telling pages go first).
//
// Pure parts (tested):  rate(metric, value), pickSpeedPages(urls, startUrl, max),
//                       clsFromShifts(shifts), speedFindings(results, foundOn), summarizeSpeed(results, pagesTotal)
// Browser part:         measurePages(urls, { chromium, concurrency, budgetMs, onProgress })

import os from "node:os";

// Google's thresholds (web.dev/vitals); page weight from HTTP Archive's mobile median (~2.3 MB).
export const LIMITS = {
    lcp: { good: 2500, poor: 4000 },     // ms
    cls: { good: 0.1, poor: 0.25 },      // score
    tbt: { good: 200, poor: 600 },       // ms
    ttfb: { good: 800, poor: 1800 },     // ms
    fcp: { good: 1800, poor: 3000 },     // ms
    bytes: { good: 3 * 1024 * 1024, poor: 6 * 1024 * 1024 },
};

export const PHONE = {
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 progrowth-sitefix-agent/0.6",
};
export const NETWORK = { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
export const CPU_SLOWDOWN = 4;

// "good" | "needs-improvement" | "poor" | null (not measured)
export function rate(metric, value) {
    const l = LIMITS[metric];
    if (!l || value == null || Number.isNaN(value)) return null;
    return value <= l.good ? "good" : value <= l.poor ? "needs-improvement" : "poor";
}

// Which pages to test: the home page, then one page of each kind ("/blog/*",
// "/services/*", "/p/*"), then more of each kind in turn, up to max (0 = all).
// Pages of one kind share a template, so they are usually equally fast or slow.
export function templateKey(u) {
    try {
        const parts = new URL(u).pathname.split("/").filter(Boolean);
        if (parts.length <= 1) return `/${(parts[0] || "").replace(/\d+/g, "#")}`;
        return `/${parts.slice(0, -1).join("/").replace(/\d+/g, "#")}/*`;
    } catch { return u; }
}
export function pickSpeedPages(urls, startUrl, max = 40) {
    const seen = new Set();
    const list = urls.filter((u) => !seen.has(u) && seen.add(u));
    const norm = (u) => { try { const x = new URL(u); x.hash = ""; return x.href.replace(/\/$/, ""); } catch { return u; } };
    const home = list.find((u) => norm(u) === norm(startUrl));
    const groups = new Map();
    for (const u of list) {
        if (u === home) continue;
        const k = templateKey(u);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(u);
    }
    const out = home ? [home] : [];
    const queues = [...groups.values()];
    for (let round = 0; queues.some((q) => q.length > round); round++) {
        for (const q of queues) if (q[round]) out.push(q[round]);
    }
    return max ? out.slice(0, max) : out;
}

// CLS the way Chrome counts it: shifts are grouped into windows (a gap under 1 s,
// at most 5 s long); the score is the worst window. Shifts right after a tap don't
// count; the test never taps, so observe() records none as input (Chrome's phone
// emulation marks shifts in the first half second as "after input" even so).
export function clsFromShifts(shifts) {
    let worst = 0, cur = 0, start = -Infinity, last = -Infinity;
    for (const s of [...shifts].sort((a, b) => a.t - b.t)) {
        if (s.input) continue;
        if (s.t - last >= 1000 || s.t - start >= 5000) { cur = 0; start = s.t; }
        cur += s.value;
        last = s.t;
        worst = Math.max(worst, cur);
    }
    return Math.round(worst * 1000) / 1000;
}

const sec = (ms) => `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
const mb = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

// One issue per problem per page. Poor is medium severity, needs improvement is low:
// slow pages matter, but a broken page matters more. The home page goes up a level
// in triage, like every other issue.
export function speedFindings(results, foundOn = new Map()) {
    const out = [];
    for (const r of results) {
        if (!r.ok) continue;
        const m = r.metrics;
        const ev = (metric) => ({ kind: "speed", metric, ...m, ratings: r.ratings, lcpElement: r.lcpElement, shifts: r.shifts.slice(0, 5), biggest: r.biggest.slice(0, 5), byType: r.byType });
        const add = (type, metric, detail) => {
            const rating = r.ratings[metric];
            if (rating !== "poor" && rating !== "needs-improvement") return;
            out.push({ type, affectedUrl: r.url, foundOn: [...(foundOn.get(r.url) || [])], severity: rating === "poor" ? "medium" : "low", detail, evidence: ev(metric) });
        };
        add("speed-lcp-slow", "lcp", `Main content appears after ${sec(m.lcpMs)} on a phone (good: under 2.5 s)${r.lcpElement ? `; it is ${r.lcpElement}` : ""}`);
        add("speed-cls-high", "cls", `Layout shift score ${m.cls} (good: under 0.1)${r.shifts[0]?.el ? `; ${r.shifts[0].el} moves` : ""}`);
        add("speed-tbt-high", "tbt", `Page is too busy to respond for ${Math.round(m.tbtMs)} ms while loading (good: under 200 ms)`);
        add("speed-ttfb-slow", "ttfb", `Server takes ${sec(m.ttfbMs)} to start answering (good: under 0.8 s)`);
        add("speed-page-heavy", "bytes", `Page downloads ${mb(m.bytes)} in ${m.requests} files (good: under 3 MB)${r.biggest[0] ? `; the largest is ${mb(r.biggest[0].bytes)}` : ""}`);
    }
    return out;
}

const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function summarizeSpeed(results, pagesTotal) {
    const ok = results.filter((r) => r.ok);
    const count = (metric) => ok.reduce((acc, r) => { const k = r.ratings[metric] || "unknown"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const slowest = [...ok].filter((r) => r.metrics.lcpMs != null).sort((a, b) => b.metrics.lcpMs - a.metrics.lcpMs).slice(0, 5).map((r) => ({ url: r.url, lcpMs: r.metrics.lcpMs }));
    return {
        pagesTested: ok.length,
        pagesFailed: results.length - ok.length,
        pagesTotal,
        device: "mid-range phone, slow 4G, CPU 4x slower (lab test)",
        median: {
            lcpMs: median(ok.map((r) => r.metrics.lcpMs)),
            cls: median(ok.map((r) => r.metrics.cls)),
            tbtMs: median(ok.map((r) => r.metrics.tbtMs)),
            ttfbMs: median(ok.map((r) => r.metrics.ttfbMs)),
            fcpMs: median(ok.map((r) => r.metrics.fcpMs)),
            readyMs: median(ok.map((r) => r.metrics.readyMs)),
            bytes: median(ok.map((r) => r.metrics.bytes)),
            requests: median(ok.map((r) => r.metrics.requests)),
        },
        lcp: count("lcp"), cls: count("cls"), tbt: count("tbt"), ttfb: count("ttfb"), bytes: count("bytes"),
        // A page "passes" when LCP, CLS and TBT are all good (Google's Core Web Vitals, with TBT for INP).
        passing: ok.filter((r) => ["lcp", "cls", "tbt"].every((k) => r.ratings[k] === "good")).length,
        slowest,
    };
}

// ---------- the browser part ----------

// Runs in the page before anything else: records LCP, layout shifts and long tasks.
function observe() {
    const sf = (window.__sitefix = { lcp: null, lcpEl: null, lcpAt: 0, shifts: [], long: [] });
    const describe = (el) => {
        if (!el || !el.tagName) return null;
        const tag = el.tagName.toLowerCase();
        if (tag === "img") return `the image ${(el.currentSrc || el.src || "").split("/").pop().split("?")[0].slice(0, 60) || "(no name)"}`;
        if (tag === "video") return "a video";
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== "none") return `a background image (${(bg.match(/url\("?([^")]+)/) || [])[1]?.split("/").pop().slice(0, 60) || tag})`;
        const t = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
        return t ? `the text "${t.slice(0, 60)}${t.length > 60 ? "…" : ""}"` : `a <${tag}> block`;
    };
    try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) { sf.lcp = e.startTime; sf.lcpAt = performance.now(); sf.lcpEl = describe(e.element) || (e.url ? `the image ${e.url.split("/").pop().slice(0, 60)}` : null); } }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) { const src = (e.sources || []).map((s) => describe(s.node)).find(Boolean); sf.shifts.push({ t: e.startTime, value: e.value, input: false, el: src || null }); } }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) sf.long.push({ t: e.startTime, d: e.duration }); }).observe({ type: "longtask", buffered: true });
    } catch { /* an old browser: the numbers it can't measure stay empty */ }
}

// Runs in the page: is the first screen finished? Something has been drawn, the main
// content candidate hasn't changed for a second, the web fonts are in, and every image
// and background image on the first screen has arrived. Until then the slow network
// stays on; after it, only files below the first screen are still loading.
function firstScreenDone() {
    const sf = window.__sitefix;
    if (!sf || !performance.getEntriesByName("first-contentful-paint").length) return false;
    if (performance.now() - Math.max(sf.lcpAt, performance.getEntriesByName("first-contentful-paint")[0].startTime) < 1000) return false;
    if (document.fonts && document.fonts.status !== "loaded") return false;
    const vw = innerWidth, vh = innerHeight;
    const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw; };
    // Every image on the first screen has arrived, at least a second ago (time to be
    // drawn and become the main content if it is the largest).
    const arrived = new Map(performance.getEntriesByType("resource").map((r) => [r.name, r.responseEnd]));
    const now = performance.now();
    for (const img of document.images) {
        if (!onScreen(img)) continue;
        if (!img.complete) return false;
        const at = arrived.get(img.currentSrc || img.src);
        if (at != null && now - at < 1000) return false;
    }
    const done = new Set(arrived.keys());
    const els = document.body ? document.body.getElementsByTagName("*") : [];
    for (let i = 0; i < els.length && i < 3000; i++) {
        const el = els[i];
        if (!onScreen(el)) continue;
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === "none") continue;
        for (const m of bg.matchAll(/url\("?([^")]+)"?\)/g)) {
            if (m[1].startsWith("data:")) continue;
            try { const u = new URL(m[1], location.href).href; if (!done.has(u) || now - arrived.get(u) < 1000) return false; } catch { /* odd url: ignore */ }
        }
    }
    return true;
}

function collect() {
    const sf = window.__sitefix || { shifts: [], long: [] };
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const fcp = (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime ?? null;
    const tbt = sf.long.filter((x) => fcp == null || x.t >= fcp).reduce((s, x) => s + Math.max(0, x.d - 50), 0);
    return { lcp: sf.lcp, lcpEl: sf.lcpEl, shifts: sf.shifts, fcp, tbt, ttfb: nav.responseStart || null, load: nav.loadEventEnd || null };
}

const TYPE = { Document: "html", Script: "script", Stylesheet: "css", Image: "image", Font: "font", Media: "media", XHR: "data", Fetch: "data" };

async function measureOne(browser, url, { timeoutMs = 30000, settleMs = 3000 } = {}) {
    const context = await browser.newContext({ ...PHONE });
    const page = await context.newPage();
    const files = new Map();
    try {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NETWORK });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
        // The page's own timing reports the server's answer before the slowed network
        // delivers it, so TTFB is taken from the browser's network events instead.
        const doc = { sent: null, answered: null };
        cdp.on("Network.requestWillBeSent", (e) => { if (e.type === "Document" && doc.sent == null) doc.sent = e.timestamp; });
        cdp.on("Network.responseReceived", (e) => {
            if (e.type === "Document" && doc.answered == null && doc.sent != null) doc.answered = e.timestamp;
            files.set(e.requestId, { url: e.response.url, type: TYPE[e.type] || "other", bytes: 0 });
        });
        cdp.on("Network.dataReceived", (e) => { const f = files.get(e.requestId); if (f) f.bytes += e.encodedDataLength || 0; });
        cdp.on("Network.loadingFinished", (e) => { const f = files.get(e.requestId); if (f && e.encodedDataLength) f.bytes = e.encodedDataLength; });
        await page.addInitScript(observe);
        // Two parts, so a page doesn't take the whole slow-4G download time:
        //  1. on slow 4G until the first screen is finished (firstScreenDone): that is
        //     everything LCP, FCP and TTFB depend on;
        //  2. then full speed for the rest (images further down, trackers), with the CPU
        //     still 4x slower, until the page has loaded and its scripts have gone quiet
        //     for a second: CLS and TBT keep counting, and the page weight is complete
        //     (the bytes don't depend on the speed).
        const t0 = Date.now();
        const nav = page.goto(url, { waitUntil: "load", timeout: timeoutMs }).then(() => null, (err) => err);
        const committed = await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).then(() => true, () => false);
        let failed = null;
        if (!committed) failed = await nav;
        if (failed && !/Timeout/i.test(failed.message)) throw failed;
        let readyMs = null;
        while (!failed && Date.now() - t0 < timeoutMs) {
            if (await page.evaluate(firstScreenDone).catch(() => false)) { readyMs = Date.now() - t0; break; }
            await page.waitForTimeout(200);
        }
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        let timer;
        const loadErr = await Promise.race([nav, new Promise((r) => { timer = setTimeout(() => r(new Error("Timeout")), Math.max(1000, timeoutMs - (Date.now() - t0))); })]);
        clearTimeout(timer);
        if (loadErr && !/Timeout/i.test(loadErr.message)) throw loadErr;
        // Settle: until no long task for a second (at most settleMs).
        const settleEnd = Date.now() + settleMs;
        while (Date.now() < settleEnd) {
            const quiet = await page.evaluate(() => { const l = (window.__sitefix || { long: [] }).long, last = l.length ? l[l.length - 1].t + l[l.length - 1].d : 0; return performance.now() - last >= 1000; }).catch(() => true);
            if (quiet) break;
            await page.waitForTimeout(200);
        }
        const res = loadErr ? { failed: loadErr } : null;
        const c = await page.evaluate(collect);
        const list = [...files.values()];
        const bytes = list.reduce((s, f) => s + f.bytes, 0);
        const byType = {};
        for (const f of list) byType[f.type] = (byType[f.type] || 0) + f.bytes;
        const metrics = {
            lcpMs: c.lcp != null ? Math.round(c.lcp) : null,
            cls: clsFromShifts(c.shifts),
            tbtMs: Math.round(c.tbt),
            ttfbMs: doc.answered != null ? Math.round((doc.answered - doc.sent) * 1000) : c.ttfb != null ? Math.round(c.ttfb) : null,
            fcpMs: c.fcp != null ? Math.round(c.fcp) : null,
            readyMs, // when the first screen was finished on slow 4G (null: not before the time limit)
            bytes,
            requests: list.length,
        };
        const ratings = { lcp: rate("lcp", metrics.lcpMs), cls: rate("cls", metrics.cls), tbt: rate("tbt", metrics.tbtMs), ttfb: rate("ttfb", metrics.ttfbMs), fcp: rate("fcp", metrics.fcpMs), bytes: rate("bytes", metrics.bytes) };
        const shifts = c.shifts.filter((s) => !s.input).sort((a, b) => b.value - a.value).map((s) => ({ value: Math.round(s.value * 1000) / 1000, el: s.el }));
        const biggest = list.filter((f) => f.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 8).map((f) => ({ url: f.url, type: f.type, bytes: f.bytes }));
        return { url, ok: true, timedOut: Boolean(res?.failed), metrics, ratings, lcpElement: c.lcpEl, shifts, biggest, byType };
    } catch (err) {
        return { url, ok: false, error: String(err.message || err).split("\n")[0].slice(0, 200) };
    } finally {
        await context.close().catch(() => { });
    }
}

// A few pages at a time, in the order given (the most telling pages first): each one
// has its own slowed-down network and CPU. As many as the machine has cores to spare
// (2 to 6), so pages don't slow each other's CPU timings. budgetMs: no new page is
// started after that long; pages already started finish. shouldStop: () => true once
// the inspection was stopped: no new page is started at all. Results come back in the
// order of urls; pages not started are left out.
export function defaultConcurrency(cpus = os.cpus().length) {
    return Math.max(2, Math.min(6, cpus - 1));
}
export async function measurePages(urls, { chromium, concurrency = defaultConcurrency(), budgetMs = 0, shouldStop = () => false, onProgress = () => { }, ...opts } = {}) {
    if (!urls.length) return [];
    const browser = await chromium.launch();
    const results = new Array(urls.length);
    const t0 = Date.now();
    let next = 0, done = 0;
    try {
        // Each worker always starts one page; after that, none starts once the budget is spent.
        await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
            for (let mine = 0; next < urls.length && !(mine > 0 && budgetMs && Date.now() - t0 > budgetMs) && !shouldStop(); mine++) {
                const k = next++;
                results[k] = await measureOne(browser, urls[k], opts);
                onProgress({ done: ++done, total: urls.length, result: results[k] });
            }
        }));
    } finally {
        await browser.close();
    }
    return results.filter(Boolean);
}
