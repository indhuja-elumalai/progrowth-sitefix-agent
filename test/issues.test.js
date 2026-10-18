import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegistry, issueId, validateIssue, validateRegistry, CATALOG } from "../lib/issues.js";

const run = { id: "run-test", startedAt: "2026-10-12T00:00:00.000Z", startUrl: "https://x.test/" };

const links = [
    { url: "https://x.test/gone", type: "internal", status: 404, classification: "broken", foundOn: ["https://x.test/b", "https://x.test/a"] },
    { url: "https://other.test/x", type: "external", status: 410, classification: "broken", foundOn: ["https://x.test/a"] },
    { url: "https://x.test/dead", type: "internal", status: null, classification: "unreachable", error: "ENOTFOUND", foundOn: ["https://x.test/a"] },
    { url: "https://x.test/slow", type: "internal", status: null, classification: "unverified", error: "timeout", foundOn: ["https://x.test/a"] },
    {
        url: "https://x.test/old", type: "internal", status: 301, classification: "redirect", foundOn: ["https://x.test/a"],
        redirect: { kind: "chain", hops: 3, chain: ["https://x.test/old", "https://x.test/m", "https://x.test/n", "https://x.test/new"], finalUrl: "https://x.test/new", finalStatus: 200, issueType: "redirect-chain" }
    },
    {
        url: "https://x.test/fine", type: "internal", status: 301, classification: "redirect", foundOn: ["https://x.test/a"],
        redirect: { kind: "single", hops: 1, chain: ["https://x.test/fine", "https://x.test/new"], finalUrl: "https://x.test/new", finalStatus: 200, issueType: null }
    },
];
const metaPages = [
    {
        url: "https://x.test/a", foundOn: ["https://x.test/"], canonical: "https://x.test/zzz", rawHead: { title: "T" }, head: { title: "T" },
        canonicalCheck: { status: 404, classification: "broken" },
        issues: [{ type: "canonical-broken-target", severity: "high", detail: "Canonical points at /zzz, which returns 404" },
        { type: "title-too-short", severity: "low", detail: "1 characters (minimum 10)" }]
    },
];
const softPages = [
    { url: "https://x.test/404.html", foundOn: ["https://x.test/a"], via: "redirect-target", flagged: true, title: "404", h1s: [], wordCount: 410, signals: [{ name: "title-not-found", strength: "strong", detail: "Title is \"404\"" }, { name: "no-h1", strength: "supporting", detail: "No <h1>" }] },
    { url: "https://x.test/contact", foundOn: [], via: "crawled", flagged: false, signals: [{ name: "low-word-count", strength: "supporting", detail: "14 words" }] },
];
const siteChecks = { findings: [{ type: "https-missing-redirect", url: "http://x.test/", detail: "http:// stays on http://" }] };
const reg = buildRegistry({ run, links, siteChecks, metaPages, softPages });

test("only real issues become issues: not ok, unverified, single redirects or unflagged soft-404 candidates", () => {
    assert.deepEqual(reg.issues.map((i) => i.type).sort(), [
        "canonical-broken-target", "http-4xx-external", "http-4xx-internal", "https-missing-redirect",
        "link-unreachable", "redirect-chain", "soft-404", "title-too-short",
    ]);
});

test("every issue is valid and the whole registry validates", () => {
    for (const i of reg.issues) assert.deepEqual(validateIssue(i), []);
    assert.deepEqual(validateRegistry(reg), []);
});

test("sorted by severity, then type, then URL", () => {
    const sev = reg.issues.map((i) => i.severity);
    assert.deepEqual(sev, [...sev].sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a] - ({ high: 0, medium: 1, low: 2 })[b]));
});

test("ids are stable for the same type and URL, and differ otherwise", () => {
    assert.equal(issueId("soft-404", "https://x.test/404.html"), issueId("soft-404", "https://x.test/404.html"));
    assert.notEqual(issueId("soft-404", "https://x.test/a"), issueId("soft-404", "https://x.test/b"));
    assert.notEqual(issueId("soft-404", "https://x.test/a"), issueId("title-missing", "https://x.test/a"));
    assert.equal(reg.issues.length, new Set(reg.issues.map((i) => i.id)).size);
});

test("a broken link keeps every page that links to it, sorted", () => {
    const i = reg.issues.find((x) => x.type === "http-4xx-internal");
    assert.deepEqual(i.foundOn, ["https://x.test/a", "https://x.test/b"]);
    assert.deepEqual(i.evidence, { kind: "http", status: 404, method: "HEAD, then GET if refused" });
});

test("redirect evidence carries the whole chain", () => {
    const i = reg.issues.find((x) => x.type === "redirect-chain");
    assert.equal(i.evidence.hops, 3);
    assert.equal(i.evidence.chain.length, 4);
    assert.equal(i.fixClass, "deterministic");
});

test("canonical evidence includes the target's check result", () => {
    const i = reg.issues.find((x) => x.type === "canonical-broken-target");
    assert.deepEqual(i.evidence.canonicalCheck, { status: 404, classification: "broken" });
    assert.equal(i.evidence.canonical, "https://x.test/zzz");
});

test("a rule's own severity overrides the catalog default", () => {
    const r = buildRegistry({ run, metaPages: [{ url: "https://x.test/p", foundOn: [], head: {}, issues: [{ type: "canonical-multiple", severity: "low", detail: "2 identical canonical tags" }] }] });
    assert.equal(r.issues[0].severity, "low");
});

test("soft-404 evidence records the signals and that it was reached only through redirects", () => {
    const i = reg.issues.find((x) => x.type === "soft-404");
    assert.equal(i.evidence.reachedOnlyThroughRedirects, true);
    assert.equal(i.evidence.signals.length, 2);
});

test("counts add up", () => {
    assert.equal(reg.counts.total, reg.issues.length);
    assert.equal(Object.values(reg.counts.bySeverity).reduce((a, b) => a + b, 0), reg.counts.total);
});

test("an unknown type is refused rather than guessed", () => {
    assert.throws(() => buildRegistry({ run, metaPages: [{ url: "u", foundOn: [], head: {}, issues: [{ type: "made-up", severity: "low", detail: "x" }] }] }), /Unknown issue type/);
});

test("validation catches a broken issue", () => {
    const bad = { ...reg.issues[0], severity: "urgent", evidence: null, fixClass: "yolo" };
    assert.equal(validateIssue(bad).length, 3);
});

test("every catalog entry is well-formed", () => {
    for (const [type, m] of Object.entries(CATALOG)) {
        assert.ok(m.category && ["high", "medium", "low"].includes(m.severity) && ["deterministic", "ai-proposed", "not-automatable"].includes(m.fixClass), type);
    }
});

test("image findings become Images issues with image evidence", () => {
    const imageFindings = [
        { type: "image-broken", affectedUrl: "https://x.test/img/gone.jpg", foundOn: ["https://x.test/b", "https://x.test/a"], detail: "Image returns 404", evidence: { kind: "image", src: "https://x.test/img/gone.jpg", status: 404 } },
        { type: "image-alt-missing", affectedUrl: "https://x.test/img/team.jpg", foundOn: ["https://x.test/a"], detail: "No alt attribute", evidence: { kind: "image", src: "https://x.test/img/team.jpg", status: 200, alt: null } },
    ];
    const r = buildRegistry({ run, imageFindings });
    assert.deepEqual(validateRegistry(r), []);
    assert.deepEqual(r.issues.map((i) => [i.type, i.category, i.severity, i.fixClass]), [
        ["image-broken", "Images", "high", "ai-proposed"],
        ["image-alt-missing", "Images", "medium", "ai-proposed"],
    ]);
    assert.deepEqual(r.issues[0].foundOn, ["https://x.test/a", "https://x.test/b"]); // sorted
    assert.equal(r.issues[0].evidence.kind, "image");
});

test("every image type is in the catalog under Images", () => {
    for (const t of ["image-broken", "image-alt-missing", "image-alt-unhelpful", "image-alt-too-long", "image-mixed-content", "image-oversized"]) {
        assert.equal(CATALOG[t]?.category, "Images", t);
    }
});

test("categories are grouped by who reads the tag", () => {
    const cat = (t) => CATALOG[t].category;
    assert.equal(cat("title-missing"), "SEO: titles & descriptions");
    assert.equal(cat("heading-skip"), "SEO: titles & descriptions");
    assert.equal(cat("canonical-missing"), "SEO: indexing");
    assert.equal(cat("robots-noindex"), "SEO: indexing");
    assert.equal(cat("og-image-broken"), "Social sharing");
    assert.equal(cat("viewport-missing"), "Page setup");
});

test("ready-made findings (e.g. a broken share image) go into the registry", () => {
    const r = buildRegistry({ run, findings: [{ type: "og-image-broken", affectedUrl: "https://x.test/share.png", foundOn: ["https://x.test/"], detail: "Share image (og:image) returns 404", evidence: { kind: "image", src: "https://x.test/share.png", status: 404, usedAs: "og:image" } }] });
    assert.deepEqual(validateRegistry(r), []);
    assert.equal(r.issues[0].category, "Social sharing");
});
