import { test } from "node:test";
import assert from "node:assert/strict";
import { rephrase, factsKept, unsupported, sameQuestion } from "../lib/phrasing.js";
import { answerQuestion, varyAnswer } from "../lib/chat.js";
import { mockProvider } from "../lib/ai-provider.js";

const ORIGINAL = "Your score today is **74** (Good). On-page 78 · Technical 65 · Off-page 93.\nThe biggest gains:\n- **Broken link to your own page**: +2.7 points (2 found) on /pricing\n- **Page has no title**: +1.6 points";
const GOOD = "You're at **74** right now, which counts as Good. On-page 78, Technical 65, Off-page 93.\nWhere you'd gain most:\n- **Broken link to your own page**: +2.7 points, 2 of them, on /pricing\n- **Page has no title**: +1.6 points";

test("a rewording must keep every number, path, bold name and list line, and add none", () => {
    assert.equal(factsKept(ORIGINAL, GOOD).ok, true);
    assert.match(factsKept(ORIGINAL, GOOD.replace("78", "79")).problem, /number/);
    assert.match(factsKept(ORIGINAL, GOOD.replace("+1.6 points", "+1.6 points, about 5 minutes")).problem, /added the number 5/);
    assert.match(factsKept(ORIGINAL, GOOD.replace(" on /pricing", "")).problem, /lost \/pricing/);
    assert.match(factsKept(ORIGINAL, GOOD.replace("/pricing", "/pricing and /about")).problem, /added \/about/);
    assert.match(factsKept(ORIGINAL, GOOD.replace("**Page has no title**", "**A missing title**")).problem, /lost "Page has no title"/);
    assert.match(factsKept(ORIGINAL, GOOD.replace("\n- **Page has no title**", " and **Page has no title**")).problem, /list/);
    assert.equal(factsKept(ORIGINAL, "").ok, false);
});

test("rephrase: the AI's words when they keep the facts, the original otherwise", async () => {
    let seen;
    const ok = mockProvider(({ user }) => { seen = user; return { text: GOOD }; });
    const r = await rephrase({ text: ORIGINAL, question: "what's my score", provider: ok, avoid: ["an earlier answer"] });
    assert.deepEqual(r, { text: GOOD, varied: true });
    assert.equal(seen.task, "rephrase");
    assert.deepEqual(seen.avoid, ["an earlier answer"]);
    const wrong = mockProvider(() => ({ text: GOOD.replace("74", "84") }));
    assert.deepEqual(await rephrase({ text: ORIGINAL, provider: wrong }), { text: ORIGINAL, varied: false });
    const broken = { name: "x", complete: async () => { throw new Error("down"); } };
    assert.deepEqual(await rephrase({ text: ORIGINAL, provider: broken }), { text: ORIGINAL, varied: false });
    const slow = { name: "x", complete: () => new Promise((r) => setTimeout(() => r(JSON.stringify({ text: GOOD })), 300)) };
    assert.deepEqual(await rephrase({ text: ORIGINAL, provider: slow, timeoutMs: 50 }), { text: ORIGINAL, varied: false });
    assert.deepEqual(await rephrase({ text: ORIGINAL, provider: null }), { text: ORIGINAL, varied: false });
});

test("unsupported: numbers, links and paths an AI answer has but its data doesn't", () => {
    const data = { site: "https://x.test/", issues: [{ url: "https://x.test/pricing", detail: "returns 404", pages: 12, lcp: 3.4 }] };
    assert.deepEqual(unsupported("The link on /pricing returns 404 on 12 pages; main content shows in 3.4 s. Fix these 2 first.", data), []);
    assert.deepEqual(unsupported("It returns 500 and takes 4.1 s on /about.", data).sort(), ["/about", "4.1", "500"]);
    assert.deepEqual(unsupported("See https://elsewhere.com/x", data), ["https://elsewhere.com/x"]);
});

test("the same question asked again, written differently", () => {
    assert.ok(sameQuestion("What's my score?", "whats my score"));
    assert.ok(sameQuestion("How many pages were crawled", "how many pages were crawled?"));
    assert.equal(sameQuestion("what's my score", "how do I get to 80"), false);
    assert.equal(sameQuestion("", ""), false);
});

const report = {
    run: { startUrl: "https://x.test/", pagesCrawled: 12 },
    summaries: {},
    types: [{ type: "image-broken", title: "Broken image", fixSteps: ["Upload the image again"], issues: [{ id: "ISS-aaaaaaaaaa", type: "image-broken", priority: "P1", severity: "high", affectedUrl: "https://x.test/hero.jpg", detail: "Image returns 404", foundOn: ["https://x.test/"] }] }],
};

test("an AI answer with a number the data doesn't have is asked again, then honestly declined", async () => {
    const asks = [];
    const liar = mockProvider(({ user }) => { asks.push(user); return { answer: "Your hero image fails on 37 pages.", issueIds: [] }; });
    const r = await answerQuestion({ question: "what about the hero image?", report, provider: liar });
    assert.equal(asks.length, 2);
    assert.match(asks[1].correction, /37/);
    assert.match(r.answer, /I'd rather not guess/);
    let n = 0;
    const learns = mockProvider(() => (++n === 1 ? { answer: "It fails on 37 pages.", issueIds: [] } : { answer: "The hero image returns 404.", issueIds: ["ISS-aaaaaaaaaa"] }));
    const ok = await answerQuestion({ question: "what about the hero image?", report, provider: learns });
    assert.equal(ok.answer, "The hero image returns 404.");
    assert.deepEqual(ok.issueIds, ["ISS-aaaaaaaaaa"]);
});

test("earlier answers to the same question go to the AI, to be said differently", async () => {
    let seen;
    const p = mockProvider(({ user }) => { seen = user; return { answer: "The hero image returns 404.", issueIds: [] }; });
    await answerQuestion({ question: "what about the hero image?", report, provider: p, previous: ["Before: the hero image returns 404."] });
    assert.deepEqual(seen.previousAnswers, ["Before: the hero image returns 404."]);
});

test("varyAnswer: a list keeps its items; only its first and last lines are reworded", async () => {
    const list = { display: "cards", lead: "These images don't load", tail: "Upload each one again, then check the page.", answer: "These images don't load\n- /hero.jpg\nUpload each one again, then check the page.", issueIds: ["ISS-aaaaaaaaaa"], source: "report data" };
    const p = mockProvider(({ user }) => ({ text: user.message === list.lead ? "A few images aren't loading" : "Upload each one again and check the page after." }));
    const v = await varyAnswer(list, { question: "which images are broken", provider: p });
    assert.equal(v.lead, "A few images aren't loading");
    assert.equal(v.answer, "A few images aren't loading\n- /hero.jpg\nUpload each one again and check the page after.");
    assert.deepEqual(v.issueIds, list.issueIds);
    assert.equal(await varyAnswer(list, { question: "x", provider: null }), list);
});

test("a general question: the AI gets the guide and the conversation, and may use the guide's numbers", async () => {
    let seen, turns;
    const p = mockProvider(({ user, history }) => { seen = user; turns = history; return { answer: "Start by asking what to fix first. Page titles should be 10 to 60 characters.", issueIds: [] }; });
    const r = await answerQuestion({ question: "I'm not sure how this works, where do I start?", report, provider: p, conversation: [{ question: "hi", answer: "Hello!" }] });
    assert.match(r.answer, /10 to 60 characters/);
    assert.match(seen.guide.about, /never changes the site/);
    assert.equal(seen.guide.limits.title, "10 to 60 characters");
    assert.deepEqual(turns, [{ role: "user", content: "hi" }, { role: "assistant", content: JSON.stringify({ answer: "Hello!", issueIds: [] }) }]);
});

test("not inspected yet: a general answer from the guide, never site facts", async () => {
    let seen;
    const p = mockProvider(({ user }) => { seen = user; return { answer: "SiteFix checks links, images, tags, text and speed. Press Inspect to start.", issueIds: ["ISS-aaaaaaaaaa"] }; });
    const r = await answerQuestion({ question: "what do you check?", report: null, provider: p, site: "https://x.test/" });
    assert.equal(seen.data.inspected, false);
    assert.match(r.answer, /Press Inspect/);
    assert.deepEqual(r.issueIds, []); // no report: no issue can be shown
    assert.match((await answerQuestion({ question: "what do you check?", report: null, provider: null })).answer, /Inspect a site first/);
});

test("an answer shows at most 5 issues", async () => {
    const many = { ...report, types: [{ ...report.types[0], issues: Array.from({ length: 8 }, (_, i) => ({ ...report.types[0].issues[0], id: `ISS-aaaaaaaa${i}${i}` })) }] };
    const p = mockProvider(() => ({ answer: "These images don't load.", issueIds: many.types[0].issues.map((i) => i.id) }));
    assert.equal((await answerQuestion({ question: "tell me about the hero image", report: many, provider: p })).issueIds.length, 5);
});

test("a follow-up is read with the conversation before it, and its data is picked for both questions", async () => {
    let seen, turns;
    const p = mockProvider(({ user, history }) => { seen = user; turns = history; return { answer: "Think of the hero picture as a poster that fell off the wall: the page points to it, but it isn't there.", issueIds: [] }; });
    const conversation = [{ question: "what is wrong with the hero image?", answer: "The hero image returns 404." }];
    const r = await answerQuestion({ question: "explain like I'm 10", report, provider: p, conversation });
    assert.equal(turns.length, 2);
    assert.equal(turns[0].content, "what is wrong with the hero image?");
    assert.match(turns[1].content, /returns 404/);
    assert.equal(seen.data.issues[0].id, "ISS-aaaaaaaaaa"); // the hero image, from the question before
    assert.equal(seen.data.matched, true);
    assert.match(r.answer, /poster/);
    assert.deepEqual(r.issueIds, []);
});
