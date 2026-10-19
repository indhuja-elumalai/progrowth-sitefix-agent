// Checks that the fixture really behaves the way expected-issues.json claims.
// Run with the fixture server already running:  node fixture/selfcheck.js
import { LIMITS } from "../lib/seo.js";
import { COMMON_MISSPELLINGS } from "../lib/copy.js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.FIXTURE_BASE || "http://localhost:4000";
const ext = process.env.FIXTURE_EXT || "http://localhost:4001";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
};

const hit = async (url) => {
  const r = await fetch(url, { redirect: "manual" });
  return { status: r.status, location: r.headers.get("location") };
};

// Follow redirects by hand so chains and loops can be counted.
async function follow(start, max = 10) {
  let url = start, hops = 0;
  const seen = new Set();
  while (hops < max) {
    const { status, location } = await hit(url);
    if (status < 300 || status >= 400) return { hops, final: status, url, loop: false };
    seen.add(url);
    url = new URL(location, url).href;
    hops++;
    if (seen.has(url)) return { hops, loop: true, url };
  }
  return { hops, loop: false, tooLong: true };
}

console.log("-- HTTP behaviour");
for (const p of ["/", "/about.html", "/contact.html", "/final.html", "/broken-links.html", "/broken-image.html",
  "/redirects.html", "/soft-404.html", "/missing-title.html", "/dup-title-1.html", "/dup-title-2.html",
  "/canonical-to-404.html", "/gone.html", "/image-alt.html", "/large-image.html",
  "/noindex.html", "/heading-skip.html", "/no-social.html", "/social-partial.html", "/page-setup.html",
  "/location-austin.html", "/location-denver.html", "/draft-page.html", "/typos-page.html",
  "/img/logo.svg", "/img/office.svg", "/img/team-photo.svg", "/img/chart.svg", "/img/divider.svg", "/img/pattern.svg"]) {
  const { status } = await hit(base + p);
  check(`200 ${p}`, status === 200, `got ${status}`);
}
for (const p of ["/does-not-exist.html", "/img/missing.jpg", "/gone-page.html", "/img/missing-share.png"]) {
  const { status } = await hit(base + p);
  check(`404 ${p}`, status === 404, `got ${status}`);
}
check("external /gone is 404", (await hit(ext + "/gone")).status === 404);
const banner = await fetch(base + "/img/large-banner.svg", { method: "HEAD" });
const bannerBytes = Number(banner.headers.get("content-length"));
check("large-banner.svg is 200 and reports a size over 300 KB", banner.status === 200 && bannerBytes > 300 * 1024, `status=${banner.status} bytes=${bannerBytes}`);
check("external /ok is 200", (await hit(ext + "/ok")).status === 200);

const help = await follow(base + "/old-help");
const faq = await follow(base + "/old-faq");
check("/old-help and /old-faq each redirect once to /gone.html (200)", help.hops === 1 && help.final === 200 && faq.hops === 1 && faq.final === 200, `help=${help.hops}/${help.final} faq=${faq.hops}/${faq.final}`);

const chain = await follow(base + "/redirect-chain-start");
check("redirect chain has 3 hops and ends in 200", chain.hops === 3 && chain.final === 200 && !chain.loop, `hops=${chain.hops}`);
const loop = await follow(base + "/loop-a");
check("loop-a is a redirect loop", loop.loop === true);
const toError = await follow(base + "/old-page");
check("/old-page redirects once to a 404", toError.hops === 1 && toError.final === 404 && !toError.loop, `hops=${toError.hops} final=${toError.final}`);

console.log("-- Page hygiene (so nothing unplanted gets flagged)");
const files = (await readdir(path.join(dir, "site"))).filter((f) => f.endsWith(".html"));
const info = {};
for (const f of files) {
  const html = await readFile(path.join(dir, "site", f), "utf8");
  info[f] = {
    title: (html.match(/<title>([^<]*)<\/title>/i) || [])[1] ?? null,
    desc: (html.match(/<meta name="description" content="([^"]*)"/i) || [])[1] ?? null,
    canonical: (html.match(/<link rel="canonical" href="([^"]*)"/i) || [])[1] ?? null,
    h1: /<h1>/i.test(html),
  };
}
check("every page has a description, H1 and canonical", files.every((f) => info[f].desc && info[f].h1 && info[f].canonical));
check("only missing-title.html lacks a title", files.filter((f) => !info[f].title).join() === "missing-title.html");
const titles = files.map((f) => info[f].title).filter(Boolean);
const dupTitles = titles.filter((t, i) => titles.indexOf(t) !== i);
check("exactly one duplicated title (the planted pair)", new Set(dupTitles).size === 1 && dupTitles.length === 1);
const descs = files.map((f) => info[f].desc);
check("all descriptions are unique", new Set(descs).size === descs.length);
check(
  `titles are ${LIMITS.titleMin}-${LIMITS.titleMax} chars and descriptions ${LIMITS.descriptionMin}-${LIMITS.descriptionMax} chars (so length rules stay quiet)`,
  files.every((f) => (!info[f].title || (info[f].title.length >= LIMITS.titleMin && info[f].title.length <= LIMITS.titleMax)) &&
    info[f].desc.length >= LIMITS.descriptionMin && info[f].desc.length <= LIMITS.descriptionMax),
  files.filter((f) => (info[f].title && (info[f].title.length < LIMITS.titleMin || info[f].title.length > LIMITS.titleMax)) || info[f].desc.length < LIMITS.descriptionMin || info[f].desc.length > LIMITS.descriptionMax).join()
);
const imgTags = {};
for (const f of files) imgTags[f] = (await readFile(path.join(dir, "site", f), "utf8")).match(/<img\b[^>]*>/gi) || [];
const lacksAlt = (tag) => !/\salt=/i.test(tag) && !/aria-hidden="true"/i.test(tag);
check("only image-alt.html has an image without alt (the planted office.svg)",
  files.filter((f) => imgTags[f].some(lacksAlt)).join() === "image-alt.html" && imgTags["image-alt.html"].filter(lacksAlt).length === 1);
check("image-alt.html keeps its two decorative controls (alt=\"\" and aria-hidden)",
  imgTags["image-alt.html"].some((t) => /alt=""/.test(t)) && imgTags["image-alt.html"].some((t) => /aria-hidden="true"/.test(t)));
const raw = {};
for (const f of files) raw[f] = await readFile(path.join(dir, "site", f), "utf8");
const only = (pred) => files.filter((f) => pred(raw[f])).sort().join();
check("only noindex.html has a robots meta tag", only((h) => /<meta name="robots"/i.test(h)) === "noindex.html");
check("only page-setup.html lacks a viewport tag and a lang attribute",
  only((h) => !/<meta name="viewport"/i.test(h)) === "page-setup.html" && only((h) => !/<html lang="/i.test(h)) === "page-setup.html");
check("only no-social.html has no Open Graph tags", only((h) => !/property="og:/i.test(h)) === "no-social.html");
check("only social-partial.html has incomplete Open Graph tags (no og:description)",
  only((h) => /property="og:/i.test(h) && !(/property="og:title"/.test(h) && /property="og:description"/.test(h) && /property="og:image"/.test(h))) === "social-partial.html");
const skips = (h) => { const lv = [...h.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1])); return lv.some((l, i) => i && l > lv[i - 1] + 1); };
check("only heading-skip.html skips a heading level", only(skips) === "heading-skip.html");
const text = (h) => h.replace(/<head>[\s\S]*<\/head>/i, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
check("only draft-page.html has placeholder text (lorem ipsum, {{ }})", only((h) => /lorem ipsum|\{\{/i.test(text(h))) === "draft-page.html");
// Line by line, like the browser's visible text: a heading and the next paragraph are separate lines.
const lines = (h) => h.replace(/<head>[\s\S]*<\/head>/i, " ").split(/<\/?(?:p|li|ul|h[1-6]|div|br)\b[^>]*>/i).map((l) => l.replace(/<[^>]+>/g, " ").trim()).filter(Boolean);
check("only draft-page.html has a doubled word", only((h) => lines(h).some((l) => /\b(\w{2,})\s+\1\b/i.test(l.replace(/\b(had|that) \1\b/gi, "")))) === "draft-page.html");
const words = (h) => (text(h).match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || []).length;
check("every page except contact.html and soft-404.html has at least 200 words",
  only((h) => words(h) < 200) === "contact.html,soft-404.html", files.filter((f) => words(raw[f]) < 200).map((f) => `${f}=${words(raw[f])}`).join(" "));
const misspelled = (h) => (text(h).match(/[A-Za-z]+/g) || []).filter((w) => COMMON_MISSPELLINGS[w.toLowerCase()]);
check("only typos-page.html has common misspellings (recieve, seperate)",
  only((h) => misspelled(h).length > 0) === "typos-page.html" && misspelled(raw["typos-page.html"]).map((w) => w.toLowerCase()).sort().join() === "recieve,seperate");
check("only canonical-to-404.html has a non-self canonical", files.filter((f) => info[f].canonical !== `${base}/${f}`).join() === "canonical-to-404.html");

console.log("-- Ground truth file");
const truth = JSON.parse(await readFile(path.join(dir, "expected-issues.json"), "utf8"));
check(`expected-issues.json lists ${truth.plantedCount} issues`, truth.issues.length === truth.plantedCount);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);