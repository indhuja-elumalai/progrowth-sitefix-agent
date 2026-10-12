// Scores the crawler's output against the planted issues in expected-issues.json.
// Run after:  node crawl.js http://localhost:4000
//   node fixture/score.js              print the table
//   node fixture/score.js --require 5  also exit 1 if fewer than 5 planted issues
//                                      are found, or if anything unplanted is flagged
//
// Reads issues.json, the issue registry. Every detector's findings are in it,
// so this also proves the registry carries everything the fixture expects, and
// it fails if any issue in the registry is malformed.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRegistry } from "../lib/issues.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..");
const args = process.argv.slice(2);
const reqIdx = args.indexOf("--require");
const required = reqIdx !== -1 ? Number(args[reqIdx + 1]) : null;

const truth = JSON.parse(await readFile(path.join(dir, "expected-issues.json"), "utf8"));
const registry = JSON.parse(await readFile(path.join(root, "issues.json"), "utf8"));
const schemaProblems = validateRegistry(registry);
const baseOrigin = new URL(truth.baseUrl).origin;

const toPath = (u) => { const x = new URL(u); return x.pathname + x.search; };
// What we want to compare: internal URLs as paths, external URLs in full.
const norm = (u) => (new URL(u).origin === baseOrigin ? toPath(u) : u);

// Every issue in the registry is a detection.
const detections = registry.issues.map((i) => ({ type: i.type, url: norm(i.affectedUrl), foundOn: i.foundOn.map(toPath) }));

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
console.log(`Registry schema problems: ${schemaProblems.length}`);
for (const p of schemaProblems.slice(0, 5)) console.log(`  ${p}`);
for (const u of unplanted) console.log(`  ${u.type}  ${u.url}`);

if (required !== null) {
  const ok = found >= required && unplanted.length === 0 && schemaProblems.length === 0;
  console.log(ok ? `\nPASS: at least ${required} found, no false positives, valid registry.` : `\nFAIL: need at least ${required} found, 0 false positives and a valid registry.`);
  process.exit(ok ? 0 : 1);
}