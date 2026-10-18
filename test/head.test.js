import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHead } from "../lib/head.js";

const html = `<!doctype html><html class="no-js" lang="en-GB"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page</title>
<meta property="og:title" content="Share title">
<meta property="og:description" content="Share &amp; description">
<meta name="og:image" content="/img/share.png">
<meta property="og:title" content="Second og:title is ignored">
<meta name="twitter:card" content="summary_large_image">
</head><body>
<h1>Main <em>heading</em></h1><h2>Section</h2><h4>Deep</h4>
</body></html>`;

test("reads Open Graph (property= or name=) and Twitter tags; first value wins", () => {
    const h = extractHead(html);
    assert.deepEqual(h.og, { "og:title": "Share title", "og:description": "Share & description", "og:image": "/img/share.png" });
    assert.deepEqual(h.twitter, { "twitter:card": "summary_large_image" });
});

test("reads the viewport and the <html lang>", () => {
    const h = extractHead(html);
    assert.equal(h.viewport, "width=device-width, initial-scale=1");
    assert.equal(h.lang, "en-GB");
});

test("missing viewport, lang and social tags come back empty", () => {
    const h = extractHead("<html><head><title>T</title></head><body></body></html>");
    assert.equal(h.viewport, null);
    assert.equal(h.lang, null);
    assert.deepEqual(h.og, {});
    assert.deepEqual(h.twitter, {});
    assert.equal(extractHead('<html lang=""><head></head></html>').lang, null);
});

test("headings come out in page order with their level and clean text", () => {
    assert.deepEqual(extractHead(html).headings, [
        { level: 1, text: "Main heading" }, { level: 2, text: "Section" }, { level: 4, text: "Deep" },
    ]);
});

test("Open Graph tags in the body are ignored (only <head> counts)", () => {
    const h = extractHead('<head><title>T</title></head><body><meta property="og:title" content="x"></body>');
    assert.deepEqual(h.og, {});
});
