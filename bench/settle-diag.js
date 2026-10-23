// Shows why a page never "settles": opens each URL like crawl.js does (images, video
// and fonts blocked) and records every 100 ms what changes for 4 seconds.
// Usage: node bench/settle-diag.js <url> [url...]
// Use it when links.json says many pages hit the settle limit (summary.pageTiming).
import { chromium } from "playwright";

const EXT = ["jpg","jpeg","png","gif","webp","avif","svg","ico","mp4","webm","mp3","woff","woff2","ttf","otf","eot"];
const BLOCKED = EXT.flatMap((e) => [`*.${e}`, `*.${e}?*`]);
const browser = await chromium.launch();
const context = await browser.newContext();
for (const url of process.argv.slice(2)) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setBlockedURLs", { urls: BLOCKED });
  const t = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log(`\n=== ${url}  (DOMContentLoaded after ${Date.now() - t} ms)`);
  const samples = await page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const start = performance.now();
    let prevText = document.body ? document.body.textContent : "";
    let prevLinks = [...document.links].map((a) => a.href);
    let prevImgs = [...document.images].map((i) => i.getAttribute("src") || i.getAttribute("data-src") || "");
    let prevHead = document.head ? document.head.innerHTML : "";
    const tick = () => {
      const now = Math.round(performance.now() - start);
      const text = document.body ? document.body.textContent : "";
      const links = [...document.links].map((a) => a.href);
      const imgs = [...document.images].map((i) => i.getAttribute("src") || i.getAttribute("data-src") || "");
      const head = document.head ? document.head.innerHTML : "";
      const notes = [];
      if (Math.abs(text.length - prevText.length) > Math.max(40, prevText.length * 0.02)) {
        let i = 0; while (i < text.length && text[i] === prevText[i]) i++;
        notes.push(`TEXT ${prevText.length} -> ${text.length} chars, changed near: "${text.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, " ")}"`);
      }
      if (links.length !== prevLinks.length) notes.push(`LINKS ${prevLinks.length} -> ${links.length}; new: ${links.filter((l) => !prevLinks.includes(l)).slice(0, 3).join(" , ")}`);
      if (imgs.length !== prevImgs.length) notes.push(`IMAGES ${prevImgs.length} -> ${imgs.length}; new: ${imgs.filter((l) => !prevImgs.includes(l)).slice(0, 3).join(" , ")}`);
      if (head.length !== prevHead.length) {
        const added = [...new DOMParser().parseFromString(head, "text/html").head.children].map((e) => e.outerHTML.slice(0, 120)).filter((h) => !prevHead.includes(h)).slice(0, 2);
        notes.push(`HEAD ${prevHead.length} -> ${head.length} chars; added: ${added.join(" | ")}`);
      }
      if (notes.length) out.push(`${String(now).padStart(5)} ms  [${document.readyState}]  ${notes.join("  ||  ")}`);
      prevText = text; prevLinks = links; prevImgs = imgs; prevHead = head;
      if (now < 4000) setTimeout(tick, 100); else resolve({ out, ready: document.readyState });
    };
    setTimeout(tick, 100);
  }));
  console.log(samples.out.length ? samples.out.slice(0, 40).join("\n") : "  nothing changed after DOMContentLoaded");
  if (samples.out.length > 40) console.log(`  ... and ${samples.out.length - 40} more changes`);
  console.log(`  readyState at the end: ${samples.ready}`);
  await page.close();
}
await browser.close();
