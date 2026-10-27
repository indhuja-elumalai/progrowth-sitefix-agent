// A synthetic site for measuring crawl speed: like a real marketing site, every page
// has heavy images, a web font, an analytics script that never lets the network go
// quiet, a carousel that moves forever, a number that counts up, a cookie banner,
// tracking tags added to the head for 3 seconds and a slow tracking script that
// holds back the "load" event, and every response takes a little while. A few problems are planted so a
// faster crawl can be checked for finding exactly the same issues.
//
// Usage: node bench/server.js [--pages 200] [--port 4100] [--latency 120] [--limit-rps 0]
//   --limit-rps N   answer 429 (Retry-After: 1) when more than N pages are asked for
//                   within one second, like a rate-limited host
//   --load-ms N     each page answer takes N ms longer for every other page request
//                   in progress, like a server that renders pages on demand
//   --cold-ms N     the first request for each page takes N ms longer, like a server
//                   that builds a page on its first visit (a cold cache)
//   --weight-kb N   each page also loads 12 images below the first screen, N KB in all
//                   (not lazy-loaded), like a heavy marketing page; for timing the
//                   phone speed test (bench/speed-diag.js)
//   GET /__stats    how many page requests (GET and HEAD) the server has answered
//   http://localhost:4100/         home page; /p/1 ... /p/N content pages
//   http://localhost:4101/         a second host for external links
//
// Planted: a link to a missing page (/p/9999), a missing image, a redirect (/old),
// one external link that is a 404, hero images over 300 KB, a tracking script from
// another host that holds up every page by 0.7 s, and on /p/50 a noindex
// tag that JavaScript adds 0.6 s after the page loads (a slow check must still see it).

import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 ? Number(args[i + 1]) : d; };
const PAGES = opt("pages", 200);
const PORT = opt("port", 4100);
const LATENCY = opt("latency", 120); // ms per HTML response
const LIMIT_RPS = opt("limit-rps", 0);
const LOAD_MS = opt("load-ms", 0);
const COLD_MS = opt("cold-ms", 0);
const WEIGHT_KB = opt("weight-kb", 0);
// A real (decodable) PNG of about the right size: random pixels, stored uncompressed.
// Browsers stop downloading an image they can't decode, so filler bytes would not count.
function pngOfSize(bytes) {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const w = 300, h = Math.max(1, Math.round(bytes / (w * 3 + 1)));
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let i = 0; i < raw.length; i++) raw[i] = i % (w * 3 + 1) === 0 ? 0 : (i * 2654435761) >>> 24;
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
}
const WEIGHT_IMG = WEIGHT_KB ? pngOfSize(Math.round((WEIGHT_KB * 1024) / 12)) : Buffer.alloc(0);
const warm = new Set();
let inflight = 0;
const stats = { pageGet: 0, pageHead: 0, other: 0 };
const BASE = `http://localhost:${PORT}`;
const recent = [];
let refused = 0;
const EXT = `http://localhost:${PORT + 1}`;

// Deterministic words, so every run serves the same site.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
// A vocabulary of 600 made-up words, so pages read as distinct (no near-duplicates
// or doubled words unless planted) while every run serves exactly the same site.
const SYL = ["ka", "lo", "mi", "ra", "ten", "vo", "san", "del", "pri", "mo", "nu", "fa", "zel", "qui", "ber", "lan", "tor", "vis", "per", "dra", "gu", "shi", "ob", "el", "mar", "ust", "fen", "ic", "ad", "rol"];
const VOCAB = [...new Set(Array.from({ length: 900 }, () => Array.from({ length: 2 + Math.floor(rnd() * 2) }, () => SYL[Math.floor(rnd() * SYL.length)]).join("")))].slice(0, 600);
let prev = "";
const word = () => { let w; do { w = VOCAB[Math.floor(rnd() * VOCAB.length)]; } while (w === prev); prev = w; return w; };
const sentence = () => { const w = Array.from({ length: 8 + Math.floor(rnd() * 8) }, word); w[0] = w[0][0].toUpperCase() + w[0].slice(1); return w.join(" ") + "."; };
const texts = Array.from({ length: PAGES + 1 }, () => Array.from({ length: 6 }, () => Array.from({ length: 5 }, sentence).join(" ")));
const names = Array.from({ length: PAGES + 1 }, (_, i) => `${word()} ${word()} ${i}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bytes = (n) => Buffer.alloc(n, 7);
const HERO = bytes(340 * 1024), SMALL = bytes(40 * 1024), FONT = bytes(180 * 1024);

function page(i) {
    const title = i ? `${names[i]} | Bench Site` : "Bench Site home | Fast crawl test";
    const desc = i ? `All about ${names[i]}: what it is, how it works and why it matters to visitors of the bench site.` : "The bench site home page, used to measure how fast SiteFix can crawl a realistic site.";
    const related = i ? Array.from({ length: 8 }, (_, k) => ((i + k * 7) % PAGES) + 1) : Array.from({ length: Math.min(PAGES, 40) }, (_, k) => k + 1);
    const nav = Array.from({ length: 10 }, (_, k) => k + 1);
    const imgs = [`<img src="/img/hero-${i % 20}.jpg" alt="Hero picture for ${names[i]}" width="1200" height="600">`,
        `<img src="/img/a-${i}.jpg" alt="Detail view of ${names[i]}" loading="lazy">`,
        `<img src="/img/b-${i}.jpg" alt="Diagram of ${names[i]}" loading="lazy">`];
    if (i === 33) imgs.push('<img src="/img/missing.jpg" alt="A picture that is not there">');
    if (WEIGHT_KB) for (let k = 0; k < 12; k++) imgs.push(`<img src="/img/w-${i}-${k}.png" alt="Gallery picture ${k + 1} of ${names[i]}" width="300" height="200" style="display:block;margin-top:400px">`);
    const extra = [];
    if (i === 17) extra.push('<a href="/p/9999">An old page</a>');
    if (i === 21) extra.push('<a href="/old">The previous version</a>');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}"><link rel="canonical" href="${BASE}${i ? `/p/${i}` : "/"}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:image" content="${BASE}/img/hero-${i % 20}.jpg">
<style>@font-face{font-family:Bench;src:url(/font.woff2) format("woff2")}body{font-family:Bench,sans-serif;max-width:900px;margin:auto}img{max-width:100%}</style>
<script>setInterval(function(){fetch("/beacon?t="+Date.now()).catch(function(){})},300)</script>
<script async src="/tracker.js"></script>
<script src="${EXT}/fbevents.js"></script>
<script>(function(){var n=0,t=setInterval(function(){var e=document.createElement(n%2?"script":"link");if(n%2){e.src="/beacon?tag="+n;e.async=true}else{e.rel="prefetch";e.href="/p/"+(n+1)}document.head.appendChild(e);if(++n>=8)clearInterval(t)},400);
setTimeout(function(){var d=document.createElement("div");d.textContent="Cookie preferences: we use cookies to improve your visit, measure traffic and personalise content. You can accept all cookies or choose which ones to allow.";document.body.appendChild(d)},200);})();</script>
${i === 50 ? '<script>setTimeout(function(){var m=document.createElement("meta");m.name="robots";m.content="noindex";document.head.appendChild(m)},600)</script>' : ""}
<script>document.addEventListener("DOMContentLoaded",function(){var s=document.getElementById("slides"),i=0,c=document.getElementById("count"),n=0;
setInterval(function(){i=(i+1)%3;s.style.transform="translateX(-"+(i*100)+"%)";s.className="slides s"+i;},120);
var t=setInterval(function(){n+=37;c.textContent=String(n);if(n>=1850)clearInterval(t);},25);});</script></head>
<body><nav>${nav.map((n) => `<a href="/p/${n}">Section ${n}</a>`).join(" ")} <a href="/">Home</a></nav>
<h1>${i ? names[i] : "Bench Site"}</h1><div id="slides" class="slides"><span>Slide one</span><span>Slide two</span><span>Slide three</span></div><p>Clients served: <b id="count">0</b></p>${imgs.join("")}
${texts[i].map((t, k) => `<h2>Part ${k + 1}</h2><p>${t}</p>`).join("")}
<p>Related: ${related.map((r) => `<a href="/p/${r}">${names[r]}</a>`).join(", ")} ${extra.join(" ")}</p>
<p>Elsewhere: <a href="${EXT}/doc/${i % 5}">Reference ${i % 5}</a> <a href="${EXT}/gone">An external page that is gone</a></p>
<footer><a href="/">Home</a> · <a href="${EXT}/privacy">Privacy</a> · All rights reserved by the bench site.</footer></body></html>`;
}

createServer(async (req, res) => {
    const u = new URL(req.url, BASE);
    const p = u.pathname;
    if (p === "/__stats") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(stats)); }
    const isPage = p === "/" || /^\/p\/\d+$/.test(p);
    if (isPage) { if (req.method === "HEAD") stats.pageHead++; else stats.pageGet++; } else stats.other++;
    if (isPage && (LOAD_MS || COLD_MS)) {
        inflight++;
        const cold = COLD_MS && !warm.has(p);
        await sleep(inflight * LOAD_MS + (cold ? COLD_MS : 0));
        if (cold) warm.add(p); // built: later requests for this page are fast
        inflight--;
    }
    if (p === "/beacon") { await sleep(40); res.writeHead(204); return res.end(); }
    if (p === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); return res.end(`User-agent: *\nSitemap: ${BASE}/sitemap.xml\n`); }
    if (p === "/sitemap.xml") {
        res.writeHead(200, { "content-type": "application/xml" });
        return res.end(`<?xml version="1.0"?><urlset>${[`${BASE}/`, ...Array.from({ length: PAGES }, (_, k) => `${BASE}/p/${k + 1}`)].map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`);
    }
    if (p === "/tracker.js") { await sleep(3500); res.writeHead(200, { "content-type": "text/javascript" }); return res.end("window.tracked=1;"); }
    if (p === "/font.woff2") { await sleep(150); res.writeHead(200, { "content-type": "font/woff2", "content-length": FONT.length }); return res.end(req.method === "HEAD" ? undefined : FONT); }
    if (p === "/old") { await sleep(LATENCY / 2); res.writeHead(301, { location: "/p/2" }); return res.end(); }
    let m;
    if (/^\/img\/w-\d+-\d+\.png$/.test(p)) {
        await sleep(40);
        res.writeHead(200, { "content-type": "image/png", "content-length": WEIGHT_IMG.length, "cache-control": "no-store" });
        return res.end(req.method === "HEAD" ? undefined : WEIGHT_IMG);
    }
    if ((m = p.match(/^\/img\/(hero|a|b)-(\d+)\.jpg$/))) {
        const body = m[1] === "hero" ? HERO : SMALL;
        await sleep(60 + body.length / 20000);
        res.writeHead(200, { "content-type": "image/jpeg", "content-length": body.length, "cache-control": "no-store" });
        return res.end(req.method === "HEAD" ? undefined : body);
    }
    if (LIMIT_RPS && (p === "/" || p.startsWith("/p/")) && req.method !== "HEAD") {
        const now = Date.now();
        while (recent.length && now - recent[0] > 1000) recent.shift();
        if (recent.length >= LIMIT_RPS) { refused++; res.writeHead(429, { "retry-after": "1", "content-type": "text/plain" }); return res.end(`slow down (${refused} refused so far)`); }
        recent.push(now);
    }
    if (p === "/") { await sleep(LATENCY); res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(page(0)); }
    if ((m = p.match(/^\/p\/(\d+)$/)) && Number(m[1]) >= 1 && Number(m[1]) <= PAGES) {
        await sleep(LATENCY); res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(page(Number(m[1])));
    }
    await sleep(LATENCY / 2);
    res.writeHead(404, { "content-type": "text/html" }); res.end("<!doctype html><title>Not found</title><h1>Not found</h1>");
}).listen(PORT, () => console.log(`bench site      ${BASE}  (${PAGES} pages${LIMIT_RPS ? `, at most ${LIMIT_RPS} pages a second` : ""})`));
if (LIMIT_RPS) setInterval(() => { if (refused) console.log(`refused ${refused} requests with 429 so far`); }, 5000).unref();

createServer(async (req, res) => {
    const p = new URL(req.url, EXT).pathname;
    // A tracking script loaded without async: the page cannot be read until it arrives.
    if (p === "/fbevents.js") { await sleep(700); res.writeHead(200, { "content-type": "text/javascript" }); return res.end("window.fbq=function(){};"); }
    await sleep(150);
    if (p === "/gone") { res.writeHead(404); return res.end("gone"); }
    res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><title>External</title><p>External page</p>");
}).listen(PORT + 1, () => console.log(`bench external  ${EXT}`));
