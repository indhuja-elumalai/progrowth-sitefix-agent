import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSoft404, visibleWordCount } from "../lib/soft404.js";

const names = (r) => r.signals.map((s) => s.name);

test("planted fixture page: not-found title and H1, short body", () => {
    const r = analyzeSoft404({ title: "Page Not Found | Fixture Site", h1s: ["Sorry, this page doesn't exist"], wordCount: 17 });
    assert.equal(r.flagged, true);
    assert.deepEqual(names(r), ["title-not-found", "h1-not-found", "low-word-count"]);
});

test("the sonagroup.ae pattern: title is only 404, no H1, 410 words, 9 links redirect in", () => {
    const r = analyzeSoft404({ title: "404", h1s: [], wordCount: 410, redirectsIn: 9 });
    assert.equal(r.flagged, true);
    assert.deepEqual(names(r), ["title-not-found", "no-h1", "redirect-target"]);
});

test("a short but valid page is not flagged", () => {
    const r = analyzeSoft404({ title: "Contact the Fixture Team for Questions", h1s: ["Contact us"], wordCount: 14 });
    assert.equal(r.flagged, false);
    assert.deepEqual(names(r), ["low-word-count"]);
});

test("an article about 404 errors is not flagged: it says 404 but nothing else agrees", () => {
    const r = analyzeSoft404({ title: "How to fix a 404 error", h1s: ["How to fix a 404 error"], wordCount: 1200 });
    assert.equal(r.flagged, false);
});

test("supporting signals alone are never enough", () => {
    const r = analyzeSoft404({ title: "Some page", h1s: [], wordCount: 20, robots: "noindex", redirectsIn: 5 });
    assert.equal(r.flagged, false);
    assert.equal(r.signals.length, 4);
});

test("a not-found title plus many redirects into the page is flagged", () => {
    const r = analyzeSoft404({ title: "Error 404: Content Unavailable", h1s: ["Help centre"], wordCount: 300, redirectsIn: 2 });
    assert.equal(r.flagged, true);
});

test("the same page with only one redirect in is not flagged", () => {
    const r = analyzeSoft404({ title: "Error 404: Content Unavailable", h1s: ["Help centre"], wordCount: 300, redirectsIn: 1 });
    assert.equal(r.flagged, false);
});

test("a normal page has no signals", () => {
    const r = analyzeSoft404({ title: "Prestige White Paper", h1s: ["Prestige White"], wordCount: 752, redirectsIn: 0 });
    assert.deepEqual(r, { flagged: false, signals: [] });
});

test("visibleWordCount ignores scripts, styles and tags", () => {
    assert.equal(visibleWordCount("<style>a{}</style><script>var x=1</script><p>one two <b>three</b></p>"), 3);
});