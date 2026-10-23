import { test } from "node:test";
import assert from "node:assert/strict";
import { createProgress, estimateEta, parseProgressLine, PROGRESS_PREFIX } from "../lib/progress.js";

function harness(opts = {}) {
    let t = 0;
    const lines = [];
    const p = createProgress({ write: (s) => lines.push(s), now: () => t, ...opts });
    const msgs = () => lines.map((l) => parseProgressLine(l.trimEnd()));
    return { p, lines, msgs, tick: (ms) => { t += ms; } };
}

test("nothing is written when progress is off, so the command-line output is unchanged", () => {
    const { p, lines } = harness({ enabled: false });
    p.set({ phase: "crawl" });
    p.finding({ type: "title-missing", severity: "high", url: "https://x.test/" });
    p.flush();
    assert.equal(lines.length, 0);
    assert.equal(p.state.issues.high, 1, "still counted");
});

test("a new phase is sent at once; updates within the interval are held back", () => {
    const { p, msgs, tick } = harness({ intervalMs: 250 });
    p.set({ phase: "crawl", pages: { done: 0, found: 1 } });
    p.set({ pages: { done: 1, found: 5 } });
    p.set({ pages: { done: 2, found: 9 } });
    assert.equal(msgs().length, 1);
    tick(300);
    p.set({ pages: { done: 3, found: 9 } });
    assert.equal(msgs().length, 2);
    assert.deepEqual(msgs()[1].pages, { done: 3, found: 9, sitemap: 0, cap: 0 });
    p.set({ phase: "links", step: { done: 0, total: 40 } });
    assert.equal(msgs().length, 3);
    assert.equal(msgs()[2].phase, "links");
    assert.equal(msgs()[2].elapsedMs, 300);
});

test("findings are counted by severity, sent once each, and capped", () => {
    const { p, msgs } = harness({ maxFindings: 2 });
    p.finding({ type: "http-4xx-internal", severity: "high", url: "https://x.test/a", detail: "Link returns 404" });
    p.finding({ type: "http-4xx-internal", severity: "high", url: "https://x.test/a" }); // same issue again
    p.finding({ type: "title-too-long", severity: "medium", url: "https://x.test/b" });
    p.finding({ type: "lang-missing", severity: "weird", url: "https://x.test/c" });
    const f = msgs().filter((m) => m.kind === "finding");
    assert.equal(f.length, 2, "capped at maxFindings");
    assert.deepEqual(f[0], { kind: "finding", type: "http-4xx-internal", severity: "high", url: "https://x.test/a", detail: "Link returns 404" });
    assert.deepEqual(p.state.issues, { high: 1, medium: 1, low: 1, total: 3 });
});

test("time left comes from the recent page rate and the larger of pages found and sitemap size", () => {
    const { p, msgs, tick } = harness({ intervalMs: 0 });
    p.set({ phase: "crawl", pages: { done: 0, found: 10, sitemap: 100 } });
    tick(2000); p.set({ pages: { done: 4 } });
    assert.equal(msgs().at(-1).etaMs, null, "too early to tell");
    tick(3000); p.set({ pages: { done: 10, found: 60 } });
    // 10 pages in 5 s = 2 a second; 100 - 10 = 90 left -> 45 s
    assert.equal(msgs().at(-1).etaMs, 45000);
    p.set({ phase: "links" });
    assert.equal(msgs().at(-1).etaMs, null, "only estimated while crawling");
});

test("a page cap limits the pages left", () => {
    const { p, msgs, tick } = harness({ intervalMs: 0 });
    p.set({ phase: "crawl", pages: { done: 0, found: 500, cap: 50 } });
    tick(4000); p.set({ pages: { done: 20 } });
    assert.equal(msgs().at(-1).etaMs, 6000); // 30 left at 5 a second
});

test("estimateEta edge cases", () => {
    assert.equal(estimateEta([[0, 0], [5000, 10]], 0), 0);
    assert.equal(estimateEta([[0, 0]], 10), null);
    assert.equal(estimateEta([[0, 5], [6000, 5]], 10), null, "no pages finished in the window");
    assert.equal(estimateEta([[0, 0], [4000, 8]], 10), 5000);
});

test("parseProgressLine reads only SiteFix progress lines", () => {
    assert.equal(parseProgressLine("Crawling (3, 10 queued): https://x.test/"), null);
    assert.equal(parseProgressLine(`${PROGRESS_PREFIX}{not json`), null);
    assert.equal(parseProgressLine(`${PROGRESS_PREFIX}{"kind":"other"}`), null);
    assert.deepEqual(parseProgressLine(`${PROGRESS_PREFIX}{"kind":"progress","phase":"crawl"}`), { kind: "progress", phase: "crawl" });
});

test("a new phase resets the step counter unless one is given", () => {
    const { p } = harness();
    p.set({ phase: "spelling", step: { done: 3, total: 10 } });
    p.set({ phase: "registry" });
    assert.deepEqual(p.state.step, { done: 0, total: 0 });
});
