// Crawler, Day 12 version.
// Usage: node crawl.js https://your-site.com [--max-pages 0] [--concurrency 4]
//          [--link-concurrency 8] [--settle-ms 1500] [--delay-ms 150] [--no-sitemap]
//
// What it does, on purpose and nothing more:
//   1. Fetches the raw HTML of each page (no JavaScript executed).
//   2. Opens the same page in headless Chromium and lets JS run, so we can
//      compare "what the server sent" with "what a visitor sees".
//   3. Follows every internal link it finds, plus every URL in the site's
//      sitemap (robots.txt "Sitemap:" lines, else /sitemap.xml). No page cap
//      by default; --max-pages N sets one. Pages are rendered --concurrency
//      at a time (default 4) and links checked --link-concurrency at a time
//      (default 8).
//   4. Checks EVERY link found (internal and external) directly, once each,
//      and records which pages link to it ("found on").
//   5. Follows every redirecting link to its end and classifies it:
//      loop, chain (2+ hops), or a redirect that ends in an error.
//   6. Checks the start URL's host: http -> https, and the www / non-www twin.
//   7. Reads each page's title, meta description, H1s and canonical (raw and
//      rendered) and flags missing, duplicate, too long / short, and canonicals
//      that point at an error or a redirect.
//
//   8. Flags soft 404s: pages that answer 200 but say "not found", backed by a
//      second signal (almost no text, no H1, noindex, or many links redirect
//      into the page). Pages that are only reached through redirects are
//      fetched and judged too.
//
//   9. Reads every <img> on each page (src, lazy-load src, alt, decorative
//      markers), checks each distinct image URL once (following redirects,
//      reading its size), and flags broken images, missing / unhelpful /
//      too-long alt text, http images on https pages, and files over 300 KB.
//
//  10. Gathers every finding into one issue registry (issues.json): a typed
//      issue with severity, the pages it was found on, and the evidence.
//
// Writes six files:
//   report.json    one entry per crawled page (raw vs rendered, with head facts)
//   links.json     summary, site-level checks, redirect destinations, one entry per link
//   metadata.json  per-page metadata and canonical issues, with a summary
//   soft404.json   pages with soft-404 signals, flagged or not, with the evidence
//   images.json    one entry per distinct image: status, size, pages, alt problems
//   issues.json    the issue registry: every finding as one typed record with evidence
//
// Nothing here fixes anything or touches the site. It only looks and records.

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { extractHead, headIssues, findDuplicates, canonicalTargetIssue, jsDependence, sameUrl } from "./lib/metadata.js";
import { buildRegistry, validateRegistry } from "./lib/issues.js";
import { analyzeSoft404, visibleWordCount } from "./lib/soft404.js";
import { followRedirects, classifyRedirect, redirectIssueType, siteLevelChecks } from "./lib/redirects.js";
import { pickImageSrc, isDecorative, summarizeImages, imageFindings, formatBytes, IMAGE_LIMITS } from "./lib/images.js";

// ---------- command line ----------
const args = process.argv.slice(2);
const startArg = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
if (!startArg) {
  console.error("Usage: node crawl.js https://your-site.com [--max-pages 0] [--concurrency 4] [--link-concurrency 8] [--settle-ms 1500] [--delay-ms 150] [--no-sitemap]");
  process.exit(1);
}
const MAX_PAGES = opt("max-pages", 0); // 0 = no cap: crawl every internal page found
const DELAY_MS = opt("delay-ms", 150); // pause after each request, per worker
const CONCURRENCY = Math.max(1, opt("concurrency", 4)); // pages rendered at the same time
const LINK_CONCURRENCY = Math.max(1, opt("link-concurrency", 8)); // link checks at the same time
const SETTLE_MS = opt("settle-ms", 1500); // max wait for late JavaScript after DOMContentLoaded
const USE_SITEMAP = !args.includes("--no-sitemap");
const MAX_HOPS = 10;
const LINK_TIMEOUT_MS = 10000;
const UA = "progrowth-sitefix-agent/0.6 (site QA crawler)";

const startUrl = new URL(startArg).href; // normalises "https://x.com" to "https://x.com/"
const origin = new URL(startUrl).origin;
const visited = new Set();
const report = [];
const foundOn = new Map(); // target URL -> Set of pages that link to it
const SKIP_CRAWL = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|mp4|mp3|docx?|xlsx?|pptx?|css|js|xml|txt)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run fn over items with at most n in flight; results keep the input order.
async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// The key a page is crawled under: no #fragment, no tracking parameters
// (utm_*, gclid, fbclid, ...), and absurdly long URLs (crawler traps) dropped.
const TRACKING_PARAM = /^(utm_.+|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga)$/i;
function crawlKey(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  u.hash = "";
  const tracking = [...u.searchParams.keys()].filter((k) => TRACKING_PARAM.test(k));
  for (const k of tracking) u.searchParams.delete(k);
  return u.href.length > 500 ? null : u.href;
}

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

// ---------- page fetches ----------
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
      head: res.status < 400 ? extractHead(body) : null,
      wordCount: res.status < 400 ? visibleWordCount(body) : null,
    };
  } catch (err) {
    return { status: null, error: String(err) };
  }
}

async function fetchRendered(context, url) {
  const page = await context.newPage();
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
    // Give late JavaScript a short window. Many sites never go fully idle
    // (analytics, chat widgets), so a long wait here costs time on every page.
    if (SETTLE_MS > 0) await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => { });
  } catch (err) {
    await page.close();
    return { status: null, error: String(err), links: [], brokenLinks: [], images: [] };
  }

  const title = await page.title();
  const head = extractHead(await page.content()); // the DOM after JavaScript has run
  const wordCount = await page.evaluate(() => document.body.innerText.trim().split(/\s+/).length);
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
  for (const href of hrefs) {
    let u;
    try { u = new URL(href); } catch { continue; }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue; // skip mailto:, tel:, javascript:
    u.hash = "";
    links.add(u.href);
  }

  // Every <img>, with the attributes the image rules need (lib/images.js).
  const rawImages = await page.$$eval("img", (imgs) => imgs.map((i) => ({
    currentSrc: i.currentSrc || "",
    src: i.getAttribute("src") || "",
    dataSrc: i.getAttribute("data-src") || i.getAttribute("data-lazy-src") || i.getAttribute("data-original") || "",
    srcset: i.getAttribute("srcset") || i.getAttribute("data-srcset") || "",
    alt: i.getAttribute("alt"), // null when the attribute is absent, "" when empty
    role: i.getAttribute("role") || "",
    ariaHidden: i.getAttribute("aria-hidden") || "",
  })));
  const base = page.url(); // resolve relative src against where the page ended up
  const images = rawImages.map((r) => ({ src: pickImageSrc(r, base), alt: r.alt, decorative: isDecorative(r) }));

  await page.close();
  return { status, title, head, wordCount, links: [...links], brokenLinks, images };
}

// ---------- direct link check ----------
// HEAD first; fall back to GET when the server rejects HEAD (403/405/501).
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

// With { meta: true } it also returns the response's size and type (used for images).
async function checkLink(url, { meta = false } = {}) {
  try {
    let res = await requestOnce(url, "HEAD");
    // Some servers reject HEAD (405/501) or block it with 403. Retry with GET before judging.
    if ([403, 405, 501].includes(res.status)) {
      res.body?.cancel().catch(() => { });
      res = await requestOnce(url, "GET");
    }
    res.body?.cancel().catch(() => { }); // we only need the status, not the page
    const out = {
      status: res.status,
      location: res.headers.get("location") || null,
      classification: classify(res.status),
    };
    if (meta) {
      out.bytes = Number(res.headers.get("content-length")) || null; // null when the server does not say
      out.contentType = res.headers.get("content-type") || null;
    }
    return out;
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

// ---------- image check ----------
// Like a link check, but follows redirects to the real file and reads its size there.
async function checkImage(url) {
  const first = await checkLink(url, { meta: true });
  if (first.classification !== "redirect") return { ...first, finalUrl: null };
  const r = classifyRedirect(await followRedirects(url, checkLink, { maxHops: MAX_HOPS }));
  if (!r.finalUrl) { // a loop, or more than MAX_HOPS redirects: the image never arrives
    return { status: null, classification: "broken", error: r.kind === "loop" ? "redirect loop" : "too many redirects", bytes: null, contentType: null, finalUrl: null };
  }
  const end = await checkLink(r.finalUrl, { meta: true });
  return { ...end, finalUrl: r.finalUrl };
}

// ---------- sitemap ----------
// URLs listed in the sitemap(s): robots.txt "Sitemap:" lines, else /sitemap.xml.
// Follows sitemap index files (up to 50 sitemaps). Plain XML only, not .gz.
async function sitemapUrls() {
  const get = async (url) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": UA } });
      return res.ok ? await res.text() : null;
    } catch { return null; }
  };
  const sitemaps = new Set();
  const robots = await get(origin + "/robots.txt");
  for (const m of (robots || "").matchAll(/^\s*sitemap:\s*(\S+)/gim)) sitemaps.add(m[1]);
  if (!sitemaps.size) sitemaps.add(origin + "/sitemap.xml");
  const todo = [...sitemaps];
  const pages = new Set();
  let fetched = 0;
  while (todo.length && fetched < 50) {
    const xml = await get(todo.shift());
    fetched++;
    if (!xml) continue;
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
    if (/<sitemapindex/i.test(xml)) {
      for (const l of locs) if (!sitemaps.has(l)) { sitemaps.add(l); todo.push(l); }
    } else {
      for (const l of locs) pages.add(l);
    }
  }
  return [...pages];
}

// ---------- main ----------
async function main() {
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch();
  const context = await browser.newContext(); // one context: pages share the HTTP cache
  const queue = [];
  const queued = new Set();
  const enqueue = (href) => {
    const key = crawlKey(href);
    if (!key || queued.has(key) || SKIP_CRAWL.test(new URL(key).pathname)) return false;
    queued.add(key);
    queue.push(key);
    return true;
  };
  enqueue(startUrl);
  let capReached = false;

  let sitemapListed = [];
  if (USE_SITEMAP) {
    const all = await sitemapUrls();
    sitemapListed = all.filter((u) => { try { return new URL(u).origin === origin; } catch { return false; } });
    const added = sitemapListed.filter((u) => enqueue(u)).length;
    console.log(`Sitemap: ${all.length} URLs listed, ${sitemapListed.length} on ${origin}, ${added} added to the queue`);
  }

  // Crawl with CONCURRENCY workers sharing one queue. A worker stops when the
  // queue is empty and no other worker is still busy (and could add more).
  const crawled = []; // { n, entry } in completion order; sorted by n afterwards
  const imageOccurrences = []; // one per <img> per page (pages that loaded with 2xx only)
  let active = 0;
  const worker = async () => {
    for (;;) {
      if (MAX_PAGES && visited.size >= MAX_PAGES) { if (queue.length) capReached = true; return; }
      const url = queue.shift();
      if (!url) {
        if (!active) return;
        await sleep(50);
        continue;
      }
      visited.add(url);
      const n = visited.size;
      active++;
      try {
        console.log(MAX_PAGES ? `Crawling (${n}/${MAX_PAGES}): ${url}` : `Crawling (${n}, ${queue.length} queued): ${url}`);
        const [raw, rendered] = await Promise.all([fetchRaw(url), fetchRendered(context, url)]);

        // Only compare titles when both sides produced a real page. A redirect, a 404
        // or a failed render has no body to compare, and a missing title is "" on both sides.
        const rawIsPage = raw.status >= 200 && raw.status < 300;
        const renderedOk = rendered.status !== null;
        crawled.push({
          n,
          entry: {
            url,
            raw,
            rendered: {
              status: rendered.status,
              title: rendered.title,
              wordCount: rendered.wordCount,
              head: rendered.head || null,
              brokenLinks: rendered.brokenLinks,
            },
            jsChangedTitle: rawIsPage && renderedOk && (raw.title || "") !== (rendered.title || ""),
          },
        });

        if (rendered.status >= 200 && rendered.status < 300) {
          for (const img of rendered.images) imageOccurrences.push({ pageUrl: url, ...img });
        }

        for (const link of rendered.links || []) {
          if (!foundOn.has(link)) foundOn.set(link, new Set());
          foundOn.get(link).add(url);
          if (new URL(link).origin === origin) enqueue(link);
        }
      } finally {
        active--;
      }
      if (DELAY_MS) await sleep(DELAY_MS); // be polite to the server
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  report.push(...crawled.sort((a, b) => a.n - b.n).map((c) => c.entry));
  await context.close();
  await browser.close();

  // Check every distinct link target once.
  const targets = [...foundOn.keys()];
  console.log(`\nChecking ${targets.length} distinct links directly...`);
  let checked = 0;
  const links = await mapPool(targets, LINK_CONCURRENCY, async (target) => {
    const result = await checkLink(target);
    if (++checked % 100 === 0) console.log(`  ${checked}/${targets.length} links checked`);
    if (DELAY_MS) await sleep(DELAY_MS); // be polite to the server
    return {
      url: target,
      type: new URL(target).origin === origin ? "internal" : "external",
      ...result,
      foundOn: [...foundOn.get(target)],
    };
  });

  // Follow every redirecting link to its end.
  const redirecting = links.filter((l) => l.classification === "redirect");
  console.log(`Following ${redirecting.length} redirecting links to their destination...`);
  await mapPool(redirecting, LINK_CONCURRENCY, async (l) => {
    const result = await followRedirects(l.url, checkLink, { maxHops: MAX_HOPS, delayMs: DELAY_MS });
    const c = classifyRedirect(result);
    l.redirect = { ...c, issueType: redirectIssueType(c) };
  });

  // ---------- images ----------
  const imageSummary = summarizeImages(imageOccurrences);
  console.log(`Checking ${imageSummary.length} distinct images (${imageOccurrences.length} <img> tags)...`);
  const imageChecks = await mapPool(imageSummary, LINK_CONCURRENCY, async (img) => {
    const c = await checkImage(img.url);
    if (DELAY_MS) await sleep(DELAY_MS); // be polite to the server
    return c;
  });
  const imageEntries = imageSummary.map((img, i) => {
    const check = imageChecks[i];
    const findings = imageFindings(img, check);
    return { ...img, status: check.status, classification: check.classification, finalUrl: check.finalUrl, bytes: check.bytes ?? null, contentType: check.contentType ?? null, error: check.error, issues: findings.map((f) => f.type), findings };
  });
  const imgFindings = imageEntries.flatMap((e) => e.findings);
  const imgCount = (t) => imgFindings.filter((f) => f.type === t).length;
  const images = {
    imagesFound: imageEntries.length,
    imgTags: imageOccurrences.length,
    limits: { altMaxChars: IMAGE_LIMITS.altMax, maxBytes: IMAGE_LIMITS.maxBytes },
    broken: imgCount("image-broken"),
    unverified: imageEntries.filter((e) => e.classification === "unverified" || e.classification === "unreachable").length,
    altMissing: imgCount("image-alt-missing"),
    altUnhelpful: imgCount("image-alt-unhelpful"),
    altTooLong: imgCount("image-alt-too-long"),
    mixedContent: imgCount("image-mixed-content"),
    oversized: imgCount("image-oversized"),
    sizeUnknown: imageEntries.filter((e) => e.classification === "ok" && e.bytes === null).length,
  };
  await writeFile("images.json", JSON.stringify({
    summary: images,
    images: imageEntries.map(({ findings, ...e }) => e),
  }, null, 2));

  // Which destinations do many different redirecting links end up on?
  const byDestination = new Map();
  for (const l of redirecting) {
    const dest = l.redirect.finalUrl;
    if (!dest) continue;
    if (!byDestination.has(dest)) byDestination.set(dest, { url: dest, status: l.redirect.finalStatus, sources: [] });
    byDestination.get(dest).sources.push(l.url);
  }
  const redirectTargets = [...byDestination.values()]
    .map((d) => ({ url: d.url, status: d.status, redirectingLinks: d.sources.length, examples: d.sources.slice(0, 3) }))
    .filter((d) => d.redirectingLinks >= 2)
    .sort((a, b) => b.redirectingLinks - a.redirectingLinks);

  // http -> https and www / non-www checks on the start URL's host.
  const siteChecks = await siteLevelChecks(startUrl, checkLink, { maxHops: MAX_HOPS, delayMs: DELAY_MS });

  // ---------- metadata and canonical ----------
  // Rules run on the rendered page (what a browser, and Google, ends up with).
  // Raw is compared so we can say when a tag exists only after JavaScript runs.
  const linkByUrl = new Map(links.map((l) => [l.url, l]));
  const canonicalChecks = new Map();
  const targetResult = async (target) => {
    if (linkByUrl.has(target)) return linkByUrl.get(target);
    if (!canonicalChecks.has(target)) canonicalChecks.set(target, await checkLink(target));
    return canonicalChecks.get(target);
  };

  const metaPages = [];
  for (const p of report) {
    const is2xx = (n) => n >= 200 && n < 300;
    if (!is2xx(p.raw.status) || !is2xx(p.rendered.status) || !p.rendered.head) continue; // errors and redirects are reported elsewhere
    let canonical = null;
    try { canonical = p.rendered.head.canonicals[0] ? new URL(p.rendered.head.canonicals[0], p.url).href : null; } catch { /* bad href: headIssues flags it */ }
    const issues = headIssues(p.rendered.head);
    let canonicalCheck = null;
    if (canonical && !sameUrl(canonical, p.url)) {
      const target = await targetResult(canonical);
      canonicalCheck = { status: target.status, classification: target.classification };
      const found = canonicalTargetIssue(canonical, target);
      if (found) issues.push(found);
    }
    const jsOnly = jsDependence(p.raw.head, p.rendered.head);
    if (jsOnly.length) issues.push({ type: "metadata-js-only", severity: "medium", detail: `${jsOnly.join(", ")} exist only after JavaScript runs` });
    metaPages.push({ url: p.url, foundOn: [...(foundOn.get(p.url) || [])], canonical, canonicalCheck, rawHead: p.raw.head, head: p.rendered.head, issues });
  }
  for (const [url, extra] of findDuplicates(metaPages)) metaPages.find((m) => m.url === url).issues.push(...extra);

  const byType = {};
  for (const m of metaPages) for (const i of m.issues) byType[i.type] = (byType[i.type] || 0) + 1;
  const metadata = {
    pagesAnalysed: metaPages.length,
    pagesWithIssues: metaPages.filter((m) => m.issues.length).length,
    issuesByType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])),
  };

  // ---------- soft 404 ----------
  // Candidates: every crawled page that loaded, plus pages that are only ever
  // reached through redirects (the crawler never lands on them directly, which
  // is exactly how sonagroup.ae's /404.html hides). Capped at 20 extra fetches.
  const redirectsIn = new Map([...byDestination].map(([dest, d]) => [dest, d.sources.length]));
  const is2xx = (n) => n >= 200 && n < 300;
  const soft = [];
  const seenSoft = new Set();
  for (const p of report) {
    if (!is2xx(p.raw.status) || !is2xx(p.rendered.status) || !p.rendered.head) continue;
    seenSoft.add(p.url);
    const r = analyzeSoft404({ title: p.rendered.head.title, h1s: p.rendered.head.h1s, wordCount: p.rendered.wordCount, robots: p.rendered.head.robots, redirectsIn: redirectsIn.get(p.url) || 0 });
    soft.push({ url: p.url, foundOn: [...(foundOn.get(p.url) || [])], via: "crawled", title: p.rendered.head.title, h1s: p.rendered.head.h1s, wordCount: p.rendered.wordCount, ...r });
  }
  const extra = [...byDestination.values()]
    .filter((d) => d.sources.length >= 2 && is2xx(d.status) && new URL(d.url).origin === origin && !seenSoft.has(d.url))
    .slice(0, 20);
  for (const d of extra) {
    const raw = await fetchRaw(d.url);
    if (!is2xx(raw.status) || !raw.head) continue;
    const r = analyzeSoft404({ title: raw.head.title, h1s: raw.head.h1s, wordCount: raw.wordCount, robots: raw.head.robots, redirectsIn: d.sources.length });
    const pagesLinking = new Set(d.sources.flatMap((s) => [...(foundOn.get(s) || [])]));
    soft.push({ url: d.url, foundOn: [...pagesLinking], via: "redirect-target", title: raw.head.title, h1s: raw.head.h1s, wordCount: raw.wordCount, ...r });
  }
  const softFlagged = soft.filter((s) => s.flagged);
  await writeFile("soft404.json", JSON.stringify({
    summary: { pagesAnalysed: soft.length, flagged: softFlagged.length },
    pages: soft.filter((s) => s.signals.length),
  }, null, 2));

  // ---------- issue registry ----------
  const runId = "run-" + startedAt.replace(/[-:]/g, "").slice(0, 15);
  const registry = buildRegistry({
    run: { id: runId, startedAt, finishedAt: new Date().toISOString(), startUrl, pagesCrawled: visited.size, capReached, toolVersion: "0.6" },
    links, siteChecks, metaPages, softPages: soft, imageFindings: imgFindings,
  });
  const registryProblems = validateRegistry(registry);
  await writeFile("issues.json", JSON.stringify(registry, null, 2));

  const count = (c) => links.filter((l) => l.classification === c).length;
  const kindCount = (t) => redirecting.filter((l) => l.redirect.issueType === t).length;
  const summary = {
    startUrl,
    maxPages: MAX_PAGES || "no cap",
    concurrency: CONCURRENCY,
    pagesCrawled: visited.size,
    capReached,
    pagesLeftInQueue: capReached ? queue.length : 0,
    sitemapUrls: sitemapListed.length,
    // Listed in the sitemap but no crawled page links to them (possible orphans).
    sitemapOnly: sitemapListed.filter((u) => { const k = crawlKey(u); return k && visited.has(k) && !foundOn.has(u) && !foundOn.has(k); }).length,
    linksChecked: links.length,
    ok: count("ok"),
    broken: count("broken"),
    unverified: count("unverified"),
    unreachable: count("unreachable"),
    redirecting: redirecting.length,
    redirectLoops: kindCount("redirect-loop"),
    redirectChains: kindCount("redirect-chain"),
    redirectsToError: kindCount("redirect-to-error"),
    singleRedirects: redirecting.filter((l) => !l.redirect.issueType).length,
    siteChecks: siteChecks.skipped ? `skipped (${siteChecks.skipped})` : `${siteChecks.findings.length} finding(s)`,
  };

  await writeFile("report.json", JSON.stringify(report, null, 2));
  await writeFile("links.json", JSON.stringify({ summary, siteChecks, redirectTargets, links }, null, 2));
  await writeFile("metadata.json", JSON.stringify({ summary: metadata, pages: metaPages }, null, 2));

  // Readable result in the console (and the Actions log).
  console.log("\n=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  if (capReached) console.log(`\nNOTE: stopped at the --max-pages limit of ${MAX_PAGES} with ${queue.length} pages still queued. Drop --max-pages to crawl everything.`);

  const foundLine = (l) => `      found on: ${l.foundOn.slice(0, 5).join(", ")}${l.foundOn.length > 5 ? ` (+${l.foundOn.length - 5} more)` : ""}`;
  const show = (label, list, line) => {
    if (!list.length) return;
    console.log(`\n${label} (${list.length}):`);
    for (const l of list.slice(0, 25)) { console.log(line(l)); console.log(foundLine(l)); }
    if (list.length > 25) console.log(`  ... and ${list.length - 25} more in links.json`);
  };
  const plain = (l) => `  ${l.status ?? l.error}  ${l.url}`;
  const chainLine = (l) => `  ${l.redirect.hops} hop(s)  ${l.redirect.chain.join(" -> ")}${l.redirect.finalStatus ? `  [ends ${l.redirect.finalStatus}]` : ""}`;

  show("Broken links", links.filter((l) => l.classification === "broken"), plain);
  show("Unreachable links", links.filter((l) => l.classification === "unreachable"), plain);
  show("Redirect loops", redirecting.filter((l) => l.redirect.issueType === "redirect-loop"), chainLine);
  show("Redirect chains (2 or more hops)", redirecting.filter((l) => l.redirect.issueType === "redirect-chain"), chainLine);
  show("Redirects that end in an error", redirecting.filter((l) => l.redirect.issueType === "redirect-to-error"), chainLine);
  show("Unverified links (blocked or timed out)", links.filter((l) => l.classification === "unverified"), plain);

  const single = redirecting.filter((l) => !l.redirect.issueType);
  if (single.length) {
    console.log(`\nSingle redirects to a working page (${single.length}): internal links that point at a redirect. First 5:`);
    for (const l of single.slice(0, 5)) console.log(`  ${l.url}  ->  ${l.redirect.finalUrl}`);
  }
  if (redirectTargets.length) {
    console.log("\nMost common redirect destinations (2 or more redirecting links end here):");
    for (const d of redirectTargets.slice(0, 5)) console.log(`  ${d.redirectingLinks} links  ->  ${d.url}  [${d.status}]`);
  }
  console.log("\n=== Site-level checks (http -> https, www / non-www) ===");
  if (siteChecks.skipped) console.log(`  skipped: ${siteChecks.skipped}`);
  else if (!siteChecks.findings.length) console.log("  no findings");
  else for (const f of siteChecks.findings) console.log(`  ${f.type}: ${f.detail}`);

  console.log("\n=== Metadata and canonical ===");
  console.log(`  ${metadata.pagesAnalysed} pages analysed, ${metadata.pagesWithIssues} with at least one issue`);
  for (const [type, n] of Object.entries(metadata.issuesByType)) {
    console.log(`\n${type} (${n}):`);
    const examples = metaPages.filter((m) => m.issues.some((i) => i.type === type)).slice(0, 3);
    for (const m of examples) console.log(`  ${m.url}  ${m.issues.find((i) => i.type === type).detail}`);
    if (n > 3) console.log(`  ... and ${n - 3} more in metadata.json`);
  }

  console.log("\n=== Images ===");
  console.log(`  ${images.imagesFound} distinct images in ${images.imgTags} <img> tags: ${images.broken} broken, ${images.altMissing} missing alt, ${images.altUnhelpful} unhelpful alt, ${images.altTooLong} alt too long, ${images.mixedContent} mixed content, ${images.oversized} over ${formatBytes(IMAGE_LIMITS.maxBytes)}`);
  for (const t of ["image-broken", "image-alt-missing", "image-alt-unhelpful", "image-alt-too-long", "image-mixed-content", "image-oversized"]) {
    const list = imgFindings.filter((f) => f.type === t);
    if (!list.length) continue;
    console.log(`\n${t} (${list.length}):`);
    for (const f of list.slice(0, 5)) console.log(`  ${f.affectedUrl}  ${f.detail}  (on ${f.foundOn.length} page${f.foundOn.length === 1 ? "" : "s"})`);
    if (list.length > 5) console.log(`  ... and ${list.length - 5} more in images.json`);
  }

  console.log("\n=== Soft 404 ===");
  console.log(`  ${soft.length} pages analysed (${extra.length} reached only through redirects), ${softFlagged.length} flagged`);
  for (const s of softFlagged.slice(0, 10)) {
    console.log(`\n  ${s.url}${s.via === "redirect-target" ? "  (only reached through redirects)" : ""}`);
    for (const sig of s.signals) console.log(`      ${sig.strength === "strong" ? "*" : "-"} ${sig.detail}`);
  }
  if (softFlagged.length > 10) console.log(`\n  ... and ${softFlagged.length - 10} more in soft404.json`);

  console.log("\n=== Issue registry ===");
  const sev = registry.counts.bySeverity;
  console.log(`  ${registry.counts.total} issues: ${sev.high || 0} high, ${sev.medium || 0} medium, ${sev.low || 0} low  (run ${runId})`);
  for (const [type, n] of Object.entries(registry.counts.byType).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${type}`);
  if (registryProblems.length) {
    console.log(`\nWARNING: ${registryProblems.length} registry problem(s):`);
    for (const p of registryProblems.slice(0, 5)) console.log(`  ${p}`);
    process.exitCode = 1;
  }

  console.log("\nDone. See issues.json (all findings) plus report.json, links.json, metadata.json, soft404.json and images.json");
}

main();