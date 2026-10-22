// Keeps the crawler fast without hammering anyone's server.
//
// createThrottle({ perHost, baseDelayMs, maxDelayMs })
//   run(url, fn)        run fn() with at most perHost requests to that host at once;
//                       if fn returns { status, retryAfter }, the host's pace adapts to it
//   wait(url)           wait until the host may be asked again (for requests made elsewhere)
//   note(url, status, retryAfter)
//                       429 or 503: double the pause before the next request to that
//                       host (from 500 ms, up to maxDelayMs; Retry-After is respected, up
//                       to 30 s). Anything else: the pause shrinks back towards baseDelayMs.
//   stats()             { slowDowns, maxDelayMs, hosts: [host...] that asked us to slow down }
//
// createPool(n)         add(fn) -> promise; at most n of them run at the same time.

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SLOW_DOWN = new Set([429, 503]);
const MAX_RETRY_AFTER_MS = 30000;

function retryAfterMs(value, now) {
    if (value === null || value === undefined || value === "") return 0;
    const s = Number(value);
    if (Number.isFinite(s)) return Math.max(0, s * 1000);
    const at = Date.parse(value); // an HTTP date
    return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

export function createThrottle({ perHost = 6, baseDelayMs = 0, maxDelayMs = 8000, sleep = realSleep, now = Date.now } = {}) {
    const hosts = new Map();
    let slowDowns = 0;
    let maxSeen = 0;
    const slowHosts = new Set();
    const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url); } };
    const get = (url) => {
        const key = hostOf(url);
        if (!hosts.has(key)) hosts.set(key, { key, active: 0, queue: [], delay: baseDelayMs, nextAt: 0 });
        return hosts.get(key);
    };

    async function wait(url) {
        const h = get(url);
        for (;;) { // nextAt can move while we sleep (another request was told to slow down)
            const ms = h.nextAt - now();
            if (ms <= 0) return;
            await sleep(ms);
        }
    }

    function note(url, status, retryAfter = null) {
        const h = get(url);
        if (SLOW_DOWN.has(status)) {
            slowDowns++;
            slowHosts.add(h.key);
            h.delay = Math.min(maxDelayMs, Math.max(500, h.delay * 2));
            const asked = Math.min(MAX_RETRY_AFTER_MS, retryAfterMs(retryAfter, now()));
            h.nextAt = Math.max(h.nextAt, now() + Math.max(h.delay, asked));
            maxSeen = Math.max(maxSeen, h.delay, asked);
        } else if (typeof status === "number") {
            h.delay = h.delay > baseDelayMs ? Math.max(baseDelayMs, Math.floor(h.delay * 0.75)) : baseDelayMs;
            if (h.delay < 50) h.delay = baseDelayMs;
            h.nextAt = Math.max(h.nextAt, now() + h.delay);
        }
    }

    async function run(url, fn) {
        const h = get(url);
        if (h.active >= perHost) await new Promise((resolve) => h.queue.push(resolve));
        h.active++;
        try {
            await wait(url);
            const result = await fn();
            if (result && typeof result.status === "number") note(url, result.status, result.retryAfter);
            return result;
        } finally {
            h.active--;
            const next = h.queue.shift();
            if (next) next();
        }
    }

    const stats = () => ({ slowDowns, maxDelayMs: maxSeen, hosts: [...slowHosts] });
    return { run, wait, note, stats };
}

export function createPool(n) {
    let active = 0;
    const queue = [];
    const pump = () => {
        while (active < n && queue.length) {
            const { fn, resolve, reject } = queue.shift();
            active++;
            Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; pump(); });
        }
    };
    return {
        add: (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); }),
        get size() { return active + queue.length; },
    };
}
