import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shotPlan, isVisual, createShooter } from "../lib/screenshots.js";

test("a broken image or link is shown on the page it was found on, outlined", () => {
    assert.deepEqual(shotPlan({ type: "image-broken", affectedUrl: "https://x.test/a.jpg", foundOn: ["https://x.test/p", "https://x.test/q"], evidence: { kind: "image" } }),
        { page: "https://x.test/p", target: "https://x.test/a.jpg", kind: "image", text: null });
    assert.equal(shotPlan({ type: "image-broken", affectedUrl: "https://x.test/a.jpg", foundOn: [], evidence: { kind: "image" } }), null);
});

test("a spelling mistake is outlined as text on its own page, without the snippet's dots", () => {
    const p = shotPlan({ type: "copy-spelling", affectedUrl: "https://x.test/about", evidence: { kind: "content", matches: [{ text: "…we recieve every order", correction: "receive" }] } });
    assert.deepEqual(p, { page: "https://x.test/about", target: null, kind: "content", text: "we recieve every order" });
    assert.equal(shotPlan({ type: "title-too-long", affectedUrl: "javascript:alert(1)" }), null, "only web pages");
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
        assert.ok((await stat(path.join(dir, "a.jpg"))).size > 1000);
    } finally {
        await shooter.close();
        server.close();
    }
});
