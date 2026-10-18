import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHead } from "../lib/head.js";
import { socialIssues, ogImageUrl, ogImageFindings } from "../lib/social.js";

const og = (tags) => extractHead(`<head>${Object.entries(tags).map(([k, v]) => `<meta property="${k}" content="${v}">`).join("")}</head>`);
const types = (head) => socialIssues(head).map((i) => i.type);

test("title, description and image present: no issues (og:url and twitter tags are optional)", () => {
    assert.deepEqual(types(og({ "og:title": "T", "og:description": "D", "og:image": "https://x.test/i.png" })), []);
});

test("no Open Graph tags at all", () => {
    assert.deepEqual(types(extractHead("<head><title>T</title></head>")), ["og-missing"]);
});

test("some Open Graph tags but essentials missing: names exactly what is missing", () => {
    const [i] = socialIssues(og({ "og:title": "T", "og:type": "website" }));
    assert.equal(i.type, "og-incomplete");
    assert.equal(i.detail, "Missing og:description, og:image: shared links will look incomplete");
});

test("an empty og:image counts as missing", () => {
    assert.deepEqual(types(og({ "og:title": "T", "og:description": "D", "og:image": "" })), ["og-incomplete"]);
});

test("ogImageUrl resolves relative URLs and rejects non-http ones", () => {
    assert.equal(ogImageUrl(og({ "og:image": "/i.png" }), "https://x.test/a/b"), "https://x.test/i.png");
    assert.equal(ogImageUrl(og({ "og:image": "https://cdn.test/i.png" }), "https://x.test/"), "https://cdn.test/i.png");
    assert.equal(ogImageUrl(og({ "og:image": "data:image/png;base64,AA" }), "https://x.test/"), null);
    assert.equal(ogImageUrl(og({}), "https://x.test/"), null);
});

test("only share images that are broken become issues, with every page that uses them", () => {
    const f = ogImageFindings([
        { url: "https://x.test/gone.png", pages: ["https://x.test/b", "https://x.test/a"], check: { status: 404, classification: "broken" } },
        { url: "https://x.test/ok.png", pages: ["https://x.test/a"], check: { status: 200, classification: "ok" } },
        { url: "https://x.test/slow.png", pages: ["https://x.test/a"], check: { status: null, classification: "unverified", error: "timeout" } },
    ]);
    assert.equal(f.length, 1);
    assert.equal(f[0].type, "og-image-broken");
    assert.equal(f[0].detail, "Share image (og:image) returns 404");
    assert.deepEqual(f[0].foundOn, ["https://x.test/a", "https://x.test/b"]);
    assert.equal(f[0].evidence.usedAs, "og:image");
});
