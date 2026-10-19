import { test } from "node:test";
import assert from "node:assert/strict";
import { dictionaryFindings, siteVocabulary, buildCopyRequest, copyText, validateCopyAnswer, checkCopy, COMMON_MISSPELLINGS, COPY_LIMITS } from "../lib/copy.js";
import { mockProvider } from "../lib/ai-provider.js";

const PAGE = "We recieve every enquiry within one day.\nOur team are work hard for each client.\nProGrowth builds websites for law firms.";

// ---------- dictionary ----------
test("dictionary: finds common misspellings with the sentence and a corrected version", () => {
    const [f] = dictionaryFindings(PAGE);
    assert.equal(f.kind, "spelling");
    assert.equal(f.text, "We recieve every enquiry within one day.");
    assert.equal(f.correction, "We receive every enquiry within one day.");
    assert.equal(f.source, "dictionary");
    assert.match(f.explanation, /"recieve" is a common misspelling of "receive"/);
});

test("dictionary: keeps capitals, reports each word once, and only whole words", () => {
    const f = dictionaryFindings("Seperate rooms. We seperate them. Teh end.");
    assert.deepEqual(f.map((x) => x.word), ["seperate", "teh"]);
    assert.match(f[0].correction, /^Separate rooms\./); // capital kept
    assert.deepEqual(dictionaryFindings("The thesis was definitely realistic and completely fine."), []);
});

test("dictionary: every entry is a real correction (no word maps to itself)", () => {
    for (const [wrong, right] of Object.entries(COMMON_MISSPELLINGS)) assert.notEqual(wrong, right.toLowerCase(), wrong);
});

// ---------- site vocabulary ----------
test("siteVocabulary counts pages, not occurrences", () => {
    const v = siteVocabulary(["ProGrowth ProGrowth helps", "ProGrowth again", "nothing here"]);
    assert.equal(v.get("progrowth"), 2);
    assert.equal(v.get("helps"), 1);
});

test("the AI request carries the page text only, capped", () => {
    const r = buildCopyRequest("https://x.test/a", "x".repeat(COPY_LIMITS.maxCharsPerPage + 100));
    assert.equal(r.url, "https://x.test/a");
    assert.equal(r.text.length, COPY_LIMITS.maxCharsPerPage);
});

// ---------- guardrails ----------
const ans = (...findings) => JSON.stringify({ findings });

test("a real grammar mistake quoted exactly passes", () => {
    const v = validateCopyAnswer(ans({ text: "Our team are work hard", correction: "Our team works hard", kind: "grammar", explanation: "Wrong verb form." }), PAGE);
    assert.equal(v.ok, true);
    assert.deepEqual(v.findings, [{ kind: "grammar", text: "Our team are work hard", correction: "Our team works hard", explanation: "Wrong verb form.", source: "ai" }]);
});

test("GUARDRAIL: a quote that is not on the page is dropped (no invented mistakes)", () => {
    const v = validateCopyAnswer(ans({ text: "We provides great services", correction: "We provide great services", kind: "grammar", explanation: "x" }), PAGE);
    assert.deepEqual(v.findings, []);
    assert.match(v.problems[0], /quote not found on the page/);
});

test("GUARDRAIL: whitespace differences in the quote are tolerated", () => {
    const v = validateCopyAnswer(ans({ text: "Our  team are\nwork hard", correction: "Our team works hard", kind: "grammar" }), PAGE);
    assert.equal(v.findings.length, 1);
});

test("GUARDRAIL: no-op corrections, rewrites and unknown kinds are dropped", () => {
    const v = validateCopyAnswer(ans(
        { text: "Our team are work hard", correction: "Our team are work hard", kind: "grammar" },
        { text: "Our team are work hard", correction: "Our talented, award-winning team works incredibly hard every single day for every client", kind: "grammar" },
        { text: "Our team are work hard", correction: "Our team works hard", kind: "style" },
    ), PAGE);
    assert.deepEqual(v.findings, []);
    assert.equal(v.problems.length, 3);
});

test("GUARDRAIL: a word the site uses on 3+ pages is its own vocabulary, not a typo", () => {
    const siteVocab = new Map([["progrowth", 5]]);
    const v = validateCopyAnswer(ans({ text: "ProGrowth builds websites", correction: "Pro Growth builds websites", kind: "spelling" }), PAGE, { siteVocab });
    assert.deepEqual(v.findings, []);
    assert.match(v.problems[0], /"progrowth" is used across the site/);
});

test("GUARDRAIL: words on the allow list are never flagged", () => {
    const v = validateCopyAnswer(ans({ text: "ProGrowth builds websites", correction: "Progress builds websites", kind: "spelling" }), PAGE, { allowWords: new Set(["progrowth"]) });
    assert.deepEqual(v.findings, []);
});

test("GUARDRAIL: broken JSON or a missing list is refused; at most maxFindingsPerPage are kept", () => {
    assert.equal(validateCopyAnswer("nope", PAGE).ok, false);
    assert.equal(validateCopyAnswer({}, PAGE).ok, false);
    const many = Array.from({ length: 12 }, () => ({ text: "Our team are work hard", correction: "Our team works hard", kind: "grammar" }));
    assert.equal(validateCopyAnswer(ans(...many), PAGE).findings.length, 1); // duplicates collapse
});

// ---------- orchestration ----------
const pages = [
    { url: "https://x.test/a", foundOn: ["https://x.test/"], text: PAGE },
    { url: "https://x.test/b", foundOn: ["https://x.test/"], text: "Everything on this page is fine." },
];

test("without AI: the dictionary still runs; one spelling issue per page, with sentence and correction", async () => {
    const { findings, stats } = await checkCopy({ pages });
    assert.deepEqual(findings.map((f) => `${f.type} ${f.affectedUrl}`), ["copy-spelling https://x.test/a"]);
    assert.equal(stats.aiPagesChecked, 0);
    const m = findings[0].evidence.matches[0];
    assert.equal(m.correction, "We receive every enquiry within one day.");
    assert.equal(findings[0].evidence.kind, "content");
    assert.match(findings[0].detail, /1 spelling mistake, e\.g\. "We recieve/);
});

test("with AI: one call per page; grammar added; the dictionary's spot and doubled words are not repeated", async () => {
    let calls = 0;
    const provider = mockProvider(({ user }) => {
        calls++;
        if (!user.text.includes("recieve")) return { findings: [] };
        return { findings: [
            { text: "We recieve every enquiry", correction: "We receive every enquiry", kind: "spelling", explanation: "dup of dictionary" },
            { text: "Our team are work hard", correction: "Our team works hard", kind: "grammar", explanation: "Wrong verb form." },
        ] };
    });
    const { findings, stats } = await checkCopy({ pages, provider });
    assert.equal(calls, 2);
    assert.equal(stats.aiPagesChecked, 2);
    assert.deepEqual(findings.map((f) => f.type).sort(), ["copy-grammar", "copy-spelling"]);
    assert.equal(findings.find((f) => f.type === "copy-spelling").evidence.matches.length, 1); // AI duplicate dropped
});

test("doubled words from the AI are left to the repeated-word rule", async () => {
    const provider = mockProvider(() => ({ findings: [{ text: "for the the client", correction: "for the client", kind: "grammar" }] }));
    const { findings } = await checkCopy({ pages: [{ url: "https://x.test/c", text: "We work for the the client." }], provider });
    assert.deepEqual(findings, []);
});

test("a failing AI never breaks the crawl: dictionary results stay, the failure is counted", async () => {
    const provider = { name: "openai", model: "m", complete: async () => { throw new Error("AI request failed (429): Rate limit"); } };
    const { findings, stats } = await checkCopy({ pages, provider });
    assert.equal(findings.length, 1);
    assert.equal(stats.aiFailures, 2);
    assert.match(stats.problems[0], /429/);
});

test("answers are cached per page text", async () => {
    let calls = 0;
    const store = {};
    const cache = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
    const provider = mockProvider(() => { calls++; return { findings: [] }; });
    await checkCopy({ pages, provider, cache });
    await checkCopy({ pages, provider, cache });
    assert.equal(calls, 2); // 2 pages, first run only
});

test("snippets are whole sentences (or end on a word boundary), never half a word", () => {
    const [a] = dictionaryFindings("First sentence here. Our team will seperate urgent requests from routine ones so nothing important waits for days and days on end. Next one.");
    const sentence = "Our team will seperate urgent requests from routine ones so nothing important waits for days and days on end.";
    assert.ok(a.text.startsWith("Our team will seperate"), a.text); // starts at the sentence
    assert.ok(sentence.startsWith(a.text) && sentence[a.text.length] === " ", a.text); // ends on a whole word
    const [b] = dictionaryFindings("Short line. We recieve it.");
    assert.equal(b.text, "We recieve it.");
});

test("placeholder text from the AI is left to the placeholder rule", async () => {
    const provider = mockProvider(() => ({ findings: [{ text: "Welcome to {{ company_name }}, friends.", correction: "Welcome to our company, friends.", kind: "grammar" }] }));
    const { findings } = await checkCopy({ pages: [{ url: "https://x.test/d", text: "Welcome to {{ company_name }}, friends." }], provider });
    assert.deepEqual(findings, []);
});

// ---------- noise filters found on a real site ----------
test("style-only corrections are dropped: spacing, case, full stops, UK/US spelling", () => {
    const text = "Growth of 350 % last year. We build b2b tech marketing. It is a volume problem , not a fit problem. Most firms are not realising gains. Target for FinServ mark";
    const raw = JSON.stringify({ findings: [
        { kind: "spelling", text: "350 %", correction: "350%", explanation: "x" },
        { kind: "grammar", text: "b2b tech marketing", correction: "B2B tech marketing", explanation: "x" },
        { kind: "grammar", text: "volume problem , not", correction: "volume problem, not", explanation: "x" },
        { kind: "spelling", text: "not realising gains", correction: "not realizing gains", explanation: "x" },
        { kind: "grammar", text: "Target for FinServ mark", correction: "Target for FinServ mark.", explanation: "x" },
    ] });
    const v = validateCopyAnswer(raw, text);
    assert.equal(v.findings.length, 0);
    assert.equal(v.problems.filter((p) => p.startsWith("style only")).length, 5);
});

test("real fixes that look like UK/US pairs or spacing changes are kept", () => {
    const text = "We caled every client. Their presense matters. Thanks four your time. Plan in atleast 4 phases.";
    const raw = JSON.stringify({ findings: [
        { kind: "spelling", text: "We caled every client", correction: "We called every client", explanation: "x" },
        { kind: "spelling", text: "Their presense matters", correction: "Their presence matters", explanation: "x" },
        { kind: "grammar", text: "Thanks four your time", correction: "Thanks for your time", explanation: "x" },
        { kind: "spelling", text: "in atleast 4 phases", correction: "in at least 4 phases", explanation: "x" },
    ] });
    assert.equal(validateCopyAnswer(raw, text).findings.length, 4);
});

test("curly quotes or invisible characters are not a correction", () => {
    const text = "By concentrating resources on the right accounts​, teams win.";
    const raw = JSON.stringify({ findings: [{ kind: "spelling", text: "on the right accounts​, teams", correction: "on the right accounts, teams", explanation: "x" }] });
    assert.equal(validateCopyAnswer(raw, text).findings.length, 0);
});

test("a cut-off last word is not a typo", () => {
    const text = "Pick the AEO Monthly Packa";
    const raw = JSON.stringify({ findings: [{ kind: "spelling", text: "AEO Monthly Packa", correction: "AEO Monthly Package", explanation: "x" }] });
    const v = validateCopyAnswer(raw, text);
    assert.equal(v.findings.length, 0);
    assert.match(v.problems[0], /cut-off/);
});

test("copyText never cuts a word in half", () => {
    const text = "One sentence here. ".repeat(10) + "Monthly Package";
    const out = copyText(text, { ...COPY_LIMITS, maxCharsPerPage: text.length - 4 });
    assert.ok(!/Packa$/.test(out));
    assert.ok(out.endsWith("."));
});

test("text shared by several pages is reported once, with the other pages listed", async () => {
    const shared = "Our teams recieve every request.";
    const pages = ["a", "b", "c"].map((p) => ({ url: `https://x.test/${p}`, foundOn: [], text: `${p} page. ${shared}` }));
    const { findings, stats } = await checkCopy({ pages });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].affectedUrl, "https://x.test/a");
    assert.deepEqual(findings[0].evidence.matches[0].alsoOn, ["https://x.test/b", "https://x.test/c"]);
    assert.match(findings[0].detail, /also on 2 other pages/);
    assert.equal(stats.sharedRepeats, 2);
});
