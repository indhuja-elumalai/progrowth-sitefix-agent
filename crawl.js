// Crawler, Day 2 version.
// Usage: node crawl.js https://your-site.com [--max-pages 100] [--delay-ms 150]
//
// What it does, on purpose and nothing more:
//   1. Fetches the raw HTML of each page (no JavaScript executed).
//   2. Opens the same page in headless Chromium and lets JS run, so we can
//      compare "what the server sent" with "what a visitor sees".
//   3. Follows internal links up to --max-pages (default 100).
//   4. Checks EVERY link found (internal and external) directly, once each,
//      and records which pages link to it ("found on").
//
// Writes two files:
//   report.json  one entry per crawled page (raw vs rendered)
//   links.json   summary plus one entry per checked link
//
// Nothing here fixes anything or touches the site. It only looks and records.

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

// ---------- command line ----------
const args = process.argv.slice(2);
const startArg = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
if (!startArg) {
  console.error("Usage: node crawl.js https://your-site.com [--max-pages 100] [--delay-ms 150]");
  process.exit(1);
}
const MAX_PAGES = opt("max-pages", 100);
const DELAY_MS = opt("delay-ms", 150);
const LINK_TIMEOUT_MS = 10000;
const UA = "progrowth-sitefix-agent/0.2 (site QA crawler)";

const startUrl = new URL(startArg).href; // normalises "https://x.com" to "https://x.com/"
const origin = new URL(startUrl).origin;
const visited = new Set();
const report = [];
const foundOn = new Map(); // target URL -> Set of pages that link to it
const SKIP_CRAWL = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|mp4|mp3|docx?|xlsx?|pptx?|css|js|xml|txt)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---------- page fetches (unchanged from Week 1) ----------
async function fetchRaw(url) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
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
  const links = new Set();

  page.on("response", (res) => {
    if (res.status() >= 400 && res.url().startsWith(origin)) {
      brokenLinks.push({ url: res.url(), status: res.status() });
    }
  });

  let status = null;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    status = res ? res.status() : null;
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  } catch (err) {
    await page.close();
    return { status: null, error: String(err), links: [], brokenLinks: [] };
  }

  const title = await page.title();
  const wordCount = await page.evaluate(() => document.body.innerText.trim().split(/\s+/).length);
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
  for (const href of hrefs) {
    let u;
    try { u = new URL(href); } catch { continue; }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue; // skip mailto:, tel:, javascript:
    u.hash = "";
    links.add(u.href);
  }

  await page.close();
  return { status, title, wordCount, links: [...links], brokenLinks };
}

// ---------- direct link check ----------
// HEAD first; fall back to GET when the server rejects HEAD (405/501).
// Redirects are NOT followed, so a 301 is reported as a 301.
async function requestOnce(url, method) {
  return fetch(url, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    headers: { "user-agent": UA },
  });
}

function classify(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  if ([401, 403, 429, 999].includes(status)) return "unverified"; // blocked, not proven broken
  return "broken"; // other 4xx and 5xx
}

async function checkLink(url) {
  try {
    let res = await requestOnce(url, "HEAD");
    // Some servers reject HEAD (405/501) or block it with 403. Retry with GET before judging.
    if ([403, 405, 501].includes(res.status)) {
      res.body?.cancel().catch(() => {});
      res = await requestOnce(url, "GET");
    }
    res.body?.cancel().catch(() => {}); // we only need the status, not the page
    return {
      status: res.status,
      location: res.headers.get("location") || null,
      classification: classify(res.status),
    };
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      status: null,
      location: null,
      classification: timedOut ? "unverified" : "unreachable", // timeouts are not proof of a broken link
      error: timedOut ? "timeout" : String(err.cause?.code || err.message),
    };
  }
}

// ---------- main ----------
async function main() {
  const browser = await chromium.launch();
  const queue = [startUrl];
  let capReached = false;

  while (queue.length) {
    if (visited.size >= MAX_PAGES) { capReached = true; break; }
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`Crawling (${visited.size}/${MAX_PAGES}): ${url}`);
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

    for (const link of rendered.links || []) {
      if (!foundOn.has(link)) foundOn.set(link, new Set());
      foundOn.get(link).add(url);
      const internal = new URL(link).origin === origin;
      if (internal && !visited.has(link) && !SKIP_CRAWL.test(new URL(link).pathname)) queue.push(link);
    }
  }
  await browser.close();

  // Check every distinct link target once.
  const targets = [...foundOn.keys()];
  console.log(`\nChecking ${targets.length} distinct links directly...`);
  const links = [];
  for (const target of targets) {
    const result = await checkLink(target);
    links.push({
      url: target,
      type: new URL(target).origin === origin ? "internal" : "external",
      ...result,
      foundOn: [...foundOn.get(target)],
    });
    await sleep(DELAY_MS); // be polite to the server
  }

  const count = (c) => links.filter((l) => l.classification === c).length;
  const summary = {
    startUrl,
    maxPages: MAX_PAGES,
    pagesCrawled: visited.size,
    capReached,
    pagesLeftInQueue: capReached ? queue.filter((u) => !visited.has(u)).length : 0,
    linksChecked: links.length,
    ok: count("ok"),
    redirect: count("redirect"),
    broken: count("broken"),
    unverified: count("unverified"),
    unreachable: count("unreachable"),
  };

  await writeFile("report.json", JSON.stringify(report, null, 2));
  await writeFile("links.json", JSON.stringify({ summary, links }, null, 2));

  // Readable result in the console (and the Actions log).
  console.log("\n=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  if (capReached) console.log(`\nNOTE: stopped at ${MAX_PAGES} pages with pages still queued. Raise --max-pages to see more.`);
  const show = (label, cls) => {
    const list = links.filter((l) => l.classification === cls);
    if (!list.length) return;
    console.log(`\n${label} (${list.length}):`);
    for (const l of list.slice(0, 50)) {
      console.log(`  ${l.status ?? l.error}  ${l.url}${l.location ? "  -> " + l.location : ""}`);
      console.log(`      found on: ${l.foundOn.slice(0, 5).join(", ")}${l.foundOn.length > 5 ? ` (+${l.foundOn.length - 5} more)` : ""}`);
    }
    if (list.length > 50) console.log(`  ... and ${list.length - 50} more in links.json`);
  };
  show("Broken links", "broken");
  show("Unreachable links", "unreachable");
  show("Redirecting links", "redirect");
  show("Unverified links (blocked or timed out)", "unverified");
  console.log("\nDone. See report.json and links.json");
}

main();