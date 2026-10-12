// Scores the crawler's output against the planted issues in expected-issues.json.
// Run after:  node crawl.js http://localhost:4000
//   node fixture/score.js              print the table
//   node fixture/score.js --require 5  also exit 1 if fewer than 5 planted issues
//                                      are found, or if anything unplanted is flagged
//
// Reads links.json (broken links, redirect loops, chains, redirects that end in
// an error), metadata.json (titles, descriptions, H1s, canonicals) and
// soft404.json (pages flagged as soft 404s). Later days add images.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..");
const args = process.argv.slice(2);
const reqIdx = args.indexOf("--require");
const required = reqIdx !== -1 ? Number(args[reqIdx + 1]) : null;

const truth = JSON.parse(await readFile(path.join(dir, "expected-issues.json"), "utf8"));
const { links } = JSON.parse(await readFile(path.join(root, "links.json"), "utf8"));
const { pages: metaPages } = JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8"));
const { pages: softPages } = JSON.parse(await readFile(path.join(root, "soft404.json"), "utf8"));
const baseOrigin = new URL(truth.baseUrl).origin;

const toPath = (u) => { const x = new URL(u); return x.pathname + x.search; };
// What we want to compare: internal URLs as paths, external URLs in full.
const norm = (u) => (new URL(u).origin === baseOrigin ? toPath(u) : u);

// Detections available so far.
const detections = [];
for (const l of links) {
  const base = { url: norm(l.url), foundOn: l.foundOn.map(toPath) };
  if (l.classification === "broken") {
    detections.push({ ...base, type: l.type === "internal" ? "http-4xx-internal" : "http-4xx-external" });
  }
  if (l.redirect?.issueType) detections.push({ ...base, type: l.redirect.issueType });
}

for (const m of metaPages) {
  for (const i of m.issues) detections.push({ type: i.type, url: norm(m.url), foundOn: m.foundOn.map(toPath) });
}

for (const s of softPages.filter((p) => p.flagged)) {
  detections.push({ type: "soft-404", url: norm(s.url), foundOn: s.foundOn.map(toPath) });
}

const matched = new Set();
let found = 0;
console.log("ID    Type                       Affected URL                      Result");
console.log("----  -------------------------  --------------------------------  --------------------------");
for (const issue of truth.issues) {
  const d = detections.find((x) => x.type === issue.type && x.url === issue.affectedUrl);
  let result = "MISSED";
  if (d) {
    matched.add(detections.indexOf(d));
    const foundOnOk = issue.foundOn.every((p) => d.foundOn.includes(p));
    result = foundOnOk ? "FOUND (found-on correct)" : "FOUND (found-on wrong)";
    found++;
  }
  console.log(`${issue.id.padEnd(4)}  ${issue.type.padEnd(25)}  ${issue.affectedUrl.slice(0, 32).padEnd(32)}  ${result}`);
}
const unplanted = detections.filter((_, i) => !matched.has(i));
console.log(`\nFound ${found} of ${truth.plantedCount} planted issues.`);
console.log(`Unplanted findings (false positives): ${unplanted.length}`);
for (const u of unplanted) console.log(`  ${u.type}  ${u.url}`);

if (required !== null) {
  const ok = found >= required && unplanted.length === 0;
  console.log(ok ? `\nPASS: at least ${required} found, no false positives.` : `\nFAIL: need at least ${required} found and 0 false positives.`);
  process.exit(ok ? 0 : 1);
}