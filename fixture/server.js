// Test fixture server.
// Serves ./site on port 4000 with REAL HTTP redirects, and a second
// "external" origin on port 4001 that stands in for a third-party site.
// Built-ins only: no npm install needed.
//
//   node fixture/server.js
//
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
const MAIN_PORT = Number(process.env.FIXTURE_PORT || 4000);
const EXT_PORT = Number(process.env.FIXTURE_EXT_PORT || 4001);

// path -> [status, location]
const redirects = {
  "/redirect-chain-start": [301, "/redirect-chain-2"],
  "/redirect-chain-2": [301, "/redirect-chain-3"],
  "/redirect-chain-3": [301, "/final.html"],
  "/loop-a": [302, "/loop-b"],
  "/loop-b": [302, "/loop-a"],
  "/old-page": [302, "/does-not-exist.html"],
  "/old-help": [302, "/gone.html"],
  "/old-faq": [302, "/gone.html"],
};
// Planted oversized image (F-16): a valid SVG padded past 300 KB with a comment.
// Generated here so no large file is committed.
const LARGE_BANNER = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160"><rect width="640" height="160" fill="#2B7A78"/>' +
  `<!-- ${"padding ".repeat(40 * 1024)} --></svg>\n`
);

// Page speed (F-31, F-34): a hero image the server sends after 4.5 seconds, and a
// 3.3 MB background file. Generated here so no large file is committed.
// The hero has real detail (many shapes): Chrome ignores near-empty images for LCP.
const SLOW_HERO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="412" height="700"><rect width="412" height="700" fill="#3D5A80"/>' +
  Array.from({ length: 600 }, (_, i) => `<circle cx="${(i * 37) % 412}" cy="${(i * 53) % 700}" r="${4 + (i % 9)}" fill="hsl(${(i * 47) % 360},60%,${40 + (i % 30)}%)"/>`).join("") + "</svg>\n");
const HEAVY_TEXTURE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#98C1D9"/>' +
  `<!-- ${"texture ".repeat(420 * 1024)} --></svg>\n`
);

const types = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

const main = http.createServer(async (req, res) => {
  let p = new URL(req.url, "http://fixture").pathname;
  if (redirects[p]) {
    const [code, to] = redirects[p];
    res.writeHead(code, { Location: to });
    return res.end();
  }
  if (p === "/img/slow-hero.svg") {
    await new Promise((r) => setTimeout(r, 4500));
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Content-Length": SLOW_HERO.length });
    return res.end(SLOW_HERO);
  }
  if (p === "/img/heavy-texture.svg") {
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Content-Length": HEAVY_TEXTURE.length });
    return res.end(HEAVY_TEXTURE);
  }
  if (p === "/img/large-banner.svg") {
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Content-Length": LARGE_BANNER.length });
    return res.end(LARGE_BANNER);
  }
  if (p === "/") p = "/index.html";
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Length": data.length });
    res.end(data);
  } catch {
    // A genuine 404: correct status code, error content.
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>404 Not Found</title><h1>404</h1>");
  }
});

// "External" site: /ok works, everything else is a 404.
const external = http.createServer((req, res) => {
  const ok = new URL(req.url, "http://external").pathname === "/ok";
  res.writeHead(ok ? 200 : 404, { "Content-Type": "text/plain" });
  res.end(ok ? "ok" : "not found");
});

main.listen(MAIN_PORT, () => console.log(`fixture site     http://localhost:${MAIN_PORT}`));
external.listen(EXT_PORT, () => console.log(`fixture external http://localhost:${EXT_PORT}`));