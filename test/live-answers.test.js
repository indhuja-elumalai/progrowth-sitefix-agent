import { test } from "node:test";
import assert from "node:assert/strict";
import { answerProcessQuestion as ans } from "../lib/live-answers.js";

const live = {
    running: true, site: "https://www.progrowth.services/", phase: "crawl",
    pages: { done: 42, found: 120, sitemap: 173, cap: 0 }, checks: { done: 200, total: 265 },
    issues: { high: 2, medium: 5, low: 1, total: 8 }, elapsedMs: 60000, etaMs: 90000, avgLoadMs: 4000, slowDowns: 3,
    findings: [
        { type: "image-oversized", severity: "medium", url: "https://www.progrowth.services/img/a.png" },
        { type: "http-4xx-internal", severity: "high", url: "https://www.progrowth.services/old-page" },
        { type: "http-4xx-internal", severity: "high", url: "https://www.progrowth.services/gone" },
        { type: "title-too-long", severity: "low", url: "https://www.progrowth.services/blog/" },
    ],
    label: (t) => ({ "http-4xx-internal": "Broken link to your own page", "image-oversized": "Image file too large", "title-too-long": "Title too long" })[t] || t,
};

test("questions about the inspection itself are recognised in many wordings", () => {
    const kinds = {
        "How does the crawl work?": "how", "what is the mechanism behind it": "how", "how are you checking my site": "how",
        "Why is it taking this long?": "why-long", "why so slow??": "why-long", "can you go faster": "why-long",
        "How long is left?": "eta", "when will it be done": "eta", "how many pages so far?": "eta",
        "What are you checking?": "what", "which checks do you run": "what",
        "Will this change my site?": "safe", "is it safe to run on our website": "safe",
        "What have you found so far?": "found", "anything wrong yet?": "found",
    };
    for (const [q, kind] of Object.entries(kinds)) assert.equal(ans(q, live)?.kind, kind, q);
});

test("questions about the report are left to the AI", () => {
    for (const q of ["What should I fix first?", "Which images are broken?", "what are the quick wins", "Which page titles need fixing?"]) assert.equal(ans(q, live), null, q);
});

test("'why so long' while running uses the live numbers", () => {
    const a = ans("why is it taking so long", live).answer;
    assert.match(a, /at least 173 pages \(173 listed in its sitemap\)/);
    assert.match(a, /265 links and images/);
    assert.match(a, /about 4 s to load\. That's slow/);
    assert.match(a, /slow down 3 times/);
    assert.match(a, /about 42 pages a minute, so about 1 minute 30 seconds are left/);
});

test("'how long is left' while crawling, and after the crawl step", () => {
    assert.match(ans("how long is left?", live).answer, /^42 pages read out of at least 173, about 1 minute 30 seconds left for the pages/);
    assert.match(ans("how long is left?", { ...live, phase: "report" }).answer, /All 42 pages are read\. I'm now writing the explanations and taking screenshots/);
});

test("'what have you found so far' lists the most serious kinds first, once each", () => {
    const a = ans("found anything so far?", live).answer;
    assert.match(a, /So far: 2 high, 5 medium and 1 low/);
    assert.match(a, /- Broken link to your own page \(\/old-page\)\n- Image file too large \(\/img\/a\.png\)\n- Title too long \(\/blog\/\)/);
    assert.equal((a.match(/Broken link/g) || []).length, 1);
    assert.match(ans("anything wrong yet", { ...live, issues: { total: 0 }, findings: [] }).answer, /Nothing yet/);
});

test("after the inspection: timings from the run; 'found so far' goes to the report", () => {
    const after = { running: false, site: "https://x.test/", pages: { done: 169 }, seconds: { total: 164, pages: 151.8 }, avgLoadMs: 4010 };
    assert.match(ans("why did it take so long", after).answer, /took 2 minutes 44 seconds to check 169 pages\. Reading the pages took 2 minutes 32 seconds.*about 4 s per page/);
    assert.match(ans("how long did it take", after).answer, /finished: 169 pages checked in 2 minutes 44 seconds/);
    assert.equal(ans("what have you found so far", after), null);
    assert.equal(ans("why so slow", { running: false }), null, "no timings: let the AI say what it can");
});

test("the safety answer never promises more than the crawler does", () => {
    const a = ans("will you change anything on my website?", live).answer;
    assert.match(a, /never log in, submit forms, book anything or change anything/);
});

test("the function is self-contained, so the page can carry a copy of it", () => {
    const copy = new Function(`${ans.toString()}; return answerProcessQuestion;`)();
    assert.deepEqual(copy("how long is left", live), ans("how long is left", live));
});

test("after a large site was read in part, 'how many pages' says so", () => {
    const a = ans("how many pages were checked?", { running: false, pages: { done: 140 }, seconds: { total: 53 }, partial: { reason: "time", pagesFound: 3003 } }).answer;
    assert.match(a, /140 pages checked in 53 seconds\. The site is larger \(at least 3003 pages found\), so I read a share of every section/);
});

test("after an inspection was stopped, 'how many pages' says it was stopped early", () => {
    const a = ans("how many pages were checked?", { running: false, pages: { done: 62 }, seconds: { total: 40 }, partial: { reason: "stopped", pagesFound: 603 } }).answer;
    assert.match(a, /62 pages checked in 40 seconds\. You stopped it early, so the report covers those pages \(at least 603 were found\)\./);
});
