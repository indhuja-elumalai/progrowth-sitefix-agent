import { test } from "node:test";
import assert from "node:assert/strict";
import { selectContext, validateAnswer, answerQuestion, factAnswer, MAX_CONTEXT_ISSUES } from "../lib/chat.js";
import { mockProvider } from "../lib/ai-provider.js";
import { mockRespond } from "../lib/ai-mock.js";

const mk = (id, type, title, priority, url, extra = {}) => ({ id, type, category: "Images", severity: "high", priority, effort: "easy", owner: "Developer", quickWin: priority !== "P3", affectedUrl: url, foundOn: ["https://x.test/"], detail: `${title} detail`, explanation: `${title} on ${url}`, suggestedValue: null, ...extra });
const report = {
    run: { startUrl: "https://x.test/", pagesCrawled: 12, finishedAt: "2026-10-18T10:00:00Z" },
    summaries: { links: { linksChecked: 40, ok: 35, broken: 2, redirecting: 3, unverified: 0, sitemapUrls: 10 }, images: { imagesFound: 8, broken: 1, altMissing: 2, oversized: 0 } },
    types: [
        { type: "image-broken", title: "Broken image", fixSteps: ["Upload it again."], issues: [mk("ISS-aaaaaaaaaa", "image-broken", "Broken image", "P1", "https://x.test/img/hero.jpg")] },
        { type: "title-too-long", title: "Title too long", fixSteps: ["Shorten it."], issues: [mk("ISS-bbbbbbbbbb", "title-too-long", "Title too long", "P3", "https://x.test/pricing", { category: "SEO: titles & descriptions" })] },
        { type: "content-duplicate", title: "Nearly the same text as another page", fixSteps: ["Rewrite."], issues: [mk("ISS-cccccccccc", "content-duplicate", "Nearly the same text", "P2", "https://x.test/locations/austin", { category: "Content" })] },
    ],
};

test("context: question words pick the matching issues first, and totals are always complete", () => {
    const c = selectContext("Which images are broken?", report);
    assert.equal(c.issues[0].id, "ISS-aaaaaaaaaa");
    assert.equal(c.totals.issues, 3);
    assert.equal(c.totals.byPriority.P1, 1);
    assert.equal(c.pagesCrawled, 12);
    assert.deepEqual(c.issues[0].fixSteps, ["Upload it again."]);
});

test("context: page addresses match too (\"austin\")", () => {
    assert.equal(selectContext("what is wrong with the austin page", report).issues[0].id, "ISS-cccccccccc");
});

test("context: 'what should I fix first' favours P1; 'quick wins' favours easy P1/P2", () => {
    assert.equal(selectContext("what should I fix first?", report).issues[0].priority, "P1");
    assert.equal(selectContext("any quick wins?", report).issues[0].quickWin, true);
});

test("context: no match falls back to the highest-priority issues, capped", () => {
    const big = { ...report, types: [{ type: "x", title: "X", fixSteps: [], issues: Array.from({ length: 60 }, (_, n) => mk(`ISS-${String(n).padStart(10, "0")}`, "x", "X", n < 5 ? "P1" : "P3", `https://x.test/${n}`)) }] };
    const c = selectContext("zzzz", big);
    assert.equal(c.issues.length, MAX_CONTEXT_ISSUES);
    assert.equal(c.omittedIssues, 20);
    assert.equal(c.issues[0].priority, "P1");
});

test("GUARDRAIL: issue ids that are not in the report are removed from the answer and the list", () => {
    const v = validateAnswer({ answer: "Fix ISS-aaaaaaaaaa and ISS-9999999999 first.", issueIds: ["ISS-aaaaaaaaaa", "ISS-9999999999"] }, report);
    assert.equal(v.answer, "Fix ISS-aaaaaaaaaa and (unknown issue) first.");
    assert.deepEqual(v.issueIds, ["ISS-aaaaaaaaaa"]);
    assert.deepEqual(v.removedIds, ["ISS-9999999999"]);
});

test("GUARDRAIL: ids mentioned only in the text are picked up; empty or broken answers are refused", () => {
    assert.deepEqual(validateAnswer({ answer: "See ISS-bbbbbbbbbb." }, report).issueIds, ["ISS-bbbbbbbbbb"]);
    assert.equal(validateAnswer("nope", report).ok, false);
    assert.equal(validateAnswer({ answer: "  " }, report).ok, false);
});

test("answerQuestion: no report, no key, and a working provider", async () => {
    assert.match((await answerQuestion({ question: "hi", report: null, provider: null })).answer, /Inspect a site first/);
    assert.match((await answerQuestion({ question: "hi", report, provider: null })).answer, /AI answers aren't switched on/);
    const r = await answerQuestion({ question: "Which images are broken?", report, provider: mockProvider(mockRespond) });
    assert.equal(r.source, "mock");
    assert.deepEqual(r.issueIds[0], "ISS-aaaaaaaaaa");
    assert.match(r.answer, /hero\.jpg/);
});

test("answerQuestion: the AI's request contains the question and only this report's data", async () => {
    let seen;
    const provider = mockProvider(({ user }) => { seen = user; return { answer: "ok", issueIds: [] }; });
    await answerQuestion({ question: "broken images?", report, provider });
    assert.equal(seen.question, "broken images?");
    assert.equal(seen.data.site, "https://x.test/");
    assert.ok(seen.data.issues.every((i) => i.id.startsWith("ISS-")));
});

test("answerQuestion: an AI error becomes a readable message, not a crash", async () => {
    const provider = { name: "openai", model: "m", complete: async () => { throw new Error("AI request failed (429): Rate limit"); } };
    const r = await answerQuestion({ question: "anything", report, provider });
    assert.equal(r.source, "error");
    assert.match(r.answer, /429/);
});

test("context: plurals match the singular issue type (\"images\" finds image-broken before other broken things)", () => {
    const r = { ...report, types: [...report.types, { type: "http-4xx-internal", title: "Broken link to your own page", fixSteps: [], issues: [mk("ISS-dddddddddd", "http-4xx-internal", "Broken link", "P1", "https://x.test/old", { category: "HTTP and URLs" })] }] };
    assert.equal(selectContext("Which images are broken?", r).issues[0].id, "ISS-aaaaaaaaaa");
});

test("context: whole words only, so \"were\" does not match \"ai-powered\" in a URL", () => {
    const r = { ...report, types: [...report.types, { type: "heading-skip", title: "Heading levels skip", fixSteps: [], issues: [mk("ISS-eeeeeeeeee", "heading-skip", "Heading levels skip", "P3", "https://x.test/blog/ai-powered-growth", { category: "SEO: titles & descriptions" })] }] };
    const c = selectContext("what were the results", r);
    assert.equal(c.matched, false);
    assert.equal(c.issues[0].priority, "P1"); // fell back to top priorities, not the "powered" page
});

test("count questions are answered exactly from the report data, with or without AI", async () => {
    assert.equal(factAnswer("how many pages were crawled?", report), "SiteFix crawled 12 pages on https://x.test/; 10 URLs were listed in its sitemap.");
    assert.match(factAnswer("How many issues did you find?", report), /^SiteFix found 3 issues on https:\/\/x\.test\/: 1 P1 \(fix first\), 1 P2, 1 P3/);
    assert.equal(factAnswer("how many P1 issues are there", report), "1 issue on https://x.test/ is P1 (fix first).");
    assert.match(factAnswer("how many links were checked", report), /40 distinct links.*2 broken/);
    assert.match(factAnswer("total number of images", report), /8 distinct images.*1 broken.*2 missing alt/);
    assert.equal(factAnswer("which images are broken?", report), null); // not a count question: goes to the AI
    const r = await answerQuestion({ question: "how many pages were crawled?", report, provider: null });
    assert.equal(r.source, "report data");
    assert.match(r.answer, /12 pages/);
});
