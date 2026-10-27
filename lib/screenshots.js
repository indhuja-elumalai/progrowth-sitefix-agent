// Screenshots of the page where a problem is, with the problem outlined in red where it
// can be located: the broken link or image, or the misspelt / placeholder text.
// Used by report.js (screenshots for the report) and ui/server.js (a screenshot taken
// when the chat shows an issue that has none yet).
//
// shotPlan(issue)             -> { page, target, kind, text } or null (nothing worth showing)
// isVisual(issue)             -> true when a screenshot shows the problem itself
// capture(context, plan, file) -> true when the screenshot was saved
// createShooter({ concurrency, idleMs, launch }) -> { take(plan, file), close() }
//   one shared browser, started on first use and closed after idleMs without work.

import { mkdir } from "node:fs/promises";
import path from "node:path";

// The problem is ON a page (a link, an image): show the page it was found on.
const SHOWN_ON = new Set(["image", "http", "redirect"]);

// Self-contained (no outside variables): ui/build-index.js copies it into the page.
export function isVisual(issue) {
    // Head tags and site settings: nothing to see on the page, the value tells the story.
    if (!issue || /^(og-|title-|description-|canonical-|robots-|lang-|metadata-|https-|www-)/.test(issue.type)) return false;
    const kind = issue.evidence && issue.evidence.kind;
    if (kind === "image" || kind === "http" || kind === "redirect") return true;
    // Problems that are visible on the page itself.
    return ["soft-404", "content-placeholder", "content-thin", "content-duplicate", "content-repeated-word", "copy-spelling", "copy-grammar", "h1-missing", "h1-multiple", "heading-skip", "viewport-missing"].indexOf(issue.type) !== -1;
}

// Text to outline on the page: the first quoted mistake, without the "…" of a snippet.
function textOf(issue) {
    const m = issue.evidence?.matches?.[0];
    if (!m?.text) return null;
    const parts = String(m.text).split(/…|\.\.\./).map((s) => s.trim()).filter((s) => s.length >= 3);
    const best = parts.sort((a, b) => b.length - a.length)[0];
    return best ? best.slice(0, 60) : null;
}

export function shotPlan(issue) {
    if (!issue) return null;
    const on = SHOWN_ON.has(issue.evidence?.kind);
    const page = on ? issue.foundOn?.[0] : issue.affectedUrl;
    if (!page || !/^https?:\/\//.test(page)) return null;
    return { page, target: on ? issue.affectedUrl : null, kind: issue.evidence?.kind || null, text: on ? null : textOf(issue) };
}

// Runs inside the page: outline the element (or text) and centre it on screen.
function outline({ target, kind, text }) {
    const same = (a, b) => { try { return new URL(a, location.href).href.replace(/\/$/, "") === new URL(b).href.replace(/\/$/, ""); } catch { return false; } };
    let el = null;
    if (target) {
        const els = kind === "image" ? [...document.images].filter((i) => same(i.currentSrc || i.src, target) || same(i.getAttribute("src") || "", target))
            : [...document.querySelectorAll("a[href]")].filter((a) => same(a.href, target));
        el = els.find((e) => e.getClientRects().length) || els[0] || null;
    } else if (text) {
        const want = text.toLowerCase().replace(/\s+/g, " ");
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const at = n.nodeValue.toLowerCase().replace(/\s+/g, " ").indexOf(want);
            if (at === -1 || !n.parentElement || !n.parentElement.getClientRects().length) continue;
            try {
                const r = document.createRange();
                r.setStart(n, at);
                r.setEnd(n, Math.min(n.nodeValue.length, at + want.length));
                const mark = document.createElement("span");
                r.surroundContents(mark);
                el = mark;
            } catch { el = n.parentElement; }
            break;
        }
    }
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.style.outline = "4px solid #ff2d55";
    el.style.outlineOffset = "3px";
    el.style.boxShadow = "0 0 0 9999px rgba(0,0,0,.25)";
    return true;
}

export async function capture(context, plan, file) {
    const page = await context.newPage();
    try {
        await page.goto(plan.page, { waitUntil: "domcontentloaded", timeout: 20000 });
        // Wait for the page's images (the "load" event), not for the network to go
        // quiet: analytics and chat widgets never do.
        await page.waitForLoadState("load", { timeout: 4000 }).catch(() => { });
        await page.waitForTimeout(250);
        if (plan.target || plan.text) await page.evaluate(outline, { target: plan.target, kind: plan.kind, text: plan.text }).catch(() => false);
        await mkdir(path.dirname(file), { recursive: true });
        await page.screenshot({ path: file, type: "jpeg", quality: 60 });
        return true;
    } catch {
        return false; // page unreachable: no screenshot
    } finally {
        await page.close().catch(() => { });
    }
}

export function createShooter({ concurrency = 3, idleMs = 60000, launch } = {}) {
    let browser = null, context = null, starting = null, idle = null, active = 0;
    const queue = [];
    const start = async () => {
        if (context) return context;
        if (!starting) starting = (async () => {
            const chromium = launch ? null : (await import("playwright")).chromium;
            browser = launch ? await launch() : await chromium.launch();
            context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
            return context;
        })().finally(() => { starting = null; });
        return starting;
    };
    const close = async () => {
        clearTimeout(idle);
        const b = browser;
        browser = null; context = null;
        if (b) await b.close().catch(() => { });
    };
    const pump = () => {
        while (active < concurrency && queue.length) {
            const job = queue.shift();
            active++;
            clearTimeout(idle);
            start().then((ctx) => capture(ctx, job.plan, job.file)).catch(() => false).then((ok) => {
                active--;
                job.resolve(ok);
                if (!active && !queue.length) { idle = setTimeout(close, idleMs); idle.unref?.(); }
                pump();
            });
        }
    };
    const take = (plan, file) => new Promise((resolve) => { queue.push({ plan, file, resolve }); pump(); });
    return { take, close };
}
