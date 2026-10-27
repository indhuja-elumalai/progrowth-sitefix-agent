import { test } from "node:test";
import assert from "node:assert/strict";
import { listAnswer, listTopic, LIST_MAX } from "../lib/list-answers.js";
import { answerQuestion } from "../lib/chat.js";
import { suggestQuestions } from "../lib/suggest.js";
import { CATALOG } from "../lib/issues.js";

const issue = (id, type, priority, url, extra = {}) => ({ id, type, priority, quickWin: priority !== "P3", affectedUrl: url, foundOn: ["https://x.test/"], detail: `${type} detail`, evidence: { kind: "head" }, ...extra });
const img = (n, priority = "P1", pages = 1) => issue(`ISS-${String(n).padStart(10, "a")}`, "image-broken", priority, `https://x.test/img/${n}.jpg`, { evidence: { kind: "image", status: 404 }, foundOn: Array.from({ length: pages }, (_, k) => `https://x.test/p/${k}`), detail: "Image returns 404" });
const report = {
    run: { startUrl: "https://x.test/" },
    types: [
        { type: "image-broken", title: "Broken image", fixSteps: ["Upload the image again.", "Remove it if it is not needed."], issues: [img(1, "P1", 1), img(2, "P1", 5)] },
        { type: "http-4xx-external", title: "Broken link to another website", fixSteps: ["Replace the link."], issues: [issue("ISS-bbbbbbbbbb", "http-4xx-external", "P2", "https://other.test/gone", { evidence: { kind: "http", status: 404 }, detail: "Link returns 404" })] },
        { type: "title-too-long", title: "Title too long", fixSteps: ["Shorten it."], issues: [issue("ISS-cccccccccc", "title-too-long", "P3", "https://x.test/pricing", { detail: "Title is 82 characters" })] },
        { type: "copy-spelling", title: "Spelling mistakes", fixSteps: ["Correct the words."], issues: [issue("ISS-dddddddddd", "copy-spelling", "P1", "https://x.test/about", { evidence: { kind: "content", matches: [{ text: "recieve", correction: "receive" }] }, detail: '1 spelling mistake, e.g. "recieve" → "receive"' })] },
    ],
};

test("'which images are broken?' lists the broken images themselves, the most widespread first", () => {
    const a = listAnswer("Which images are broken?", report);
    assert.equal(a.display, "cards");
    assert.deepEqual(a.issueIds, ["ISS-aaaaaaaaa2", "ISS-aaaaaaaaa1"]);
    assert.equal(a.lead, "I found 2 broken images:");
    assert.match(a.answer, /^- \/img\/2\.jpg on \/p\/0 and 4 other pages\. Image returns 404$/m);
    assert.equal(a.tail, "To fix: Upload the image again, then remove it if it is not needed.");
});

test("the same topic in other words", () => {
    for (const q of ["show me the broken images", "any pictures not loading?", "list missing images", "images that are broken"]) assert.equal(listTopic(q)?.types?.[0], "image-broken", q);
    assert.equal(listTopic("which links to other sites are broken?")?.types?.[0], "http-4xx-external");
    assert.equal(listTopic("broken links")?.types?.[0], "http-4xx-internal");
    assert.equal(listTopic("where are the typos")?.types?.[0], "copy-spelling");
});

test("counts, 'why' and 'how do I' questions are not lists", () => {
    for (const q of ["How many images are broken?", "Why are broken images bad?", "How do I fix the broken images?", "explain the broken links", "hello"]) assert.equal(listAnswer(q, report), null, q);
});

test("nothing of that kind: a plain answer, no cards", () => {
    const a = listAnswer("Which pages are hidden from Google?", report);
    assert.equal(a.answer, "No pages are hidden from Google.");
    assert.deepEqual(a.issueIds, []);
});

test("'fix first' takes one of each kind first, then the rest; mixed lists name the kind", () => {
    const a = listAnswer("What should I fix first?", report);
    assert.deepEqual(a.issueIds, ["ISS-aaaaaaaaa2", "ISS-dddddddddd", "ISS-aaaaaaaaa1"]);
    assert.match(a.answer, /^- Spelling mistakes: \/about\. 1 spelling mistake/m);
    assert.equal(a.tail, "", "no single set of fix steps for a mixed list");
});

test("long lists are cut at LIST_MAX and say how many more are in the report", () => {
    const many = { ...report, types: [{ ...report.types[0], issues: Array.from({ length: LIST_MAX + 3 }, (_, n) => img(n)) }] };
    const a = listAnswer("which images are broken", many);
    assert.equal(a.issueIds.length, LIST_MAX);
    assert.equal(a.more, 3);
    assert.equal(a.lead, `I found ${LIST_MAX + 3} broken images. The ${LIST_MAX} most urgent:`);
    assert.equal(a.reportHash, "type=image-broken,og-image-broken", "the web report opens filtered to the full list");
    assert.equal(a.moreLabel, `See all ${LIST_MAX + 3} broken images`);
    assert.match(a.answer, /And 3 more\.$/);
    assert.equal(listAnswer("what should I fix first", many).reportHash, "p=P1");
});

test("other sites' addresses keep their host", () => {
    assert.match(listAnswer("which external links are broken?", report).answer, /^- other\.test\/gone on \/\. Link returns 404$/m);
});

test("answerQuestion answers lists from the report, without asking the AI", async () => {
    let called = false;
    const provider = { name: "openai", model: "m", complete: async () => { called = true; return "{}"; } };
    const r = await answerQuestion({ question: "Which images are broken?", report, provider });
    assert.equal(called, false);
    assert.equal(r.source, "report data");
    assert.equal(r.issueIds.length, 2);
    assert.equal((await answerQuestion({ question: "what should i fix first", report, provider: null })).display, "cards", "works with AI off too");
});

test("every suggested question has a list answer", () => {
    const all = suggestQuestions(Object.keys(CATALOG), [], 50).filter((q) => q !== "How many pages were checked?");
    for (const q of all) assert.ok(listTopic(q), q);
});

test("a question about one page goes to the AI when it is on", async () => {
    let called = 0;
    const provider = { name: "openai", model: "m", complete: async () => { called++; return JSON.stringify({ answer: "The title on /pricing is too long.", issueIds: ["ISS-cccccccccc"] }); } };
    for (const q of ["is the title on /pricing too long?", "which titles on the pricing page need fixing", "what title problems does the homepage have"]) {
        assert.equal((await answerQuestion({ question: q, report, provider })).source, "openai", q);
    }
    assert.equal(called, 3);
    assert.equal((await answerQuestion({ question: "is the title on /pricing too long?", report, provider: null })).display, "cards", "AI off: the list is still the best answer");
});

test("a list of one kind offers itself as the scope of a follow-up", () => {
    assert.deepEqual(listAnswer("Which images are broken?", report).scope, { types: ["image-broken", "og-image-broken"], noun: "broken images" });
    assert.equal(listAnswer("What should I fix first?", report).scope, undefined, "a mixed list is not a scope");
});

test("'fix first' within a scope: the most urgent of those only, said so in the lead", () => {
    const a = listAnswer("What should I fix first?", report, { scope: ["image-broken", "og-image-broken"] });
    assert.deepEqual(a.issueIds, ["ISS-aaaaaaaaa2", "ISS-aaaaaaaaa1"]);
    assert.equal(a.lead, "Of the broken images, I'd fix these first:");
    const t = listAnswer("what should i fix first", report, { scope: ["title-too-long", "title-missing"] });
    assert.deepEqual(t.issueIds, ["ISS-cccccccccc"], "within a scope, not only P1");
    assert.equal(listAnswer("what are the quick wins", report, { scope: ["title-too-long"] }).answer, "None of the title problems is a quick win.");
    assert.deepEqual(listAnswer("Which images are broken?", report, { scope: ["title-too-long"] }).issueIds.length, 2, "a topic question ignores the scope");
});

test("'how fast are my pages?' gives the site-wide picture, then the slowest pages one card each", () => {
    const sp = (id, type, url, lcpMs, priority = "P2") => ({ id, type, priority, affectedUrl: url, foundOn: [], detail: `${type} detail`, evidence: { kind: "speed", lcpMs } });
    const r = {
        run: { startUrl: "https://x.test/" },
        summaries: { speed: { pagesTested: 10, passing: 6, median: { lcpMs: 2900 }, lcp: { good: 7, "needs-improvement": 3 }, cls: { good: 9, poor: 1 } } },
        types: [
            { type: "speed-lcp-slow", title: "Main content shows up slowly", fixSteps: [], issues: [sp("ISS-s000000001", "speed-lcp-slow", "https://x.test/a", 5200), sp("ISS-s000000002", "speed-lcp-slow", "https://x.test/b", 3100, "P3")] },
            { type: "speed-cls-high", title: "Layout jumps while loading", fixSteps: [], issues: [sp("ISS-s000000003", "speed-cls-high", "https://x.test/a", 5200), sp("ISS-s000000004", "speed-cls-high", "https://x.test/c", 1200)] },
        ],
    };
    const a = listAnswer("How fast are my pages?", r);
    assert.equal(a.lead, "On a phone over 4G, your pages show their main content in about 2.9 s (good: under 2.5 s). 6 of the 10 pages tested pass Google's Core Web Vitals, mostly because 3 show their main content slowly. The pages to fix:");
    assert.deepEqual(a.issueIds, ["ISS-s000000001", "ISS-s000000002", "ISS-s000000004"], "one per page, the page with the most problems first");
    const everyPage = { ...r, summaries: { speed: { pagesTested: 40, passing: 0, median: { lcpMs: 980, tbtMs: 295 }, lcp: { good: 32, "needs-improvement": 8 }, tbt: { "needs-improvement": 39, poor: 1 }, cls: { good: 39, poor: 1 } } } };
    assert.match(listAnswer("what is my page speed", everyPage).lead, /about 1\.0 s \(good: under 2\.5 s\)\. None of the 40 pages tested pass Google's Core Web Vitals, mostly because 40 are too busy to respond while loading \(about 295 ms; good: under 200 ms\)\./);
    assert.match(a.tail, /mid-range phone over 4G/);
    assert.equal(listAnswer("does the layout jump around?", r).issueIds.length, 2, "a narrower speed question lists just that problem");
    assert.match(listAnswer("is my site slow", { ...r, summaries: {} }).answer, /wasn't tested/);
    assert.equal(listTopic("which images are too large")?.noun, "large images", "image questions stay image questions");
});
