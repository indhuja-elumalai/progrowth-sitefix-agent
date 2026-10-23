// Live progress from crawl.js and report.js to the UI, as one JSON object per line
// on stdout, so the UI shows real numbers instead of guessing from log text.
//
//   @@sitefix {"kind":"progress", phase, pages, checks, step, issues, elapsedMs, etaMs, current}
//   @@sitefix {"kind":"finding", type, severity, url, detail}
//
// createProgress({ enabled, write, intervalMs, now, maxFindings })
//   set(patch)      update the state; sent at most every intervalMs, at once on a new phase
//   finding(f)      an issue seen while the crawl runs (a preview: the final list comes
//                   from the registry); counted by severity, the first maxFindings sent
//   flush()         send the current state now
// estimateEta(samples, remaining) -> ms left, from recent [time, done] samples, or null
// parseProgressLine(line) -> the object, or null for an ordinary log line
//
// Nothing is written unless enabled (the UI server sets SITEFIX_PROGRESS=1), so the
// command-line output stays as it was.

export const PROGRESS_PREFIX = "@@sitefix ";

export function estimateEta(samples, remaining) {
    if (!(remaining > 0) || samples.length < 2) return remaining === 0 ? 0 : null;
    const [t0, d0] = samples[0];
    const [t1, d1] = samples[samples.length - 1];
    if (t1 - t0 < 3000 || d1 <= d0) return null; // too early to tell
    return Math.round(remaining / ((d1 - d0) / (t1 - t0)));
}

export function parseProgressLine(line) {
    if (typeof line !== "string" || !line.startsWith(PROGRESS_PREFIX)) return null;
    try {
        const o = JSON.parse(line.slice(PROGRESS_PREFIX.length));
        return o && (o.kind === "progress" || o.kind === "finding") ? o : null;
    } catch { return null; }
}

const SAMPLE_WINDOW_MS = 30000;

export function createProgress({ enabled = true, write = (s) => process.stdout.write(s), intervalMs = 250, now = Date.now, maxFindings = 400 } = {}) {
    const startedAt = now();
    const state = {
        phase: null,
        pages: { done: 0, found: 0, sitemap: 0, cap: 0 },
        checks: { done: 0, total: 0 },
        step: { done: 0, total: 0 },
        issues: { high: 0, medium: 0, low: 0, total: 0 },
        current: null,
        final: false,
    };
    const samples = [];
    const seen = new Set();
    let sent = 0;
    let lastEmit = -Infinity;

    const remainingPages = () => {
        const total = Math.max(state.pages.found, state.pages.sitemap, state.pages.done);
        const capped = state.pages.cap ? Math.min(total, state.pages.cap) : total;
        return Math.max(0, capped - state.pages.done);
    };
    const emit = () => {
        if (!enabled) return;
        lastEmit = now();
        const etaMs = state.phase === "crawl" ? estimateEta(samples, remainingPages()) : null;
        write(PROGRESS_PREFIX + JSON.stringify({ kind: "progress", ...state, elapsedMs: lastEmit - startedAt, etaMs }) + "\n");
    };

    function set(patch = {}) {
        const newPhase = patch.phase !== undefined && patch.phase !== state.phase;
        for (const [k, v] of Object.entries(patch)) {
            if (v && typeof v === "object" && !Array.isArray(v) && state[k] && typeof state[k] === "object") Object.assign(state[k], v);
            else state[k] = v;
        }
        if (newPhase && patch.step === undefined) state.step = { done: 0, total: 0 };
        if (patch.pages && patch.pages.done !== undefined) {
            const t = now();
            samples.push([t, state.pages.done]);
            while (samples.length > 2 && t - samples[0][0] > SAMPLE_WINDOW_MS) samples.shift();
        }
        if (newPhase || state.final || now() - lastEmit >= intervalMs) emit();
    }

    function finding({ type, severity = "low", url = null, detail = null }) {
        const key = `${type}|${url}`;
        if (seen.has(key)) return;
        seen.add(key);
        const sev = ["high", "medium", "low"].includes(severity) ? severity : "low";
        state.issues[sev]++;
        state.issues.total++;
        if (enabled && sent < maxFindings) {
            sent++;
            write(PROGRESS_PREFIX + JSON.stringify({ kind: "finding", type, severity: sev, url, detail: detail ? String(detail).slice(0, 200) : null }) + "\n");
        }
    }

    return { set, finding, flush: emit, state };
}
