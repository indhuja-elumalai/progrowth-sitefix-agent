// The web report: the live report the chat links to, one page per inspection, that can
// also be downloaded and sent to a client, printed, or read as the PDF. Data in, HTML out.
//
// buildWebReport({ report, shotSrc, standalone, links })
//   report     = explained.json (run, summary, types[], score, coach)
//   shotSrc    = (issue) -> image URL or data: URI, or null for no screenshot
//   standalone = true for the downloaded file (no links back to the SiteFix server; the
//                client's selection is kept in their own browser)
//   links      = { pdf, download, api, fix, shot } URLs. shot = "/api/history/<id>/shot/":
//                on the live page, issues without a screenshot get one when opened. api = "/api/history/<id>/" turns on
//                saved progress and checking the live site; fix turns on the Fix button
//                (the fix stage: not built yet, so the button shows "coming soon")
// reportFileName(report) -> "sitefix-example.com-2026-10-22.html"
// fixFirst(report, n) -> the most urgent issues, one per type and page
//
// The live report (Day 29): the client picks what to fix and sees what it does to the
// score before anything is fixed.
//   Score     always in the top bar; on the Fix tab, a meter in four bands (Needs work,
//             Fair, Good, Excellent): the needle at the score with the selected fixes, a dot
//             at today's score.
//   Areas     the Fix tab has three columns, On-page, Technical and Off-page, each with its
//             own score (now -> with the selection) and its fixes, ticked to select them.
//   Selection a bar at the bottom: how many fixes, the points, the score they lead to, and
//             "Fix these". Until the fix stage exists the button is shown but not active;
//             fixes SiteFix will be able to make are marked (from each type's fixClass).
//   Panel     clicking a fix opens it: what visitors face, why, the steps, every page (each
//             can be selected on its own), and on the live page "Check your live site" for
//             a client who fixed it themselves; a confirmed fix counts in today's score.
//   All issues every kind of problem with search, filters and sorting, also selectable.
// The words of SiteFix's messages may come from AI (lib/coach.js); every fact in them (the
// issue, the numbers, the score) is filled in by the code.
//
// The full report (every kind, its steps and every page) is also on the page as plain
// HTML: it is what prints, and what shows without JavaScript. The page loads nothing
// from the network. Links from the chat still work: #ISS-… opens one issue, #type=a,b
// lists only those kinds, #p=P1 one priority, #qw=1 the quick wins.

import { evidenceFacts } from "./report-html.js";
import { siteScore, gainOf, gainText, levelOf, areaOf, pointsOf, projected, fmtPoints } from "./score.js";
import { standardBank, fillMessage } from "./coach.js";
import { isVisual, shotPlan } from "./screenshots.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const ORDER = { P1: 0, P2: 1, P3: 2 };
const EFFORT_ORDER = { easy: 0, medium: 1, hard: 2 };
const EFFORT_WORD = { easy: "Easy", medium: "Medium", hard: "Bigger job" };
const AREA_WORD = { "on-page": "On-page", technical: "Technical", "off-page": "Off-page" };
const LEVEL_WORD = { P1: "Urgent", P2: "Important", P3: "Polish" };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"; } catch { return iso || ""; } };
const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u || "site"); } };
const gainBadge = (g) => (g >= 0.95 ? String(Math.round(g)) : "<1");
// Problems a site may have on purpose, which don't harm visitors: near-identical pages
// (a page with a tracking parameter, location pages), a page kept out of Google, a long
// title, a brand name the spelling check doesn't know. These can be "kept as is": they
// move to their own column and stop counting against the score (until undone).
export const KEEPABLE = new Set(["content-duplicate", "content-thin", "content-repeated-word", "copy-spelling", "copy-grammar", "title-duplicate", "description-duplicate",
    "title-too-long", "title-too-short", "description-too-long", "description-too-short", "h1-multiple", "heading-skip", "image-alt-too-long",
    "robots-noindex", "robots-nofollow", "redirect-chain", "canonical-missing", "og-missing", "og-incomplete"]);

// A broken link, image or redirect is on the pages it was found on; any other issue is
// on its own page, and foundOn lists the pages that link to that page.
const isOnPages = (i) => ["image", "http", "redirect"].includes(i.evidence?.kind);
const safeHref = (u) => (/^https?:\/\//i.test(String(u || "")) ? esc(u) : null);

export function reportFileName(report) {
    const host = hostOf(report?.run?.startUrl).replace(/[^a-z0-9.-]+/gi, "-");
    const day = String(report?.run?.startedAt || report?.generatedAt || "").slice(0, 10) || "report";
    return `sitefix-${host}-${day}.html`;
}

// All instances, flattened, with their type's title.
const flatten = (report) => (report.types || []).flatMap((t) => t.issues.map((i) => ({ ...i, title: t.title })));

// The most urgent issues: P1 first, then quick wins, easiest first; one entry per type and page.
export function fixFirst(report, n = 8) {
    const seen = new Set();
    return flatten(report)
        .filter((i) => i.priority === "P1" || i.quickWin)
        .sort((a, b) => ORDER[a.priority] - ORDER[b.priority] || (b.quickWin - a.quickWin) || EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort])
        .filter((i) => { const k = `${i.type}|${i.affectedUrl}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, n);
}

// Images on the page: the screenshot of the page with the problem outlined (taken by
// report.js, or on the live page taken when the issue is first opened), and for image
// problems the image itself.
function figures(i, ctx) {
    const shot = ctx.shotSrc ? ctx.shotSrc(i) : null;
    const plan = shotPlan(i);
    if (!plan) return imageItself(i);
    const outlined = plan.mode === "page" ? ": the whole page is the problem" : ", with the problem outlined in red";
    let h = "";
    if (shot) h += `<figure class="shot"><a href="${esc(shot)}" target="_blank" rel="noopener"><img src="${esc(shot)}" alt="Screenshot of ${esc(i.affectedUrl)}" loading="lazy"></a><figcaption>Screenshot${outlined}</figcaption></figure>`;
    else if (ctx.shotLater) h += `<figure class="shot later"><a href="${esc(ctx.shotLater(i))}" target="_blank" rel="noopener"><img data-src="${esc(ctx.shotLater(i))}" alt="Screenshot of ${esc(i.foundOn?.[0] || i.affectedUrl)}"></a><figcaption>Taking a screenshot of the page\u2026</figcaption><span class="cap-done" hidden>Screenshot${outlined}</span></figure>`;
    return h + imageItself(i);
}
function imageItself(i) {
    let h = "";
    if (i.evidence?.kind === "image" && safeHref(i.affectedUrl)) {
        h += /broken$/.test(i.type)
            ? `<p class="img-note">The image itself can't be shown: it doesn't load${i.evidence.status ? ` (the server answers ${esc(String(i.evidence.status))})` : ""}, which is the problem.</p>`
            : `<figure class="img-self"><img src="${esc(i.affectedUrl)}" alt="The image at ${esc(i.affectedUrl)}" loading="lazy" referrerpolicy="no-referrer"><figcaption>The image itself</figcaption></figure>`;
    }
    return h;
}

function instance(i, t, ctx) {
    const found = i.foundOn || [];
    const href = safeHref(i.affectedUrl);
    const facts = evidenceFacts(i.evidence);
    return `<details class="inst" id="${esc(i.id)}" data-p="${esc(i.priority)}" data-cat="${esc(i.category)}" data-owner="${esc(i.owner)}" data-qw="${i.quickWin ? 1 : 0}">
<summary><span class="pill ${esc(i.priority)}">${esc(i.priority)}</span><span class="u">${esc(i.affectedUrl)}</span><span class="ist" data-id="${esc(i.id)}"></span><span class="ipts" data-id="${esc(i.id)}"></span><span class="chev" aria-hidden="true"></span></summary>
<div class="inst-body">
<p class="expl">${esc(i.explanation || i.detail)}</p>
<div class="meta">${esc(i.effort)} fix · ${esc(i.owner)}${i.priorityReason ? ` · priority: ${esc(i.priorityReason)}` : ""}${href ? ` · <a href="${href}" target="_blank" rel="noopener noreferrer">open page</a>` : ""}</div>
${i.suggestedValue ? `<div class="val"><div class="k">${esc(t.valueLabel || "Suggested value")}</div><div class="v"><span>${esc(i.suggestedValue)}</span><button type="button" class="copy" data-copy="${esc(i.suggestedValue)}">Copy</button></div></div>` : ""}
${figures(i, ctx)}
${facts ? `<table class="facts">${facts}</table>` : ""}
${found.length ? `<div class="found"><div class="k">${isOnPages(i) ? "Found on" : "Linked from"} ${plural(found.length, "page")}</div>${found.slice(0, 10).map((u) => `<div class="u">${esc(u)}</div>`).join("")}${found.length > 10 ? `<div class="more">and ${found.length - 10} more</div>` : ""}</div>` : ""}
<div class="inst-act"><label class="tick"><input type="checkbox" data-sel-id="${esc(i.id)}"> Include this page in the fix</label>${KEEPABLE.has(i.type) ? `<button type="button" class="keep1" data-keep-id="${esc(i.id)}">Keep this page as it is</button>` : ""}</div>
</div>
</details>`;
}

// One kind of problem in full: what it is, why it matters, the steps and every page.
// The fix panel shows this; it is also what prints.
function typeDetail(t, ctx) {
    const issues = [...t.issues].sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
    const top = issues[0];
    const area = areaOf(t.type);
    const coach = ctx.bank.types[t.type] || {};
    const gain = ctx.P.types[t.type]?.points || 0;
    return `<section class="tdetail" id="t-${esc(t.type)}" data-type="${esc(t.type)}" data-area="${area}" data-effort="${esc(top.effort)}" data-level="${esc(top.priority)}">
<div class="td-head"><h3>${esc(t.title)}</h3><p class="td-tags"><span class="pill ${esc(top.priority)}">${LEVEL_WORD[top.priority] || esc(top.priority)}</span> ${esc(EFFORT_WORD[top.effort] || top.effort)} · ${AREA_WORD[area]} · ${esc(top.owner)} · ${plural(issues.length, "issue")} · worth +${esc(fmtPoints(gain))} points</p>
${coach.visitor ? `<p class="td-vis">${esc(coach.visitor)}</p>` : ""}</div>
<p class="sum">${esc(t.summary)}</p>
${t.why ? `<p class="why"><b>Why it matters.</b> ${esc(t.why)}</p>` : ""}
${(t.fixSteps || []).length ? `<div class="fix"><div class="k">How to fix</div><ol>${t.fixSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>` : ""}
<div class="k pages-k">Where: ${plural(issues.length, "issue")}</div>
<div class="insts">${issues.map((i) => instance(i, t, ctx)).join("\n")}</div>
</section>`;
}

// The score meter: a half dial like a credit-score meter. A thin outer ring shows the
// four bands; the thick arc inside is solid green up to today's score and lighter green
// on to the score with the selected fixes.
export const BANDS = [
    { min: 0, max: 49, name: "Needs work", cls: "b1" },
    { min: 50, max: 69, name: "Fair", cls: "b2" },
    { min: 70, max: 84, name: "Good", cls: "b3" },
    { min: 85, max: 100, name: "Excellent", cls: "b4" },
];
export const bandOf = (score) => BANDS.find((b) => score <= b.max) || BANDS[BANDS.length - 1];
function gauge(score) {
    const cx = 100, cy = 100, rb = 92, r = 74;
    const pt = (v, rr) => { const a = Math.PI * (1 - v / 100); return `${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy - rr * Math.sin(a)).toFixed(1)}`; };
    const bands = BANDS.map((b, k) => `<path class="g-band ${b.cls}" d="M ${pt(b.min + (k ? 1 : 0), rb)} A ${rb} ${rb} 0 0 1 ${pt(Math.min(100, b.max + 1) - (k < 3 ? 1 : 0), rb)}"/>`).join("");
    const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
    return `<svg class="gauge" viewBox="0 0 200 112" aria-hidden="true">${bands}<path class="g-track" d="${arc}"/><path class="g-arc-sel" d="${arc}" pathLength="100" style="stroke-dashoffset:${100 - score}"/><path class="g-arc-now" d="${arc}" pathLength="100" style="stroke-dashoffset:${100 - score}"/></svg>`;
}

const CSS = `
/* SiteFix live report. A calm app: a dark top bar with the score, light working surfaces,
   the brand lime only for what moves the score (gains, the selection). */
:root{--bg:#f3f4ef;--surface:#fff;--sunk:#eef0e8;--line:#dfe1d7;--ink:#17181a;--t2:#4f5249;--t3:#83867b;
--bar:#17181a;--score:#17181a;--bar-t:#f3f4ef;--bar-t2:#a9ab9f;--lime:#b8ff00;--lime-ink:#2f4a00;--lime-bg:#eef8cf;--link:#2d5fb3;
--p1:#c4271d;--p1b:#fbe6e3;--p2:#9a5600;--p2b:#fcefd9;--p3:#2d5fb3;--p3b:#e4ecf8;--ok:#237a3b;--okb:#e2f2e5;
--shadow:0 1px 2px rgba(20,22,18,.05),0 8px 24px rgba(20,22,18,.08);--r:14px;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121311;--surface:#1b1c19;--sunk:#23251f;--line:#2e3029;--ink:#eef0e8;--t2:#c0c3b7;--t3:#8c8f84;
--bar:#0b0c0a;--score:#1d2414;--bar-t:#eef0e8;--bar-t2:#8c8f84;--lime-ink:#c9ff4d;--lime-bg:rgba(184,255,0,.12);--link:#86b3ff;
--p1:#ff8a7f;--p1b:rgba(255,99,85,.15);--p2:#ffbe6b;--p2b:rgba(255,170,60,.14);--p3:#86b3ff;--p3b:rgba(90,150,255,.15);--ok:#6fd88a;--okb:rgba(70,200,110,.14);
--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.3);color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121311;--surface:#1b1c19;--sunk:#23251f;--line:#2e3029;--ink:#eef0e8;--t2:#c0c3b7;--t3:#8c8f84;
--bar:#0b0c0a;--score:#1d2414;--bar-t:#eef0e8;--bar-t2:#8c8f84;--lime-ink:#c9ff4d;--lime-bg:rgba(184,255,0,.12);--link:#86b3ff;
--p1:#ff8a7f;--p1b:rgba(255,99,85,.15);--p2:#ffbe6b;--p2b:rgba(255,170,60,.14);--p3:#86b3ff;--p3b:rgba(90,150,255,.15);--ok:#6fd88a;--okb:rgba(70,200,110,.14);
--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.3);color-scheme:dark}
*{box-sizing:border-box}
html{scroll-padding-top:90px}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--link)}
button{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.in{max-width:1180px;margin:0 auto;padding-left:max(20px,env(safe-area-inset-left,0px));padding-right:max(20px,env(safe-area-inset-right,0px))}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* ---------- top bar ---------- */
.top{background:var(--bar);color:var(--bar-t);position:sticky;top:0;z-index:20}
.top .in{display:flex;align-items:center;gap:18px;min-height:60px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.dot{width:12px;height:12px;border-radius:50%;background:var(--lime);flex-shrink:0}
.brand b{font-size:15px}
.brand .site{color:var(--bar-t2);font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
.brand .site a{color:inherit;text-decoration:none}
.tabs{display:flex;gap:4px;margin-left:auto}
.tab{all:unset;cursor:pointer;padding:8px 14px;border-radius:999px;font-size:14px;font-weight:600;color:var(--bar-t2);white-space:nowrap;display:inline-flex;align-items:center;gap:7px}
.tab:hover{color:var(--bar-t)}
.tab[aria-selected=true]{background:rgba(255,255,255,.1);color:var(--bar-t)}
.tab:focus-visible{outline:2px solid var(--lime)}
.tab .n{font-size:12px;font-weight:700;background:rgba(255,255,255,.12);border-radius:999px;padding:0 7px;font-variant-numeric:tabular-nums}
.spill{display:inline-flex;align-items:baseline;gap:6px;padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.08);font-size:13px;color:var(--bar-t2);font-variant-numeric:tabular-nums;white-space:nowrap}
.spill b{font-size:16px;color:var(--bar-t)}
.spill .to{color:var(--lime);font-weight:700;font-size:16px}
.spill.bump{animation:bump .5s ease}
@keyframes bump{40%{transform:scale(1.08)}}
.export{position:relative}
.export>summary{list-style:none;cursor:pointer;padding:7px 13px;border:1px solid rgba(255,255,255,.18);border-radius:999px;font-size:13.5px;font-weight:600}
.export>summary::-webkit-details-marker{display:none}
.export[open]>summary{background:rgba(255,255,255,.1)}
.menu{position:absolute;right:0;top:calc(100% + 8px);background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);min-width:220px;padding:6px;z-index:30;display:flex;flex-direction:column}
.menu a,.menu button{all:unset;cursor:pointer;padding:9px 12px;border-radius:8px;font-size:14px}
.menu a:hover,.menu button:hover{background:var(--sunk)}
.menu small{display:block;color:var(--t3);font-size:12px}
/* ---------- layout ---------- */
main{padding-block:22px 140px}
.panel[hidden]{display:none}
.lede{color:var(--t2);font-size:13.5px;margin:0 0 16px}
.box{background:var(--surface);border:1px solid var(--line);border-radius:var(--r)}
.k{font-size:11.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em}
/* ---------- hero: score + SiteFix ---------- */
.hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px}
.scorecard{background:var(--score);color:var(--bar-t);border-radius:18px;padding:20px 24px;display:flex;gap:24px;align-items:center}
.meterbox{position:relative;width:200px;flex-shrink:0;text-align:center}
.gauge{width:200px;height:112px;display:block;overflow:visible}
.g-band{fill:none;stroke-width:4;opacity:.7}
.g-track,.g-arc-now,.g-arc-sel{fill:none;stroke-width:14;stroke-linecap:round}
.g-track{stroke:rgba(255,255,255,.1)}
.g-arc-now,.g-arc-sel{stroke:var(--lime);stroke-dasharray:100 200;transition:stroke-dashoffset .7s cubic-bezier(.2,.8,.2,1)}
.g-arc-sel{opacity:.35}
.g-band.b1{stroke:#ff7a6b}.g-band.b2{stroke:#ffb547}.g-band.b3{stroke:#c9f25a}.g-band.b4{stroke:#46d27a}
.g-num{margin-top:-46px;position:relative}
.g-num b{display:block;font-size:38px;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.g-band-name{display:inline-block;margin-top:6px;font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px;color:#17181a}
.g-band-name.b1{background:#ff7a6b}.g-band-name.b2{background:#ffb547}.g-band-name.b3{background:#c9f25a}.g-band-name.b4{background:#46d27a}
.g-scale{display:flex;justify-content:space-between;font-size:11px;color:var(--bar-t2);margin-top:6px;padding:0 4px}
.site-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 2px}
.site-h h1{font-size:26px;letter-spacing:-.02em;margin:0;overflow-wrap:anywhere}
.site-h a{font-size:13.5px;font-weight:600;text-decoration:none}
.sc-txt{min-width:0;display:flex;flex-direction:column;gap:6px}
.sc-now{font-size:14px;color:var(--bar-t2)}
.sc-now b{color:var(--bar-t);font-size:15px}
.sc-gain{font-size:20px;font-weight:700;letter-spacing:-.01em;min-height:28px}
.sc-gain .g{color:var(--lime)}
.sc-hint{font-size:13px;color:var(--bar-t2);margin:0}
.coach{padding:16px 18px;display:flex;flex-direction:column;gap:10px;min-width:0}
.coach-h{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--t3)}
.coach-h b{color:var(--ink);font-size:14px}
.av{width:30px;height:30px;border-radius:50%;background:var(--lime);color:#17181a;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0}
.bubble{background:var(--sunk);border-radius:4px 14px 14px 14px;padding:11px 14px;font-size:15px;animation:pop .4s ease}
.coach-act{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.earlier{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:13.5px;color:var(--t2)}
.earlier small{color:var(--t3)}
.linkbtn{all:unset;cursor:pointer;color:var(--link);font-size:13.5px;font-weight:500}
.linkbtn:focus-visible{outline:2px solid var(--link)}
@keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
/* ---------- the three areas ---------- */
.sorts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:26px 0 12px}
.sorts h2{font-size:18px;margin:0 12px 0 0;letter-spacing:-.01em}
.chip{all:unset;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--t2);border-radius:999px;font-size:13px;font-weight:600;padding:5px 12px}
.chip:hover{color:var(--ink)}
.chip[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.chip:focus-visible{outline:2px solid var(--link)}
.areatabs{display:none}
.cols{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;align-items:start}
@media (max-width:1180px) and (min-width:901px){.cols{grid-template-columns:repeat(2,minmax(0,1fr))}}
.col.kept{background:transparent;border-style:dashed}
.col.kept .col-t h3::before{content:"\\21BA  ";color:var(--t3)}
.kp-i{width:18px;height:18px;border-radius:50%;background:var(--sunk);color:var(--t2);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}
.it.kp .it-g{font-size:12.5px;font-weight:700;color:var(--t2)}
.unkeep{all:unset;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--link)}
.keep1{all:unset;cursor:pointer;margin-left:14px;font-size:13px;color:var(--link)}
.keep1[aria-pressed=true]{color:var(--t2)}
.inst.kept-one>summary .u{text-decoration:line-through;text-decoration-color:var(--t3)}
.col{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.col-h{padding:14px 16px 12px;border-bottom:1px solid var(--line)}
.col-t{display:flex;align-items:baseline;gap:8px}
.col-t h3{font-size:16px;margin:0}
.col-t .sc{margin-left:auto;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.col-t .sc .to{color:var(--ok)}
.meter{position:relative;height:6px;border-radius:6px;background:var(--sunk);overflow:hidden;margin:8px 0 6px}
.meter b,.meter i{position:absolute;inset:0 auto 0 0;border-radius:6px;transition:width .6s ease}
.meter i{background:var(--lime);opacity:.45}
.meter b{background:var(--ink)}
.col-n{font-size:12.5px;color:var(--t3)}
.list{display:flex;flex-direction:column}
.it{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 10px;align-items:center;padding:10px 14px 10px 12px;border-top:1px solid var(--line);transition:background .15s}
.it:first-child{border-top:0}
.it:hover{background:var(--sunk)}
.it.sel{background:var(--lime-bg)}
.ck{width:18px;height:18px;margin:0;accent-color:var(--ink);cursor:pointer}
.it-main{all:unset;cursor:pointer;min-width:0;display:flex;flex-direction:column;gap:2px}
.it-main:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.it-t{font-size:14.5px;font-weight:600;line-height:1.3}
.it-m{font-size:12.5px;color:var(--t3);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.it-g{font-size:15px;font-weight:800;color:var(--ok);font-variant-numeric:tabular-nums;text-align:right}
.it.ver .it-g{font-size:12.5px;font-weight:700}
.it-g .of{font-size:11.5px;font-weight:600;color:var(--t3)}
.ok-i{width:18px;height:18px;border-radius:50%;background:var(--ok);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800}
.col-more{all:unset;cursor:pointer;display:block;text-align:center;padding:10px;font-size:13px;font-weight:600;color:var(--link);border-top:1px solid var(--line)}
.col-empty{padding:18px 16px;color:var(--t3);font-size:13.5px}
.pill{font-size:11px;font-weight:700;border-radius:999px;padding:0 7px;white-space:nowrap}
.pill.P1{background:var(--p1b);color:var(--p1)}.pill.P2{background:var(--p2b);color:var(--p2)}.pill.P3{background:var(--p3b);color:var(--p3)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn:hover{border-color:var(--t3)}
.btn.primary{background:var(--lime);border-color:var(--lime);color:#17181a}
.btn.primary:hover{filter:brightness(.95)}
.btn.small{padding:6px 12px;font-size:13px}
.btn[disabled]{opacity:.5;cursor:not-allowed;filter:none}
/* ---------- All issues ---------- */
.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.toolbar input[type=search]{flex:1 1 260px;min-width:0;height:38px;border:1px solid var(--line);border-radius:999px;padding:0 16px;font:inherit;font-size:14px;background:var(--surface);color:var(--ink)}
.toolbar select{height:38px;border:1px solid var(--line);border-radius:999px;padding:0 12px;font:inherit;font-size:13.5px;background:var(--surface);color:var(--ink);max-width:100%}
.presets{display:flex;gap:6px;flex-wrap:wrap}
.preset{all:unset;cursor:pointer;font-size:13px;font-weight:600;background:var(--lime-bg);color:var(--lime-ink);border-radius:999px;padding:4px 12px;margin-bottom:10px}
.count-line{font-size:13px;color:var(--t3);margin:0 0 8px}
.rows{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.rows .it{grid-template-columns:auto minmax(0,1fr) 100px 92px 70px;padding:11px 16px}
.rows .hdr{display:grid;grid-template-columns:18px minmax(0,1fr) 100px 92px 70px;gap:10px;padding:9px 16px;font-size:11.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;background:var(--sunk)}
.r-c{font-size:13px;color:var(--t2)}
.empty{padding:26px;text-align:center;color:var(--t2)}
/* ---------- the selection bar ---------- */
.selbar{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translate(-50%,0);width:min(920px,calc(100% - 24px));background:var(--bar);color:var(--bar-t);border-radius:18px;padding:12px 14px 12px 20px;display:flex;align-items:center;gap:16px;box-shadow:0 14px 40px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1);z-index:25;animation:up .3s cubic-bezier(.2,.8,.2,1)}
@keyframes up{from{opacity:0;transform:translate(-50%,20px)}to{opacity:1;transform:translate(-50%,0)}}
.sb-l{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.sb-main{font-size:15px}
.sb-main .g{color:var(--lime)}
.sb-sub{font-size:12.5px;color:var(--bar-t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-r{display:flex;align-items:center;gap:8px;flex-shrink:0}
.sb-r .ghost{all:unset;cursor:pointer;font-size:13.5px;color:var(--bar-t2);padding:8px 10px}
.sb-r .ghost:hover{color:var(--bar-t)}
.sb-fix{display:flex;flex-direction:column;align-items:center;gap:2px}
.sb-fix small{font-size:11px;color:var(--bar-t2)}
.selbar .btn[disabled]{background:rgba(255,255,255,.1);border-color:transparent;color:var(--bar-t2);opacity:1}
/* ---------- the fix panel ---------- */
.scrim{position:fixed;inset:0;background:rgba(10,11,9,.42);z-index:40;opacity:0;transition:opacity .2s}
.scrim.on{opacity:1}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(620px,100%);background:var(--surface);z-index:41;display:flex;flex-direction:column;box-shadow:-10px 0 40px rgba(0,0,0,.18);transform:translateX(100%);transition:transform .28s cubic-bezier(.2,.8,.2,1)}
.drawer.on{transform:none}
.dr-head{position:relative;padding:18px 22px 14px;padding-top:calc(18px + env(safe-area-inset-top,0px));border-bottom:1px solid var(--line)}
.dr-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--t3);padding-right:40px}
.dr-close{all:unset;cursor:pointer;position:absolute;top:calc(12px + env(safe-area-inset-top,0px));right:14px;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--t2)}
.dr-close:hover{background:var(--sunk)}
.dr-head h2{font-size:21px;letter-spacing:-.015em;margin:8px 0 8px;text-wrap:balance}
.dr-gain{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:13.5px;color:var(--t2)}
.dr-gain b{font-size:26px;color:var(--ok);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.can{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;border-radius:999px;padding:2px 10px;margin-top:8px}
.can.yes{background:var(--lime-bg);color:var(--lime-ink)}.can.no{background:var(--sunk);color:var(--t2)}
.dr-body{flex:1;overflow-y:auto;padding:18px 22px 24px;overscroll-behavior:contain}
.face{background:var(--sunk);border-radius:12px;padding:12px 14px;margin-bottom:14px}
.face p{margin:4px 0 0}
.dr-foot{border-top:1px solid var(--line);padding:12px 22px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:6px}
.dr-btns{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.dr-state{font-size:13px;color:var(--t2);min-height:18px}
.dr-state.ok{color:var(--ok);font-weight:600}.dr-state.bad{color:var(--p2);font-weight:600}
.dr-next{margin-left:auto}
.drawer .td-head{display:none}
/* the full detail of one kind (in the panel, in print, without JavaScript) */
.tdetail .sum{margin:0 0 6px}
.tdetail .why{margin:0 0 14px;color:var(--t2)}
.fix{background:var(--lime-bg);border-radius:12px;padding:12px 16px;margin-bottom:16px}
.fix ol{margin:6px 0 0 18px;padding:0}.fix li{margin:3px 0}
.pages-k{margin:6px 0 8px}
.insts{display:flex;flex-direction:column;gap:6px}
.inst{border:1px solid var(--line);border-radius:10px;background:var(--surface)}
.inst>summary{display:flex;align-items:center;gap:8px;padding:9px 12px;list-style:none;cursor:pointer}
.inst>summary::-webkit-details-marker{display:none}
.inst>summary:hover{background:var(--sunk)}
.inst .u{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;color:var(--t2);overflow-wrap:anywhere;flex:1;min-width:0}
.ist{font-size:12px;font-weight:600;color:var(--ok)}
.ipts{font-size:12.5px;font-weight:700;color:var(--ok);font-variant-numeric:tabular-nums}
.chev{width:8px;height:8px;border-right:2px solid var(--t3);border-bottom:2px solid var(--t3);transform:rotate(-45deg);transition:transform .15s;flex-shrink:0;margin-right:2px}
details[open]>summary .chev{transform:rotate(45deg)}
.inst-body{padding:4px 12px 12px;border-top:1px solid var(--line)}
.inst-act{margin-top:10px}
.tick{display:inline-flex;gap:7px;align-items:center;font-size:13.5px;color:var(--t2);cursor:pointer}
.tick input{accent-color:var(--ink)}
.expl{margin:8px 0 4px}
.meta{font-size:12.5px;color:var(--t3)}
.val{border-left:3px solid var(--lime);background:var(--lime-bg);border-radius:0 8px 8px 0;padding:6px 10px;margin:10px 0}
.val .v{display:flex;gap:10px;align-items:flex-start;font-weight:600}.val .v span{flex:1;overflow-wrap:anywhere}
.copy{border:1px solid var(--line);background:var(--surface);color:var(--t2);border-radius:6px;font-size:12px;padding:1px 8px;cursor:pointer}
.facts{border-collapse:collapse;margin:10px 0;font-size:13px;width:100%}
.facts th{text-align:left;color:var(--t3);font-weight:600;width:130px;vertical-align:top;padding:3px 10px 3px 0}
.facts td{padding:3px 0;overflow-wrap:anywhere}
.found{margin-top:8px}.found .u{display:block;font-size:12px;line-height:1.7}.more{font-size:12px;color:var(--t3)}
figure{margin:12px 0 0}figure img{max-width:100%;width:520px;border:1px solid var(--line);border-radius:8px;display:block}
figcaption{font-size:12px;color:var(--t3);margin-top:4px}
.shot.later img{min-height:120px;background:linear-gradient(90deg,var(--sunk) 30%,var(--surface) 50%,var(--sunk) 70%) 0 0/300% 100%;animation:shim 1.2s linear infinite}
.shot.later.done img{animation:none;background:none;min-height:0}
@keyframes shim{from{background-position:100% 0}to{background-position:0 0}}
.shot.failed,.img-self.failed img{display:none}
.img-self img{max-width:260px;max-height:200px;width:auto;object-fit:contain;background:repeating-conic-gradient(var(--sunk) 0 25%,var(--surface) 0 50%) 0 0/16px 16px}
.img-note{font-size:13px;color:var(--t2);margin:10px 0 0}
.flash{animation:fl 1.6s ease}@keyframes fl{0%{box-shadow:0 0 0 3px var(--lime)}100%{box-shadow:0 0 0 3px transparent}}
/* ---------- toast ---------- */
.toast{position:fixed;left:50%;top:calc(74px + env(safe-area-inset-top,0px));transform:translate(-50%,-16px);background:var(--bar);color:var(--bar-t);border-radius:999px;padding:11px 20px;font-size:14px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;z-index:60;white-space:nowrap;max-width:calc(100% - 32px);overflow:hidden;text-overflow:ellipsis}
.toast.on{opacity:1;transform:translate(-50%,0)}
.toast b{color:var(--lime)}
/* ---------- the full report: print and no-JavaScript ---------- */
.full{display:none}
.nojs .app,.nojs .tabs,.nojs .spill,.nojs .drawer,.nojs .scrim,.nojs .selbar{display:none!important}
.nojs .full{display:block}
.full h2{font-size:19px;margin:28px 0 10px}
.full .tdetail{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;margin-bottom:12px}
.full .td-head h3{margin:0;font-size:17px}
.full .td-tags{margin:4px 0 8px;font-size:13px;color:var(--t2)}
.full .td-vis{margin:0 0 10px}
.print-sum{display:none}
.nojs .print-sum{display:block}
.clean{text-align:center;padding:40px 20px;margin-top:24px}
footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--t3)}
footer p{margin:0 0 6px;max-width:80ch}
[hidden]{display:none!important}
@media (max-width:900px){.hero{grid-template-columns:1fr}
.areatabs{display:flex;gap:4px;background:var(--sunk);border-radius:999px;padding:4px;margin-bottom:12px}
.areatabs button{all:unset;cursor:pointer;flex:1;text-align:center;padding:7px 8px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--t2)}
.areatabs button[aria-pressed=true]{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.cols{grid-template-columns:1fr}.cols .col:not(.show){display:none}
.rows .hdr{display:none}.rows .it{grid-template-columns:auto minmax(0,1fr) auto}.rows .r-c.hide-s{display:none}}
@media (max-width:620px){.top .in{gap:6px 12px;padding-block:8px}.brand .site{display:none}.tabs{order:3;width:100%;margin-left:0}.spill{margin-left:auto}
.scorecard{padding:16px 18px;gap:12px;flex-direction:column;align-items:stretch}.meterbox{margin:0 auto}.sc-txt{text-align:center;align-items:center}.sc-gain{font-size:17px}.site-h h1{font-size:21px}
.selbar{gap:10px;padding:10px 12px 10px 16px}.sb-main{font-size:14px}.sb-sub{display:none}.sb-r .ghost{padding:8px 4px}.sb-fix small{font-size:10px}.sorts h2{width:100%}
.dr-head,.dr-body,.dr-foot{padding-left:16px;padding-right:16px}}
@media print{.top,.app,.drawer,.scrim,.toast,.selbar,.copy,.inst-act{display:none!important}.full,.print-sum{display:block!important}body{background:#fff;color:#000;font-size:12px}
.full .tdetail,.inst{break-inside:avoid}.print-sum{margin-bottom:16px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

// The page's own script (its source is copied into the page): the score, the three
// areas, selecting fixes, the selection bar, the fix panel, checking the live site, the
// list with its filters, SiteFix's messages and links from the chat.
function liveReport(D) {
    "use strict";
    var $ = function (s, c) { return (c || document).querySelector(s); }, $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
    var all = D.issues.map(function (x) { return { id: x.id, type: x.t, severity: x.s, priority: x.p, pages: x.n }; });
    var byId = {}; all.forEach(function (i) { byId[i.id] = i; });
    var T = {}; D.types.forEach(function (t) { T[t.type] = t; t._text = ""; });
    var KEY = "sitefix-progress-" + D.runId;
    var state = { selected: {}, verified: {}, kept: {}, posts: [], visits: 0, last: 0 };
    var AREAS = ["on-page", "technical", "off-page"], AREA = { "on-page": "On-page", technical: "Technical", "off-page": "Off-page" };
    var EFF = { easy: "Easy", medium: "Medium", hard: "Bigger job" }, LV = { P1: "Urgent", P2: "Important", P3: "Polish" };
    var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
    var ui = { tab: "fix", sort: "rec", area: "on-page", drawer: null, note: {}, more: {}, earlier: false, f: { q: "", p: "", area: "", effort: "", sort: "points", types: null, qw: false } };
    function fill(tpl, v) { return fillMessage(tpl, v); }
    function badge(g) { return fmtPoints(g); }
    function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
    // ---------- what is selected, what is confirmed ----------
    function verIds() { return Object.keys(state.verified); }
    function keptIds() { return Object.keys(state.kept).filter(function (id) { return byId[id] && !state.verified[id]; }); }
    // Settled: confirmed fixed, or kept as is on purpose. Neither counts against the score.
    function baseIds() { return verIds().concat(keptIds()); }
    function selIds() { return Object.keys(state.selected).filter(function (id) { return byId[id] && !state.verified[id] && !state.kept[id]; }); }
    function openOf(t) { return t.ids.filter(function (id) { return !state.verified[id] && !state.kept[id]; }); }
    function keptOf(t) { return t.ids.filter(function (id) { return state.kept[id] && !state.verified[id]; }); }
    function selOf(t) { var o = openOf(t); if (!o.length) return keptOf(t).length ? "kept" : "verified"; var n = o.filter(function (id) { return state.selected[id]; }).length; return !n ? "none" : n === o.length ? "all" : "some"; }
    function settled(t) { var x = selOf(t); return x === "verified" || x === "kept"; }
    // Points per kind and per issue (lib/score.js pointsOf), worked out again only when
    // a fix is confirmed on the live site.
    var Pkey = null, P = null;
    // Shares are worked out from what is confirmed fixed; something kept as is adds its
    // share like a selected fix does, so keeping a page moves the score by exactly the
    // points it shows.
    function pts() { var v = verIds().sort(), k = v.join(","); if (k !== Pkey) { Pkey = k; P = pointsOf(all, v); } return P; }
    function issuePts(id) { var x = pts().perIssue[id]; return x ? x.points : 0; }
    function worth(t) { return openOf(t).reduce(function (n, id) { return n + issuePts(id); }, 0); }
    function scores() { var p = pts(), k = keptIds(); return { now: projected(p, k), sel: projected(p, k.concat(selIds())) }; }
    // ---------- saving ----------
    function save() {
        state.posts = state.posts.slice(-30);
        if (D.api) { try { fetch(D.api + "progress", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }).catch(function () { }); } catch (e) { } }
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
    }
    function adopt(s) { if (!s || typeof s !== "object") return false; state.selected = s.selected || {}; state.verified = s.verified || {}; state.kept = s.kept || {}; state.posts = s.posts || []; state.visits = s.visits || 0; state.last = s.last || 0; return true; }
    function load(done) {
        var local = null;
        try { local = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { }
        if (!D.api) { if (local && local.selected) adopt(local); return done(); }
        fetch(D.api + "progress").then(function (r) { return r.ok ? r.json() : null; }).then(function (s) { if (!(s && s.selected && adopt(s)) && local && local.selected) adopt(local); done(); }, function () { if (local && local.selected) adopt(local); done(); });
    }
    // ---------- toast ----------
    var toastTimer = null;
    function toast(html) { var t = $("#toast"); t.innerHTML = html; t.className = "toast on"; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = "toast"; }, 2800); }
    // ---------- the score ----------
    var shown = null;
    function paint() {
        var s = scores(), now = s.now.score, to = s.sel.score, d = s.sel.exact - s.now.exact;
        var bn = $(".g-band-name"), band = BANDS.filter(function (b) { return to <= b.max; })[0] || BANDS[3];
        var an = $(".g-arc-now"), as = $(".g-arc-sel");
        if (an) an.style.strokeDashoffset = (100 - s.now.exact).toFixed(2);
        if (as) as.style.strokeDashoffset = (100 - s.sel.exact).toFixed(2);
        if (bn) { bn.textContent = band.name; bn.className = "g-band-name " + band.cls; }
        var mb = $(".meterbox"); if (mb) mb.setAttribute("aria-label", "Score " + to + " out of 100: " + band.name + (to !== now ? " with the selected fixes; " + now + " today" : ""));
        var n = $(".g-num b");
        if (n && shown !== null && to !== shown) {
            var from = shown, t0 = performance.now();
            (function step(t) { var k = Math.min(1, (t - t0) / 600); n.textContent = Math.round(from + (to - from) * k); if (k < 1) requestAnimationFrame(step); })(t0);
            var pill = $(".spill"); if (pill) { pill.classList.remove("bump"); void pill.offsetWidth; pill.classList.add("bump"); }
        } else if (n) n.textContent = to;
        shown = to;
        var nSel = D.types.filter(function (t) { var x = selOf(t); return x === "all" || x === "some"; }).length;
        $("#sp-now").textContent = now;
        $("#sp-to").hidden = to === now; $("#sp-to").textContent = "→ " + to;
        var bandNow = BANDS.filter(function (b) { return now <= b.max; })[0] || BANDS[3];
        $(".sc-now").innerHTML = "Your score today: <b>" + now + "</b> \u00b7 " + bandNow.name + (verIds().length ? " (" + plural(verIds().length, "fix") + " confirmed on your site)" : "") + (keptIds().length ? " (" + keptIds().length + " kept as is)" : "");
        $(".sc-gain").innerHTML = d > 0 ? '<span class="g">+' + fmtPoints(d) + "</span> with " + plural(nSel, "selected fix").replace("fixs", "fixes") : "Tick fixes below to see your score climb";
        renderCols(); renderRows(); renderBar(s, nSel); renderDrawer();
    }
    // ---------- the three areas ----------
    var WEIGHT = { P1: 1.6, P2: 1.2, P3: 1 }, COST = { easy: 1, medium: 1.8, hard: 3 }, PO = { P1: 0, P2: 1, P3: 2 }, EO = { easy: 0, medium: 1, hard: 2 };
    function sorter(mode, g) {
        var rank = function (t) { return g[t.type] * WEIGHT[t.level] / COST[t.effort]; };
        var by = {
            rec: function (a, b) { return rank(b) - rank(a); },
            quick: function (a, b) { return EO[a.effort] - EO[b.effort] || g[b.type] - g[a.type]; },
            boost: function (a, b) { return g[b.type] - g[a.type]; },
            urgent: function (a, b) { return PO[a.level] - PO[b.level] || g[b.type] - g[a.type]; },
        }[mode] || function () { return 0; };
        return function (a, b) { return settled(a) - settled(b) || by(a, b); };
    }
    function item(t, g, extra) {
        var st = selOf(t), v = st === "verified";
        if (st === "kept") return keptItem(t, extra);
        return '<div class="it' + (st === "all" ? " sel" : "") + (v ? " ver" : "") + '">' +
            (v ? '<span class="ok-i" title="Confirmed on your live site">✓</span>' : '<input type="checkbox" class="ck" data-sel="' + esc(t.type) + '"' + (st === "all" ? " checked" : "") + (st === "some" ? " data-part" : "") + ' aria-label="Select: ' + esc(t.title) + '">') +
            '<button type="button" class="it-main" data-open="' + esc(t.type) + '"><span class="it-t">' + esc(t.title) + '</span><span class="it-m"><span class="pill ' + t.level + '">' + LV[t.level] + "</span>" + EFF[t.effort] + " · " + plural(t.pages, "page") + "</span></button>" +
            (extra || "") + '<span class="it-g">' + (v ? "Fixed" : st === "some" ? "+" + badge(openOf(t).filter(function (id) { return state.selected[id]; }).reduce(function (n, id) { return n + issuePts(id); }, 0)) + '<small class="of"> of ' + badge(g) + "</small>" : "+" + badge(g)) + "</span></div>";
    }
    // A kind kept as is (all of it, or some pages): in the Kept column, with Undo.
    function keptItem(t, extra) {
        var k = keptOf(t).length;
        return '<div class="it kp"><span class="kp-i" title="Kept as is">\u21ba</span>' +
            '<button type="button" class="it-main" data-open="' + esc(t.type) + '"><span class="it-t">' + esc(t.title) + '</span><span class="it-m">' + (k === t.ids.length ? "Kept as is" : k + " of " + t.ids.length + " kept as is") + " \u00b7 " + AREA[t.area] + "</span></button>" +
            (extra || "") + '<button type="button" class="unkeep" data-unkeep="' + esc(t.type) + '">Undo</button></div>';
    }
    function renderCols() {
        var box = $("#cols"); if (!box) return;
        var s = scores(), g = {};
        D.types.forEach(function (t) { g[t.type] = worth(t); });
        $$(".chip[data-sort]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.sort === ui.sort)); });
        $$(".areatabs button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.area === ui.area)); });
        var kept = D.types.filter(function (t) { return keptOf(t).length; });
        box.innerHTML = AREAS.map(function (a) {
            var list = D.types.filter(function (t) { return t.area === a && selOf(t) !== "kept"; }).sort(sorter(ui.sort, g));
            var open = list.filter(function (t) { return !settled(t); }).length, nSel = list.filter(function (t) { var x = selOf(t); return x === "all" || x === "some"; }).length;
            var now = s.now.areas[a], to = s.sel.areas[a], MAX = 6, shown = ui.more[a] ? list : list.slice(0, MAX);
            return '<section class="col' + (ui.area === a ? " show" : "") + '" data-col="' + a + '" aria-label="' + AREA[a] + '">' +
                '<div class="col-h"><div class="col-t"><h3>' + AREA[a] + '</h3><span class="sc">' + now + (to > now ? ' <span class="to">→ ' + to + "</span>" : "") + '</span></div>' +
                '<div class="meter"><i style="width:' + to + '%"></i><b style="width:' + now + '%"></b></div>' +
                '<div class="col-n">' + (list.length ? plural(open, "fix") .replace("fixs", "fixes") + " to make" + (nSel ? " · " + nSel + " selected" : "") : "") + (a === "off-page" ? (list.length ? " · " : "") + "Backlinks and reviews aren't measured yet" : "") + "</div></div>" +
                (list.length ? '<div class="list">' + shown.map(function (t) { return item(t, g[t.type]); }).join("") + "</div>" +
                    (list.length > MAX ? '<button type="button" class="col-more" data-more="' + a + '">' + (ui.more[a] ? "Show fewer" : "Show all " + list.length) + "</button>" : "")
                    : '<div class="col-empty">No problems found here.</div>') + "</section>";
        }).join("") +
            '<section class="col kept' + (ui.area === "kept" ? " show" : "") + '" data-col="kept" aria-label="Kept as is">' +
            '<div class="col-h"><div class="col-t"><h3>Kept as is</h3><span class="sc">' + kept.length + '</span></div>' +
            '<div class="col-n">On purpose, so not counted in your score. Undo any time.</div></div>' +
            (kept.length ? '<div class="list">' + kept.map(function (t) { return keptItem(t); }).join("") + "</div>"
                : '<div class="col-empty">Nothing kept. If a flagged item is there on purpose (a page with a tracking link, a brand name), open it and choose <b>Keep as is</b>.</div>') + "</section>";
        $$("input[data-part]", box).forEach(function (c) { c.indeterminate = true; });
    }
    // ---------- the list ----------
    function renderRows() {
        var box = $("#rows"); if (!box) return;
        var f = ui.f, words = f.q.toLowerCase().split(/\s+/).filter(Boolean), g = {};
        D.types.forEach(function (t) { g[t.type] = worth(t); });
        var list = D.types.filter(function (t) {
            return (!f.p || t.level === f.p) && (!f.area || (f.area === "kept" ? keptOf(t).length > 0 : t.area === f.area)) && (!f.effort || t.effort === f.effort) &&
                (!f.types || f.types.indexOf(t.type) !== -1) && (!f.qw || (t.effort === "easy" && t.level !== "P3")) &&
                words.every(function (w) { return t._text.indexOf(w) !== -1; });
        });
        var sorts = {
            points: sorter("boost", g), priority: sorter("urgent", g), easy: sorter("quick", g),
            pages: function (a, b) { return b.pages - a.pages; }, az: function (a, b) { return a.title.localeCompare(b.title); },
        };
        list.sort(sorts[f.sort] || sorts.points);
        var issues = list.reduce(function (n, t) { return n + t.ids.length; }, 0);
        $("#count").textContent = "Showing " + list.length + " of " + D.types.length + " kinds of problem (" + plural(issues, "issue") + ")";
        var pre = [];
        if (f.types) pre.push('<button type="button" class="preset" data-clear="types">Only the problems from the chat ×</button>');
        if (f.qw) pre.push('<button type="button" class="preset" data-clear="qw">Quick wins ×</button>');
        $("#presets").innerHTML = pre.join("");
        if (!list.length) { box.innerHTML = '<div class="empty">Nothing matches. <button class="btn small" type="button" id="reset">Clear the filters</button></div>'; return; }
        box.innerHTML = '<div class="hdr" aria-hidden="true"><span></span><span>Problem</span><span>Area</span><span>Effort</span><span style="text-align:right">Points</span></div>' +
            list.map(function (t) { return item(t, g[t.type], '<span class="r-c hide-s">' + AREA[t.area] + '</span><span class="r-c hide-s">' + EFF[t.effort] + "</span>"); }).join("");
        $$("input[data-part]", box).forEach(function (c) { c.indeterminate = true; });
    }
    // ---------- the selection bar ----------
    function renderBar(s, nSel) {
        var bar = $("#selbar"); if (!bar) return;
        var ids = selIds();
        bar.hidden = !ids.length || Boolean(ui.drawer);
        if (!ids.length) return;
        var now = s.now.score, to = s.sel.score, d = s.sel.exact - s.now.exact;
        var parts = AREAS.filter(function (a) { return s.sel.areasExact[a] - s.now.areasExact[a] > 0.001; }).map(function (a) { return AREA[a] + " +" + fmtPoints(s.sel.areasExact[a] - s.now.areasExact[a]); });
        var can = 0, manual = 0;
        D.types.forEach(function (t) { var x = selOf(t); if (x === "all" || x === "some") { if (t.canFix) can++; else manual++; } });
        $(".sb-main").innerHTML = "<b>" + plural(nSel, "fix").replace("fixs", "fixes") + "</b> selected · " + '<b class="g">+' + fmtPoints(d) + "</b> point" + (fmtPoints(d) === "1" ? "" : "s") + " · score <b>" + now + " → " + to + "</b>";
        $(".sb-sub").textContent = [parts.join(" · "), (can ? can + " SiteFix will be able to fix" : "") + (can && manual ? ", " : "") + (manual ? manual + " for your developer" : "")].filter(Boolean).join("  |  ");
    }
    // The fix stage: when the server offers it (links.fix), the selection is sent to be
    // fixed; fixes that come back confirmed count in today's score.
    function fixSelected() {
        if (!D.fix) return;
        var ids = selIds(); if (!ids.length) return;
        var btn = $("#sb-fix"); btn.disabled = true; btn.textContent = "Fixing…";
        fetch(D.fix, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids }) }).then(function (r) { return r.json(); }).then(function (d) {
            var before = scores().now.score, res = (d && d.results) || {};
            Object.keys(res).forEach(function (id) { if (res[id].status === "fixed" && byId[id]) { state.verified[id] = Date.now(); delete state.selected[id]; } });
            paint(); save();
            var after = scores().now.score; if (after > before) toast("<b>+" + (after - before) + "</b> points · score " + after);
        }, function () { toast("Couldn't reach SiteFix. Try again in a moment."); }).then(function () { btn.disabled = false; btn.textContent = "Fix these"; });
    }
    // ---------- selecting ----------
    var msgTimer = null;
    function select(ids, on) {
        ids.forEach(function (id) { if (state.verified[id]) return; if (on) state.selected[id] = true; else delete state.selected[id]; });
        paint(); save();
        selectionChanged();
    }
    // Keep as is: on purpose, so it stops counting against the score; Undo brings it back.
    function keep(ids, on) {
        var t = T[byId[ids[0]] && byId[ids[0]].type];
        ids.forEach(function (id) { if (state.verified[id]) return; if (on) { state.kept[id] = Date.now(); delete state.selected[id]; } else delete state.kept[id]; });
        paint(); save();
        if (on && t) post(fill(D.bank.afterKeep, { issue: t.title, score: scores().now.score }), null, "keep");
        else if (t) toast("Back in your list \u00b7 " + esc(t.title));
    }
    // SiteFix's message always matches what is selected now: ticking or unticking
    // rewrites the latest selection message (it isn't stacked up), and when nothing is
    // left selected it says so. Other messages (a suggestion, a live check) stay.
    function selectionChanged() {
        clearTimeout(msgTimer);
        msgTimer = setTimeout(function () {
            var s = scores(), d = s.sel.exact - s.now.exact, n = D.types.filter(function (t) { var x = selOf(t); return x === "all" || x === "some"; }).length;
            var last = state.posts[state.posts.length - 1], mine = last && (last.kind === "select" || last.kind === "cleared");
            if (n) {
                var text = fill(D.bank.afterSelect, { count: n, gain: fmtPoints(d), score: s.sel.score });
                if (mine) { last.text = withEmoji(text, "select"); last.kind = "select"; last.at = Date.now(); renderCoach(true); save(); }
                else post(text, null, "select");
            } else if (mine && last.kind === "select") {
                last.text = withEmoji(fill(D.bank.selectionCleared, { score: s.now.score }), "cleared"); last.kind = "cleared"; last.at = Date.now(); renderCoach(true); save();
            }
        }, 450);
    }
    // ---------- SiteFix's messages ----------
    function ago(t) { var m = Math.round((Date.now() - t) / 60000); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; var h = Math.round(m / 60); if (h < 24) return h + " h ago"; return Math.round(h / 24) + " d ago"; }
    // A friendly emoji on SiteFix's messages, picked by the kind of message and varied
    // from one message to the next. Added here, after the words (AI or built-in) were
    // checked, so it never changes what a message says.
    var EMOJI = { hello: ["\ud83d\udc4b"], back: ["\ud83d\udc4b", "\ud83d\ude4c"], next: ["\ud83d\udca1", "\ud83c\udfaf", "\ud83d\udc49"], select: ["\ud83d\ude80", "\ud83d\udcc8", "\u2728", "\ud83d\udcaa"], verified: ["\u2705", "\ud83c\udf89"], still: ["\ud83d\udd0d", "\ud83d\udee0\ufe0f"], keep: ["\ud83d\udc4c"], cleared: ["\ud83d\ude42"], done: ["\ud83c\udfc6"] };
    function withEmoji(text, kind) {
        var set = EMOJI[kind]; if (!set) return text;
        var e = set[state.posts.length % set.length];
        return kind === "hello" || kind === "back" ? e + " " + text : text + " " + e;
    }
    function post(text, action, kind) { state.posts.push({ at: Date.now(), text: withEmoji(text, kind), action: action || null, kind: kind || null }); renderCoach(true); save(); }
    function renderCoach(fresh) {
        var p = state.posts[state.posts.length - 1], b = $(".bubble"); if (!p || !b) return;
        b.textContent = p.text;
        if (fresh) { b.style.animation = "none"; void b.offsetWidth; b.style.animation = ""; }
        $(".coach-when").textContent = ago(p.at);
        var older = state.posts.slice(0, -1).reverse().slice(0, 5);
        $(".coach-act").innerHTML = (p.action && T[p.action.type] ? '<button type="button" class="btn small primary" data-open="' + esc(p.action.type) + '">Show me</button>' : "") +
            (older.length ? '<button type="button" class="linkbtn" id="earlier" aria-expanded="' + ui.earlier + '">' + (ui.earlier ? "Hide earlier messages" : "Earlier messages") + "</button>" : "");
        var list = $(".earlier");
        list.hidden = !ui.earlier || !older.length;
        list.innerHTML = older.map(function (x) { return "<li>" + esc(x.text) + " <small>" + ago(x.at) + "</small></li>"; }).join("");
    }
    function nextUp(except) {
        var best = null;
        D.types.forEach(function (t) {
            if (selOf(t) !== "none" || t.type === except) return;
            var g = worth(t), k = g * WEIGHT[t.level] / COST[t.effort];
            if (!best || k > best.k) best = { t: t, g: g, k: k };
        });
        return best;
    }
    function suggestNext() { var n = nextUp(); if (n) post(fill(D.bank.nextUp, { issue: n.t.title, gain: fmtPoints(n.g) }), { type: n.t.type }, "next"); }
    // ---------- checking the live site (for a client who fixed something themselves) ----------
    function check(type) {
        var t = T[type], ids = openOf(t);
        if (!ids.length) return;
        var got = {}, rounds = 0;
        ui.note[type] = { text: "Checking your live site…", cls: "", busy: true }; renderDrawer();
        function round(list) {
            rounds++;
            return fetch(D.api + "verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: list.slice(0, 60) }) })
                .then(function (r) { if (!r.ok) throw new Error("bad"); return r.json(); })
                .then(function (d) {
                    var res = d.results || {}, left = [];
                    list.forEach(function (id) { var x = res[id]; if (!x || x.status === "skipped") left.push(id); else got[id] = x.status; });
                    if (left.length && rounds < 6) { ui.note[type] = { text: "Checking your live site (" + Object.keys(got).length + " of " + ids.length + " done)…", cls: "", busy: true }; renderDrawer(); return round(left); }
                    left.forEach(function (id) { got[id] = "unknown"; });
                });
        }
        round(ids).then(function () {
            var fixedNow = [], still = [], manual = [], unknown = [];
            ids.forEach(function (id) { var s = got[id]; if (s === "fixed") fixedNow.push(id); else if (s === "still") still.push(id); else if (s === "manual") manual.push(id); else unknown.push(id); });
            var before = scores().now;
            fixedNow.forEach(function (id) { state.verified[id] = Date.now(); delete state.selected[id]; });
            var note;
            if (still.length) note = { text: still.length === ids.length ? "Still there on your live site." : still.length + " of " + ids.length + " still there on your live site.", cls: "bad" };
            else if (unknown.length && !fixedNow.length) note = { text: "Couldn't reach your site just now. Try again in a moment.", cls: "bad" };
            else if (manual.length && !fixedNow.length) note = { text: "This kind is confirmed at the next inspection.", cls: "" };
            else if (fixedNow.length < ids.length) note = { text: fixedNow.length + " of " + ids.length + " confirmed; the rest are checked at the next inspection.", cls: "ok" };
            else note = { text: "Confirmed on your live site.", cls: "ok" };
            ui.note[type] = note;
            paint();
            var after = scores().now;
            if (fixedNow.length) {
                post(fill(D.bank.afterVerify, { issue: t.title, gain: after.score - before.score >= 1 ? after.score - before.score : gainText(Math.max(0, Math.min(0.9, Math.round((after.exact - before.exact) * 10) / 10))), score: after.score }), null, "verified");
                if (after.score > before.score) toast("<b>+" + (after.score - before.score) + "</b> points confirmed · score " + after.score);
            } else if (still.length) post(fill(D.bank.stillThere, { issue: t.title }), { type: type }, "still");
            save();
        }, function () { ui.note[type] = { text: "Couldn't reach SiteFix to check. Try again in a moment.", cls: "bad" }; renderDrawer(); });
    }
    // ---------- the fix panel ----------
    var home = {};
    // Ask for a fix's screenshots before they are shown (when the pointer is over it, and
    // when it opens), so they are usually ready by the time a page is opened.
    var preloaded = {};
    function preload(type, n) {
        $$("#t-" + type + " figure.shot img").slice(0, n).forEach(function (img) {
            var u = img.getAttribute("data-src") || img.getAttribute("src");
            if (!u || preloaded[u]) return;
            preloaded[u] = new Image(); preloaded[u].src = u;
        });
    }
    document.addEventListener("pointerover", function (e) { var o = e.target.closest && e.target.closest("[data-open]"); if (o) preload(o.dataset.open, 1); });
    function openDrawer(type, instId) {
        var t = T[type]; if (!t) return;
        preload(type, 4);
        if (ui.drawer && ui.drawer !== type) putBack();
        var node = document.getElementById("t-" + type);
        if (node && !home[type]) { home[type] = { parent: node.parentNode, next: node.nextSibling }; $("#dr-detail").appendChild(node); }
        ui.drawer = type;
        $("#dr-vis").textContent = t.visitor; $("#dr-face").hidden = !t.visitor;
        paint();
        $(".scrim").hidden = false; $(".drawer").hidden = false;
        requestAnimationFrame(function () { $(".scrim").classList.add("on"); $(".drawer").classList.add("on"); });
        document.body.style.overflow = "hidden";
        if (instId) {
            var inst = document.getElementById(instId);
            if (inst) { inst.open = true; setTimeout(function () { inst.scrollIntoView({ block: "center" }); inst.classList.add("flash"); setTimeout(function () { inst.classList.remove("flash"); }, 1700); }, 320); }
        } else {
            $(".dr-body").scrollTop = 0;
            // The first page opens by itself, so its screenshot is in view straight away.
            var first = $("#dr-detail .inst"); if (first && !first.open) first.open = true;
        }
        setTimeout(function () { $("#dr-title").focus(); }, 60);
    }
    function putBack() {
        var type = ui.drawer, h = home[type], node = document.getElementById("t-" + type);
        if (h && node) h.parent.insertBefore(node, h.next);
        delete home[type];
    }
    function closeDrawer() {
        if (!ui.drawer) return;
        var type = ui.drawer;
        $(".scrim").classList.remove("on"); $(".drawer").classList.remove("on");
        document.body.style.overflow = "";
        setTimeout(function () { if (ui.drawer) return; $(".scrim").hidden = true; $(".drawer").hidden = true; }, 300);
        putBack(); ui.drawer = null; paint();
        var back = $('[data-open="' + type + '"]'); if (back) back.focus({ preventScroll: true });
    }
    function renderDrawer() {
        var type = ui.drawer; if (!type) return;
        var t = T[type], st = selOf(t), v = st === "verified", g = worth(t), s = scores();
        var withIt = projected(pts(), keptIds().concat(openOf(t)));
        $("#dr-meta").innerHTML = '<span class="pill ' + t.level + '">' + LV[t.level] + "</span><span>" + EFF[t.effort] + " · " + AREA[t.area] + " · " + esc(t.owner) + " · " + plural(t.ids.length, "issue") + "</span>";
        $("#dr-title").textContent = t.title;
        var kk = keptOf(t).length, kb = $("#dr-keep");
        if (kb) { kb.hidden = !t.canKeep || v; kb.textContent = st === "kept" ? "Kept as is \u00b7 Undo" : kk ? "Keep the rest as is" : "Keep as is"; kb.dataset.mode = st === "kept" ? "undo" : "keep"; }
        if (st === "kept") { $("#dr-gain").innerHTML = "<b>\u21ba</b><span>Kept as is, on purpose: not counted in your score</span>"; }
        else $("#dr-gain").innerHTML = v ? "<b>✓</b><span>Confirmed on your live site</span>" : "<b>+" + badge(g) + "</b><span>point" + (badge(g) === "1" ? "" : "s") + " · score " + s.now.score + " → " + withIt.score + " · " + AREA[t.area] + " " + s.now.areas[t.area] + " → " + withIt.areas[t.area] + "</span>";
        $("#dr-can").className = "can " + (t.canFix ? "yes" : "no");
        $("#dr-can").textContent = t.canFix ? "SiteFix will be able to fix this" : "A fix for your developer or content writer";
        var sb = $("#dr-sel");
        sb.hidden = v || st === "kept";
        sb.textContent = st === "all" ? "Selected ✓ · Remove" : st === "some" ? "Select all pages" : "Select this fix · +" + badge(g);
        sb.className = st === "all" ? "btn" : "btn primary";
        var chk = $("#dr-check");
        if (chk) { var busy = ui.note[type] && ui.note[type].busy; chk.hidden = v || st === "kept"; chk.disabled = Boolean(busy); chk.textContent = busy ? "Checking…" : "Fixed it yourself? Check your live site"; }
        var n = ui.note[type], el = $("#dr-state");
        el.textContent = n ? n.text : st === "some" ? openOf(t).filter(function (id) { return state.selected[id]; }).length + " of " + openOf(t).length + " pages selected" : kk && st !== "kept" ? kk + " of " + t.ids.length + " kept as is" : "";
        el.className = "dr-state " + (n ? n.cls : "");
        var nx = nextUp(type), nb = $("#dr-next");
        nb.hidden = !nx; if (nx) { nb.dataset.open = nx.t.type; nb.textContent = "Next: " + nx.t.title + " →"; }
        $$(".ipts", $("#dr-detail")).forEach(function (el) { var id = el.dataset.id; el.textContent = state.verified[id] || state.kept[id] ? "" : "+" + fmtPoints(issuePts(id)); });
        $$("input[data-sel-id]", $("#dr-detail")).forEach(function (cb) { var id = cb.dataset.selId, k = Boolean(state.kept[id]); cb.checked = Boolean(state.selected[id] || state.verified[id]); cb.disabled = Boolean(state.verified[id]) || k; cb.closest(".inst").classList.toggle("kept-one", k); var m = $('.ist[data-id="' + id + '"]'); if (m) m.textContent = state.verified[id] ? "Confirmed" : k ? "Kept as is" : state.selected[id] ? "Selected" : ""; });
        $$("button[data-keep-id]", $("#dr-detail")).forEach(function (b) { var k = Boolean(state.kept[b.dataset.keepId]); b.setAttribute("aria-pressed", String(k)); b.textContent = k ? "Kept as it is \u00b7 Undo" : "Keep this page as it is"; });
    }
    // ---------- tabs and links from the chat ----------
    function setTab(name, keepScroll) {
        if (!$("#panel-" + name)) return;
        ui.tab = name;
        $$(".tab").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.tab === name)); b.tabIndex = b.dataset.tab === name ? 0 : -1; });
        $$(".panel").forEach(function (p) { p.hidden = p.id !== "panel-" + name; });
        if (!keepScroll) window.scrollTo(0, 0);
    }
    function resetFilters() { ui.f = { q: "", p: "", area: "", effort: "", sort: ui.f.sort, types: null, qw: false }; syncControls(); }
    function syncControls() { ["p", "area", "effort", "sort"].forEach(function (k) { var el = $("#f-" + k); if (el) el.value = ui.f[k]; }); var q = $("#q"); if (q) q.value = ui.f.q; }
    function fromHash(h) {
        if (!h) return;
        if (h === "fix" || h === "issues") return setTab(h);
        var m = h.match(/^(type|p|qw)=([a-z0-9,-]+)$/i);
        if (!m) { var inst = document.getElementById(h); var sec = inst && inst.closest(".tdetail"); if (sec) openDrawer(sec.dataset.type, h); return; }
        resetFilters();
        if (m[1] === "type") ui.f.types = m[2].split(","); else if (m[1] === "p") ui.f.p = m[2].toUpperCase(); else ui.f.qw = true;
        syncControls(); renderRows(); setTab("issues");
        if (m[1] === "type" && ui.f.types.length === 1 && T[ui.f.types[0]]) openDrawer(ui.f.types[0]);
    }
    // ---------- start ----------
    document.documentElement.classList.remove("nojs");
    // Search looks at the problem's name, what it means, and the pages it is on.
    $$(".tdetail").forEach(function (sec) { var t = T[sec.dataset.type]; if (t) t._text = [t.title, t.visitor, t.owner, ($(".sum", sec) || {}).textContent || ""].concat($$(".inst > summary .u", sec).map(function (u) { return u.textContent; })).join(" ").toLowerCase(); });
    $("#sb-fix").disabled = !D.fix;
    $("#sb-soon").hidden = Boolean(D.fix);
    load(function () {
        var firstVisit = !state.visits;
        state.visits = (state.visits || 0) + 1;
        paint();
        var s = scores(), lv = levelOf(all, verIds());
        if (firstVisit) {
            post(lv.total.P1 ? fill(D.bank.intro, { site: D.site, score: s.now.score, urgent: lv.total.P1, level: lv.name }) : fill(D.bank.level[Math.min(4, lv.level)], { count: lv.level <= 3 ? lv.open[["", "P1", "P2", "P3"][lv.level]] : 0 }), null, lv.level <= 3 ? "hello" : "done");
            setTimeout(suggestNext, 1200);
        } else if (Date.now() - (state.last || 0) > 30 * 60000) {
            var cur = ["", "P1", "P2", "P3"][lv.level];
            post(cur ? fill(D.bank.welcomeBack, { score: s.now.score, left: lv.open[cur], level: lv.name }) : fill(D.bank.level[4], {}), null, cur ? "back" : "done");
        } else renderCoach(false);
        state.last = Date.now();
        save();
        if (location.hash) fromHash(decodeURIComponent(location.hash.slice(1)));
        // When the page is left open, now and then suggest a fix not yet selected.
        setInterval(function () { var lp = state.posts[state.posts.length - 1]; if (!document.hidden && !ui.drawer && (!lp || Date.now() - lp.at > 10 * 60000)) suggestNext(); renderCoach(false); }, 60000);
    });
    window.addEventListener("hashchange", function () { fromHash(decodeURIComponent(location.hash.slice(1))); });
    // Screenshots taken when an issue is first opened, two at a time, so one still being
    // taken doesn't hold up the others.
    var shotQueue = [], shotsLoading = 0;
    function pumpShots() {
        while (shotsLoading < 2 && shotQueue.length) {
            var img = shotQueue.shift(), fig = img.closest("figure"); shotsLoading++;
            img.onload = function () { shotsLoading--; this.closest("figure").classList.add("done"); this.closest("figure").querySelector("figcaption").textContent = this.closest("figure").querySelector(".cap-done").textContent; pumpShots(); };
            img.onerror = function () { shotsLoading--; this.closest("figure").classList.add("failed"); pumpShots(); };
            img.src = img.dataset.src; img.removeAttribute("data-src");
            if (fig) fig.classList.add("loading");
        }
    }
    document.addEventListener("toggle", function (e) {
        var d = e.target; if (!d.classList || !d.classList.contains("inst") || !d.open) return;
        $$("img[data-src]", d).forEach(function (img) { shotQueue.push(img); }); pumpShots();
    }, true);
    // An image that doesn't load says so instead of showing a broken picture.
    document.addEventListener("error", function (e) {
        var img = e.target; if (!img || img.tagName !== "IMG") return;
        var shot = img.closest("figure.shot"); if (shot) { shot.classList.add("failed"); return; }
        if (!img.closest(".img-self")) return;
        var f = img.closest(".img-self"); f.classList.add("failed"); f.querySelector("figcaption").textContent = "The image doesn't load right now.";
    }, true);
    // The Export menu closes on a click anywhere else, on Escape, and once an option is chosen.
    function closeExport() { var ex = $(".export"); if (ex && ex.open) ex.open = false; }
    document.addEventListener("click", function (e) {
        var ex = $(".export");
        if (ex && ex.open && !ex.contains(e.target)) closeExport();
        var opt = e.target.closest(".menu a");
        if (opt) { closeExport(); toast(opt.hasAttribute("download") ? "Preparing your download\u2026" : "The PDF opens in a new tab"); return; }
        var b = e.target.closest("button, .scrim"); if (!b) return;
        if (b.classList.contains("scrim") || b.classList.contains("dr-close")) return closeDrawer();
        if (b.dataset.tab) return setTab(b.dataset.tab);
        if (b.dataset.open) return openDrawer(b.dataset.open);
        if (b.dataset.sort) { ui.sort = b.dataset.sort; return renderCols(); }
        if (b.dataset.area) { ui.area = b.dataset.area; return renderCols(); }
        if (b.dataset.more) { ui.more[b.dataset.more] = !ui.more[b.dataset.more]; return renderCols(); }
        if (b.id === "earlier") { ui.earlier = !ui.earlier; return renderCoach(false); }
        if (b.id === "dr-sel") { var t = T[ui.drawer], o = openOf(t), st = selOf(t); delete ui.note[ui.drawer]; return select(o, st !== "all"); }
        if (b.id === "dr-check") return check(ui.drawer);
        if (b.id === "dr-keep") { var tk = T[ui.drawer]; delete ui.note[ui.drawer]; return b.dataset.mode === "undo" ? keep(keptOf(tk), false) : keep(openOf(tk), true); }
        if (b.dataset.keepId) { delete ui.note[ui.drawer]; return keep([b.dataset.keepId], !state.kept[b.dataset.keepId]); }
        if (b.dataset.unkeep) return keep(keptOf(T[b.dataset.unkeep]), false);
        if (b.id === "sb-clear") { state.selected = {}; paint(); save(); selectionChanged(); return; }
        if (b.id === "sb-fix") return fixSelected();
        if (b.dataset.clear) { ui.f[b.dataset.clear] = b.dataset.clear === "types" ? null : false; return renderRows(); }
        if (b.id === "reset") { resetFilters(); return renderRows(); }
        if (b.dataset.print !== undefined) { closeExport(); return setTimeout(function () { window.print(); }, 80); }
        if (b.classList.contains("copy")) { e.preventDefault(); var done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1200); }; if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, function () { }); }
    });
    document.addEventListener("change", function (e) {
        var c = e.target.closest("input[data-sel]");
        if (c) { var t = T[c.dataset.sel]; return select(openOf(t), c.checked); }
        var one = e.target.closest("input[data-sel-id]");
        if (one) { delete ui.note[ui.drawer]; return select([one.dataset.selId], one.checked); }
        var sel = e.target.closest("select[data-f]"); if (sel) { ui.f[sel.dataset.f] = sel.value; renderRows(); }
    });
    var q = $("#q"); if (q) q.addEventListener("input", function () { ui.f.q = q.value; renderRows(); });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { var ex = $(".export"); if (ex && ex.open) { closeExport(); $(".export > summary").focus(); return; } if (ui.drawer) closeDrawer(); }
        var tab = e.target.closest && e.target.closest(".tab");
        if (tab && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { var tabs = $$(".tab"), k = tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1); var nt = tabs[(k + tabs.length) % tabs.length]; setTab(nt.dataset.tab, true); nt.focus(); }
    });
    window.addEventListener("beforeprint", function () { closeDrawer(); $$(".full details").forEach(function (d) { d.dataset.was = d.open ? "1" : "0"; d.open = true; }); });
    window.addEventListener("afterprint", function () { $$(".full details").forEach(function (d) { d.open = d.dataset.was === "1"; }); });
}

export function buildWebReport({ report, shotSrc = null, standalone = false, links = {} }) {
    const run = report.run || {};
    const all = flatten(report);
    const site = run.startUrl || "";
    const siteHref = safeHref(site);
    const host = hostOf(site);
    const std = standardBank((report.types || []).map((t) => ({ type: t.type, why: t.why, effort: t.issues[0]?.effort })));
    const bank = report.coach?.bank ? JSON.parse(JSON.stringify(report.coach.bank)) : std;
    bank.types ||= {};
    // Reports made before the coach, or messages and kinds the AI left out: the standard lines.
    for (const k of Object.keys(std)) if (k !== "types" && !bank[k]) bank[k] = std[k];
    for (const t of report.types || []) {
        bank.types[t.type] = { visitor: bank.types[t.type]?.visitor || std.types[t.type].visitor, nudge: bank.types[t.type]?.nudge || std.types[t.type].nudge };
    }
    const live = !standalone && Boolean(links.api);
    const score = siteScore(all, []);
    const lv = levelOf(all, []);
    const P = pointsOf(all, []);
    const ctx = { all, P, bank, shotSrc, live, shotLater: live && links.shot ? (i) => links.shot + encodeURIComponent(i.id) : null };

    const menu = [];
    if (!standalone && links.download) menu.push(`<a href="${esc(links.download)}" download>Download this report<small>One file to send to a client</small></a>`);
    if (!standalone && links.pdf) menu.push(`<a href="${esc(links.pdf)}" target="_blank" rel="noopener">Open PDF<small>The full report as a document</small></a>`);
    menu.push(`<button type="button" data-print>Print<small>Every issue, every page</small></button>`);

    // Each kind of problem: its level is that of its most urgent issue.
    const kinds = (report.types || []).filter((t) => t.issues?.length).map((t) => {
        const issues = [...t.issues].sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
        const top = issues[0];
        const pages = new Set(issues.flatMap((i) => (isOnPages(i) && i.foundOn?.length ? i.foundOn : [i.affectedUrl]))).size;
        return { t, top, pages, gain: P.types[t.type]?.points || 0 };
    }).sort((a, b) => ORDER[a.top.priority] - ORDER[b.top.priority] || EFFORT_ORDER[a.top.effort] - EFFORT_ORDER[b.top.effort] || b.gain - a.gain);

    const fullHtml = ["P1", "P2", "P3"].map((p, k) => {
        const list = kinds.filter((x) => x.top.priority === p);
        return list.length ? `<h2>Level ${k + 1} · ${["Urgent fixes", "Important fixes", "Polish"][k]}</h2>\n${list.map((x) => typeDetail(x.t, ctx)).join("\n")}` : "";
    }).join("\n");

    const data = {
        runId: run.id || "report",
        site: host.replace(/^www\./, ""),
        api: live ? links.api : null,
        fix: live && links.fix ? links.fix : null,
        bank: { intro: bank.intro, welcomeBack: bank.welcomeBack, level: bank.level, levelUp: bank.levelUp, afterSelect: bank.afterSelect, selectionCleared: bank.selectionCleared, afterKeep: bank.afterKeep, afterVerify: bank.afterVerify, stillThere: bank.stillThere, nextUp: bank.nextUp },
        types: kinds.map(({ t, top, pages }) => ({
            type: t.type, title: t.title, area: areaOf(t.type), effort: EFFORT_WORD[top.effort] ? top.effort : "medium", level: ORDER[top.priority] !== undefined ? top.priority : "P3", owner: top.owner || "",
            canFix: Boolean(top.fixClass) && top.fixClass !== "not-automatable", canKeep: KEEPABLE.has(t.type),
            visitor: bank.types[t.type].visitor, nudge: bank.types[t.type].nudge, ids: t.issues.map((i) => i.id), pages,
        })),
        issues: all.map((i) => ({ id: i.id, t: i.type, s: i.severity, p: i.priority, n: (isOnPages(i) && (i.foundOn || []).length) || 1 })),
    };
    const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    const script = `var BANDS = ${JSON.stringify(BANDS.map(({ max, name, cls }) => ({ max, name, cls })))};\n${areaOf.toString()}\n${siteScore.toString()}\n${gainOf.toString()}\n${gainText.toString()}\n${pointsOf.toString()}\n${projected.toString()}\n${fmtPoints.toString()}\n${levelOf.toString()}\n${fillMessage.toString()}\n(${liveReport.toString()})(JSON.parse(document.getElementById("sf-data").textContent));`;

    const firstMsg = lv.total.P1 ? fillMessage(bank.intro, { site: host.replace(/^www\./, ""), score: score.score, urgent: lv.total.P1, level: lv.name }) : fillMessage(bank.level[Math.min(4, lv.level)], { count: lv.level <= 3 ? lv.open[["", "P1", "P2", "P3"][lv.level]] : 0 });
    const lede = `Inspected ${esc(fmtDate(run.finishedAt || run.startedAt))} · ${plural(run.pagesCrawled ?? 0, "page")} crawled${run.partial?.reason === "time" ? ` (a share of every section of a larger site: at least ${esc(String(run.partial.pagesFound))} pages found)` : run.capReached ? " (page limit reached, some pages not checked)" : ""}`;

    const app = all.length ? `
<div class="app">
<section class="panel" id="panel-fix" role="tabpanel" aria-labelledby="tab-fix">
  <div class="hero">
    <div class="scorecard" aria-label="Site score">
      <div class="meterbox" role="img" aria-label="Score ${score.score} out of 100: ${bandOf(score.score).name}">${gauge(score.score)}<div class="g-num"><b>${score.score}</b><span class="g-band-name ${bandOf(score.score).cls}">${bandOf(score.score).name}</span></div><div class="g-scale"><span>0</span><span>100</span></div></div>
      <div class="sc-txt">
        <div class="sc-now">Your score today: <b>${score.score}</b> · ${bandOf(score.score).name}</div>
        <div class="sc-gain" aria-live="polite">Tick fixes below to see your score climb</div>
        <p class="sc-hint">${plural(all.length, "issue")} found: ${lv.total.P1} urgent, ${lv.total.P2} important, ${lv.total.P3} polish. Nothing on your site changes until it is fixed.</p>
      </div>
    </div>
    <div class="box coach" aria-live="polite" aria-label="Message from SiteFix">
      <div class="coach-h"><span class="av" aria-hidden="true">S</span><div><b>SiteFix</b> · <span class="coach-when">just now</span></div></div>
      <div class="bubble">${lv.level <= 3 ? "\u{1F44B} " : ""}${esc(firstMsg)}${lv.level > 3 ? " \u{1F3C6}" : ""}</div>
      <div class="coach-act"></div>
      <ol class="earlier" hidden></ol>
    </div>
  </div>
  <div class="sorts" role="group" aria-label="Sort fixes">
    <h2>Choose what to fix</h2>
    <button type="button" class="chip" data-sort="rec" aria-pressed="true">Recommended</button>
    <button type="button" class="chip" data-sort="quick" aria-pressed="false">Quick wins</button>
    <button type="button" class="chip" data-sort="boost" aria-pressed="false">Biggest boost</button>
    <button type="button" class="chip" data-sort="urgent" aria-pressed="false">Urgent first</button>
  </div>
  <div class="areatabs" role="group" aria-label="Area"><button type="button" data-area="on-page" aria-pressed="true">On-page</button><button type="button" data-area="technical" aria-pressed="false">Technical</button><button type="button" data-area="off-page" aria-pressed="false">Off-page</button><button type="button" data-area="kept" aria-pressed="false">Kept</button></div>
  <div class="cols" id="cols"></div>
</section>
<section class="panel" id="panel-issues" role="tabpanel" aria-labelledby="tab-issues" hidden>
  <div class="toolbar">
    <input type="search" id="q" placeholder="Search problems or pages" aria-label="Search problems or pages">
    <select id="f-area" data-f="area" aria-label="Area"><option value="">All areas</option><option value="on-page">On-page</option><option value="technical">Technical</option><option value="off-page">Off-page</option><option value="kept">Kept as is</option></select>
    <select id="f-p" data-f="p" aria-label="Level"><option value="">All levels</option><option value="P1">Urgent</option><option value="P2">Important</option><option value="P3">Polish</option></select>
    <select id="f-effort" data-f="effort" aria-label="Effort"><option value="">Any effort</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Bigger job</option></select>
    <select id="f-sort" data-f="sort" aria-label="Sort"><option value="points">Most points first</option><option value="priority">Most urgent first</option><option value="easy">Easiest first</option><option value="pages">Most pages first</option><option value="az">A to Z</option></select>
  </div>
  <div class="presets" id="presets"></div>
  <p class="count-line" id="count"></p>
  <div class="rows" id="rows"></div>
</section>
</div>
<div class="print-sum"><p><b>Score ${score.score} / 100</b> · On-page ${score.areas["on-page"]} · Technical ${score.areas.technical} · Off-page ${score.areas["off-page"]}</p><p>${esc(firstMsg)}</p></div>
<div class="full">${fullHtml}</div>
<div class="selbar" id="selbar" role="region" aria-label="Selected fixes" hidden>
  <div class="sb-l"><div class="sb-main"></div><div class="sb-sub"></div></div>
  <div class="sb-r"><button type="button" class="ghost" id="sb-clear">Clear</button><div class="sb-fix"><button type="button" class="btn primary" id="sb-fix" disabled aria-describedby="sb-soon">Fix these</button><small id="sb-soon">Automatic fixing is coming soon</small></div></div>
</div>
<div class="scrim" hidden></div>
<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title" hidden>
  <div class="dr-head">
    <div class="dr-row" id="dr-meta"></div><button type="button" class="dr-close" aria-label="Close">×</button>
    <h2 id="dr-title" tabindex="-1"></h2>
    <div class="dr-gain" id="dr-gain"></div>
    <span class="can" id="dr-can"></span>
  </div>
  <div class="dr-body">
    <div class="face" id="dr-face"><div class="k">What visitors face</div><p id="dr-vis"></p></div>
    <div id="dr-detail"></div>
  </div>
  <div class="dr-foot">
    <div class="dr-btns"><button type="button" class="btn primary" id="dr-sel">Select this fix</button><button type="button" class="btn" id="dr-keep" hidden>Keep as is</button>${live ? '<button type="button" class="linkbtn" id="dr-check">Fixed it yourself? Check your live site</button>' : ""}<button type="button" class="linkbtn dr-next" id="dr-next" hidden></button></div>
    <div class="dr-state" id="dr-state" aria-live="polite"></div>
  </div>
</aside>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`
        : `<div class="box clean"><h2 style="margin-top:0">No issues found</h2><p class="lede">None of SiteFix's checks found a problem on the ${plural(run.pagesCrawled ?? 0, "page")} crawled. Your score is 100.</p></div>`;

    return `<!doctype html>
<html lang="en" class="nojs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Website audit: ${esc(host)} · SiteFix</title>
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="in">
  <div class="brand"><span class="dot" aria-hidden="true"></span><b>SiteFix</b></div>
  ${all.length ? `<nav class="tabs" role="tablist" aria-label="Report">
    <button type="button" class="tab" role="tab" id="tab-fix" data-tab="fix" aria-selected="true" aria-controls="panel-fix">Fix</button>
    <button type="button" class="tab" role="tab" id="tab-issues" data-tab="issues" aria-selected="false" aria-controls="panel-issues" tabindex="-1">All issues <span class="n">${kinds.length}</span></button>
  </nav>
  <div class="spill" aria-live="polite"><span>Score</span><b id="sp-now">${score.score}</b><span class="to" id="sp-to" hidden></span></div>` : ""}
  <details class="export"><summary>Export</summary><div class="menu">${menu.join("")}</div></details>
</div></header>
<main><div class="in">
<div class="site-h"><h1>${esc(host.replace(/^www\./, "") || site)}</h1>${siteHref ? `<a href="${siteHref}" target="_blank" rel="noopener noreferrer">Visit site \u2197</a>` : ""}</div>
<p class="lede">Website audit · ${lede}</p>
${app}
<footer><p>The score starts at 100 and loses points for each kind of problem SiteFix measured: more for serious ones and ones on many pages, levelling off so one problem can't sink it. Ticking a fix shows the points it gives back; your score today only counts fixes confirmed on your live site. Something you keep as is, on purpose, stops counting against the score until you undo it.</p>
<p>${report.coach?.source === "ai" ? "SiteFix's messages are worded by AI; every issue, number and score in them comes from the measurements. " : ""}${report.ai?.provider && report.ai.provider !== "none" ? "Explanations are written by AI from the evidence the crawler measured, and checked automatically before they are shown. " : "Explanations use SiteFix's guidance for each type of issue. "}Every finding was measured by the crawler; nothing here is guessed. Report generated ${esc(fmtDate(report.generatedAt))}.</p></footer>
</div></main>
${all.length ? `<script type="application/json" id="sf-data">${json}</script>\n<script>${script}</script>` : ""}
</body>
</html>`;
}
