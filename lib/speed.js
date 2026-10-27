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
//       FCP   when anything first appears; load time; page weight and requests
// These are lab numbers from one run on this machine: close to PageSpeed Insights,
// not the same as Google's field data from real Chrome users.
//
// Pure parts (tested):  rate(metric, value), pickSpeedPages(urls, startUrl, max),
//                       clsFromShifts(shifts), speedFindings(results, foundOn), summarizeSpeed(results, pagesTotal)
// Browser part:         measurePages(urls, { chromium, concurrency, onProgress })

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
            loadMs: median(ok.map((r) => r.metrics.loadMs)),
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
    const sf = (window.__sitefix = { lcp: null, lcpEl: null, shifts: [], long: [] });
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
        new PerformanceObserver((l) => { for (const e of l.getEntries()) { sf.lcp = e.startTime; sf.lcpEl = describe(e.element) || (e.url ? `the image ${e.url.split("/").pop().slice(0, 60)}` : null); } }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) { const src = (e.sources || []).map((s) => describe(s.node)).find(Boolean); sf.shifts.push({ t: e.startTime, value: e.value, input: false, el: src || null }); } }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) sf.long.push({ t: e.startTime, d: e.duration }); }).observe({ type: "longtask", buffered: true });
    } catch { /* an old browser: the numbers it can't measure stay empty */ }
}

function collect() {
    const sf = window.__sitefix || { shifts: [], long: [] };
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const fcp = (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime ?? null;
    const tbt = sf.long.filter((x) => fcp == null || x.t >= fcp).reduce((s, x) => s + Math.max(0, x.d - 50), 0);
    return { lcp: sf.lcp, lcpEl: sf.lcpEl, shifts: sf.shifts, fcp, tbt, ttfb: nav.responseStart || null, load: nav.loadEventEnd || null };
}

const TYPE = { Document: "html", Script: "script", Stylesheet: "css", Image: "image", Font: "font", Media: "media", XHR: "data", Fetch: "data" };

async function measureOne(browser, url, { timeoutMs = 30000, settleMs = 2000 } = {}) {
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
        const res = await page.goto(url, { waitUntil: "load", timeout: timeoutMs }).catch((err) => ({ failed: err }));
        if (res?.failed && !/Timeout/i.test(res.failed.message)) throw res.failed;
        // Let late content, layout shifts and the last long tasks arrive.
        await page.waitForTimeout(settleMs);
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
            loadMs: c.load ? Math.round(c.load) : res?.failed ? timeoutMs : null,
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

// A few pages at a time: each one has its own slowed-down network and CPU, so they
// don't slow each other's numbers much. Results come back in the order of urls.
export async function measurePages(urls, { chromium, concurrency = 3, onProgress = () => { }, ...opts } = {}) {
    if (!urls.length) return [];
    const browser = await chromium.launch();
    const results = new Array(urls.length);
    let next = 0, done = 0;
    try {
        await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
            while (next < urls.length) {
                const k = next++;
                results[k] = await measureOne(browser, urls[k], opts);
                onProgress({ done: ++done, total: urls.length, result: results[k] });
            }
        }));
    } finally {
        await browser.close();
    }
    return results;
}
