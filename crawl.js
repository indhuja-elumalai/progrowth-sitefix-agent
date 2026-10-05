// Week-1 starter crawler.
// Usage: node crawl.js https://your-site.com
//
// What it does, on purpose and nothing more:
//   1. Fetches the raw HTML of the start URL (no JavaScript executed).
//   2. Opens the same URL in a real headless browser and lets JS run,
//      so we can compare "what the server sent" vs "what a visitor sees."
//   3. Follows internal links one level deep and repeats the same two checks.
//   4. Writes one JSON report with: status code, title, word count,
//      whether JS rendering changed anything, and any broken links found.
//
// Nothing here fixes anything, stores anything long-term, or touches
// the site. It only looks and records -- exactly the "Crawl and render"
// box in the architecture diagram.
//
// Fixes in this version:
//   - Decode HTML entities (&amp; etc.) before comparing raw vs rendered
//     titles, so encoding differences no longer look like real JS changes.
//   - Wait for "domcontentloaded" instead of "networkidle" as the primary
//     signal, then best-effort wait a little longer for network to settle.
//     Pages with chat widgets, embeds, or constant background requests
//     never go fully idle, which was causing false render failures.

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const startUrl = process.argv[2];
if (!startUrl) {
  console.error("Usage: node crawl.js https://your-site.com");
  process.exit(1);
}

const origin = new URL(startUrl).origin;
const visited = new Set();
const report = [];

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchRaw(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    const body = res.status < 400 ? await res.text() : "";
    const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
    return {
      status: res.status,
      redirectedTo: res.headers.get("location") || null,
      title: titleMatch ? decodeEntities(titleMatch[1].trim()) : null,
      bodyLength: body.length,
    };
  } catch (err) {
    return { status: null, error: String(err) };
  }
}

async function fetchRendered(browser, url) {
  const page = await browser.newPage();
  const brokenLinks = [];
  const internalLinks = new Set();

  page.on("response", (res) => {
    if (res.status() >= 400 && res.url().startsWith(origin)) {
      brokenLinks.push({ url: res.url(), status: res.status() });
    }
  });

  let status = null;
  try {
    // Primary wait: DOM is parsed and ready. This is reliable even on
    // pages that keep background connections open forever (chat widgets,
    // analytics, live embeds) and would never satisfy "networkidle".
    const res = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    status = res ? res.status() : null;

    // Best-effort extra wait for things that finish loading shortly after
    // DOM-ready (e.g. a script injecting content). Non-fatal if it times
    // out -- we already have a usable page either way.
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  } catch (err) {
    await page.close();
    return { status: null, error: String(err), internalLinks: [], brokenLinks: [] };
  }

  const title = await page.title();
  const wordCount = await page.evaluate(
    () => document.body.innerText.trim().split(/\s+/).length
  );
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
  for (const href of hrefs) {
    if (href.startsWith(origin)) internalLinks.add(href.split("#")[0]);
  }

  await page.close();
  return { status, title, wordCount, internalLinks: [...internalLinks], brokenLinks };
}

async function main() {
  const browser = await chromium.launch();
  const queue = [startUrl];

  while (queue.length && visited.size < 25) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`Crawling: ${url}`);
    const raw = await fetchRaw(url);
    const rendered = await fetchRendered(browser, url);

    report.push({
      url,
      raw,
      rendered: {
        status: rendered.status,
        title: rendered.title,
        wordCount: rendered.wordCount,
        brokenLinks: rendered.brokenLinks,
      },
      jsChangedTitle: raw.title !== rendered.title,
    });

    for (const link of rendered.internalLinks || []) {
      if (!visited.has(link)) queue.push(link);
    }
  }

  await browser.close();
  await writeFile("report.json", JSON.stringify(report, null, 2));
  console.log(`\nDone. Visited ${visited.size} page(s). See report.json`);
}

main();
