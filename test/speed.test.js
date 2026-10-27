import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { rate, templateKey, pickSpeedPages, clsFromShifts, speedFindings, summarizeSpeed, measurePages } from "../lib/speed.js";

test("ratings follow Google's thresholds, with the boundary counted as good", () => {
    assert.equal(rate("lcp", 2500), "good");
    assert.equal(rate("lcp", 2501), "needs-improvement");
    assert.equal(rate("lcp", 4001), "poor");
    assert.equal(rate("cls", 0.1), "good");
    assert.equal(rate("cls", 0.3), "poor");
    assert.equal(rate("tbt", 300), "needs-improvement");
    assert.equal(rate("ttfb", 2000), "poor");
    assert.equal(rate("bytes", 4 * 1024 * 1024), "needs-improvement");
    assert.equal(rate("lcp", null), null, "not measured is not rated");
});

test("pages of one kind share a template key", () => {
    assert.equal(templateKey("https://x.test/blog/post-a"), "/blog/*");
    assert.equal(templateKey("https://x.test/blog/2024/post-b"), "/blog/#/*");
    assert.equal(templateKey("https://x.test/p/12"), "/p/*");
    assert.equal(templateKey("https://x.test/about"), "/about");
    assert.equal(templateKey("https://x.test/"), "/");
});

test("the sample is the home page, then one page of each kind, then more of each in turn", () => {
    const urls = ["https://x.test/blog/a", "https://x.test/blog/b", "https://x.test/blog/c", "https://x.test/p/1", "https://x.test/p/2", "https://x.test/about", "https://x.test/"];
    assert.deepEqual(pickSpeedPages(urls, "https://x.test", 5), ["https://x.test/", "https://x.test/blog/a", "https://x.test/p/1", "https://x.test/about", "https://x.test/blog/b"]);
    assert.equal(pickSpeedPages(urls, "https://x.test/", 0).length, 7, "0 means every page");
    assert.equal(pickSpeedPages([...urls, ...urls], "https://x.test/", 0).length, 7, "no page twice");
});

test("CLS is the worst window of shifts, not the sum of all of them", () => {
    assert.equal(clsFromShifts([{ t: 100, value: 0.05 }, { t: 600, value: 0.05 }]), 0.1, "close together: one window");
    assert.equal(clsFromShifts([{ t: 100, value: 0.05 }, { t: 3000, value: 0.08 }]), 0.08, "over a second apart: two windows");
    assert.equal(clsFromShifts([{ t: 100, value: 0.3, input: true }]), 0, "after a tap: not counted");
});

const result = (url, m, extra = {}) => {
    const metrics = { lcpMs: 1500, cls: 0, tbtMs: 50, ttfbMs: 300, fcpMs: 900, loadMs: 2000, bytes: 1e6, requests: 20, ...m };
    return { url, ok: true, metrics, ratings: { lcp: rate("lcp", metrics.lcpMs), cls: rate("cls", metrics.cls), tbt: rate("tbt", metrics.tbtMs), ttfb: rate("ttfb", metrics.ttfbMs), bytes: rate("bytes", metrics.bytes) }, lcpElement: "the image hero.jpg", shifts: [{ value: metrics.cls, el: "a <div> block" }], biggest: [{ url: "https://x.test/hero.jpg", type: "image", bytes: 900000 }], byType: {}, ...extra };
};

test("one issue per slow measure per page; poor is medium, needs improvement low; good and failed pages give none", () => {
    const f = speedFindings([
        result("https://x.test/", { lcpMs: 5200, cls: 0.15 }),
        result("https://x.test/fast", {}),
        { url: "https://x.test/down", ok: false, error: "net::ERR" },
    ], new Map([["https://x.test/", new Set(["https://x.test/about"])]]));
    assert.deepEqual(f.map((x) => [x.type, x.severity]), [["speed-lcp-slow", "medium"], ["speed-cls-high", "low"]]);
    assert.match(f[0].detail, /^Main content appears after 5\.2 s on a phone \(good: under 2\.5 s\); it is the image hero\.jpg$/);
    assert.equal(f[0].evidence.kind, "speed");
    assert.equal(f[0].evidence.metric, "lcp");
    assert.deepEqual(f[0].foundOn, ["https://x.test/about"]);
});

test("the summary has medians, counts by rating and how many pages pass", () => {
    const s = summarizeSpeed([result("https://x.test/a", { lcpMs: 1000 }), result("https://x.test/b", { lcpMs: 3000 }), result("https://x.test/c", { lcpMs: 5000 }), { url: "https://x.test/d", ok: false }], 10);
    assert.equal(s.pagesTested, 3);
    assert.equal(s.pagesFailed, 1);
    assert.equal(s.pagesTotal, 10);
    assert.equal(s.median.lcpMs, 3000);
    assert.deepEqual(s.lcp, { good: 1, "needs-improvement": 1, poor: 1 });
    assert.equal(s.passing, 1);
    assert.equal(s.slowest[0].url, "https://x.test/c");
});

test("a real phone test: a late hero image is the slow main content; a late banner is a layout shift", async () => {
    const server = createServer((req, res) => {
        if (req.url === "/hero.svg") {
            setTimeout(() => { res.writeHead(200, { "Content-Type": "image/svg+xml" }); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">${Array.from({ length: 300 }, (_, i) => `<circle cx="${(i * 37) % 400}" cy="${(i * 53) % 600}" r="${3 + (i % 7)}" fill="hsl(${i * 13},60%,50%)"/>`).join("")}</svg>`); }, 3000);
            return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        if (req.url === "/hero") return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><img src="/hero.svg" alt="" style="display:block;width:100%;height:600px"><p>Hello</p>`);
        res.end(`<!doctype html><meta name="viewport" content="width=device-width"><p>Some text to read.</p><p>More text.</p><script>setTimeout(function(){var d=document.createElement("div");d.style.height="400px";document.body.prepend(d);},600)</script>`);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const [hero, shift] = await measurePages([`${base}/hero`, `${base}/shift`], { chromium, settleMs: 1200 });
        assert.equal(hero.ok, true);
        assert.ok(hero.metrics.lcpMs > 3000, `LCP ${hero.metrics.lcpMs}`);
        assert.equal(hero.ratings.lcp, "needs-improvement");
        assert.match(hero.lcpElement, /hero\.svg/);
        assert.ok(hero.metrics.ttfbMs >= 150, "the slowed network is in the server response time");
        assert.ok(shift.metrics.cls > 0.25, `CLS ${shift.metrics.cls}`);
        assert.ok(shift.metrics.bytes > 0 && shift.metrics.requests >= 1);
    } finally {
        server.close();
    }
});
