import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWebReport, reportFileName, fixFirst, bandOf, BANDS } from "../lib/web-report.js";
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
    assert.match(html, /Content writer · 1 issue · worth/, "who fixes it");
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

// ---------- the live report (Day 29) ----------
const dataOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="sf-data">([\s\S]*?)<\/script>/)[1]);

test("the page is an app: Fix and All issues tabs, the score always in the top bar", () => {
    const r = sample();
    const html = buildWebReport({ report: r });
    const s = siteScore(r.types.flatMap((t) => t.issues), []);
    for (const t of ["fix", "issues"]) {
        assert.match(html, new RegExp(`data-tab="${t}"`));
        assert.match(html, new RegExp(`<section class="panel" id="panel-${t}" role="tabpanel"`));
    }
    assert.ok(!html.includes('data-tab="progress"'));
    assert.match(html, new RegExp(`<div class="spill" aria-live="polite"><span>Score</span><b id="sp-now">${s.score}</b>`));
    assert.match(html, /All issues <span class="n">2<\/span>/);
    assert.match(html, /id="q" placeholder="Search problems or pages"/, "search, filters and sorting live in All issues");
});

test("the Fix tab: score ring (today and with the selection), SiteFix's message, sorting and the three areas", () => {
    const r = sample();
    const html = buildWebReport({ report: r });
    const s = siteScore(r.types.flatMap((t) => t.issues), []);
    assert.match(html, new RegExp(`<div class="g-num"><b>${s.score}</b><span class="g-band-name b\\d">`), "the score meter");
    assert.match(html, /Tick fixes below to see your score climb/);
    assert.match(html, new RegExp(`Your site scores ${s.score} out of 100 today\\. There is 1 urgent thing to fix first`));
    for (const k of ["rec", "quick", "boost", "urgent"]) assert.match(html, new RegExp(`data-sort="${k}"`));
    for (const a of ["on-page", "technical", "off-page"]) assert.match(html, new RegExp(`<button type="button" data-area="${a}"`));
    assert.match(html, /<div class="cols" id="cols"><\/div>/);
});

test("the selection bar: Fix these is shown but not active until the fix stage", () => {
    const html = buildWebReport({ report: sample(), links: { api: "/api/history/r/" } });
    assert.match(html, /<button type="button" class="btn primary" id="sb-fix" disabled aria-describedby="sb-soon">Fix these<\/button><small id="sb-soon">Automatic fixing is coming soon<\/small>/);
    assert.equal(dataOf(html).fix, null);
    const later = buildWebReport({ report: sample(), links: { api: "/api/history/r/", fix: "/api/history/r/fix" } });
    assert.equal(dataOf(later).fix, "/api/history/r/fix", "the fix stage turns the button on with one link");
    assert.equal(dataOf(buildWebReport({ report: sample(), standalone: true, links: { fix: "/x" } })).fix, null);
});

test("each kind of problem carries the facts the page needs, from the report only", () => {
    const r = sample();
    r.types[0].issues[0].fixClass = "ai-proposed";
    r.types[1].issues.forEach((i) => { i.fixClass = "not-automatable"; });
    const d = dataOf(buildWebReport({ report: r }));
    assert.deepEqual(d.types.map((t) => [t.type, t.level, t.area, t.effort, t.owner, t.pages, t.ids, t.canFix]), [
        ["title-missing", "P1", "on-page", "easy", "Content writer", 1, ["ISS-0000000001"], true],
        ["image-alt-missing", "P2", "on-page", "easy", "Developer", 3, ["ISS-0000000002", "ISS-0000000003"], false],
    ]);
    assert.equal(d.types[0].visitor, "Search results show the URL.", "what visitors face: the standard line comes from the guidance");
    assert.deepEqual(d.issues.map((i) => [i.id, i.t, i.p]), [["ISS-0000000001", "title-missing", "P1"], ["ISS-0000000002", "image-alt-missing", "P2"], ["ISS-0000000003", "image-alt-missing", "P3"]]);
    assert.ok(d.bank.afterSelect.includes("{score}"), "messages travel as templates");
});

test("the full detail of every kind is on the page, for the fix panel, print and no JavaScript", () => {
    const html = buildWebReport({ report: sample() });
    assert.match(html, /<div class="full"><h2>Level 1 · Urgent fixes<\/h2>\n<section class="tdetail" id="t-title-missing" data-type="title-missing" data-area="on-page" data-effort="easy" data-level="P1">/);
    assert.match(html, /<h2>Level 2 · Important fixes<\/h2>\n<section class="tdetail" id="t-image-alt-missing"/);
    assert.match(html, /<div class="fix"><div class="k">How to fix<\/div><ol><li>Add a title\.<\/li><\/ol><\/div>/);
    assert.match(html, /<input type="checkbox" data-sel-id="ISS-0000000002"> Include this page in the fix/, "each page can be selected on its own");
    assert.match(html, /<html lang="en" class="nojs">/);
    assert.match(html, /\.nojs \.full\{display:block\}/);
    assert.match(html, /@media print\{\.top,\.app,\.drawer,\.scrim,\.toast,\.selbar/);
});

test("checking the live site and saved progress only on the live page; the download keeps the selection in the browser", () => {
    const live = buildWebReport({ report: sample(), links: { api: "/api/history/r/" } });
    assert.equal(dataOf(live).api, "/api/history/r/");
    assert.match(live, /id="dr-check">Fixed it yourself\? Check your live site<\/button>/);
    const file = buildWebReport({ report: sample(), standalone: true, links: { api: "/api/history/r/" } });
    assert.equal(dataOf(file).api, null);
    assert.ok(!file.includes('id="dr-check"'));
    assert.ok(!file.includes("/api/history/"));
    assert.match(file, /id="dr-sel">Select this fix/);
});

test("the page's data is safely embedded", () => {
    const r = sample();
    r.types[0].title = "</script><script>alert(1)</script>";
    const html = buildWebReport({ report: r });
    assert.equal((html.match(/<\/script>/g) || []).length, 2, "only the data block and SiteFix's script end a script");
    assert.equal(dataOf(html).types[0].title, "</script><script>alert(1)</script>");
});

test("the coach's AI words are used when the report has them; missing ones get the standard text", () => {
    const r = sample();
    r.coach = { source: "ai", bank: { intro: "Hello {site}, you are at {score}.", welcomeBack: "Back: {score}.", level: { 1: "Urgent: {count} left.", 2: "Two: {count}.", 3: "Three: {count}.", 4: "All done." }, levelUp: { 2: "Up {score}", 3: "Up {score}", 4: "Up {score}" }, afterMark: "a {issue}", afterVerify: "b {issue}", stillThere: "c {issue}", nextUp: "d {issue}", types: { "title-missing": { visitor: "People see a bare address.", nudge: "Easy, {gain} points." } } } };
    const html = buildWebReport({ report: r });
    assert.match(html, /Hello example\.com, you are at \d+\./);
    const d = dataOf(html);
    assert.equal(d.types[0].visitor, "People see a bare address.");
    assert.ok(d.types[1].visitor.length > 8, "a kind the AI left out still gets a line");
    assert.match(d.bank.afterSelect, /\{count\} fixes selected/, "reports made before selecting existed get the standard message");
    assert.match(html, /SiteFix's messages are worded by AI/);
});

test("the site's name is the page heading, and the score meter has four bands", () => {
    const html = buildWebReport({ report: sample() });
    assert.match(html, /<div class="site-h"><h1>example\.com<\/h1><a href="https:\/\/example\.com\/" target="_blank" rel="noopener noreferrer">Visit site/);
    assert.equal((html.match(/<path class="g-band b\d"/g) || []).length, 4);
    assert.deepEqual([0, 49, 50, 69, 70, 84, 85, 100].map((v) => bandOf(v).name), ["Needs work", "Needs work", "Fair", "Fair", "Good", "Good", "Excellent", "Excellent"]);
    assert.deepEqual(BANDS.map((b) => [b.min, b.max]), [[0, 49], [50, 69], [70, 84], [85, 100]], "the bands cover 0 to 100 with no gap");
});

test("Download, PDF and Print are in the Export menu, which closes on any click elsewhere or after choosing", () => {
    const html = buildWebReport({ report: sample(), links: { pdf: "/p.pdf", download: "/d" } });
    assert.match(html, /<details class="export"><summary>Export<\/summary>/);
    assert.match(html, /<button type="button" data-print>Print/);
    assert.match(html, /if \(ex && ex\.open && !ex\.contains\(e\.target\)\) closeExport\(\);/);
});
