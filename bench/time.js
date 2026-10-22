// Times a crawl phase by phase from its log, so any version of crawl.js can be compared.
// Usage: node bench/time.js <url> [crawl.js options]   (prints the phase table at the end)
import { spawn } from "node:child_process";

const PHASES = [
    [/^Crawling \(/, "pages"],
    [/Checking \d+ distinct links/, "links"],
    [/Following \d+ redirecting/, "redirects"],
    [/Checking \d+ distinct images/, "images"],
    [/Checking \d+ distinct share images/, "share images"],
    [/Checking spelling and grammar/, "spelling"],
    [/=== Summary ===/, "registry + output"],
];
const t0 = Date.now();
const marks = [];
let lastPhase = null;
const child = spawn("node", ["crawl.js", ...process.argv.slice(2)], { stdio: ["ignore", "pipe", "inherit"] });
let buf = "";
child.stdout.on("data", (d) => {
    buf += d;
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const l of lines) {
        const hit = PHASES.find(([re]) => re.test(l.trim()));
        if (hit && marks.some(([n]) => n === hit[1])) continue; // a step only starts once
        if (hit && hit[1] !== lastPhase) { marks.push([hit[1], Date.now()]); lastPhase = hit[1]; }
        const pc = l.match(/"pagesCrawled": (\d+)/); if (pc) marks.pages = Number(pc[1]);
    }
});
child.on("close", (code) => {
    const end = Date.now();
    console.log(`\nexit ${code}, ${marks.pages ?? "?"} pages, total ${((end - t0) / 1000).toFixed(1)} s`);
    let prev = t0;
    const rows = [["start-up", marks[0] ? marks[0][1] - t0 : 0]];
    marks.forEach(([name, at], i) => rows.push([name, (marks[i + 1] ? marks[i + 1][1] : end) - at]));
    for (const [n, ms] of rows) console.log(`  ${n.padEnd(18)} ${(ms / 1000).toFixed(1).padStart(6)} s`);
});
