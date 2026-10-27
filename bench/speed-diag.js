// Times the phone speed test (lib/speed.js) on the bench site and prints what it measured,
// to compare measuring methods: the same pages, wall time and the metrics per page.
// Usage: node bench/speed-diag.js [--base http://localhost:4100] [--pages 30] [--concurrency 3]
import { chromium } from "playwright";
import { measurePages, summarizeSpeed } from "../lib/speed.js";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const base = opt("base", "http://localhost:4100");
const n = Number(opt("pages", 30));
const concurrency = Number(opt("concurrency", 3));
const urls = [`${base}/`, ...Array.from({ length: n - 1 }, (_, k) => `${base}/p/${k + 1}`)];
const t0 = Date.now();
const results = await measurePages(urls, { chromium, concurrency });
const secs = (Date.now() - t0) / 1000;
const s = summarizeSpeed(results, urls.length);
console.log(JSON.stringify({ seconds: secs, perPage: +(secs / urls.length).toFixed(2), median: s.median, lcp: s.lcp, cls: s.cls, tbt: s.tbt, failed: s.pagesFailed }));
if (args.includes("--each")) for (const r of results) console.log(r.url.replace(base, ""), r.ok ? JSON.stringify(r.metrics) : r.error);
