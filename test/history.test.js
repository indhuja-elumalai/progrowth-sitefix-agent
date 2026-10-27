import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHistory, isRunId, summarize, cleanProgress } from "../lib/history.js";

const SHOT = "ISS-0123456789.jpg";

// A project root with one crawl (and optionally its report) in it, like after crawl.js + report.js.
async function project({ id = "run-20261019T101500", withReport = true, startedAt = "2026-10-19T10:15:00.000Z", reportFor } = {}) {
    const root = await mkdtemp(path.join(tmpdir(), "sitefix-hist-"));
    await writeCrawl(root, { id, startedAt });
    if (withReport) await writeReport(root, reportFor || id);
    return root;
}
async function writeCrawl(root, { id, startedAt = "2026-10-19T10:15:00.000Z", url = "https://example.com/" }) {
    const registry = {
        schemaVersion: 1,
        run: { id, startedAt, finishedAt: startedAt, startUrl: url, pagesCrawled: 12 },
        counts: { total: 2, bySeverity: { high: 1, low: 1 } },
        issues: [{ id: "ISS-0123456789", type: "image-broken" }, { id: "ISS-abcdefabcd", type: "lang-missing" }],
    };
    await writeFile(path.join(root, "issues.json"), JSON.stringify(registry));
}
async function writeReport(root, id) {
    await mkdir(path.join(root, "audit-report", "shots"), { recursive: true });
    const report = {
        run: { id },
        ai: { provider: "mock", model: "mock-1" },
        summary: { byPriority: { P1: 1, P2: 0, P3: 1 }, quickWins: 1 },
        types: [{ type: "image-broken", issues: [{ id: "ISS-0123456789", screenshot: `shots/${SHOT}` }] }],
    };
    await writeFile(path.join(root, "audit-report", "explained.json"), JSON.stringify(report));
    await writeFile(path.join(root, "audit-report", "sitefix-report.pdf"), "%PDF-1.4 test");
    await writeFile(path.join(root, "audit-report", "shots", SHOT), "jpg");
    await writeFile(path.join(root, "audit-report", "shots", "ISS-ffffffffff.jpg"), "from an older run");
}

test("isRunId accepts only crawl.js ids, so no path can escape the history folder", () => {
    assert.ok(isRunId("run-20261019T155140"));
    for (const bad of ["../etc", "run-2026", "run-20261019T155140/../../x", "", null, "RUN-20261019T155140", "run-20261019T155140.json"]) assert.equal(isRunId(bad), false, String(bad));
});

test("sync saves the latest crawl with its report, PDF and only its own screenshots", async () => {
    const root = await project();
    const h = createHistory({ root });
    const meta = await h.sync();
    assert.equal(meta.id, "run-20261019T101500");
    assert.equal(meta.host, "example.com");
    assert.equal(meta.total, 2);
    assert.deepEqual(meta.byPriority, { P1: 1, P2: 0, P3: 1 });
    assert.equal(meta.hasReport, true);
    assert.equal(meta.hasPdf, true);
    const dir = path.join(root, "history", meta.id);
    assert.deepEqual((await readdir(path.join(dir, "shots"))).sort(), [SHOT]);
    assert.equal(await readFile(path.join(dir, "report.pdf"), "utf8"), "%PDF-1.4 test");
    const loaded = await h.load(meta.id);
    assert.equal(loaded.registry.issues.length, 2);
    assert.equal(loaded.report.ai.model, "mock-1");
    assert.deepEqual(loaded.chat, []);
});

test("a report from an older crawl is never attached to a newer one", async () => {
    const root = await project({ reportFor: "run-20261018T090000" });
    const meta = await createHistory({ root }).sync();
    assert.equal(meta.hasReport, false);
    assert.equal(meta.hasPdf, false);
    assert.equal(existsSync(path.join(root, "history", meta.id, "explained.json")), false);
});

test("sync completes an inspection when its report is made later, and is a no-op after that", async () => {
    const root = await project({ withReport: false });
    const h = createHistory({ root });
    assert.equal((await h.sync()).hasReport, false);
    await writeReport(root, "run-20261019T101500");
    assert.equal((await h.sync()).hasReport, true);
    assert.equal((await h.sync()).hasReport, true);
    assert.equal((await h.list()).length, 1);
});

test("list is newest first; the oldest are removed beyond the limit", async () => {
    const root = await project({ id: "run-20261019T100000", startedAt: "2026-10-19T10:00:00.000Z", withReport: false });
    const h = createHistory({ root, max: 2 });
    await h.sync();
    await writeCrawl(root, { id: "run-20261019T110000", startedAt: "2026-10-19T11:00:00.000Z" });
    await h.sync();
    assert.deepEqual((await h.list()).map((m) => m.id), ["run-20261019T110000", "run-20261019T100000"]);
    await writeCrawl(root, { id: "run-20261019T120000", startedAt: "2026-10-19T12:00:00.000Z" });
    await h.sync();
    assert.deepEqual((await h.list()).map((m) => m.id), ["run-20261019T120000", "run-20261019T110000"]);
});

test("a deleted inspection stays deleted, even though its crawl is still the latest", async () => {
    const root = await project();
    const h = createHistory({ root });
    const { id } = await h.sync();
    assert.equal(await h.remove(id), true);
    assert.equal(await h.load(id), null);
    assert.equal(await h.sync(), null);
    assert.deepEqual(await h.list(), []);
    assert.equal(await h.remove(id), false);
});

test("delete all removes every inspection and does not bring the latest back", async () => {
    const root = await project({ id: "run-20261019T100000", withReport: false });
    const h = createHistory({ root });
    await h.sync();
    await writeCrawl(root, { id: "run-20261019T110000", startedAt: "2026-10-19T11:00:00.000Z" });
    await h.sync();
    assert.equal(await h.removeAll(), 2);
    assert.equal(await h.sync(), null);
    assert.deepEqual(await h.list(), []);
    await writeCrawl(root, { id: "run-20261019T120000", startedAt: "2026-10-19T12:00:00.000Z" });
    assert.equal((await h.sync()).id, "run-20261019T120000"); // a new crawl is saved as usual
});

test("chat is saved per inspection, only for inspections that exist", async () => {
    const root = await project();
    const h = createHistory({ root });
    const { id } = await h.sync();
    assert.equal(await h.appendChat(id, { question: "How many pages?", answer: "12", issueIds: [] }), true);
    assert.equal(await h.appendChat("run-20200101T000000", { question: "x", answer: "y" }), false);
    const { chat } = await h.load(id);
    assert.equal(chat.length, 1);
    assert.equal(chat[0].question, "How many pages?");
    assert.ok(chat[0].at);
});

test("file() serves only the PDF and well-formed screenshot names", async () => {
    const root = await project();
    const h = createHistory({ root });
    const { id } = await h.sync();
    assert.equal(h.file(id, "report.pdf"), path.join(root, "history", id, "report.pdf"));
    assert.equal(h.file(id, `shots/${SHOT}`), path.join(root, "history", id, "shots", SHOT));
    for (const bad of ["../issues.json", "shots/../../.env", "meta.json", "shots/x.jpg"]) assert.throws(() => h.file(id, bad), /bad file name/);
    assert.throws(() => h.file("../x", "report.pdf"), /bad inspection id/);
});

test("summarize works without a report", () => {
    const m = summarize({ run: { id: "run-20261019T101500", startUrl: "not a url" }, issues: [{}, {}, {}] }, null);
    assert.equal(m.total, 3);
    assert.equal(m.host, "not a url");
    assert.equal(m.hasReport, false);
    assert.equal(m.byPriority, null);
});

test("setShot records a screenshot taken later in the saved report; queued writes never clash", async () => {
    const root = await project();
    const h = createHistory({ root });
    const { id } = await h.sync();
    const results = await Promise.all([h.setShot(id, "ISS-0123456789"), h.setShot(id, "ISS-abcdefabcd"), h.setShot(id, "ISS-0123456789")]);
    assert.deepEqual(results, [true, false, true], "an issue that is not in the report is not recorded");
    const { report } = await h.load(id);
    assert.equal(report.types[0].issues[0].screenshot, `shots/${SHOT}`);
    assert.throws(() => h.setShot("../x", "ISS-0123456789"), /bad inspection id/);
});

test("the live report's progress is saved with the inspection, cleaned, and the last save wins", async () => {
    const root = await project();
    const h = createHistory({ root });
    await h.sync();
    const id = "run-20261019T101500";
    assert.deepEqual(await h.getProgress(id), { fixed: {}, posts: [], visits: 0, last: 0 });
    await Promise.all([
        h.setProgress(id, { fixed: { "ISS-0123456789": "marked" }, visits: 1 }),
        h.setProgress(id, { fixed: { "ISS-0123456789": "verified", "ISS-abcdefabcd": "marked", "../../etc": "marked", "ISS-ffffffffff": "hacked" }, posts: [{ at: 1, text: "Hi", action: { type: "lang-missing" } }, { at: 2, text: 5 }, { at: 3, text: "x", action: { type: "<b>" } }], visits: 2, last: 9 }),
    ]);
    assert.deepEqual(await h.getProgress(id), {
        fixed: { "ISS-0123456789": "verified", "ISS-abcdefabcd": "marked" },
        posts: [{ at: 1, text: "Hi", action: { type: "lang-missing" } }, { at: 3, text: "x", action: null }],
        visits: 2, last: 9,
    });
    assert.equal(await h.getProgress("run-20990101T000000"), null);
    assert.equal(await h.setProgress("run-20990101T000000", {}), false, "no folder is made for an unknown inspection");
    assert.equal(cleanProgress({ posts: Array.from({ length: 50 }, (_, k) => ({ at: k, text: "a".repeat(900) })) }).posts.length, 30);
    assert.equal(cleanProgress({ posts: [{ at: 1, text: "a".repeat(900) }] }).posts[0].text.length, 400);
});
