// SiteFix UI server — Node built-ins only, no new npm deps.
// Usage: node ui/server.js [--port 3000]
//
// Endpoints:
//   GET  /               → ui/index.html
//   GET  /api/status     → { ready: true }
//   POST /api/run        → starts a crawl, returns { runId }
//   GET  /api/stream/:id → SSE stream of crawl progress lines
//   GET  /api/results    → reads issues.json from cwd and returns it
//
// The crawl writes issues.json (and the other files) to the project root.
// The UI reads issues.json after the SSE stream ends.

import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // project root

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
  return { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml" }[ext] || "text/plain";
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

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (d) => (buf += d));
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
    const maxPages = Math.min(Math.max(parseInt(body.maxPages, 10) || 40, 1), 500);
    activeRunId = runId;
    const child = spawn("node", ["crawl.js", siteUrl, "--max-pages", String(maxPages)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });

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

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      entry.done = true;
      entry.exitCode = code;
      if (activeRunId === runId) activeRunId = null;
      broadcast(`__DONE__:${code}`);
      for (const sub of entry.subscribers) {
        try { sub.end(); } catch { /* ignore */ }
      }
      entry.subscribers.clear();
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

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`SiteFix UI  →  http://localhost:${PORT}`);
  console.log(`Project root: ${ROOT}`);
  console.log("Usage: node ui/server.js [--port 3000]");
});
