// Report builder: runs after crawl.js.
// Usage: node report.js [--no-ai] [--no-screenshots] [--max-screenshots 30]
//
// 1. Reads issues.json (plus the detector summaries) from the last crawl.
// 2. Triage: priority (P1/P2/P3), who fixes it, effort (lib/triage.js).
// 3. Explanations and suggested fixes: AI with guardrails, or standard guidance
//    when AI is off or an answer fails a check (lib/explain.js).
// 4. Screenshots of the affected pages, with the problem outlined (lib/screenshots.js),
//    taken while the explanations are being written (both at the same time).
// 5. Writes audit-report/explained.json, report.html, sitefix-report.pdf and
//    web-report.html (the interactive report as one file, screenshots built in).
//
// AI settings come from the environment or a .env file (see lib/ai-provider.js).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadEnv } from "./lib/env.js";
import { aiConfig, providerFromConfig } from "./lib/ai-provider.js";
import { triage, triageSummary } from "./lib/triage.js";
import { explainIssues, groupByType } from "./lib/explain.js";
import { buildReportHtml } from "./lib/report-html.js";
import { buildWebReport } from "./lib/web-report.js";
import { createProgress } from "./lib/progress.js";
import { shotPlan, capture } from "./lib/screenshots.js";

const progress = createProgress({ enabled: process.env.SITEFIX_PROGRESS === "1" });

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i !== -1 && args[i + 1] ? Number(args[i + 1]) : fallback; };
const OUT = "audit-report";
const MAX_SHOTS = flag("no-screenshots") ? 0 : opt("max-screenshots", 30);
const CACHE_FILE = ".sitefix-ai-cache.json";

const readJson = async (file) => { try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; } };

// ---------- screenshots ----------
// One per kind of problem first, then more of the P1s (lib/screenshots.js takes them).
function pickShots(types, max) {
    const picks = [];
    const seen = new Set();
    const add = (i) => {
        const plan = shotPlan(i);
        if (!plan) return;
        const key = `${plan.page}|${plan.target || ""}`;
        if (seen.has(key) || picks.length >= max) return;
        seen.add(key);
        picks.push({ id: i.id, ...plan });
    };
    for (const t of types) if (t.issues[0]) add(t.issues[0]);
    for (const t of types) for (const i of t.issues) if (i.priority === "P1") add(i);
    return picks;
}

let shotProgress = () => { };
async function takeShots(picks, dir) {
    const shots = new Map();
    if (!picks.length) return shots;
    await mkdir(dir, { recursive: true });
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let done = 0, next = 0;
    await Promise.all(Array.from({ length: Math.min(6, picks.length) }, async () => {
        while (next < picks.length) {
            const p = picks[next++];
            const file = path.join(dir, `${p.id}.jpg`);
            if (await capture(context, p, file)) shots.set(p.id, file);
            console.log(`  screenshot ${++done}/${picks.length}`);
            shotProgress(done, picks.length);
        }
    }));
    await browser.close();
    return shots;
}

async function main() {
    loadEnv();
    const registry = await readJson("issues.json");
    if (!registry) { console.error("issues.json not found: run the crawler first (node crawl.js <url>)."); process.exit(1); }
    const [links, images, content, metadata, speed] = await Promise.all(["links.json", "images.json", "content.json", "metadata.json", "speed.json"].map(readJson));
    const startUrl = registry.run?.startUrl;

    const issues = registry.issues.map((i) => ({ ...i, ...triage(i, { startUrl }) }));
    const config = aiConfig();
    const provider = flag("no-ai") ? null : await providerFromConfig(config);

    // Explanations (AI calls) and screenshots (a browser) do not depend on each
    // other, so they run at the same time.
    const picks = pickShots(groupByType(issues).map((t) => ({ ...t, issues: t.list })), MAX_SHOTS);
    console.log("\n=== AI explanations ===");
    if (provider) console.log(`  ${provider.name} (${provider.model}): explaining ${new Set(issues.map((i) => i.type)).size} issue types; ${picks.length} screenshots at the same time`);
    else console.log(`  AI off (${flag("no-ai") ? "--no-ai" : config.problem}): using standard guidance; ${picks.length} screenshots`);
    const cacheData = (await readJson(CACHE_FILE)) || {};
    const cache = { get: (k) => cacheData[k], set: (k, v) => { cacheData[k] = v; } };
    const typeCount = new Set(issues.map((i) => i.type)).size;
    const work = { explained: 0, shots: 0 };
    const sendReportProgress = () => progress.set({ phase: "report", step: { done: work.explained + work.shots, total: typeCount + picks.length }, explain: { done: work.explained, total: typeCount }, shots: { done: work.shots, total: picks.length } });
    shotProgress = (done) => { work.shots = done; sendReportProgress(); };
    sendReportProgress();
    const [{ types, stats }, shotFiles] = await Promise.all([
        explainIssues({
            issues, provider, cache,
            onProgress: ({ done, total, type, source, problems }) => {
                work.explained = done; sendReportProgress();
                console.log(`  ${done}/${total} ${type}: ${source === "ai" ? "AI" : "standard"}${problems.length ? ` (${problems.length} check(s) failed: ${problems[0]})` : ""}`);
            },
        }),
        takeShots(picks, path.join(OUT, "shots")),
    ]);
    if (provider) await writeFile(CACHE_FILE, JSON.stringify(cacheData));

    console.log("\n=== Screenshots ===");
    console.log(`  ${shotFiles.size} of ${picks.length} pages captured`);

    const report = {
        generatedAt: new Date().toISOString(),
        run: registry.run,
        ai: { provider: provider ? provider.name : "none", model: provider ? provider.model : null, ...stats },
        summary: triageSummary(issues),
        summaries: { links: links?.summary, images: images?.summary, content: content?.summary, metadata: metadata?.summary, speed: speed?.summary || null },
        types: types.map((t) => ({ ...t, issues: t.issues.map((i) => ({ ...i, screenshot: shotFiles.has(i.id) ? `shots/${i.id}.jpg` : null })) })),
    };
    await mkdir(OUT, { recursive: true });
    await writeFile(path.join(OUT, "explained.json"), JSON.stringify(report, null, 2));

    console.log("\n=== PDF report ===");
    progress.set({ phase: "pdf" });
    const shots = new Map();
    for (const [id, file] of shotFiles) if (existsSync(file)) shots.set(id, `data:image/jpeg;base64,${(await readFile(file)).toString("base64")}`);
    const html = buildReportHtml({ report, shots });
    await writeFile(path.join(OUT, "report.html"), html);
    await writeFile(path.join(OUT, "web-report.html"), buildWebReport({ report, standalone: true, shotSrc: (i) => shots.get(i.id) || null }));
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: path.join(OUT, "sitefix-report.pdf"), format: "A4", printBackground: true, margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" } });
    await browser.close();

    const s = report.summary;
    console.log(`  ${issues.length} issues: ${s.byPriority.P1} P1, ${s.byPriority.P2} P2, ${s.byPriority.P3} P3, ${s.quickWins} quick wins; ${stats.aiTypes} of ${stats.types} types explained by AI, ${shots.size} screenshots`);
    if (stats.problems.length) console.log(`  ${stats.problems.length} AI check(s) failed (standard guidance used there), e.g. ${stats.problems[0]}`);
    progress.set({ phase: "report-done", final: true });
    console.log(`\nReport ready: ${OUT}/sitefix-report.pdf and ${OUT}/web-report.html (data in ${OUT}/explained.json)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
