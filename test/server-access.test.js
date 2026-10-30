// The UI server keeps every workspace to its own sites (lib/profiles.js): it is started
// here with its own history and workspaces in a temp folder.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COM = "run-20261030T100000", ORG = "run-20261030T110000";
let server, base, dir;

async function inspection(hist, id, url) {
    const d = path.join(hist, id);
    await mkdir(d, { recursive: true });
    const issues = [{ id: "ISS-0000000001", type: "title-missing", severity: "high", priority: "P1" }, { id: "ISS-0000000002", type: "og-missing", severity: "low", priority: "P3" }];
    const run = { id, startedAt: `2026-10-30T${id.slice(13, 15)}:00:00.000Z`, startUrl: url, pagesCrawled: 3 };
    await writeFile(path.join(d, "issues.json"), JSON.stringify({ run, counts: { total: 2, bySeverity: { high: 1, low: 1 } }, issues }));
    await writeFile(path.join(d, "explained.json"), JSON.stringify({ run, summary: {}, types: [{ type: "title-missing", title: "Page has no title", issues: [issues[0]] }, { type: "og-missing", title: "No sharing tags", issues: [issues[1]] }] }));
    await writeFile(path.join(d, "meta.json"), JSON.stringify({ id, url, host: new URL(url).host, startedAt: run.startedAt, total: 2, bySeverity: {}, hasReport: true, hasPdf: false }));
}

before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sitefix-srv-"));
    const hist = path.join(dir, "history");
    await inspection(hist, COM, "https://www.example.com/");
    await inspection(hist, ORG, "https://example.org/");
    const port = 3900 + Math.floor(Math.random() * 500);
    server = spawn("node", ["ui/server.js", "--port", String(port)], { cwd: ROOT, env: { ...process.env, SITEFIX_HISTORY_DIR: hist, SITEFIX_PROFILES: path.join(dir, "profiles.json") }, stdio: ["ignore", "pipe", "pipe"] });
    base = `http://127.0.0.1:${port}`;
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("server did not start")), 15000);
        server.stdout.on("data", (d) => { if (String(d).includes("SiteFix UI")) { clearTimeout(t); resolve(); } });
        server.on("exit", (c) => reject(new Error(`server exited ${c}`)));
    });
});
after(() => server?.kill());

const call = async (method, p, { cookie, body } = {}) => {
    const r = await fetch(base + p, { method, redirect: "manual", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json, text, setCookie: r.headers.get("set-cookie") };
};
async function signIn(name, site) {
    const r = await call("POST", "/api/profile", { body: { name, site } });
    assert.equal(r.status, 200);
    assert.match(r.setCookie, /^sitefix_profile=[0-9a-f]{32}; Path=\/; HttpOnly; SameSite=Lax/);
    return r.setCookie.split(";")[0];
}

test("signed out: only the page itself and the status answer", async () => {
    assert.equal((await call("GET", "/")).status, 200);
    assert.equal((await call("GET", "/api/status")).status, 200);
    assert.deepEqual((await call("GET", "/api/profile")).json, { profile: null });
    for (const p of ["/api/history", `/api/history/${COM}`, "/api/score", "/api/run/active", "/api/report"]) assert.equal((await call("GET", p)).status, 401, p);
    assert.equal((await call("GET", `/report/${COM}`)).status, 401);
    assert.equal((await call("GET", "/api/history", { cookie: "sitefix_profile=" + "0".repeat(32) })).status, 401);
    assert.equal((await call("POST", "/api/profile", { body: { name: "", site: "example.com" } })).status, 400);
    assert.equal((await call("POST", "/api/profile", { body: { name: "A", site: "not a site" } })).status, 400);
});

test("a workspace sees and opens its own site's inspections only", async () => {
    const a = await signIn("Ann", "example.com");
    const list = (await call("GET", "/api/history", { cookie: a })).json.inspections.map((m) => m.id);
    assert.deepEqual(list, [COM]);
    assert.equal((await call("GET", "/api/history?site=example.org", { cookie: a })).status, 403);
    assert.equal((await call("GET", `/api/history/${COM}`, { cookie: a })).status, 200);
    assert.equal((await call("GET", `/report/${COM}`, { cookie: a })).status, 200);
    for (const p of [`/api/history/${ORG}`, `/api/history/${ORG}/score`, `/api/history/${ORG}/progress`, `/api/history/${ORG}/report.pdf`]) assert.equal((await call("GET", p, { cookie: a })).status, 403, p);
    assert.equal((await call("GET", `/report/${ORG}`, { cookie: a })).status, 403);
    assert.equal((await call("GET", `/report/${ORG}/download`, { cookie: a })).status, 403);
    assert.equal((await call("PUT", `/api/history/${ORG}/progress`, { cookie: a, body: { selected: {} } })).status, 403);
    assert.equal((await call("DELETE", `/api/history/${ORG}`, { cookie: a })).status, 403);
    assert.equal((await call("POST", "/api/ask", { cookie: a, body: { question: "what's my score", inspectionId: ORG } })).status, 403);
    // Another site can't be inspected until it is added.
    const run = await call("POST", "/api/run", { cookie: a, body: { url: "https://example.org/" } });
    assert.equal(run.status, 403);
    assert.match(run.json.error, /Add example\.org as a site first/);
});

test("the score: in the topbar, per inspection, and as an answer in the chat", async () => {
    const a = await signIn("Ann", "https://example.com/");
    const s = (await call("GET", "/api/score", { cookie: a })).json;
    assert.equal(s.id, COM);
    assert.equal(typeof s.score, "number");
    assert.deepEqual((await call("GET", `/api/history/${COM}/score`, { cookie: a })).json.score, s.score);
    // Fixes confirmed in the report count.
    await call("PUT", `/api/history/${COM}/progress`, { cookie: a, body: { verified: { "ISS-0000000001": Date.now() } } });
    assert.ok((await call("GET", "/api/score", { cookie: a })).json.score > s.score);
    const ans = (await call("POST", "/api/ask", { cookie: a, body: { question: "What's my score?", inspectionId: COM } })).json;
    assert.equal(ans.source, "score");
    assert.match(ans.answer, /Your score today is \*\*\d+\*\*/);
    assert.equal((await call("GET", "/api/score?site=example.org", { cookie: a })).status, 403);
});

test("adding and switching sites; two workspaces with the same site share its inspections", async () => {
    const b = await signIn("Bo", "example.org");
    assert.deepEqual((await call("GET", "/api/history", { cookie: b })).json.inspections.map((m) => m.id), [ORG]);
    const added = (await call("POST", "/api/profile/sites", { cookie: b, body: { site: "www.example.com" } })).json.profile;
    assert.deepEqual(added.sites, ["https://example.org/", "https://www.example.com/"]);
    assert.equal(added.activeSite, "https://www.example.com/");
    assert.deepEqual((await call("GET", "/api/history", { cookie: b })).json.inspections.map((m) => m.id).sort(), [COM, ORG]);
    assert.deepEqual((await call("GET", "/api/history?site=example.com", { cookie: b })).json.inspections.map((m) => m.id), [COM]);
    assert.equal((await call("PUT", "/api/profile/active", { cookie: b, body: { site: "example.org" } })).json.profile.activeSite, "https://example.org/");
    assert.equal((await call("PUT", "/api/profile/active", { cookie: b, body: { site: "elsewhere.net" } })).status, 403);
    assert.equal((await call("POST", "/api/profile/sites", { cookie: b, body: { site: "nope" } })).status, 400);
    // Delete all is one site's inspections only, and needs the site.
    assert.equal((await call("DELETE", "/api/history", { cookie: b })).status, 400);
    assert.equal((await call("DELETE", "/api/history?site=example.org", { cookie: b })).json.deleted, 1);
    assert.deepEqual((await call("GET", "/api/history", { cookie: b })).json.inspections.map((m) => m.id), [COM]);
    assert.ok((await readdir(path.join(dir, "history"))).includes(COM));
    // Signing out forgets the workspace in this browser.
    assert.match((await call("POST", "/api/profile/signout", { cookie: b })).setCookie, /Max-Age=0/);
});
