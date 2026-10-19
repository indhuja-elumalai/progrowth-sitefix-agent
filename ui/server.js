// SiteFix UI server — Node built-ins only, no new npm deps.
// Usage: node ui/server.js [--port 3000]
//
// Endpoints:
//   GET  /               → ui/index.html
//   GET  /api/status     → { ready: true }
//   POST /api/run        → starts a crawl, returns { runId }
//   GET  /api/stream/:id → SSE stream of crawl progress lines
//   GET  /api/results    → reads issues.json from cwd and returns it
//   GET  /api/report     → audit-report/explained.json (priorities, explanations, fixes)
//   GET  /api/report.pdf → the PDF report
//   GET  /api/shots/:id  → one screenshot from the report
//   GET  /api/ai-status  → whether AI is on, which provider and model
//   POST /api/ask        → { question } → an answer from the last report only
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // project root
const REPORT_DIR = path.join(ROOT, "audit-report");

loadEnv(path.join(ROOT, ".env"));
const AI = aiConfig();
const provider = await providerFromConfig(AI);

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const PORT = portArg !== -1 && args[portArg + 1] ? Number(args[portArg + 1]) : 3000;
// Bind to loopback only: /api/run spawns a crawler, so it must not be reachable from the network.
const HOST = process.env.SITEFIX_UI_HOST || "127.0.0.1";
// Only one crawl at a time: every run writes issues.json to the same project root.
let activeRunId = null;

// In-memory store of active/completed runs (keyed by runId).
// Each entry: { id, url, lines: string[], done: boolean, exitCode: number|null, subscribers: Set<res> }
const runs = new Map();

function makeRunId() {
  return "ui-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function mime(ext) {
  return { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".jpg": "image/jpeg" }[ext] || "text/plain";
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
    const entry = { id: runId, url: siteUrl, lines: [], done: false, exitCode: null, subscribers: new Set() };
    runs.set(runId, entry);

    // Start the crawler as a child process
    // No page cap unless the caller asks for one: the crawler covers the whole site.
    const maxPages = parseInt(body.maxPages, 10);
    const crawlArgs = ["crawl.js", siteUrl];
    if (maxPages > 0) crawlArgs.push("--max-pages", String(maxPages));
    activeRunId = runId;
    const child = spawn("node", crawlArgs, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });

    function broadcast(line) {
      entry.lines.push(line);
      for (const sub of entry.subscribers) {
        try { sub.write(`data: ${JSON.stringify({ line })}\n\n`); } catch { /* ignore */ }
      }
    }

    function onData(chunk) {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.trim()) broadcast(line);
      }
    }

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

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      if (code !== 0) return finish(code);
      // The crawl worked: build the explained report and PDF. A report failure
      // does not hide the crawl results; the UI shows them without the extras.
      const report = spawn("node", ["report.js"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
      report.stdout.on("data", onData);
      report.stderr.on("data", onData);
      report.on("close", (rcode) => {
        entry.reportCode = rcode;
        broadcast(`__REPORT__:${rcode}`);
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

    // Replay buffered lines
    for (const line of entry.lines) {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }

    if (entry.done) {
      res.write(`data: ${JSON.stringify({ line: `__DONE__:${entry.exitCode}` })}\n\n`);
      return res.end();
    }

    entry.subscribers.add(res);
    req.on("close", () => entry.subscribers.delete(res));
    return; // keep open
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

  // API: ask a question about the latest report
  if (method === "POST" && pathname === "/api/ask") {
    const body = await parseBody(req);
    const result = await answerQuestion({ question: body.question, report: await currentReport(), provider });
    return json(res, 200, result);
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
