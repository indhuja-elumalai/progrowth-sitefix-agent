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
//   POST /api/ask        → { question, inspectionId?, scope? } → an answer from that inspection only
//                          (scope: issue types a follow-up stays within, e.g. the broken images)
//
// History (lib/history.js): every finished inspection is kept in history/<run-id>/.
//   GET    /api/history                  → past inspections, newest first
//   GET    /api/history/:id              → { meta, registry, report, chat }
//   GET    /api/history/:id/report.pdf   → that inspection's PDF
//   GET    /api/history/:id/shots/:name  → one of its screenshots
//   GET    /api/history/:id/shot/:issueId → the screenshot for one issue; taken now (and
//                                          kept) when the report has none (lib/screenshots.js)
//   DELETE /api/history/:id              → delete one inspection
//   DELETE /api/history                  → delete all inspections
//   GET    /report/:id                   → the web report for one inspection (lib/web-report.js)
//   GET    /report/:id/download          → the same report as one file, screenshots built in
// DELETE is same-origin only: the CORS preflight below never allows it.
//
// A run is: crawl.js, then (if the crawl succeeded) report.js, both streamed over SSE.
// The crawl writes issues.json (and the other files) to the project root; report.js
// writes audit-report/. AI settings come from .env (see lib/ai-provider.js).

import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnv } from "../lib/env.js";
import { aiConfig, providerFromConfig } from "../lib/ai-provider.js";
import { answerQuestion } from "../lib/chat.js";
import { createHistory, isRunId } from "../lib/history.js";
import { buildWebReport, reportFileName } from "../lib/web-report.js";
import { parseProgressLine } from "../lib/progress.js";
import { shotPlan, createShooter } from "../lib/screenshots.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // project root
const REPORT_DIR = path.join(ROOT, "audit-report");
const history = createHistory({ root: ROOT, max: Number(process.env.SITEFIX_HISTORY_MAX) || undefined });
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

function makeRunId() {
  return "ui-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function mime(ext) {
  return { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".jpg": "image/jpeg" }[ext] || "text/plain";
}

// The screenshot of one issue of a saved inspection. When the report has none, the page
// is opened now (the problem outlined), the screenshot kept with the inspection, and the
// report updated. A page that can't be opened is not tried again until a restart.
async function issueShot(res, id, issueId) {
  if (!/^ISS-[0-9a-f]{10}$/.test(issueId)) return json(res, 400, { error: "Bad issue id" });
  const file = history.file(id, `shots/${issueId}.jpg`);
  if (await access(file).then(() => true, () => false)) return serveFile(res, file);
  const key = `${id}/${issueId}`;
  if (shotFailed.has(key)) return json(res, 404, { error: "The page could not be opened for a screenshot" });
  let job = shotJobs.get(key);
  if (!job) {
    const saved = await history.load(id);
    const issue = saved?.report?.types?.flatMap((t) => t.issues || []).find((i) => i.id === issueId);
    const plan = shotPlan(issue);
    if (!plan) return json(res, 404, { error: "No screenshot for this issue" });
    job = shooter.take(plan, file)
      .then(async (ok) => { if (ok) await history.setShot(id, issueId); else shotFailed.add(key); return ok; })
      .finally(() => shotJobs.delete(key));
    shotJobs.set(key, job);
  }
  return (await job) ? serveFile(res, file) : json(res, 404, { error: "The page could not be opened for a screenshot" });
}

async function serveFile(res, filePath) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime(path.extname(filePath)) });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
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

  // API: start a crawl
  if (method === "POST" && pathname === "/api/run") {
    const body = await parseBody(req);
    const siteUrl = (body.url || "").trim();
    let parsed;
    try { parsed = new URL(siteUrl); } catch { parsed = null; }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
      return json(res, 400, { error: "A valid http:// or https:// URL is required" });
    }
    if (activeRunId) {
      return json(res, 409, { error: "An inspection is already running. Wait for it to finish." });
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
    child.on("close", (code) => {
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
    return json(res, 200, entry ? { runId: entry.id, url: entry.url, startedAt: entry.startedAt } : {});
  }

  // API: return the current issues.json
  if (method === "GET" && pathname === "/api/results") {
    const file = path.join(ROOT, "issues.json");
    const runId = url.searchParams.get("runId");
    const entry = runId ? runs.get(runId) : null;
    if (runId && (!entry || !entry.done || entry.exitCode !== 0)) {
      return json(res, 409, { error: "That run has not finished successfully, so there are no results for it" });
    }
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
      if (!saved.report) return json(res, 200, { answer: "This inspection has no explained report (the report step did not finish), so I cannot answer questions about it. Run it again to chat about it.", issueIds: [], source: "none" });
      const scope = Array.isArray(body.scope) ? body.scope.filter((t) => typeof t === "string" && /^[a-z0-9-]{2,40}$/.test(t)).slice(0, 20) : undefined;
      const result = await answerQuestion({ question: body.question, report: saved.report, provider, scope });
      if (String(body.question || "").trim()) await history.appendChat(body.inspectionId, { question: String(body.question).trim().slice(0, 500), answer: result.answer, issueIds: result.issueIds || [], source: result.source, ...(result.display ? { display: result.display, lead: result.lead, tail: result.tail, more: result.more, moreIds: result.moreIds || [], reportHash: result.reportHash, moreLabel: result.moreLabel, ...(result.scope ? { scope: result.scope } : {}) } : {}) });
      return json(res, 200, result);
    }
    const result = await answerQuestion({ question: body.question, report: await currentReport(), provider });
    return json(res, 200, result);
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
    if (!saved.report) return page(404, "No report for this inspection", "The report step did not finish for this inspection, so there are no explanations to show. Run the inspection again to get a full report.");
    const base = `/api/history/${encodeURIComponent(id)}/`;
    if (!download) {
      const html = buildWebReport({
        report: saved.report,
        shotSrc: (i) => (i.screenshot ? base + i.screenshot : null),
        links: { download: `/report/${encodeURIComponent(id)}/download`, pdf: saved.meta.hasPdf ? `${base}report.pdf` : null },
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html);
    }
    // One file to send to a client: screenshots built in as data: URIs, no links back here.
    const shots = new Map();
    for (const t of saved.report.types || []) for (const i of t.issues || []) {
      if (!i.screenshot) continue;
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
        if (method === "GET") { await history.sync(); return json(res, 200, { inspections: await history.list() }); }
        if (method === "DELETE") { if (activeRunId) return json(res, 409, { error: "Wait for the running inspection to finish." }); return json(res, 200, { deleted: await history.removeAll() }); }
        return json(res, 405, { error: "Method not allowed" });
      }
      if (!isRunId(id)) return json(res, 400, { error: "Bad inspection id" });
      if (parts.length === 1) {
        if (method === "GET") { const saved = await history.load(id); return saved ? json(res, 200, saved) : json(res, 404, { error: "Inspection not found" }); }
        if (method === "DELETE") return (await history.remove(id)) ? json(res, 200, { deleted: id }) : json(res, 404, { error: "Inspection not found" });
        return json(res, 405, { error: "Method not allowed" });
      }
      if (method !== "GET") return json(res, 405, { error: "Method not allowed" });
      if (parts[1] === "shot" && parts.length === 3) return issueShot(res, id, parts[2]);
      const file = history.file(id, parts.slice(1).join("/"));
      if (file.endsWith(".pdf")) {
        try {
          const data = await readFile(file);
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
