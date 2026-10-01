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

async function fetchRaw(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    const body = res.status < 400 ? await res.text() : "";
    const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
    return {
      status: res.status,
      redirectedTo: res.headers.get("location") || null,
      title: titleMatch ? titleMatch[1].trim() : null,
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
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
    status = res ? res.status() : null;
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
