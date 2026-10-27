import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWebReport, reportFileName, fixFirst } from "../lib/web-report.js";
import { siteScore } from "../lib/score.js";

const issue = (o) => ({
    id: "ISS-0000000001", type: "title-missing", category: "SEO: titles & descriptions", severity: "high",
    affectedUrl: "https://example.com/a", foundOn: [], detail: "No <title> tag", evidence: { kind: "head", head: { title: null } },
    priority: "P1", priorityReason: "high severity", owner: "Content writer", effort: "easy", quickWin: true,
    explanation: "The page has no title.", explanationSource: "ai", suggestedValue: null, screenshot: null, ...o,
});
const report = (types, extra = {}) => ({
    generatedAt: "2026-10-22T10:00:00.000Z",
    run: { id: "run-20261022T100000", startUrl: "https://example.com/", startedAt: "2026-10-22T10:00:00.000Z", finishedAt: "2026-10-22T10:05:00.000Z", pagesCrawled: 12 },
    ai: { provider: "mock", model: "mock", standardTypes: 0 },
    summary: { byPriority: { P1: 1, P2: 1, P3: 1 }, quickWins: 1 },
    types,
    ...extra,
});
const sample = () => report([
    { type: "title-missing", category: "SEO: titles & descriptions", title: "Missing title", summary: "Pages without a title.", why: "Search results show the URL.", fixSteps: ["Add a title."], valueLabel: "Suggested title",
      issues: [issue({ suggestedValue: "About us | Example" })] },
    { type: "image-alt-missing", category: "Images", title: "Image has no alt text", summary: "Images without alt.", why: "", fixSteps: ["Add alt."],
      issues: [
          issue({ id: "ISS-0000000002", type: "image-alt-missing", category: "Images", priority: "P2", owner: "Developer", effort: "easy", quickWin: false, affectedUrl: "https://example.com/i.png", foundOn: ["https://example.com/", "https://example.com/b"], screenshot: "shots/ISS-0000000002.jpg" }),
          issue({ id: "ISS-0000000003", type: "image-alt-missing", category: "Images", priority: "P3", owner: "Developer", effort: "easy", quickWin: false, affectedUrl: "https://example.com/j.png" }),
      ] },
]);

test("every issue is on the page, with its priority, category and owner as filter data", () => {
    const html = buildWebReport({ report: sample() });
    for (const id of ["ISS-0000000001", "ISS-0000000002", "ISS-0000000003"]) assert.match(html, new RegExp(`<details class="inst" id="${id}"`));
    assert.match(html, /id="ISS-0000000002" data-p="P2" data-cat="Images" data-owner="Developer" data-qw="0"/);
    assert.match(html, /id="ISS-0000000001" data-p="P1" data-cat="SEO: titles &amp; descriptions" data-owner="Content writer" data-qw="1"/);
    assert.match(html, /Suggested title<\/div><div class="v"><span>About us \| Example<\/span><button type="button" class="copy" data-copy="About us \| Example">/);
    assert.match(html, /Found on 2 pages/);
    assert.match(html, /<span class="tag">Content writer<\/span>/, "who fixes it, on the card");
});

test("page text from the crawled site is escaped, so a hostile page cannot inject script", () => {
    const evil = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
    const r = report([{ type: "title-missing", category: "Content", title: evil, summary: evil, why: evil, fixSteps: [evil],
        issues: [issue({ affectedUrl: `https://example.com/${evil}`, explanation: evil, suggestedValue: evil, foundOn: [evil], owner: evil })] }]);
    r.run.startUrl = `javascript:alert(3)//${evil}`;
    const html = buildWebReport({ report: r });
    const scripts = html.match(/<script>/g) || [];
    assert.equal(scripts.length, 1, "only SiteFix's own script");
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!html.includes('href="javascript:'), "non-http start URL is not made a link");
});

test("the standalone file loads nothing from the network and has no links back to the server", () => {
    const html = buildWebReport({ report: sample(), standalone: true, links: { pdf: "/api/history/x/report.pdf", download: "/report/x/download" }, shotSrc: (i) => (i.screenshot ? "data:image/jpeg;base64,AAAA" : null) });
    assert.ok(!/<script[^>]+src=/i.test(html));
    assert.ok(!/<link[^>]+stylesheet/i.test(html));
    assert.ok(!/@import|url\(http/i.test(html));
    assert.ok(!html.includes("/api/history/"));
    assert.ok(!html.includes("Download this report"));
    assert.match(html, /<img src="data:image\/jpeg;base64,AAAA"/);
});

test("the live page links to the PDF and the download, and uses the screenshot URLs it is given", () => {
    const html = buildWebReport({ report: sample(), links: { pdf: "/api/history/r/report.pdf", download: "/report/r/download" }, shotSrc: (i) => (i.screenshot ? `/api/history/r/${i.screenshot}` : null) });
    assert.match(html, /href="\/report\/r\/download" download>Download this report/);
    assert.match(html, /href="\/api\/history\/r\/report.pdf"/);
    assert.match(html, /<img src="\/api\/history\/r\/shots\/ISS-0000000002.jpg"/);
    assert.equal((html.match(/<img /g) || []).length, 1, "only issues with a screenshot get one");
});

test("fix these first: P1 issues, then quick wins, one entry per type and page", () => {
    const dup = issue({ id: "ISS-00000000aa" });
    const r = report([{ type: "title-missing", category: "x", title: "Missing title", summary: "", fixSteps: [], issues: [issue({}), dup] },
        { type: "lang-missing", category: "x", title: "No lang", summary: "", fixSteps: [], issues: [issue({ id: "ISS-00000000bb", type: "lang-missing", priority: "P2", quickWin: true }), issue({ id: "ISS-00000000cc", type: "lang-missing", priority: "P3", quickWin: false, affectedUrl: "https://example.com/z" })] }]);
    assert.deepEqual(fixFirst(r).map((i) => i.id), ["ISS-0000000001", "ISS-00000000bb"]);
});

test("a site with no issues gets a clean message and no filter bar", () => {
    const html = buildWebReport({ report: report([], { summary: { byPriority: { P1: 0, P2: 0, P3: 0 }, quickWins: 0 } }) });
    assert.match(html, /No issues found/);
    assert.match(html, /12 pages crawled/);
    assert.ok(!html.includes('id="q"'));
});

test("types are ordered by their most urgent issue, and issues inside a type P1 first", () => {
    const html = buildWebReport({ report: sample() });
    assert.ok(html.indexOf('data-type="title-missing"') < html.indexOf('data-type="image-alt-missing"'));
    assert.ok(html.indexOf('id="ISS-0000000002"') < html.indexOf('id="ISS-0000000003"'));
});

test("reportFileName is safe for any start URL", () => {
    assert.equal(reportFileName(sample()), "sitefix-example.com-2026-10-22.html");
    assert.equal(reportFileName({ run: { startUrl: "http://localhost:4000/", startedAt: "2026-01-02T00:00:00Z" } }), "sitefix-localhost-4000-2026-01-02.html");
    assert.equal(reportFileName({ run: { startUrl: "not a url/../x" } }), "sitefix-not-a-url-..-x-report.html");
});

test("a large site read in part says so under the title, and the chat's filter links work", () => {
    const r = sample();
    r.run.partial = { reason: "time", pagesFound: 3003 };
    const html = buildWebReport({ report: r });
    assert.match(html, /12 pages crawled \(a share of every section of a larger site: at least 3003 pages found\)/);
    assert.match(html, /function fromHash\(h\)/, "reads #type=, #p= and #qw= from links in the chat");
});

// ---------- the live report (Day 28) ----------
const dataOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="sf-data">([\s\S]*?)<\/script>/)[1]);

test("the live report shows the score, the level, the three areas and the coach's first message", () => {
    const r = sample();
    const html = buildWebReport({ report: r });
    const s = siteScore(r.types.flatMap((t) => t.issues), []);
    assert.match(html, new RegExp(`<div class="dial-n"><b>${s.score}</b>`));
    assert.match(html, /<span class="badge">Level 1<\/span><span class="ln">Urgent fixes<\/span>/);
    assert.match(html, /On-page <b>\d+<\/b>.*Technical <b>\d+<\/b>.*Off-page <b>\d+<\/b>/s);
    assert.match(html, new RegExp(`Your site scores ${s.score} out of 100 today\\. There is 1 urgent thing to fix first`));
});

test("each kind of problem is a card in the level of its most urgent issue, with its points and buttons", () => {
    const html = buildWebReport({ report: sample(), links: { api: "/api/history/r/" } });
    assert.match(html, /<section class="level" data-p="P1">[\s\S]*data-type="title-missing"[\s\S]*<section class="level later" data-p="P2">[\s\S]*data-type="image-alt-missing"/);
    assert.match(html, /data-type="title-missing" data-area="on-page" data-effort="easy" data-level="P1"/);
    assert.match(html, /<b>\+<i class="g">\d+<\/i><\/b><span>points<\/span>/);
    assert.match(html, /Search results show the URL\./, "what visitors face (the standard line comes from the guidance)");
    assert.match(html, /class="btn small primary fixit">I fixed it/);
    assert.match(html, /class="btn small check">Check it now/);
    assert.match(html, /<input type="checkbox" data-fix="ISS-0000000002">/);
});

test("Check it now and saved progress only on the live page; the downloaded file keeps ticks in the browser", () => {
    const live = buildWebReport({ report: sample(), links: { api: "/api/history/r/" } });
    assert.equal(dataOf(live).api, "/api/history/r/");
    const file = buildWebReport({ report: sample(), standalone: true, links: { api: "/api/history/r/" } });
    assert.equal(dataOf(file).api, null);
    assert.ok(!file.includes('class="btn small check"'), "no Check it now button");
    assert.ok(!file.includes("/api/history/"));
});

test("the page's data carries facts only from the report, safely embedded", () => {
    const r = sample();
    r.types[0].title = "</script><script>alert(1)</script>";
    const html = buildWebReport({ report: r });
    assert.equal((html.match(/<\/script>/g) || []).length, 2, "only the data block and SiteFix's script end a script");
    const d = dataOf(html);
    assert.deepEqual(d.issues.map((i) => [i.id, i.t, i.p]), [["ISS-0000000001", "title-missing", "P1"], ["ISS-0000000002", "image-alt-missing", "P2"], ["ISS-0000000003", "image-alt-missing", "P3"]]);
    assert.equal(d.types[0].title, "</script><script>alert(1)</script>");
    assert.ok(d.bank.intro.includes("{score}"), "messages travel as templates; the page fills in the numbers");
});

test("the coach's AI words are used when the report has them; old reports get the standard ones", () => {
    const r = sample();
    r.coach = { source: "ai", bank: { intro: "Hello {site}, you are at {score}.", welcomeBack: "Back: {score}.", level: { 1: "Urgent: {count} left.", 2: "Two: {count}.", 3: "Three: {count}.", 4: "All done." }, levelUp: { 2: "Up {score}", 3: "Up {score}", 4: "Up {score}" }, afterMark: "a {issue}", afterVerify: "b {issue}", stillThere: "c {issue}", nextUp: "d {issue}", types: { "title-missing": { visitor: "People see a bare address.", nudge: "Easy, {gain} points." } } } };
    const html = buildWebReport({ report: r });
    assert.match(html, /Hello example\.com, you are at \d+\./);
    assert.match(html, /People see a bare address\./);
    assert.match(html, /Easy, \d+ points?\./);
    assert.match(html, /Images without alt\.|Image has no alt text/, "a type the AI left out still gets a card");
    assert.match(html, /SiteFix's messages are worded by AI/);
});

test("print keeps everything readable: details open, buttons and messages hidden", () => {
    const html = buildWebReport({ report: sample() });
    assert.match(html, /@media print\{\.actions,\.feed,\.filters,\.c-act,\.inst-act/);
    assert.match(html, /beforeprint/);
    assert.match(html, /onclick="window\.print\(\)">Print/);
});
