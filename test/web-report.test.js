import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWebReport, reportFileName, fixFirst } from "../lib/web-report.js";

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
    assert.match(html, /<option>Content writer<\/option><option>Developer<\/option>/);
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
