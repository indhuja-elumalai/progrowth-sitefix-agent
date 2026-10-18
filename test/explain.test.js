import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTypeRequest, validateTypeAnswer, templateInstanceExplanation, explainIssues, urlsIn, MAX_INSTANCES } from "../lib/explain.js";
import { mockProvider } from "../lib/ai-provider.js";
import { mockRespond } from "../lib/ai-mock.js";

const titleIssue = (n, over = {}) => ({
    id: `ISS-${String(n).padStart(10, "0")}`, type: "title-missing", severity: "high", priority: "P1", effort: "easy", owner: "Content writer", quickWin: true,
    affectedUrl: `https://x.test/page-${n}`, foundOn: ["https://x.test/"], detail: "No <title> tag",
    evidence: { kind: "head", head: { title: null, description: "Our pricing for small firms", h1s: ["Pricing plans"], canonicals: [], headings: [{ level: 1, text: "Pricing plans" }] }, rawHead: { big: "x".repeat(5000) } },
    ...over,
});
const answerFor = (req, over = {}) => ({
    type: req.type, summary: "Two pages have no title.", why: "Search engines invent one.", fixSteps: ["Add a title.", "Keep it under 60 characters."],
    instances: req.instances.map((i) => ({ id: i.id, explanation: `The page ${i.affectedUrl} has no title.`, suggestedValue: "Pricing plans for small law firms" })),
    ...over,
});

test("the request carries only evidence, trimmed, and asks for a value only where one makes sense", () => {
    const req = buildTypeRequest("title-missing", [titleIssue(1), titleIssue(2)]);
    assert.equal(req.wantsValue, true);
    assert.deepEqual(req.valueRules, { min: 10, max: 60 });
    assert.equal(req.instances[0].evidence.rawHead, undefined); // large raw head dropped
    assert.equal(req.instances[0].evidence.head.h1s[0], "Pricing plans");
    assert.equal(req.totalInstances, 2);
    assert.equal(buildTypeRequest("redirect-chain", [titleIssue(1, { type: "redirect-chain" })]).wantsValue, false);
});

test("at most MAX_INSTANCES instances go to the AI", () => {
    const req = buildTypeRequest("title-missing", Array.from({ length: MAX_INSTANCES + 5 }, (_, i) => titleIssue(i)));
    assert.equal(req.instances.length, MAX_INSTANCES);
    assert.equal(req.totalInstances, MAX_INSTANCES + 5);
});

test("a good answer passes cleanly", () => {
    const req = buildTypeRequest("title-missing", [titleIssue(1)]);
    const v = validateTypeAnswer(JSON.stringify(answerFor(req)), req);
    assert.equal(v.ok, true);
    assert.deepEqual(v.problems, []);
    assert.equal(v.instances.get(req.instances[0].id).suggestedValue, "Pricing plans for small law firms");
});

test("GUARDRAIL: a URL that is not in the evidence is rejected", () => {
    const req = buildTypeRequest("title-missing", [titleIssue(1)]);
    const v = validateTypeAnswer(answerFor(req, {
        summary: "See https://evil.test/guide for help.",
        fixSteps: ["Read https://made-up.test/docs"],
        instances: [{ id: req.instances[0].id, explanation: "Also broken: https://x.test/not-real", suggestedValue: null }],
    }), req);
    assert.equal(v.summary, null);
    assert.equal(v.fixSteps, null);
    assert.equal(v.instances.get(req.instances[0].id).explanation, null);
    assert.equal(v.problems.length, 3);
    assert.ok(v.problems.every((p) => /URL not in the evidence/.test(p)));
});

test("GUARDRAIL: URLs that ARE in the evidence are allowed (with or without trailing punctuation)", () => {
    const req = buildTypeRequest("title-missing", [titleIssue(1)]);
    const v = validateTypeAnswer(answerFor(req, { summary: "The page https://x.test/page-1. has no title." }), req);
    assert.equal(v.summary, "The page https://x.test/page-1. has no title.");
});

test("GUARDRAIL: wrong type, broken JSON, unknown ids and missing instances", () => {
    const req = buildTypeRequest("title-missing", [titleIssue(1), titleIssue(2)]);
    assert.equal(validateTypeAnswer("not json", req).ok, false);
    assert.equal(validateTypeAnswer(answerFor(req, { type: "h1-missing" }), req).ok, false);
    const v = validateTypeAnswer(answerFor(req, { instances: [{ id: "ISS-ffffffffff", explanation: "x", suggestedValue: null }] }), req);
    assert.ok(v.problems.some((p) => /unknown instance id/.test(p)));
    assert.equal(v.problems.filter((p) => /no explanation returned/.test(p)).length, 2);
});

test("GUARDRAIL: suggested values must fit the length rules and only where allowed", () => {
    const req = buildTypeRequest("title-missing", [titleIssue(1)]);
    const id = req.instances[0].id;
    const tooLong = validateTypeAnswer(answerFor(req, { instances: [{ id, explanation: "ok", suggestedValue: "A".repeat(61) }] }), req);
    assert.equal(tooLong.instances.get(id).suggestedValue, null);
    assert.match(tooLong.problems[0], /61 characters \(allowed 10-60\)/);
    const chainReq = buildTypeRequest("redirect-chain", [titleIssue(1, { type: "redirect-chain" })]);
    const notAllowed = validateTypeAnswer(answerFor(chainReq), chainReq);
    assert.equal(notAllowed.instances.get(id).suggestedValue, null);
    assert.ok(notAllowed.problems.some((p) => /does not take one/.test(p)));
});

test("GUARDRAIL: too many or empty fix steps fall back", () => {
    const req = buildTypeRequest("title-missing", [titleIssue(1)]);
    assert.equal(validateTypeAnswer(answerFor(req, { fixSteps: [] }), req).fixSteps, null);
    assert.equal(validateTypeAnswer(answerFor(req, { fixSteps: Array(7).fill("step") }), req).fixSteps, null);
});

test("urlsIn finds URLs and strips trailing punctuation and slashes", () => {
    assert.deepEqual(urlsIn("Go to https://x.test/a/, then (https://y.test/b)."), ["https://x.test/a", "https://y.test/b"]);
});

test("standard sentence without AI: page-level vs link/image issues", () => {
    assert.equal(templateInstanceExplanation(titleIssue(1)), "On /page-1: No <title> tag.");
    assert.equal(templateInstanceExplanation({ detail: "Image returns 404", affectedUrl: "https://x.test/i.png", foundOn: ["a", "b"], evidence: { kind: "image" } }), "Image returns 404: https://x.test/i.png (on 2 pages).");
});

test("explainIssues without a provider uses standard guidance for every issue", async () => {
    const r = await explainIssues({ issues: [titleIssue(1), titleIssue(2, { type: "h1-missing", severity: "medium", priority: "P2" })] });
    assert.equal(r.stats.aiTypes, 0);
    assert.equal(r.types[0].type, "title-missing"); // P1 first
    assert.equal(r.types[0].source, "standard");
    assert.equal(r.types[0].issues[0].explanationSource, "standard");
    assert.ok(r.types[0].fixSteps.length >= 1);
});

test("explainIssues with the mock AI: one call per type, values within the rules", async () => {
    let calls = 0;
    const provider = mockProvider((req) => { calls++; return mockRespond(req); });
    const r = await explainIssues({ issues: [titleIssue(1), titleIssue(2)], provider });
    assert.equal(calls, 1);
    assert.equal(r.stats.aiTypes, 1);
    const i = r.types[0].issues[0];
    assert.equal(i.explanationSource, "ai");
    assert.ok(i.suggestedValue.length >= 10 && i.suggestedValue.length <= 60, i.suggestedValue);
    assert.deepEqual(r.stats.problems, []);
});

test("a failing AI never breaks the report: the error is recorded and standard guidance is used", async () => {
    const provider = { name: "openai", model: "m", complete: async () => { throw new Error("AI request failed (401): Incorrect API key"); } };
    const r = await explainIssues({ issues: [titleIssue(1)], provider });
    assert.equal(r.types[0].source, "standard");
    assert.match(r.stats.problems[0], /401/);
});

test("an AI answer that invents a URL keeps the good parts and replaces only the bad field", async () => {
    const provider = mockProvider(({ user }) => ({ ...answerFor(user), summary: "Details at https://invented.test" }));
    const r = await explainIssues({ issues: [titleIssue(1)], provider });
    const t = r.types[0];
    assert.equal(t.source, "ai");
    assert.equal(t.summary, "This page has no <title>, the line search engines show as the blue link in results."); // standard summary
    assert.deepEqual(t.fixSteps, ["Add a title.", "Keep it under 60 characters."]); // AI steps kept
    assert.ok(t.problems.some((p) => /invented\.test/.test(p)));
});

test("answers are cached: the same request is not paid for twice", async () => {
    let calls = 0;
    const store = {};
    const cache = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
    const provider = mockProvider((req) => { calls++; return mockRespond(req); });
    await explainIssues({ issues: [titleIssue(1)], provider, cache });
    await explainIssues({ issues: [titleIssue(1)], provider, cache });
    assert.equal(calls, 1);
});
