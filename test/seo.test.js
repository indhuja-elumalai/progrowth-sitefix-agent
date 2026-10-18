import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHead, headIssues, findDuplicates, canonicalTargetIssue, jsDependence, sameUrl, LIMITS } from "../lib/metadata.js";

const goodDesc = "A description that is comfortably longer than fifty characters and shorter than the limit.";
const page = (over = "") => `<!doctype html><html><head>
<title>A Good Page Title Here</title>
<meta name="description" content="${goodDesc}">
<link rel="canonical" href="https://x.test/a">
${over}</head><body><h1>Hello</h1></body></html>`;
const types = (html) => headIssues(extractHead(html)).map((i) => i.type);

test("a clean page has no issues", () => assert.deepEqual(types(page()), []));

test("extracts the basic fields", () => {
    const h = extractHead(page());
    assert.equal(h.title, "A Good Page Title Here");
    assert.equal(h.description, goodDesc);
    assert.deepEqual(h.h1s, ["Hello"]);
    assert.deepEqual(h.canonicals, ["https://x.test/a"]);
});

test("attribute order and quote style do not matter", () => {
    const h = extractHead(`<head><title>T</title><meta content='some text here' name='description'><link href=https://x.test/a rel=canonical></head>`);
    assert.equal(h.description, "some text here");
    assert.deepEqual(h.canonicals, ["https://x.test/a"]);
});

test("entities are decoded and tags inside the title are dropped", () => {
    assert.equal(extractHead("<head><title>Tom &amp; Jerry</title></head>").title, "Tom & Jerry");
});

test("an <svg><title> in the body is not the page title", () => {
    const h = extractHead(`<head></head><body><svg><title>Logo</title></svg></body>`);
    assert.equal(h.title, null);
    assert.equal(h.titleCount, 0);
});

test("missing title", () => assert.ok(types(page().replace(/<title>.*<\/title>/, "")).includes("title-missing")));
test("empty title counts as missing", () => assert.ok(types(page().replace(/<title>.*<\/title>/, "<title>  </title>")).includes("title-missing")));
test("two titles", () => assert.ok(types(page("<title>Another</title>")).includes("title-multiple")));

test("title length limits", () => {
    const long = "x".repeat(LIMITS.titleMax + 1);
    const exact = "x".repeat(LIMITS.titleMax);
    assert.ok(types(page().replace("A Good Page Title Here", long)).includes("title-too-long"));
    assert.ok(!types(page().replace("A Good Page Title Here", exact)).includes("title-too-long"));
    assert.ok(types(page().replace("A Good Page Title Here", "Hi")).includes("title-too-short"));
});

test("meta description: missing, short, long", () => {
    const noDesc = page().replace(/<meta name="description"[^>]*>/, "");
    assert.ok(types(noDesc).includes("description-missing"));
    assert.ok(types(page().replace(goodDesc, "Too short")).includes("description-too-short"));
    assert.ok(types(page().replace(goodDesc, "y".repeat(LIMITS.descriptionMax + 1))).includes("description-too-long"));
});

test("h1: missing, empty, multiple", () => {
    assert.ok(types(page().replace("<h1>Hello</h1>", "")).includes("h1-missing"));
    assert.ok(types(page().replace("<h1>Hello</h1>", "<h1> </h1>")).includes("h1-missing"));
    assert.ok(types(page().replace("<h1>Hello</h1>", "<h1>A</h1><h1>B</h1>")).includes("h1-multiple"));
});

test("an h1 with a nested tag still counts", () => {
    assert.deepEqual(extractHead("<body><h1><span>Hi</span> there</h1></body>").h1s, ["Hi there"]);
});

test("canonical: missing, conflicting, repeated", () => {
    assert.ok(types(page().replace(/<link rel="canonical"[^>]*>/, "")).includes("canonical-missing"));
    assert.ok(types(page('<link rel="canonical" href="https://x.test/b">')).includes("canonical-multiple"));
    const same = headIssues(extractHead(page('<link rel="canonical" href="https://x.test/a">'))).find((i) => i.type === "canonical-multiple");
    assert.equal(same.severity, "low");
});

test("duplicates: same title on two pages, case and spacing ignored", () => {
    const d = findDuplicates([
        { url: "https://x.test/a", head: { title: "Hello  World" } },
        { url: "https://x.test/b", head: { title: "hello world" } },
        { url: "https://x.test/c", head: { title: "Different" } },
    ]);
    assert.equal(d.get("https://x.test/a")[0].type, "title-duplicate");
    assert.equal(d.get("https://x.test/b")[0].type, "title-duplicate");
    assert.equal(d.has("https://x.test/c"), false);
});

test("duplicates: a page that canonicals elsewhere is not a duplicate", () => {
    const d = findDuplicates([
        { url: "https://x.test/a", head: { title: "Same" }, canonical: "https://x.test/a" },
        { url: "https://x.test/a?page=2", head: { title: "Same" }, canonical: "https://x.test/a" },
    ]);
    assert.equal(d.size, 0);
});

test("duplicates: the same page under two spellings counts once", () => {
    const d = findDuplicates([
        { url: "https://x.test", head: { title: "Same" } },
        { url: "https://x.test/", head: { title: "Same" } },
    ]);
    assert.equal(d.size, 0);
});

test("duplicate descriptions are found too", () => {
    const d = findDuplicates([
        { url: "https://x.test/a", head: { description: "one" } },
        { url: "https://x.test/b", head: { description: "one" } },
    ]);
    assert.equal(d.get("https://x.test/a")[0].type, "description-duplicate");
});

test("canonical target: 404, redirect, unreachable are issues; ok and timeouts are not", () => {
    assert.equal(canonicalTargetIssue("u", { classification: "broken", status: 404 }).type, "canonical-broken-target");
    assert.equal(canonicalTargetIssue("u", { classification: "redirect", status: 301 }).type, "canonical-redirect");
    assert.equal(canonicalTargetIssue("u", { classification: "unreachable" }).type, "canonical-broken-target");
    assert.equal(canonicalTargetIssue("u", { classification: "ok", status: 200 }), null);
    assert.equal(canonicalTargetIssue("u", { classification: "unverified", status: null }), null);
});

test("jsDependence: lists what only exists after JavaScript runs", () => {
    const raw = extractHead("<head></head><body></body>");
    const rendered = extractHead(page());
    assert.deepEqual(jsDependence(raw, rendered).sort(), ["canonical", "description", "h1", "title"]);
    assert.deepEqual(jsDependence(rendered, rendered), []);
    assert.deepEqual(jsDependence(null, rendered), []);
});

test("sameUrl ignores trailing slash and fragment", () => {
    assert.ok(sameUrl("https://x.test/a/", "https://x.test/a#top"));
    assert.ok(!sameUrl("https://x.test/a", "https://x.test/b"));
});