import { test } from "node:test";
import assert from "node:assert/strict";
import {
    wordCount, findBoilerplate, mainText, thinIssue, placeholderIssue, repeatedWordIssue,
    shingles, jaccard, findNearDuplicates, duplicateIssue, contentFindings, CONTENT_LIMITS,
} from "../lib/content.js";

// Real-looking text of n words that never repeats a 5-word phrase.
const prose = (n, seed = 0) => Array.from({ length: n }, (_, i) => `word${seed}x${i}`).join(" ");
const article = (city) =>
    `Our ${city} team helps local law firms win more clients online. ` +
    "We build fast websites, write useful pages for every practice area, run search campaigns and report every month on calls, forms and signed cases. " +
    "Firms that work with us usually see more enquiries within the first quarter, and every plan includes a named strategist, monthly reviews and clear pricing with no long contracts. " +
    `Book a free audit and we will show you exactly where your ${city} firm is losing visitors and what to fix first. ` +
    "Our process starts with a technical review of your current site, then a competitor study, then a ninety day plan with weekly milestones. " +
    "We handle hosting, security updates, page speed and accessibility, so your team can focus on clients instead of software. " +
    "Every page we write is checked by an editor and by a licensed attorney before it goes live, and every claim links to a source.";

test("wordCount counts words, including numbers and hyphenated or apostrophe words", () => {
    assert.equal(wordCount("Hello, world! It's a well-known 2024 fact."), 7);
    assert.equal(wordCount(""), 0);
    assert.equal(wordCount("Café déjà vu"), 3);
});

// ---------- boilerplate ----------
test("lines on at least half the pages are boilerplate (menus, footers)", () => {
    const pages = [1, 2, 3, 4].map((i) => ({ url: `/p${i}`, lines: ["Home", "Services", "© 2026 Firm", `Unique text ${i}`] }));
    pages[3].lines = pages[3].lines.filter((l) => l !== "Services");
    const b = findBoilerplate(pages);
    assert.deepEqual([...b].sort(), ["Home", "Services", "© 2026 Firm"]);
    assert.equal(mainText(pages[0].lines, b), "Unique text 1");
});

test("with fewer than 4 pages nothing is treated as boilerplate", () => {
    const pages = [1, 2, 3].map((i) => ({ url: `/p${i}`, lines: ["Home", `x${i}`] }));
    assert.equal(findBoilerplate(pages).size, 0);
});

// ---------- thin ----------
test("thin: under the word limit, not at it", () => {
    assert.equal(thinIssue(CONTENT_LIMITS.minWords), null);
    const i = thinIssue(14);
    assert.equal(i.type, "content-thin");
    assert.equal(i.detail, `14 words of text (minimum ${CONTENT_LIMITS.minWords})`);
});

// ---------- placeholder ----------
const ptypes = (lines) => placeholderIssue(lines)?.evidence.matches.map((m) => m.name) ?? [];

test("finds lorem ipsum, unfilled template tags and fill-in brackets, with a snippet", () => {
    const i = placeholderIssue(["Welcome to {{ company_name }}.", "Lorem ipsum dolor sit amet, consectetur.", "Call [insert phone number] today"]);
    assert.equal(i.type, "content-placeholder");
    assert.equal(i.severity, "high");
    assert.deepEqual(i.evidence.matches.map((m) => m.name), ["unfilled template tag", "lorem ipsum", "fill-in bracket"]);
    assert.match(i.evidence.matches[0].text, /\{\{ company_name \}\}/);
});

test("finds 'your text here', sample text, construction notices, TODO notes and script output bugs", () => {
    assert.deepEqual(ptypes(["Your headline goes here"]), ['"your text here"']);
    assert.deepEqual(ptypes(["This is sample text for the hero"]), ["sample text"]);
    assert.deepEqual(ptypes(["This page is under construction"]), ["under construction"]);
    assert.deepEqual(ptypes(["TODO: add pricing"]), ["TODO / FIXME note"]);
    assert.deepEqual(ptypes(["Price: $NaN"]), ["script output bug"]);
    assert.deepEqual(ptypes(["undefined"]), ["script output bug"]);
    assert.deepEqual(ptypes(["[object Object]"]), ["script output bug"]);
});

test("normal sentences that only look similar are fine", () => {
    for (const line of [
        "The new bridge is under construction until 2027.",
        "In maths, division by zero is undefined.",
        "We are adding a todo list feature.",
        "Add your logo in the settings page.",
        "Results for {query} will appear here",
    ]) {
        assert.equal(placeholderIssue([line]), null, line);
    }
});

// ---------- repeated words ----------
test("finds 'the the' (any case) and reports the word with a snippet", () => {
    const i = repeatedWordIssue(["Contact the the team today.", "Thanks for For visiting."]);
    assert.equal(i.type, "content-repeated-word");
    assert.deepEqual(i.evidence.matches.map((m) => m.word), ["the", "for"]);
    assert.match(i.detail, /"the the"/);
});

test("legitimate doubles, place names, numbers and words split across lines are fine", () => {
    assert.equal(repeatedWordIssue(["He had had enough.", "I know that that is true.", "Bye bye!"]), null);
    assert.equal(repeatedWordIssue(["Flights to Walla Walla and Bora Bora"]), null);
    assert.equal(repeatedWordIssue(["Room 10 10 guests"]), null);
    assert.equal(repeatedWordIssue(["Services", "Services"]), null);
    assert.equal(repeatedWordIssue(["theme the"]), null);
});

// ---------- near-duplicates ----------
test("shingles and jaccard: same text is 1, unrelated text is 0", () => {
    const a = shingles(prose(60, 1)), b = shingles(prose(60, 2));
    assert.equal(jaccard(a, shingles(prose(60, 1))), 1);
    assert.equal(jaccard(a, b), 0);
});

test("templated pages with only the city swapped are near-duplicates; different pages are not", () => {
    const pages = [
        { url: "/austin", text: article("Austin") },
        { url: "/denver", text: article("Denver") },
        { url: "/about", text: prose(80, 7) },
    ];
    const d = findNearDuplicates(pages);
    assert.deepEqual([...d.keys()].sort(), ["/austin", "/denver"]);
    const [s] = d.get("/austin");
    assert.equal(s.url, "/denver");
    assert.ok(s.similarity >= CONTENT_LIMITS.nearDuplicate && s.similarity < 1, String(s.similarity));
});

test("exact copies score 1; pages with too little text of their own are skipped", () => {
    const text = prose(70, 3);
    const d = findNearDuplicates([{ url: "/a", text }, { url: "/b", text }, { url: "/c", text: "Short page" }, { url: "/d", text: "Short page" }]);
    assert.deepEqual(d.get("/a"), [{ url: "/b", similarity: 1 }]);
    assert.equal(d.has("/c"), false);
});

test("half-similar pages are not near-duplicates", () => {
    const shared = prose(60, 4);
    const d = findNearDuplicates([{ url: "/a", text: `${shared} ${prose(60, 5)}` }, { url: "/b", text: `${shared} ${prose(60, 6)}` }]);
    assert.equal(d.size, 0);
});

test("duplicateIssue names the closest page and counts the rest", () => {
    assert.equal(duplicateIssue([]), null);
    const i = duplicateIssue([{ url: "/b", similarity: 0.95 }, { url: "/c", similarity: 0.92 }]);
    assert.equal(i.type, "content-duplicate");
    assert.equal(i.detail, "95% the same text as /b (+1 more)");
    assert.equal(duplicateIssue([{ url: "/b", similarity: 1 }]).detail, "Same text as /b");
});

// ---------- together ----------
test("contentFindings: boilerplate is ignored for duplicates, thin can be skipped, drafts are registry-shaped", () => {
    const nav = ["Home", "Services", "Contact", "© 2026 Example Firm"];
    const pages = [
        { url: "/austin", foundOn: ["/"], lines: [...nav, article("Austin"), prose(150, 8)] },
        { url: "/denver", foundOn: ["/"], lines: [...nav, article("Denver"), prose(150, 8)] },
        { url: "/about", foundOn: ["/"], lines: [...nav, prose(220, 9)] },
        { url: "/blog", foundOn: ["/"], lines: [...nav, prose(240, 10), "Read the the latest posts."] },
        { url: "/404-ish", foundOn: [], lines: [...nav, "Sorry, not found"], skipThin: true },
        { url: "/contact", foundOn: ["/"], lines: [...nav, "Email us."] },
    ];
    const { findings, pages: summary, boilerplateLines } = contentFindings(pages);
    assert.equal(boilerplateLines, 4);
    const got = findings.map((f) => `${f.type} ${f.affectedUrl}`).sort();
    assert.deepEqual(got, ["content-duplicate /austin", "content-duplicate /denver", "content-repeated-word /blog", "content-thin /contact"]);
    const f = findings.find((x) => x.type === "content-thin");
    assert.deepEqual(f.foundOn, ["/"]);
    assert.equal(f.evidence.kind, "content");
    assert.equal(summary.find((p) => p.url === "/about").issues.length, 0);
});
