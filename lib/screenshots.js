// Screenshots of the page where a problem is, with the problem outlined in red: the
// broken link or image, the misspelt / placeholder text, the heading that skips a level,
// the extra H1s. A screenshot is only kept when the problem is found and visible on the
// page; otherwise there is none, so no screenshot ever shows something unrelated. For a
// problem that is the whole page (an error page served as a normal one, thin or
// duplicate content) the whole screen is framed in red.
// Used by report.js (screenshots for the report) and ui/server.js (a screenshot taken
// when the chat shows an issue that has none yet).
//
// shotPlan(issue)             -> { page, mode, target, kind, text, texts } or null (nothing worth showing)
//   mode: "element" (a link or image), "text", "heading-skip", "h1s" or "page"
// isVisual(issue)             -> true when a screenshot shows the problem itself
// capture(context, plan, file) -> true when the screenshot was saved
// createShooter({ concurrency, idleMs, launch }) -> { take(plan, file), close() }
//   one shared browser, started on first use and closed after idleMs without work.
//   take(plan, file, { urgent }) -> the same promise for the same file while it is waiting
//   or being taken; urgent puts it at the front of the queue (someone is looking at it),
//   otherwise it waits behind them (screenshots taken ahead of time).

import { mkdir } from "node:fs/promises";

// Raised when the way screenshots are taken changes; a saved screenshot from an older
// version is taken again the next time it is asked for (ui/server.js).
// 2: only kept when the problem is found and outlined (Day 29).
export const SHOT_VERSION = 2;
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
    // (A missing H1 or phone set-up has nothing to point at on the page.)
    return ["soft-404", "content-placeholder", "content-thin", "content-duplicate", "content-repeated-word", "copy-spelling", "copy-grammar", "h1-multiple", "heading-skip"].indexOf(issue.type) !== -1;
}

// Text to outline on the page, most precise first: the quoted snippet (without the "…"),
// then a few words around the mistake, then the mistaken word alone. A snippet can run
// across a bold label and the text after it, where it can't be found as one piece, so
// the shorter ones matter. The mistaken word is the one the correction changed.
const clean = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
function editDistance(a, b) {
    const d = Array.from({ length: b.length + 1 }, (_, k) => k);
    for (let i = 1; i <= a.length; i++) {
        let prev = d[0]; d[0] = i;
        for (let k = 1; k <= b.length; k++) { const t = d[k]; d[k] = Math.min(d[k] + 1, d[k - 1] + 1, prev + (a[i - 1] === b[k - 1] ? 0 : 1)); prev = t; }
    }
    return d[b.length];
}
function mistakeAt(words, correction) {
    const fixed = new Set(String(correction || "").split(/\s+/).map((w) => clean(w).toLowerCase()).filter(Boolean));
    const seen = new Set(words.map((w) => clean(w).toLowerCase()));
    const added = [...fixed].filter((w) => !seen.has(w));
    let best = -1, bestD = Infinity;
    words.forEach((w, k) => {
        const c = clean(w).toLowerCase();
        if (!c || fixed.has(c)) return;
        for (const a of added) { const dist = editDistance(c, a); if (dist < bestD) { bestD = dist; best = k; } }
    });
    return best;
}
function textsOf(issue) {
    const m = issue.evidence?.matches?.[0];
    if (!m?.text) return [];
    const out = [];
    const add = (t) => { t = String(t || "").replace(/\s+/g, " ").trim(); if (t.length >= 3 && !out.includes(t)) out.push(t); };
    const parts = String(m.text).split(/…|\.\.\./).map((x) => x.trim()).filter((x) => x.length >= 3).sort((a, b) => b.length - a.length);
    const words = parts.join(" ").split(/\s+/).filter(Boolean);
    const k = mistakeAt(words, m.correction);
    // The mistake with a word or two either side (so the box is on the mistake, and the
    // right occurrence of it), then wider, then the word alone.
    if (k !== -1) {
        add(words.slice(Math.max(0, k - 2), k + 3).join(" "));
        add(words.slice(Math.max(0, k - 4), k + 5).join(" "));
        add(clean(words[k]));
    }
    // The quoted text itself, cut at a word, not in the middle of one.
    if (parts[0]) add(parts[0].length > 60 ? parts[0].slice(0, 60).replace(/\s+\S*$/, "") : parts[0]);
    return out;
}

const WHOLE_PAGE = new Set(["soft-404", "content-thin", "content-duplicate"]);

export function shotPlan(issue) {
    if (!issue || !isVisual(issue)) return null;
    const on = SHOWN_ON.has(issue.evidence?.kind);
    const page = on ? issue.foundOn?.[0] : issue.affectedUrl;
    if (!page || !/^https?:\/\//.test(page)) return null;
    const texts = on ? [] : textsOf(issue);
    const mode = on ? "element" : WHOLE_PAGE.has(issue.type) ? "page" : issue.type === "heading-skip" ? "heading-skip" : issue.type === "h1-multiple" ? "h1s" : "text";
    if (mode === "text" && !texts.length) return null;
    return { page, mode, target: on ? issue.affectedUrl : null, kind: issue.evidence?.kind || null, text: texts[0] || null, texts };
}

// Step 1, in the page: hide cookie banners, find the problem, scroll it into view.
// Returns how many places were found.
export function findProblem({ mode, target, kind, text, texts }) {
    for (const e of document.querySelectorAll("body *")) {
        const st = getComputedStyle(e);
        if ((st.position === "fixed" || st.position === "sticky") && /cookie|consent|gdpr/i.test((e.id || "") + " " + (typeof e.className === "string" ? e.className : "") + " " + (e.textContent || "").slice(0, 400))) e.style.setProperty("display", "none", "important");
    }
    const shown = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const st = getComputedStyle(e); if (st.display === "none" || st.visibility === "hidden") return false; } return el.getClientRects().length > 0; };
    const same = (a, b) => { try { return new URL(a, location.href).href.replace(/\/$/, "") === new URL(b).href.replace(/\/$/, ""); } catch { return false; } };
    let found = [];
    if (!mode) mode = target ? "element" : "text";
    if (mode === "page") found = [document.documentElement];
    else if (mode === "element") {
        const els = kind === "image" ? [...document.images].filter((i) => same(i.currentSrc || i.src, target) || same(i.getAttribute("src") || "", target))
            : [...document.querySelectorAll("a[href]")].filter((a) => same(a.href, target));
        found = els.filter(shown).slice(0, 1);
    } else if (mode === "h1s" || mode === "heading-skip") {
        // The heading's words, not the whole width of the block.
        const words = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r; };
        if (mode === "h1s") found = [...document.querySelectorAll("h1")].filter(shown).map(words);
        else {
            const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(shown);
            for (let k = 1; k < hs.length; k++) if (+hs[k].tagName[1] > +hs[k - 1].tagName[1] + 1) { found = [words(hs[k])]; window.__sitefixHeading = hs[k]; break; }
        }
    } else {
        // All visible text as one string (spaces collapsed, lower case), with where each
        // character came from, so a phrase is found across bold, links and line breaks.
        let flat = "";
        const map = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const p = n.parentElement;
            if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName) || !shown(p)) continue;
            const v = n.nodeValue;
            for (let k = 0; k < v.length; k++) {
                const ws = /\s/.test(v[k]);
                if (ws && (flat.endsWith(" ") || !flat)) continue;
                flat += ws ? " " : v[k].toLowerCase();
                map.push([n, k]);
            }
            if (flat && !flat.endsWith(" ")) { flat += " "; map.push([n, v.length]); }
        }
        const letter = (c) => c && /[\p{L}\p{N}]/u.test(c);
        outer: for (const t of (texts && texts.length ? texts : [text]).filter(Boolean)) {
            const w = t.toLowerCase().replace(/\s+/g, " ").trim();
            for (let at = flat.indexOf(w); at !== -1; at = flat.indexOf(w, at + 1)) {
                if (letter(flat[at - 1]) || letter(flat[at + w.length])) continue; // whole words only
                const a = map[at], b = map[at + w.length - 1];
                try {
                    const r = document.createRange();
                    r.setStart(a[0], a[1]);
                    r.setEnd(b[0], Math.min(b[0].nodeValue.length, b[1] + 1));
                    const rect = r.getBoundingClientRect();
                    if (rect.width && rect.height) { found = [r]; break outer; }
                } catch { /* try the next match */ }
            }
        }
    }
    window.__sitefixFound = found;
    if (found.length && mode !== "page") {
        const first = found[0], rect = first.getBoundingClientRect();
        window.scrollTo({ top: Math.max(0, rect.top + scrollY - innerHeight / 2 + rect.height / 2), behavior: "instant" });
    }
    return found.length;
}

// Step 2, in the page, once it has settled after scrolling (sites that fade text in as
// it scrolls into view): draw the red boxes. False when the problem isn't actually
// visible on screen, and then no screenshot is kept.
export function drawProblem({ mode }) {
    const found = window.__sitefixFound || [];
    if (!found.length) return false;
    const box = (css) => { const d = document.createElement("div"); d.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;" + css; document.body.appendChild(d); };
    if (mode === "page") { box("inset:0;border:6px solid #ff2d55"); return true; }
    const visible = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const st = getComputedStyle(e); if (+st.opacity < 0.2 || st.visibility === "hidden") return false; } return true; };
    let drawn = 0;
    for (const f of found) {
        const r = f.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
        const el = f.startContainer ? f.startContainer.parentElement : f;
        if (!visible(el)) continue;
        box(`left:${r.left - 6}px;top:${r.top - 5}px;width:${r.width + 12}px;height:${r.height + 10}px;border:4px solid #ff2d55;border-radius:6px;` + (found.length === 1 ? "box-shadow:0 0 0 9999px rgba(0,0,0,.25)" : ""));
        drawn++;
    }
    return drawn > 0;
}

export async function capture(context, plan, file) {
    const page = await context.newPage();
    try {
        await page.goto(plan.page, { waitUntil: "domcontentloaded", timeout: 20000 });
        // Wait for the page's images (the "load" event), not for the network to go
        // quiet: analytics and chat widgets never do.
        await page.waitForLoadState("load", { timeout: 4000 }).catch(() => { });
        await page.waitForTimeout(250);
        const args = { mode: plan.mode || (plan.target ? "element" : "text"), target: plan.target || null, kind: plan.kind || null, text: plan.text || null, texts: plan.texts || [] };
        if (!(await page.evaluate(findProblem, args).catch(() => 0))) return false; // not found: no screenshot
        // Let it settle (lazy images, text that fades in as it scrolls into view): a short
        // wait, and a longer one only when the problem isn't visible yet.
        await page.waitForTimeout(300);
        if (!(await page.evaluate(drawProblem, args).catch(() => false))) {
            await page.waitForTimeout(900);
            if (!(await page.evaluate(drawProblem, args).catch(() => false))) return false;
        }
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
    const pending = new Map(); // file -> job, while waiting or being taken
    const take = (plan, file, { urgent = false } = {}) => {
        const had = pending.get(file);
        if (had) {
            const k = queue.indexOf(had);
            if (urgent && k > 0) { queue.splice(k, 1); queue.unshift(had); }
            return had.promise;
        }
        const job = { plan, file };
        job.promise = new Promise((resolve) => { job.resolve = (ok) => { pending.delete(file); resolve(ok); }; });
        pending.set(file, job);
        if (urgent) queue.unshift(job); else queue.push(job);
        pump();
        return job.promise;
    };
    return { take, close };
}
