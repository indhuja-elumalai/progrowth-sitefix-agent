// Inspection history: every finished inspection is kept in its own folder, so past
// inspections survive page reloads and server restarts and can be opened or deleted.
//
//   history/<run-id>/meta.json       summary shown in the sidebar
//   history/<run-id>/issues.json     the issue registry from the crawl
//   history/<run-id>/explained.json  the explained report (when report.js ran)
//   history/<run-id>/report.pdf      the PDF report (when it was made)
//   history/<run-id>/shots/*.jpg     screenshots used by the report
//   history/<run-id>/chat.json       questions asked about this inspection, with answers
//   history/deleted.json             ids the user deleted, so they are never re-imported
//
// createHistory({ root, dir, max })  -> { sync, list, load, remove, removeAll, appendChat, file }
// isRunId(id)                         -> true only for ids made by crawl.js (no path tricks)

import { readFile, writeFile, mkdir, readdir, rm, copyFile, rename } from "node:fs/promises";
import path from "node:path";

export const HISTORY_MAX = 50;
const MAX_CHAT = 200;
const MAX_TOMBSTONES = 500;

export const isRunId = (id) => typeof id === "string" && /^run-\d{8}T\d{6}$/.test(id);
const isShot = (name) => /^ISS-[0-9a-f]{10}\.jpg$/.test(name);

const readJson = async (file) => { try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; } };
// Write to a temp file, then rename: a crash never leaves half a JSON file behind.
async function writeJson(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file);
}

export function summarize(registry, report) {
    const run = registry.run || {};
    let host = run.startUrl || "";
    try { host = new URL(run.startUrl).host; } catch { /* keep the raw value */ }
    return {
        id: run.id,
        url: run.startUrl || null,
        host,
        startedAt: run.startedAt || null,
        finishedAt: run.finishedAt || null,
        pagesCrawled: run.pagesCrawled ?? null,
        total: registry.counts?.total ?? (registry.issues || []).length,
        bySeverity: registry.counts?.bySeverity || {},
        byPriority: report?.summary?.byPriority || null,
        quickWins: report?.summary?.quickWins ?? null,
        ai: report ? { provider: report.ai?.provider || "none", model: report.ai?.model || null } : null,
        hasReport: Boolean(report),
        hasPdf: false,
    };
}

// root: the project root (where crawl.js writes issues.json and report.js writes audit-report/)
// dir:  the history folder. max: inspections kept; the oldest are removed beyond it.
export function createHistory({ root, dir = path.join(root, "history"), max = HISTORY_MAX }) {
    const folder = (id) => {
        if (!isRunId(id)) throw new Error("bad inspection id");
        return path.join(dir, id);
    };
    const tombFile = path.join(dir, "deleted.json");
    const tombstones = async () => new Set((await readJson(tombFile)) || []);

    async function list() {
        let names = [];
        try { names = await readdir(dir); } catch { return []; }
        const metas = await Promise.all(names.filter(isRunId).map((id) => readJson(path.join(dir, id, "meta.json"))));
        return metas.filter((m) => m && isRunId(m.id)).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || b.id.localeCompare(a.id));
    }

    async function prune() {
        const all = await list();
        for (const m of all.slice(max)) await rm(folder(m.id), { recursive: true, force: true });
    }

    // Copy the latest crawl (and its report, if the report belongs to the same crawl)
    // into history. Safe to call any time: it adds a new inspection, completes one whose
    // report was made after the crawl, and does nothing when history is already current.
    async function sync() {
        const registry = await readJson(path.join(root, "issues.json"));
        const id = registry?.run?.id;
        if (!isRunId(id) || (await tombstones()).has(id)) return null;
        const reportDir = path.join(root, "audit-report");
        let report = await readJson(path.join(reportDir, "explained.json"));
        if (report?.run?.id !== id) report = null;
        const target = folder(id);
        const old = await readJson(path.join(target, "meta.json"));
        if (old && (old.hasReport || !report)) return old;

        await mkdir(target, { recursive: true });
        await writeJson(path.join(target, "issues.json"), registry);
        const meta = summarize(registry, report);
        if (report) {
            await writeJson(path.join(target, "explained.json"), report);
            const shots = new Set();
            for (const t of report.types || []) for (const i of t.issues || []) {
                const name = String(i.screenshot || "").replace(/^shots\//, "");
                if (isShot(name)) shots.add(name);
            }
            if (shots.size) await mkdir(path.join(target, "shots"), { recursive: true });
            for (const name of shots) await copyFile(path.join(reportDir, "shots", name), path.join(target, "shots", name)).catch(() => {});
            meta.hasPdf = await copyFile(path.join(reportDir, "sitefix-report.pdf"), path.join(target, "report.pdf")).then(() => true, () => false);
        }
        await writeJson(path.join(target, "meta.json"), meta);
        await prune();
        return meta;
    }

    async function load(id) {
        const target = folder(id);
        const meta = await readJson(path.join(target, "meta.json"));
        if (!meta) return null;
        const [registry, report, chat] = await Promise.all(["issues.json", "explained.json", "chat.json"].map((f) => readJson(path.join(target, f))));
        if (!registry) return null;
        return { meta, registry, report, chat: chat || [] };
    }

    // A file inside one inspection: "report.pdf" or "shots/ISS-xxxxxxxxxx.jpg" only.
    function file(id, name) {
        if (name === "report.pdf") return path.join(folder(id), "report.pdf");
        const shot = String(name).replace(/^shots\//, "");
        if (isShot(shot)) return path.join(folder(id), "shots", shot);
        throw new Error("bad file name");
    }

    async function remember(ids) {
        const t = [...(await tombstones()), ...ids].slice(-MAX_TOMBSTONES);
        await mkdir(dir, { recursive: true });
        await writeJson(tombFile, [...new Set(t)]);
    }

    async function remove(id) {
        const target = folder(id);
        const existed = Boolean(await readJson(path.join(target, "meta.json")));
        await remember([id]);
        await rm(target, { recursive: true, force: true });
        return existed;
    }

    async function removeAll() {
        const all = await list();
        // The latest crawl in the project root is remembered too, so it is not re-imported.
        const latest = (await readJson(path.join(root, "issues.json")))?.run?.id;
        await remember([...all.map((m) => m.id), ...(isRunId(latest) ? [latest] : [])]);
        for (const m of all) await rm(folder(m.id), { recursive: true, force: true });
        return all.length;
    }

    async function appendChat(id, entry) {
        const target = folder(id);
        if (!(await readJson(path.join(target, "meta.json")))) return false;
        const chat = (await readJson(path.join(target, "chat.json"))) || [];
        chat.push({ at: new Date().toISOString(), ...entry });
        await writeJson(path.join(target, "chat.json"), chat.slice(-MAX_CHAT));
        return true;
    }

    return { dir, sync, list, load, file, remove, removeAll, appendChat };
}
