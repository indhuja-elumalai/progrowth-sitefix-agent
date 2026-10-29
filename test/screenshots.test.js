import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shotPlan, isVisual, createShooter, findProblem, drawProblem } from "../lib/screenshots.js";

test("a broken image or link is shown on the page it was found on, outlined", () => {
    assert.deepEqual(shotPlan({ type: "image-broken", affectedUrl: "https://x.test/a.jpg", foundOn: ["https://x.test/p", "https://x.test/q"], evidence: { kind: "image" } }),
        { page: "https://x.test/p", mode: "element", target: "https://x.test/a.jpg", kind: "image", text: null, texts: [] });
    assert.equal(shotPlan({ type: "image-broken", affectedUrl: "https://x.test/a.jpg", foundOn: [], evidence: { kind: "image" } }), null);
});

test("a spelling mistake is outlined as text on its own page, without the snippet's dots", () => {
    const p = shotPlan({ type: "copy-spelling", affectedUrl: "https://x.test/about", evidence: { kind: "content", matches: [{ text: "…we recieve every order", correction: "receive" }] } });
    assert.deepEqual(p, { page: "https://x.test/about", mode: "text", target: null, kind: "content", text: "we recieve every order", texts: ["we recieve every order", "recieve"] });
    assert.deepEqual(shotPlan({ type: "copy-spelling", affectedUrl: "https://x.test/about", evidence: { kind: "content", matches: [{ text: "…we recieve every order", correction: "…we receive every order" }] } }).texts, ["we recieve every order", "recieve"]);
    assert.equal(shotPlan({ type: "title-too-long", affectedUrl: "javascript:alert(1)" }), null, "only web pages");
});

test("a snippet that runs across a bold label still has shorter pieces and the word itself to look for", () => {
    const text = "Sending the emails or DMs: Creating batches of emails and DMs as per ICP Data Insights in atleast 4 phases for most effective communication.";
    const p = shotPlan({ type: "copy-spelling", affectedUrl: "https://x.test/blog", evidence: { kind: "content", matches: [{ text, correction: text.replace("atleast", "at least") }] } });
    assert.deepEqual(p.texts, [
        "Insights in atleast 4 phases",
        "ICP Data Insights in atleast 4 phases for most",
        "atleast",
        "Sending the emails or DMs: Creating batches of emails and",
    ], "the mistake with its neighbours first, so the box is on it; the quoted text cut at a word, last");
});

test("only problems you can see on the page get a screenshot in the chat", () => {
    assert.equal(isVisual({ type: "image-broken", evidence: { kind: "image" } }), true);
    assert.equal(isVisual({ type: "copy-spelling", evidence: { kind: "content" } }), true);
    for (const type of ["title-too-long", "description-missing", "robots-noindex", "og-image-broken", "lang-missing"]) assert.equal(isVisual({ type, evidence: { kind: type === "og-image-broken" ? "image" : "head" } }), false, type);
    const copy = new Function(`${isVisual.toString()}; return isVisual;`)();
    assert.equal(copy({ type: "soft-404" }), true, "self-contained, so the page can carry a copy");
});

test("the shooter takes a real screenshot, a few at a time, and fails softly", async () => {
    const server = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!doctype html><h1>Hi</h1><p>We recieve every order.</p><img src="/missing.jpg" alt="gone" width="80" height="60">`);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const dir = await mkdtemp(path.join(tmpdir(), "sitefix-shots-"));
    const shooter = createShooter({ concurrency: 2, idleMs: 50 });
    try {
        const [a, b, c] = await Promise.all([
            shooter.take({ page: `${base}/p`, target: `${base}/missing.jpg`, kind: "image" }, path.join(dir, "a.jpg")),
            shooter.take({ page: `${base}/q`, target: null, text: "we recieve every order" }, path.join(dir, "b.jpg")),
            shooter.take({ page: "http://127.0.0.1:1/nothing" }, path.join(dir, "c.jpg")),
        ]);
        assert.deepEqual([a, b, c], [true, true, false]);
        assert.equal(await shooter.take({ page: `${base}/r`, mode: "text", texts: ["words that are not there"] }, path.join(dir, "d.jpg")), false, "problem not found on the page: no screenshot");
        assert.ok((await stat(path.join(dir, "a.jpg"))).size > 1000);
    } finally {
        await shooter.close();
        server.close();
    }
});

// Both steps in a real browser, as capture() runs them.
const outlineIn = async (page, plan) => (await page.evaluate(findProblem, plan)) ? page.evaluate(drawProblem, plan) : false;
const boxes = (page) => page.evaluate(() => [...document.querySelectorAll("div")].filter((d) => d.style.border.includes("solid")).map((b) => { const r = b.getBoundingClientRect(); return { inView: r.top >= -10 && r.bottom <= innerHeight + 10 }; }));

test("in the page: a mistake across bold text is found and boxed, cookie banners hidden, nothing drawn when not found", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        const filler = "<p>Intro text.</p>".repeat(80);
        await page.setContent(`<!doctype html><body>${filler}<ul><li><strong>Sending the emails or DMs:</strong>
            Creating batches of emails and DMs as per ICP Data Insights in atleast 4 phases for most effective communication.</li></ul>
            <div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#fff">We use cookies. <button>Accept all</button></div></body>`);
        const text = "Sending the emails or DMs: Creating batches of emails and DMs as per ICP Data Insights in atleast 4 phases for most effective communication.";
        const plan = shotPlan({ type: "copy-spelling", affectedUrl: "https://x.test/blog", evidence: { kind: "content", matches: [{ text, correction: text.replace("atleast", "at least") }] } });
        assert.equal(await outlineIn(page, plan), true);
        const b = await boxes(page);
        assert.equal(b.length, 1);
        assert.ok(b[0].inView, "the boxed text is on screen");
        assert.equal(await page.$eval("#cookie-banner", (e) => getComputedStyle(e).display), "none");
        await page.setContent(`<p>Nothing wrong here.</p>`);
        assert.equal(await outlineIn(page, { mode: "text", texts: ["not on this page at all"] }), false, "not found: no screenshot");
    } finally {
        await browser.close();
    }
});

test("in the page: a hidden link isn't shown; a skipped heading level, extra H1s and a whole-page problem are", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await page.setContent(`<nav style="display:none"><a href="https://x.test/gone">Old page</a></nav><p>Body</p>`);
        assert.equal(await outlineIn(page, { mode: "element", target: "https://x.test/gone", kind: "http" }), false, "only in a hidden menu: no screenshot");
        await page.setContent(`<h1>Title</h1><p>a</p><h2>Part</h2><h4 id="skip">Detail</h4><h1>Second</h1>`);
        assert.equal(await outlineIn(page, { mode: "heading-skip" }), true);
        assert.equal(await page.evaluate(() => window.__sitefixHeading.id), "skip", "the heading after the skipped level");
        await page.setContent(`<h1>One</h1><p>a</p><h1>Two</h1>`);
        assert.equal(await outlineIn(page, { mode: "h1s" }), true);
        assert.equal((await boxes(page)).length, 2, "each H1 boxed");
        await page.setContent(`<p>Sorry, nothing here.</p>`);
        assert.equal(await outlineIn(page, { mode: "page" }), true);
        assert.equal((await boxes(page)).length, 1, "the whole screen framed");
    } finally {
        await browser.close();
    }
});

test("a problem with nothing to point at gets no screenshot plan", () => {
    assert.equal(shotPlan({ type: "h1-missing", affectedUrl: "https://x.test/a", evidence: { kind: "head" } }), null);
    assert.equal(shotPlan({ type: "viewport-missing", affectedUrl: "https://x.test/a", evidence: { kind: "head" } }), null);
    assert.equal(shotPlan({ type: "copy-spelling", affectedUrl: "https://x.test/a", evidence: { kind: "content", matches: [] } }), null, "no quoted text: nothing to outline");
    assert.equal(shotPlan({ type: "soft-404", affectedUrl: "https://x.test/a", evidence: { kind: "soft-404" } }).mode, "page");
});
