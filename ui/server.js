// SiteFix UI server — Node built-ins only, no new npm deps.
// Usage: node ui/server.js [--port 3000]
//
// Endpoints:
//   GET  /               → ui/index.html
//   GET  /api/status     → { ready: true }
//   POST /api/run        → starts a crawl, returns { runId }
//   GET  /api/stream/:id → SSE stream of the run: log lines, plus { progress } and
//                          { finding } messages from lib/progress.js
//   GET  /api/run/active → the inspection running now ({ runId, url, startedAt }) or {}
//   POST /api/run/:id/stop → { now }: stop reading pages and report what was read so far;
//                          with now: true, end at once with no report (run code 130)
//   GET  /api/results    → reads issues.json from cwd and returns it
//   GET  /api/report     → audit-report/explained.json (priorities, explanations, fixes)
//   GET  /api/report.pdf → the PDF report
//   GET  /api/shots/:id  → one screenshot from the report
//   GET  /api/ai-status  → whether AI is on, which provider and model
//   POST /api/ask        → { question, inspectionId?, scope? } → an answer from that inspection only;
//                          asked again, the same facts in other words (lib/phrasing.js)
//   POST /api/say        → { text, question } → the page's own answer in new words, every fact kept
//                          (scope: issue types a follow-up stays within, e.g. the broken images)
//
// History (lib/history.js): every finished inspection is kept in history/<run-id>/.
//   GET    /api/history                  → past inspections, newest first
//   GET    /api/history/:id              → { meta, registry, report, chat }
//   GET    /api/history/:id/report.pdf   → that inspection's PDF, with every screenshot taken
//                                          so far (made again when there are new ones)
//   GET    /api/history/:id/shots/:name  → one of its screenshots
//   GET    /api/history/:id/shot/:issueId → the screenshot for one issue; taken now (and
//                                          kept) when the report has none (lib/screenshots.js)
//   DELETE /api/history/:id              → delete one inspection
//   DELETE /api/history?site=            → delete all of that site's inspections
//   GET    /api/history/:id/score        → its score, counting what was confirmed fixed or kept
//   GET    /api/history/:id/progress     → the live report's progress (what the client fixed, messages)
//   PUT    /api/history/:id/progress     → save it (same origin only, like DELETE)
//   POST   /api/history/:id/verify       → { ids } → checks the live site again for those issues
//                                          (lib/verify.js): { results: { [id]: { status, detail } } }
//   GET    /report/:id                   → the live web report for one inspection (lib/web-report.js)
//   GET    /report/:id/download          → the same report as one file, screenshots built in
// DELETE is same-origin only: the CORS preflight below never allows it.
//
// Workspaces (lib/profiles.js): a name and the website links someone works on. The
// browser keeps its workspace in a cookie; everything else answers 401 without one, and
// 403 for a site that isn't in the workspace (two workspaces with the same site share
// its inspections).
//   GET    /api/profile          → { profile } (null when signed out)
//   POST   /api/profile          → { name, site }: a new workspace, signed in
//   POST   /api/profile/sites    → { site }: add a site; it becomes the active one
//   DELETE /api/profile/sites?site= → remove a site (never the last one)
//   PUT    /api/profile/active   → { site }: switch to another of the workspace's sites
//   POST   /api/profile/signout  → forget the workspace in this browser
//   GET    /api/score?site=      → the site's score from its latest inspection, counting
//                                  what was confirmed fixed or kept (lib/site-score.js)
//   GET    /api/history?site=    → only that site's inspections; DELETE deletes only those
//
// A run is: crawl.js, then (if the crawl succeeded) report.js, both streamed over SSE.
// The crawl writes issues.json (and the other files) to the project root; report.js
// writes audit-report/. AI settings come from .env (see lib/ai-provider.js).

import { createServer } from "node:http";
import { readFile, writeFile, rename, access, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnv } from "../lib/env.js";
import { aiConfig, providerFromConfig } from "../lib/ai-provider.js";
import { answerQuestion, varyAnswer } from "../lib/chat.js";
import { rephrase, sameQuestion, MAX_PHRASE } from "../lib/phrasing.js";
import { createHistory, isRunId } from "../lib/history.js";
import { buildWebReport, reportFileName } from "../lib/web-report.js";
import { buildReportHtml, MAX_INSTANCES_IN_PDF } from "../lib/report-html.js";
import { parseProgressLine } from "../lib/progress.js";
import { shotPlan, createShooter, SHOT_VERSION } from "../lib/screenshots.js";
import { verifyIssues, createRenderer, MAX_VERIFY } from "../lib/verify.js";
import { measurePages } from "../lib/speed.js";
import { createProfiles, sameSite } from "../lib/profiles.js";
import { scoreSummary, answerScoreQuestion } from "../lib/site-score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // project root
const REPORT_DIR = path.join(ROOT, "audit-report");
const history = createHistory({ root: ROOT, dir: process.env.SITEFIX_HISTORY_DIR || undefined, max: Number(process.env.SITEFIX_HISTORY_MAX) || undefined });
const profiles = createProfiles({ file: process.env.SITEFIX_PROFILES || path.join(ROOT, "profiles.json") });
// Screenshots for the chat: one shared browser, two pages at a time, closed when idle.
const shooter = createShooter({ concurrency: 2 });
const shotJobs = new Map(), shotFailed = new Set();

loadEnv(path.join(ROOT, ".env"));
const AI = aiConfig();
const provider = await providerFromConfig(AI);

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const PORT = portArg !== -1 && args[portArg + 1] ? Number(args[portArg + 1]) : 3000;
const TIME_BUDGET = process.env.SITEFIX_TIME_BUDGET !== undefined ? Number(process.env.SITEFIX_TIME_BUDGET) || 0 : 45; // seconds of page reading per inspection
// Bind to loopback only: /api/run spawns a crawler, so it must not be reachable from the network.
const HOST = process.env.SITEFIX_UI_HOST || "127.0.0.1";
// Only one crawl at a time: every run writes issues.json to the same project root.
let activeRunId = null;

// In-memory store of active/completed runs (keyed by runId).
// Each entry: { id, url, lines: string[], done: boolean, exitCode: number|null, subscribers: Set<res> }
const runs = new Map();
const STOPPED_CODE = 130; // the run was stopped with "Stop now": no report, nothing saved

// The workspace cookie. HttpOnly: the page never reads it; SameSite=Lax: another site
// can't start an inspection or delete anything with it.
const COOKIE = "sitefix_profile";
const cookieOf = (req) => (String(req.headers.cookie || "").match(/(?:^|;\s*)sitefix_profile=([0-9a-f]{32})(?:;|$)/) || [])[1] || null;
const cookieFor = (id) => `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
const profileView = (p) => p ? { name: p.name, sites: p.sites, activeSite: p.activeSite } : null;
// The site an inspection belongs to: the address it was asked for (it may have moved to
// another one) and the address it ended up checking; either one gives access.
const inspectionAllowed = (profile, m) => Boolean(m) && (profiles.allows(profile, m.site) || profiles.allows(profile, m.url));
const inspectionOnSite = (m, site) => sameSite(m.site || m.url, site) || sameSite(m.url, site);
// The crawl in the project root (issues.json), and the address each run was asked for.
const askedFor = new Map(); // registry run id -> url asked for
async function latestAllowed(profile) {
  try {
    const run = JSON.parse(await readFile(path.join(ROOT, "issues.json"), "utf8")).run || {};
    return profiles.allows(profile, run.startUrl) || profiles.allows(profile, askedFor.get(run.id));
  } catch { return false; }
}

// Answers: facts from the inspection, new words for the code's answers (counts, lists).
async function answerAndVary({ question, report, scope, previous = [], conversation = [] }) {
  const result = await answerQuestion({ question, report, provider, scope, previous, conversation });
  return result.source === "report data" ? varyAnswer(result, { question, provider, previous }) : result;
}
// /api/say: the last few wordings per question (so the next is different), and at most
// 40 a minute per workspace.
const said = new Map(), sayCount = new Map();
function sayAllowed(id) {
  const now = Date.now(), c = sayCount.get(id);
  if (!c || now - c.at > 60000) { sayCount.set(id, { at: now, n: 1 }); return true; }
  return ++c.n <= 40;
}

function makeRunId() {
  return "ui-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function mime(ext) {
  return { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".jpg": "image/jpeg" }[ext] || "text/plain";
}

// The screenshot of one issue of a saved inspection. When the report has none, the page
// is opened now (the problem outlined), the screenshot kept with the inspection, and the
// report updated. A page that can't be opened is not tried again until a restart.
// One issue's screenshot: true when an up-to-date one is saved (taken now if needed).
// urgent: someone is looking at it, so it goes ahead of the ones taken in advance.
const shotReady = new Set(); // "<run>/<issue>" known to be saved and up to date
async function ensureShot(id, issue, urgent) {
  const key = `${id}/${issue.id}`;
  if (shotReady.has(key)) return true;
  if (shotFailed.has(key)) return false;
  const file = history.file(id, `shots/${issue.id}.jpg`);
  // A saved screenshot is used when it was taken the current way; an older one is
  // taken again (it may not show the problem outlined).
  if (issue.shotVersion === SHOT_VERSION && await access(file).then(() => true, () => false)) { shotReady.add(key); return true; }
  let job = shotJobs.get(key);
  if (!job) {
    const plan = shotPlan(issue);
    if (!plan) { shotFailed.add(key); return false; }
    job = shooter.take(plan, file, { urgent })
      .then(async (ok) => { if (ok) { shotReady.add(key); await history.setShot(id, issue.id, SHOT_VERSION); } else { shotFailed.add(key); await rm(file, { force: true }).catch(() => {}); } return ok; })
      .finally(() => shotJobs.delete(key));
    shotJobs.set(key, job);
  } else if (urgent) shooter.take(shotPlan(issue), file, { urgent: true }); // moves it to the front
  return job;
}

async function issueShot(res, id, issueId) {
  if (!/^ISS-[0-9a-f]{10}$/.test(issueId)) return json(res, 400, { error: "Bad issue id" });
  const file = history.file(id, `shots/${issueId}.jpg`);
  if (shotReady.has(`${id}/${issueId}`)) return serveFile(res, file, true);
  const saved = await history.load(id);
  const issue = saved?.report?.types?.flatMap((t) => t.issues || []).find((i) => i.id === issueId);
  if (!issue) return json(res, 404, { error: "No such issue" });
  return (await ensureShot(id, issue, true)) ? serveFile(res, file, true) : json(res, 404, { error: "The problem could not be found on the page for a screenshot" });
}

// The PDF with every screenshot: report.js puts up to 30 in it; the rest are taken
// later (ahead of time, or when an issue is opened). When the PDF is opened and there are
// screenshots it doesn't have yet, it is made again from the saved report, after waiting
// a few seconds for any of its pages still missing one. The screenshots in it are noted
// (report-pdf.json), so it is only made again when there is something new.
const pdfJobs = new Map();
const PDF_WAIT_MS = 8000;
function inspectionPdf(id) {
  if (!pdfJobs.has(id)) pdfJobs.set(id, makePdf(id).finally(() => pdfJobs.delete(id)));
  return pdfJobs.get(id);
}
async function makePdf(id) {
  const pdfFile = history.file(id, "report.pdf");
  const noteFile = path.join(history.dir, id, "report-pdf.json");
  const first = await history.load(id);
  if (!first?.report) return null;
  // The pages the PDF lists (up to MAX_INSTANCES_IN_PDF of each kind) that can have a screenshot.
  const listed = (r) => (r.types || []).flatMap((t) => (t.issues || []).slice(0, MAX_INSTANCES_IN_PDF)).filter((i) => shotPlan(i));
  await Promise.race([Promise.all(listed(first.report).map((i) => ensureShot(id, i, true).catch(() => false))), new Promise((r) => setTimeout(r, PDF_WAIT_MS))]);
  const saved = await history.load(id);
  const shots = new Map();
  for (const i of listed(saved.report)) {
    if (!i.screenshot || i.shotVersion !== SHOT_VERSION) continue;
    try { shots.set(i.id, `data:image/jpeg;base64,${(await readFile(history.file(id, i.screenshot))).toString("base64")}`); } catch { /* not there: shown without one */ }
  }
  const key = [...shots.keys()].sort().join(",");
  const note = await readFile(noteFile, "utf8").then(JSON.parse, () => null);
  const have = await access(pdfFile).then(() => true, () => false);
  if (have && note?.key === key) return pdfFile; // nothing new since it was made
  if (have && !note && shots.size === 0) return pdfFile; // report.js made it; nothing to add
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(buildReportHtml({ report: saved.report, shots }), { waitUntil: "load" });
    const tmp = `${pdfFile}.${process.pid}.tmp`;
    await page.pdf({ path: tmp, format: "A4", printBackground: true, margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" } });
    await rename(tmp, pdfFile);
    await writeFile(noteFile, JSON.stringify({ key, shots: shots.size, madeAt: new Date().toISOString() }));
  } finally {
    await browser.close().catch(() => {});
  }
  return pdfFile;
}

// Screenshots taken ahead of time, so they are ready when an issue is opened: after an
// inspection finishes and when its report is opened. The first page of each kind of
// problem goes first (that is what the report shows when a fix is opened), most urgent
// kinds first, then the rest. They wait behind any screenshot someone is looking at.
const warming = new Set();
async function warmShots(id) {
  if (warming.has(id)) return;
  warming.add(id);
  try {
    const saved = await history.load(id);
    const types = [...(saved?.report?.types || [])].sort((a, b) => (a.issues?.[0]?.priority || "P3").localeCompare(b.issues?.[0]?.priority || "P3"));
    const firsts = types.map((t) => t.issues?.[0]).filter(Boolean);
    const rest = types.flatMap((t) => (t.issues || []).slice(1));
    const todo = [...firsts, ...rest].filter((i) => shotPlan(i)).slice(0, 500);
    await Promise.all(todo.map((i) => ensureShot(id, i, false).catch(() => false)));
  } finally {
    warming.delete(id);
  }
}

async function serveFile(res, filePath, cache = false) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime(path.extname(filePath)), ...(cache ? { "Cache-Control": "private, max-age=600" } : {}) });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function json(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers });
  res.end(body);
}

function parseBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (d) => { buf += d; if (buf.length > limit) { buf = ""; req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(buf || "{}")); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

// "Check it now" in the live report: one check at a time, so the site (and this
// machine) never gets several browsers at once.
let verifying = Promise.resolve();
async function verifyRequest(req, res, id) {
  const body = await parseBody(req, 50000);
  const ids = new Set((Array.isArray(body.ids) ? body.ids : []).filter((x) => typeof x === "string" && /^ISS-[0-9a-f]{10}$/.test(x)).slice(0, MAX_VERIFY));
  if (!ids.size) return json(res, 400, { error: "No issues to check" });
  const saved = await history.load(id);
  if (!saved?.report) return json(res, 404, { error: "Inspection not found" });
  const issues = (saved.report.types || []).flatMap((t) => t.issues || []).filter((i) => ids.has(i.id));
  const run = async () => {
    const { chromium } = await import("playwright");
    const renderer = createRenderer({ chromium });
    try {
      return await verifyIssues(issues, {
        renderPage: (u) => renderer.render(u),
        measure: async (u) => (await measurePages([u], { chromium, concurrency: 1 }))[0] || null,
        timeBudgetMs: 60000,
      });
    } finally { await renderer.close(); }
  };
  const job = verifying.then(run, run);
  verifying = job.catch(() => {});
  try {
    return json(res, 200, { results: await job, checkedAt: new Date().toISOString() });
  } catch (err) {
    return json(res, 500, { error: `The check could not run: ${err.message}` });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  const pathname = url.pathname;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  // Static assets from ui/
  if (method === "GET" && pathname === "/") {
    return serveFile(res, path.join(__dirname, "index.html"));
  }
  if (method === "GET" && pathname.startsWith("/assets/")) {
    const file = path.resolve(__dirname, "." + pathname);
    if (!file.startsWith(path.join(__dirname, "assets") + path.sep)) return json(res, 403, { error: "Forbidden" });
    return serveFile(res, file);
  }

  // API: health check
  if (method === "GET" && pathname === "/api/status") {
    return json(res, 200, { ready: true, version: "0.6" });
  }

  // Workspaces: signing in with a name and a website link, adding and switching sites.
  const profile = await profiles.get(cookieOf(req));
  if (pathname === "/api/profile" || pathname.startsWith("/api/profile/")) {
    const sub = pathname.slice("/api/profile".length);
    const bad = (err) => json(res, 400, { error: err.message === "bad name" ? "Please enter your name." : err.message === "too many sites" ? "This workspace already has the most sites it can hold." : err.message === "last site" ? "A workspace needs at least one site." : "That doesn't look like a website address. Try something like example.com." });
    if (sub === "" && method === "GET") return json(res, 200, { profile: profileView(profile) });
    if (sub === "" && method === "POST") {
      const body = await parseBody(req);
      try {
        const p = await profiles.create({ name: body.name, site: body.site });
        return json(res, 200, { profile: profileView(p) }, { "Set-Cookie": cookieFor(p.id) });
      } catch (err) { return bad(err); }
    }
    if (sub === "/signout" && method === "POST") return json(res, 200, { signedOut: true }, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    if (!profile) return json(res, 401, { error: "Sign in first." });
    if (sub === "/sites" && method === "POST") {
      const body = await parseBody(req);
      try { return json(res, 200, { profile: profileView(await profiles.addSite(profile.id, body.site)) }); } catch (err) { return bad(err); }
    }
    if (sub === "/sites" && method === "DELETE") {
      try { return json(res, 200, { profile: profileView(await profiles.removeSite(profile.id, url.searchParams.get("site"))) }); } catch (err) { return bad(err); }
    }
    if (sub === "/active" && method === "PUT") {
      const p = await profiles.setActive(profile.id, (await parseBody(req)).site);
      return p ? json(res, 200, { profile: profileView(p) }) : json(res, 403, { error: "That site isn't in your workspace." });
    }
    return json(res, 404, { error: "Not found" });
  }
  // Everything below works on a site, so it needs a workspace.
  if (!profile && (pathname.startsWith("/api/") || pathname.startsWith("/report/")) && pathname !== "/api/ai-status") {
    if (pathname.startsWith("/report/")) {
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Sign in to SiteFix</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;color:#1d1d1f"><h1 style="font-size:22px">Sign in to see this report</h1><p>Reports open for the workspace their site belongs to.</p><p><a href="/">Sign in to SiteFix</a></p>`);
    }
    return json(res, 401, { error: "Sign in first.", signedOut: true });
  }

  // API: the site's score, from its latest inspection with a report
  if (method === "GET" && pathname === "/api/score") {
    const site = url.searchParams.get("site") || profile.activeSite;
    if (!profiles.allows(profile, site)) return json(res, 403, { error: "That site isn't in your workspace." });
    await history.sync();
    const m = (await history.list()).find((x) => x.hasReport && inspectionOnSite(x, site));
    if (!m) return json(res, 200, { score: null });
    const saved = await history.load(m.id);
    if (!saved?.report) return json(res, 200, { score: null });
    return json(res, 200, { ...scoreSummary(saved.report, await history.getProgress(m.id)), id: m.id, startedAt: m.startedAt, url: m.url });
  }

  // API: start a crawl
  if (method === "POST" && pathname === "/api/run") {
    const body = await parseBody(req);
    const siteUrl = (body.url || "").trim();
    let parsed;
    try { parsed = new URL(siteUrl); } catch { parsed = null; }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
      return json(res, 400, { error: "A valid http:// or https:// URL is required" });
    }
    if (!profiles.allows(profile, siteUrl)) {
      return json(res, 403, { error: `This workspace can only inspect its own sites. Add ${parsed.host.replace(/^www\./, "")} as a site first.` });
    }
    if (activeRunId) {
      const other = runs.get(activeRunId);
      return json(res, 409, { error: other && profiles.allows(profile, other.url) ? "An inspection is already running. Wait for it to finish." : "SiteFix is checking another site right now. Please try again in a minute or two." });
    }

    const runId = makeRunId();
    const entry = { id: runId, url: siteUrl, startedAt: new Date().toISOString(), lines: [], progress: null, findings: [], done: false, exitCode: null, subscribers: new Set() };
    runs.set(runId, entry);

    // Start the crawler as a child process
    // No page cap unless the caller asks for one: the crawler covers the whole site.
    const maxPages = parseInt(body.maxPages, 10);
    const crawlArgs = ["crawl.js", siteUrl];
    if (maxPages > 0) crawlArgs.push("--max-pages", String(maxPages));
    // A time budget for reading pages, so an inspection from the chat stays around a
    // minute or two even on a site with thousands of pages (a share of every section is
    // read). SITEFIX_TIME_BUDGET=0 reads every page, however long it takes.
    if (TIME_BUDGET > 0) crawlArgs.push("--time-budget", String(TIME_BUDGET), "--speed-seconds", "30");
    activeRunId = runId;
    // SITEFIX_PROGRESS=1: the crawler and report also print structured progress lines.
    const childEnv = { ...process.env, SITEFIX_PROGRESS: "1" };
    const child = spawn("node", crawlArgs, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
    entry.child = child;

    function send(msg) {
      for (const sub of entry.subscribers) {
        try { sub.write(`data: ${JSON.stringify(msg)}\n\n`); } catch { /* ignore */ }
      }
    }
    function broadcast(line) {
      const p = parseProgressLine(line);
      if (p && p.kind === "progress") {
        // The report step starts its own counts; keep the crawl's issue totals.
        entry.progress = p.phase && ["report", "pdf", "report-done"].includes(p.phase) && entry.progress ? { ...p, issues: entry.progress.issues, pages: entry.progress.pages } : p;
        return send({ progress: entry.progress });
      }
      if (p && p.kind === "finding") {
        if (entry.findings.length < 400) entry.findings.push(p);
        return send({ finding: p });
      }
      entry.lines.push(line);
      if (entry.lines.length > 5000) entry.lines.splice(0, entry.lines.length - 5000); // keep memory bounded on huge sites
      send({ line });
    }

    // Output arrives in chunks that can end in the middle of a line: keep the tail.
    const lineReader = () => {
      let tail = "";
      return (chunk) => {
        const parts = (tail + chunk.toString()).split("\n");
        tail = parts.pop();
        for (const line of parts) if (line.trim()) broadcast(line);
      };
    };

    function finish(code) {
      entry.done = true;
      entry.exitCode = code;
      if (activeRunId === runId) activeRunId = null;
      broadcast(`__DONE__:${code}`);
      for (const sub of entry.subscribers) {
        try { sub.end(); } catch { /* ignore */ }
      }
      entry.subscribers.clear();
    }

    child.stdout.on("data", lineReader());
    child.stderr.on("data", lineReader());
    child.on("close", async (code) => {
      // Remember which address this crawl was asked for (it may have moved to another).
      try { const id = JSON.parse(await readFile(path.join(ROOT, "issues.json"), "utf8")).run?.id; if (id) askedFor.set(id, siteUrl); } catch { /* no crawl written */ }
      if (entry.cancelled) return finish(STOPPED_CODE);
      if (code !== 0) return finish(code);
      // The crawl worked: build the explained report and PDF. A report failure
      // does not hide the crawl results; the UI shows them without the extras.
      const report = spawn("node", ["report.js"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
      entry.reportChild = report;
      report.stdout.on("data", lineReader());
      report.stderr.on("data", lineReader());
      report.on("close", async (rcode) => {
        if (entry.cancelled) return finish(STOPPED_CODE); // stopped with no report: nothing is saved
        entry.reportCode = rcode;
        broadcast(`__REPORT__:${rcode}`);
        // Keep this inspection: it stays in the sidebar after a reload or restart.
        try {
          const meta = await history.sync();
          if (meta?.id) await history.tag(meta.id, { site: siteUrl });
          if (meta?.id) warmShots(meta.id).catch(() => {});
          if (meta) { entry.inspectionId = meta.id; broadcast(`__SAVED__:${meta.id}`); }
        } catch (err) {
          broadcast(`Could not save this inspection to history: ${err.message}`);
        }
        finish(0);
      });
    });

    return json(res, 200, { runId });
  }

  // API: SSE stream for a run
  if (method === "GET" && pathname.startsWith("/api/stream/")) {
    const runId = pathname.slice("/api/stream/".length);
    const entry = runs.get(runId);
    if (!entry) return json(res, 404, { error: "Run not found" });
    if (!profiles.allows(profile, entry.url)) return json(res, 403, { error: "That inspection belongs to another site." });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // Replay what happened so far (a page reload reattaches to a running inspection).
    for (const line of entry.lines) {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }
    for (const finding of entry.findings) res.write(`data: ${JSON.stringify({ finding })}\n\n`);
    if (entry.progress) res.write(`data: ${JSON.stringify({ progress: entry.progress })}\n\n`);

    if (entry.done) {
      res.write(`data: ${JSON.stringify({ line: `__DONE__:${entry.exitCode}` })}\n\n`);
      return res.end();
    }

    entry.subscribers.add(res);
    req.on("close", () => entry.subscribers.delete(res));
    return; // keep open
  }

  // API: stop the inspection running now. { now: false }: no new pages are read, and the
  // report covers what was read so far (crawl.js stops on SIGUSR2); once the report is
  // being written it just finishes. { now: true }: everything ends at once, with no
  // report and nothing saved (the run ends with code 130).
  const stopMatch = method === "POST" && pathname.match(/^\/api\/run\/([^/]+)\/stop$/);
  if (stopMatch) {
    const entry = runs.get(stopMatch[1]);
    if (!entry || entry.done) return json(res, 409, { error: "That inspection isn't running." });
    if (!profiles.allows(profile, entry.url)) return json(res, 403, { error: "That inspection belongs to another site." });
    const body = await parseBody(req);
    if (body.now) {
      entry.cancelled = true;
      for (const p of [entry.child, entry.reportChild]) if (p && p.exitCode === null) p.kill("SIGTERM");
      return json(res, 200, { stopping: "now" });
    }
    if (entry.reportChild) return json(res, 200, { stopping: "report" });
    if (!entry.stopping) { entry.stopping = true; entry.child.kill("SIGUSR2"); }
    return json(res, 200, { stopping: "crawl" });
  }

  // API: the inspection running now, so a reloaded page can follow it again
  if (method === "GET" && pathname === "/api/run/active") {
    const entry = activeRunId ? runs.get(activeRunId) : null;
    if (!entry) return json(res, 200, {});
    return json(res, 200, profiles.allows(profile, entry.url) ? { runId: entry.id, url: entry.url, startedAt: entry.startedAt } : { busy: true });
  }

  // API: return the current issues.json
  if (method === "GET" && pathname === "/api/results") {
    const file = path.join(ROOT, "issues.json");
    const runId = url.searchParams.get("runId");
    const entry = runId ? runs.get(runId) : null;
    if (runId && (!entry || !entry.done || entry.exitCode !== 0)) {
      return json(res, 409, { error: "That run has not finished successfully, so there are no results for it" });
    }
    if (entry ? !profiles.allows(profile, entry.url) : !(await latestAllowed(profile))) return json(res, 403, { error: "Those results belong to another site." });
    try {
      await access(file);
      const data = await readFile(file, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(data);
    } catch {
      return json(res, 404, { error: "issues.json not found — run the crawler first" });
    }
    return;
  }

  // The explained report must belong to the crawl in issues.json, never an older one.
  async function currentReport() {
    try {
      const [rep, reg] = await Promise.all([readFile(path.join(REPORT_DIR, "explained.json"), "utf-8"), readFile(path.join(ROOT, "issues.json"), "utf-8")]);
      const report = JSON.parse(rep);
      return report.run?.id && report.run.id === JSON.parse(reg).run?.id ? report : null;
    } catch {
      return null;
    }
  }

  // The latest crawl's files are only for the workspace whose site it was.
  if (method === "GET" && (pathname === "/api/report" || pathname === "/api/report.pdf" || pathname.startsWith("/api/shots/")) && !(await latestAllowed(profile))) {
    return json(res, 403, { error: "That report belongs to another site." });
  }

  // API: explained report (priorities, plain-language explanations, fixes)
  if (method === "GET" && pathname === "/api/report") {
    const report = await currentReport();
    if (!report) return json(res, 404, { error: "No report for the latest inspection yet" });
    return json(res, 200, report);
  }

  // API: the PDF report, opened in the browser
  if (method === "GET" && pathname === "/api/report.pdf") {
    if (!(await currentReport())) return json(res, 404, { error: "No report for the latest inspection yet" });
    try {
      const data = await readFile(path.join(REPORT_DIR, "sitefix-report.pdf"));
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="sitefix-report.pdf"' });
      return res.end(data);
    } catch {
      return json(res, 404, { error: "The PDF was not created (see the run log)" });
    }
  }

  // API: one screenshot (strict name check: no path tricks)
  if (method === "GET" && pathname.startsWith("/api/shots/")) {
    const name = pathname.slice("/api/shots/".length);
    if (!/^ISS-[0-9a-f]{10}\.jpg$/.test(name)) return json(res, 400, { error: "Bad screenshot name" });
    return serveFile(res, path.join(REPORT_DIR, "shots", name));
  }

  // API: is AI on?
  if (method === "GET" && pathname === "/api/ai-status") {
    return json(res, 200, { enabled: Boolean(provider), provider: provider ? provider.name : "none", model: provider ? provider.model : null, problem: provider ? null : AI.problem });
  }

  // API: ask a question about one inspection (the latest one when no id is given).
  // The question and answer are saved with that inspection.
  if (method === "POST" && pathname === "/api/ask") {
    const body = await parseBody(req);
    if (body.inspectionId !== undefined && body.inspectionId !== null) {
      if (!isRunId(body.inspectionId)) return json(res, 400, { error: "Bad inspection id" });
      const saved = await history.load(body.inspectionId);
      if (!saved) return json(res, 404, { error: "That inspection was deleted" });
      if (!inspectionAllowed(profile, saved.meta)) return json(res, 403, { error: "That inspection belongs to another site." });
      if (!saved.report) return json(res, 200, { answer: "This inspection has no explained report (the report step did not finish), so I cannot answer questions about it. Run it again to chat about it.", issueIds: [], source: "none" });
      const scope = Array.isArray(body.scope) ? body.scope.filter((t) => typeof t === "string" && /^[a-z0-9-]{2,40}$/.test(t)).slice(0, 20) : undefined;
      // The same question asked before: the facts stay the same, the words don't.
      const previous = saved.chat.filter((c) => sameQuestion(c.question, body.question)).map((c) => c.answer).slice(-3);
      // The score and how to raise it: exact numbers, counting what was fixed in the report.
      const fixed = answerScoreQuestion(body.question, saved.report, await history.getProgress(body.inspectionId));
      const result = fixed ? await varyAnswer(fixed, { question: body.question, provider, previous }) : await answerAndVary({ question: body.question, report: saved.report, scope, previous, conversation: saved.chat.slice(-4) });
      if (String(body.question || "").trim()) await history.appendChat(body.inspectionId, { question: String(body.question).trim().slice(0, 500), answer: result.answer, issueIds: result.issueIds || [], source: result.source, ...(result.display ? { display: result.display, lead: result.lead, tail: result.tail, more: result.more, moreIds: result.moreIds || [], reportHash: result.reportHash, moreLabel: result.moreLabel, ...(result.scope ? { scope: result.scope } : {}) } : {}) });
      return json(res, 200, result);
    }
    // No inspection of this workspace's site to answer from: a general answer (how SiteFix
    // works, websites in general), never another site's report.
    if (!(await latestAllowed(profile))) return json(res, 200, await answerQuestion({ question: body.question, report: null, provider, site: profile.activeSite }));
    const report = await currentReport();
    const fixed = answerScoreQuestion(body.question, report, null);
    const result = fixed ? await varyAnswer(fixed, { question: body.question, provider }) : await answerAndVary({ question: body.question, report });
    return json(res, 200, result);
  }

  // API: an answer the page worked out itself (how far the inspection is, how long is
  // left), said in new words. Only the words change: lib/phrasing.js keeps every fact.
  if (method === "POST" && pathname === "/api/say") {
    const body = await parseBody(req);
    const text = String(body.text || "").slice(0, MAX_PHRASE), question = String(body.question || "").slice(0, 500);
    if (!text.trim()) return json(res, 400, { error: "Nothing to say" });
    if (!sayAllowed(profile.id)) return json(res, 200, { text, varied: false });
    const key = `${profile.id}|${question.toLowerCase()}`;
    const avoid = said.get(key) || [];
    const r = await rephrase({ text, question, provider, avoid });
    said.delete(key); said.set(key, [...avoid, r.text].slice(-3));
    if (said.size > 2000) said.delete(said.keys().next().value);
    return json(res, 200, r);
  }

  // Web report: /report/:id opens in the browser, /report/:id/download saves one file.
  const reportMatch = method === "GET" && pathname.match(/^\/report\/([^/]+)(\/download)?$/);
  if (reportMatch) {
    const [, id, download] = reportMatch;
    const page = (status, title, text) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;color:#1d1d1f"><h1 style="font-size:22px">${title}</h1><p>${text}</p><p><a href="/">Back to SiteFix</a></p>`);
    };
    if (!isRunId(id)) return page(400, "Not a valid report link", "This link does not point to a SiteFix inspection.");
    const saved = await history.load(id);
    if (!saved) return page(404, "Report not found", "This inspection was deleted, or the link is wrong.");
    if (!inspectionAllowed(profile, saved.meta)) return page(403, "This report is for another site", "Reports open for the workspace their site belongs to. Add the site to your workspace to see it.");
    if (!saved.report) return page(404, "No report for this inspection", "The report step did not finish for this inspection, so there are no explanations to show. Run the inspection again to get a full report.");
    const base = `/api/history/${encodeURIComponent(id)}/`;
    if (!download) {
      warmShots(id).catch(() => {});
      const html = buildWebReport({
        report: saved.report,
        // Through the screenshot endpoint: it serves the saved one, or takes it again if
        // it was deleted (e.g. after the way screenshots are taken improved).
        shotSrc: (i) => (i.screenshot ? `${base}shot/${encodeURIComponent(i.id)}` : null),
        links: { download: `/report/${encodeURIComponent(id)}/download`, pdf: saved.meta.hasPdf ? `${base}report.pdf` : null, api: base, shot: `${base}shot/` },
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
    }
    // One file to send to a client: screenshots built in as data: URIs, no links back here.
    const shots = new Map();
    for (const t of saved.report.types || []) for (const i of t.issues || []) {
      if (!i.screenshot || i.shotVersion !== SHOT_VERSION) continue; // only screenshots that show the problem outlined
      try { shots.set(i.id, `data:image/jpeg;base64,${(await readFile(history.file(id, i.screenshot))).toString("base64")}`); } catch { /* missing screenshot: shown without one */ }
    }
    const html = buildWebReport({ report: saved.report, standalone: true, shotSrc: (i) => shots.get(i.id) || null });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${reportFileName(saved.report)}"` });
    return res.end(html);
  }

  // API: inspection history
  if (pathname === "/api/history" || pathname.startsWith("/api/history/")) {
    const parts = pathname.split("/").slice(3); // [id, ...file]
    const id = parts[0];
    try {
      if (!id) {
        // Only the workspace's sites; with ?site=, only that one.
        const site = url.searchParams.get("site");
        if (site && !profiles.allows(profile, site)) return json(res, 403, { error: "That site isn't in your workspace." });
        const mine = (m) => inspectionAllowed(profile, m) && (!site || inspectionOnSite(m, site));
        if (method === "GET") { await history.sync(); return json(res, 200, { inspections: (await history.list()).filter(mine) }); }
        if (method === "DELETE") {
          if (!site) return json(res, 400, { error: "Say which site's inspections to delete." });
          if (activeRunId) return json(res, 409, { error: "Wait for the running inspection to finish." });
          return json(res, 200, { deleted: await history.removeAll(mine) });
        }
        return json(res, 405, { error: "Method not allowed" });
      }
      if (!isRunId(id)) return json(res, 400, { error: "Bad inspection id" });
      const meta = await history.meta(id);
      if (!meta) return json(res, 404, { error: "Inspection not found" });
      if (!inspectionAllowed(profile, meta)) return json(res, 403, { error: "That inspection belongs to another site." });
      if (parts.length === 1) {
        if (method === "GET") { const saved = await history.load(id); return saved ? json(res, 200, saved) : json(res, 404, { error: "Inspection not found" }); }
        if (method === "DELETE") return (await history.remove(id)) ? json(res, 200, { deleted: id }) : json(res, 404, { error: "Inspection not found" });
        return json(res, 405, { error: "Method not allowed" });
      }
      if (parts[1] === "progress" && parts.length === 2) {
        if (method === "GET") { const p = await history.getProgress(id); return p ? json(res, 200, p) : json(res, 404, { error: "Inspection not found" }); }
        if (method === "PUT") return (await history.setProgress(id, await parseBody(req, 200000))) ? json(res, 200, { saved: true }) : json(res, 404, { error: "Inspection not found" });
        return json(res, 405, { error: "Method not allowed" });
      }
      if (parts[1] === "score" && parts.length === 2) {
        if (method !== "GET") return json(res, 405, { error: "Method not allowed" });
        const saved = await history.load(id);
        if (!saved?.report) return json(res, 404, { error: "This inspection has no report, so no score" });
        return json(res, 200, { ...scoreSummary(saved.report, await history.getProgress(id)), id });
      }
      if (parts[1] === "verify" && parts.length === 2) {
        if (method !== "POST") return json(res, 405, { error: "Method not allowed" });
        return verifyRequest(req, res, id);
      }
      if (method !== "GET") return json(res, 405, { error: "Method not allowed" });
      if (parts[1] === "shot" && parts.length === 3) return issueShot(res, id, parts[2]);
      const file = history.file(id, parts.slice(1).join("/"));
      if (file.endsWith(".pdf")) {
        try {
          const made = await inspectionPdf(id).catch(() => null); // with every screenshot so far
          const data = await readFile(made || file);
          res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="sitefix-${id}.pdf"` });
          return res.end(data);
        } catch { return json(res, 404, { error: "No PDF was made for this inspection" }); }
      }
      return serveFile(res, file);
    } catch (err) {
      return json(res, /^bad /.test(err.message) ? 400 : 500, { error: err.message });
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.error(`Port ${PORT} is already in use, probably by a SiteFix UI that is still running.`);
  console.error(`Stop it with: lsof -ti :${PORT} | xargs kill`);
  console.error(`Or use another port: node ui/server.js --port ${PORT + 1}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(provider ? `AI: ${provider.name} (${provider.model})` : `AI: off (${AI.problem}). Reports use standard guidance; chat needs a key.`);
  console.log(`SiteFix UI  →  http://localhost:${PORT}`);
  console.log(`Project root: ${ROOT}`);
  console.log("Usage: node ui/server.js [--port 3000]");
});
