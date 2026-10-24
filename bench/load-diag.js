// Shows what a page waits for before the crawler can read it, and whether loading
// 8 pages at once (like crawl.js) slows each one down.
// Usage: node bench/load-diag.js <url> [url...]   (give 3 to 8 pages of one site)
import { chromium } from "playwright";

const EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "ico", "mp4", "webm", "mp3", "woff", "woff2", "ttf", "otf", "eot"];
const BLOCKED = EXT.flatMap((e) => [`*.${e}`, `*.${e}?*`]);
const urls = process.argv.slice(2);
if (!urls.length) { console.error("Usage: node bench/load-diag.js <url> [url...]"); process.exit(1); }

const browser = await chromium.launch();
const context = await browser.newContext();

async function load(url, detail) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setBlockedURLs", { urls: BLOCKED });
  const reqs = new Map();
  const t0 = Date.now();
  page.on("request", (r) => reqs.set(r, { url: r.url(), type: r.resourceType(), start: Date.now() - t0 }));
  page.on("requestfinished", (r) => { const x = reqs.get(r); if (x) x.end = Date.now() - t0; });
  page.on("requestfailed", (r) => { const x = reqs.get(r); if (x) { x.end = Date.now() - t0; x.failed = true; } });
  let err = null;
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch (e) { err = e.message.split("\n")[0]; }
  const dcl = Date.now() - t0;
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { firstByte: Math.round(n.responseStart), htmlDone: Math.round(n.responseEnd), dcl: Math.round(n.domContentLoadedEventEnd) } : null; }).catch(() => null);
  if (detail) {
    const host = new URL(url).host;
    const before = [...reqs.values()].filter((r) => r.start < dcl);
    console.log(`\n=== ${url}`);
    console.log(`  first byte of HTML ${nav?.firstByte ?? "?"} ms, HTML fully received ${nav?.htmlDone ?? "?"} ms, page readable (DOMContentLoaded) ${nav?.dcl ?? dcl} ms${err ? `  ERROR: ${err}` : ""}`);
    console.log(`  ${before.length} requests started before that (${before.filter((r) => !r.url.includes(host)).length} to other sites). Slowest:`);
    for (const r of before.sort((a, b) => ((b.end ?? dcl) - b.start) - ((a.end ?? dcl) - a.start)).slice(0, 8)) {
      let h = r.url; try { const u = new URL(r.url); h = u.host + u.pathname.slice(0, 50); } catch { }
      console.log(`    ${String((r.end ?? dcl) - r.start).padStart(6)} ms  ${r.type.padEnd(10)} ${r.url.includes(host) ? "same site " : "OTHER SITE"} ${h}${r.failed ? "  (blocked/failed)" : ""}`);
    }
  }
  await page.close();
  return nav?.dcl ?? dcl;
}

console.log("One page at a time:");
const one = [];
for (const u of urls) one.push(await load(u, true));
console.log(`\nAverage time to readable, one at a time: ${Math.round(one.reduce((a, b) => a + b, 0) / one.length)} ms`);
const many = await Promise.all(Array.from({ length: 8 }, (_, i) => load(urls[i % urls.length], false)));
console.log(`Average time to readable, 8 at once (like the crawler): ${Math.round(many.reduce((a, b) => a + b, 0) / many.length)} ms`);
await browser.close();
