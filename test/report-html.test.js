import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportHtml, evidenceFacts, MAX_INSTANCES_IN_PDF } from "../lib/report-html.js";

const inst = (n, over = {}) => ({ id: `ISS-${String(n).padStart(10, "0")}`, type: "image-broken", category: "Images", priority: "P1", effort: "easy", owner: "Developer", quickWin: true, affectedUrl: `https://x.test/i${n}.png`, foundOn: ["https://x.test/"], detail: "Image returns 404", explanation: `Image ${n} <b>is</b> broken`, suggestedValue: null, evidence: { kind: "image", src: `https://x.test/i${n}.png`, status: 404 }, ...over });
const report = (issues) => ({
    generatedAt: "2026-10-18T10:00:00Z", run: { startUrl: "https://x.test/", pagesCrawled: 3, finishedAt: "2026-10-18T09:00:00Z" },
    ai: { provider: "mock", model: "mock", standardTypes: 0 }, summary: { byPriority: { P1: issues.length, P2: 0, P3: 0 }, quickWins: issues.length },
    types: [{ type: "image-broken", category: "Images", title: "Broken image", summary: "An image does not load.", why: "Visitors see a gap.", fixSteps: ["Upload it again."], valueLabel: null, issues }],
});

test("cover, category table, fix-first list and one section per type", () => {
    const html = buildReportHtml({ report: report([inst(1)]) });
    assert.match(html, /<h1>https:\/\/x\.test\/<\/h1>/);
    assert.match(html, /Issues by category/);
    assert.match(html, /Fix these first/);
    assert.match(html, /<h2>Broken image<\/h2>/);
    assert.match(html, /How to fix/);
    assert.match(html, /Explanations are written by AI/);
});

test("everything from the data is escaped (no HTML injection from page content)", () => {
    const html = buildReportHtml({ report: report([inst(1)]) });
    assert.match(html, /Image 1 &lt;b&gt;is&lt;\/b&gt; broken/);
    assert.doesNotMatch(html, /Image 1 <b>is<\/b>/);
});

test("screenshots and suggested values appear when present", () => {
    const html = buildReportHtml({ report: report([inst(1, { suggestedValue: "Team photo" })]), shots: new Map([["ISS-0000000001", "data:image/jpeg;base64,AAAA"]]) });
    assert.match(html, /<img src="data:image\/jpeg;base64,AAAA"/);
    assert.match(html, /Team photo/);
});

test(`long lists are capped at ${MAX_INSTANCES_IN_PDF} per type with a count of the rest`, () => {
    const html = buildReportHtml({ report: report(Array.from({ length: MAX_INSTANCES_IN_PDF + 3 }, (_, n) => inst(n))) });
    assert.equal((html.match(/class="inst"/g) || []).length, MAX_INSTANCES_IN_PDF);
    assert.match(html, /and 3 more of this type/);
});

test("speed evidence: the issue's own measure first, with the largest files for page weight", () => {
    const rows = evidenceFacts({ kind: "speed", metric: "bytes", lcpMs: 3100, lcpElement: "the image hero.jpg", cls: 0.02, tbtMs: 120, ttfbMs: 400, bytes: 4.2 * 1048576, requests: 88, biggest: [{ url: "https://x.test/v/intro.mp4?x=1", type: "media", bytes: 2.5 * 1048576 }] });
    const heads = [...rows.matchAll(/<th>([^<]+)<\/th>/g)].map((m) => m[1]);
    assert.deepEqual(heads.slice(0, 3), ["Page weight", "Largest files", "Main content (LCP)"]);
    assert.match(rows, /4\.2 MB in 88 files/);
    assert.match(rows, /intro\.mp4 \(2\.5 MB\)/);
});
