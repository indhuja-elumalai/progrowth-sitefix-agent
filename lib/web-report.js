// The web report: the live report the chat links to, one page per inspection, that can
// also be downloaded and sent to a client, printed, or read as the PDF. Data in, HTML out.
//
// buildWebReport({ report, shotSrc, standalone, links })
//   report     = explained.json (run, summary, types[], score, coach)
//   shotSrc    = (issue) -> image URL or data: URI, or null for no screenshot
//   standalone = true for the downloaded file (no links back to the SiteFix server; the
//                client's ticks are kept in their own browser)
//   links      = { pdf, download, api } URLs; api = "/api/history/<id>/" turns on saved
//                progress and "Check it now" (live checks of the site)
// reportFileName(report) -> "sitefix-example.com-2026-10-22.html"
// fixFirst(report, n) -> the most urgent issues, one per type and page
//
// The live report (Day 28): instead of a list to read, it coaches. On top, the site
// score (lib/score.js) with its three areas and the current level (urgent, important,
// polish); under it, messages from SiteFix (lib/coach.js) that are posted as the client
// works: what to fix next, what it does for visitors, and the new score. Each kind of
// problem is a card in its level with the points it is worth, how easy it is, what
// visitors face, how to fix it (steps, every page, evidence, screenshots), "I fixed it"
// (the score rises at once) and "Check it now" (the live site is checked again and the
// fix confirmed). The words of the messages may come from AI; every fact in them (the
// issue, the numbers, the score) is filled in by the code from the measured data.
//
// Everything is rendered on the server, so the page reads (and prints) fine without
// JavaScript. The page loads nothing from the network: no fonts, scripts or styles
// from elsewhere. Links from the chat still work: #ISS-… opens one issue, #type=a,b
// shows only those kinds, #p=P1 one priority, #qw=1 the quick wins.

import { evidenceFacts } from "./report-html.js";
import { siteScore, gainOf, gainText, levelOf, areaOf } from "./score.js";
import { standardBank, fillMessage } from "./coach.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const ORDER = { P1: 0, P2: 1, P3: 2 };
const EFFORT_ORDER = { easy: 0, medium: 1, hard: 2 };
const EFFORT_WORD = { easy: "Easy", medium: "Medium", hard: "Bigger job" };
const AREA_WORD = { "on-page": "On-page", technical: "Technical", "off-page": "Off-page" };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"; } catch { return iso || ""; } };
const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u || "site"); } };
const gainBadge = (g) => (g >= 0.95 ? String(Math.round(g)) : "<1");
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

function instance(i, t, shotSrc) {
    const found = i.foundOn || [];
    const shot = shotSrc ? shotSrc(i) : null;
    const href = safeHref(i.affectedUrl);
    const facts = evidenceFacts(i.evidence);
    return `<details class="inst" id="${esc(i.id)}" data-p="${esc(i.priority)}" data-cat="${esc(i.category)}" data-owner="${esc(i.owner)}" data-qw="${i.quickWin ? 1 : 0}">
<summary><span class="pill ${esc(i.priority)}">${esc(i.priority)}</span><span class="u">${esc(i.affectedUrl)}</span><span class="ist" data-id="${esc(i.id)}"></span><span class="chev" aria-hidden="true"></span></summary>
<div class="inst-body">
<p class="expl">${esc(i.explanation || i.detail)}</p>
<div class="meta">${esc(i.effort)} fix · ${esc(i.owner)}${i.priorityReason ? ` · priority: ${esc(i.priorityReason)}` : ""}${href ? ` · <a href="${href}" target="_blank" rel="noopener noreferrer">open page</a>` : ""}</div>
${i.suggestedValue ? `<div class="val"><div class="k">${esc(t.valueLabel || "Suggested value")}</div><div class="v"><span>${esc(i.suggestedValue)}</span><button type="button" class="copy" data-copy="${esc(i.suggestedValue)}">Copy</button></div></div>` : ""}
${facts ? `<table class="facts">${facts}</table>` : ""}
${found.length ? `<div class="found"><div class="k">Found on ${plural(found.length, "page")}</div>${found.slice(0, 10).map((u) => `<div class="u">${esc(u)}</div>`).join("")}${found.length > 10 ? `<div class="more">and ${found.length - 10} more</div>` : ""}</div>` : ""}
${shot ? `<figure><a href="${esc(shot)}" target="_blank" rel="noopener"><img src="${esc(shot)}" alt="Screenshot of ${esc(i.affectedUrl)}" loading="lazy"></a><figcaption>Screenshot${["image", "http", "redirect"].includes(i.evidence?.kind) ? ", with the problem outlined in red where it could be found" : ""}</figcaption></figure>` : ""}
<div class="inst-act"><label class="tick"><input type="checkbox" data-fix="${esc(i.id)}"> I fixed this one</label></div>
</div>
</details>`;
}

// One kind of problem: what it is, what visitors face, the points it is worth, and the
// buttons; the details (steps, every instance) open underneath.
function typeCard(t, ctx) {
    const issues = [...t.issues].sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
    const top = issues[0];
    const coach = ctx.bank.types[t.type] || {};
    const gain = gainOf(ctx.all, [], issues.map((i) => i.id));
    const pages = new Set(issues.flatMap((i) => (i.foundOn?.length ? i.foundOn : [i.affectedUrl]))).size;
    const area = areaOf(t.type);
    const nudge = fillMessage(coach.nudge || "", { count: issues.length, gain: gainText(gain) });
    return `<section class="type card" data-type="${esc(t.type)}" data-area="${area}" data-effort="${esc(top.effort)}" data-level="${esc(top.priority)}">
<div class="c-top">
  <div class="c-main">
    <h3 class="title">${esc(t.title)}</h3>
    <div class="tags"><span class="tag e-${esc(top.effort)}">${esc(EFFORT_WORD[top.effort] || top.effort)}</span><span class="tag">${AREA_WORD[area]}</span><span class="tag">${esc(top.owner)}</span><span class="tag count" data-total="${issues.length}">${plural(issues.length, "issue")}${pages > 1 ? ` · ${plural(pages, "page")}` : ""}</span></div>
  </div>
  <div class="gain" title="Points your score gains when this is fixed"><b>+<i class="g">${esc(gainBadge(gain))}</i></b><span>points</span></div>
</div>
${coach.visitor ? `<p class="visitor">${esc(coach.visitor)}</p>` : ""}
${nudge ? `<p class="nudge">${esc(nudge)}</p>` : ""}
<div class="c-act">
  <button type="button" class="btn small how" aria-expanded="false">How to fix</button>
  <button type="button" class="btn small primary fixit">I fixed it</button>
  ${ctx.live ? '<button type="button" class="btn small check">Check it now</button>' : ""}
  <span class="c-state" aria-live="polite"></span>
</div>
<details class="type-d"><summary class="sr">Details: ${esc(t.title)}</summary>
<div class="type-body">
<p class="sum">${esc(t.summary)}</p>
${t.why ? `<p class="why"><b>Why it matters.</b> ${esc(t.why)}</p>` : ""}
${(t.fixSteps || []).length ? `<div class="fix"><div class="k">How to fix</div><ol>${t.fixSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>` : ""}
<div class="insts">${issues.map((i) => instance(i, t, ctx.shotSrc)).join("\n")}</div>
</div>
</details>
</section>`;
}

const LEVELS = [
    { p: "P1", n: 1, name: "Urgent fixes", short: "Urgent" },
    { p: "P2", n: 2, name: "Important fixes", short: "Important" },
    { p: "P3", n: 3, name: "Polish", short: "Polish" },
];

function ring(score) {
    const r = 52, c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" class="ring-bg"/><circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - score / 100)).toFixed(1)}"/></svg>`;
}

const CSS = `
:root{--bg:#fff;--s1:#f5f5f7;--s2:#ececf0;--line:#e3e3e8;--t1:#1d1d1f;--t2:#515154;--t3:#86868b;--acc:#b8ff00;--accd:#4f7a00;--acc-bg:rgba(184,255,0,.2);
--p1:#d70015;--p1b:#fde7e9;--p2:#a85000;--p2b:#fff0dc;--p3:#0060c0;--p3b:#e5effb;--ok:#1f8a3b;--okb:#e3f5e8;--link:#0060c0;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--s1:#1d1d20;--s2:#2a2a2e;--line:#2f2f34;--t1:#f2f2f5;--t2:#c3c3c8;--t3:#8e8e93;--acc-bg:rgba(184,255,0,.14);--accd:#b8ff00;
--p1:#ff6b7a;--p1b:rgba(255,69,88,.16);--p2:#ffb15c;--p2b:rgba(255,159,10,.15);--p3:#6cb4ff;--p3b:rgba(10,132,255,.16);--ok:#5fd27c;--okb:rgba(52,199,89,.15);--link:#6cb4ff;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--t1);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--link)}
.wrap{max-width:960px;margin:0 auto;padding:28px 20px 80px}
header .brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;color:var(--t2)}
.dot{width:12px;height:12px;border-radius:50%;background:var(--acc)}
h1{font-size:28px;line-height:1.15;letter-spacing:-.02em;margin:12px 0 4px;overflow-wrap:anywhere}
.lede{color:var(--t2);margin:0;font-size:14px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--t1);font:inherit;font-size:13.5px;font-weight:500;text-decoration:none;cursor:pointer}
.btn:hover{background:var(--s1)}
.btn.primary{background:var(--acc);border-color:var(--acc);color:#1d1d1f}
.btn.primary:hover{filter:brightness(.96)}
.btn.small{padding:6px 12px;font-size:13px}
.btn[disabled]{opacity:.55;cursor:default}
.hero{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:center;margin-top:24px;border:1px solid var(--line);border-radius:18px;padding:18px 22px;background:linear-gradient(135deg,var(--s1),var(--bg) 60%)}
.dial{position:relative;width:132px;height:132px}
.ring{width:132px;height:132px;transform:rotate(-90deg)}
.ring-bg{fill:none;stroke:var(--s2);stroke-width:10}
.ring-fg{fill:none;stroke:var(--accd);stroke-width:10;stroke-linecap:round;transition:stroke-dashoffset .8s ease}
.dial-n{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.dial-n b{font-size:38px;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.dial-n span{font-size:12px;color:var(--t3)}
.up{font-size:12px;font-weight:700;color:var(--ok);min-height:16px}
.h-txt{min-width:0}
.lvl{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:15px}
.lvl .badge{font-size:12px;font-weight:700;background:var(--t1);color:var(--bg);border-radius:999px;padding:2px 10px}
.prog{height:8px;border-radius:8px;background:var(--s2);overflow:hidden;margin:10px 0 4px;max-width:420px}
.prog i{display:block;height:100%;width:0;background:var(--acc);transition:width .6s ease}
.prog-l{font-size:13px;color:var(--t2)}
.areas{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:12px;font-size:13px;color:var(--t2)}
.areas b{color:var(--t1);font-variant-numeric:tabular-nums}
.areas .note{flex-basis:100%;font-size:12px;color:var(--t3)}
.feed{margin-top:18px;display:flex;flex-direction:column;gap:8px}
.post{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--bg);animation:in .35s ease}
.post.new{border-color:var(--accd);box-shadow:0 0 0 3px var(--acc-bg)}
.post .av{width:28px;height:28px;border-radius:50%;background:var(--acc);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#1d1d1f}
.post .pt{flex:1;min-width:0}
.post .who{font-size:12px;color:var(--t3)}
.post p{margin:2px 0 0}
.post .pa{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.post.old{opacity:.75}
@keyframes in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.more-posts{all:unset;cursor:pointer;color:var(--link);font-size:13px;align-self:flex-start}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:28px 0 4px}
.chip{border:1px solid var(--line);background:var(--bg);color:var(--t2);border-radius:999px;font:inherit;font-size:13px;font-weight:500;padding:5px 12px;cursor:pointer}
.chip[aria-pressed=true]{background:var(--t1);color:var(--bg);border-color:var(--t1)}
.filters input[type=search]{flex:1 1 200px;min-width:0;height:34px;border:1px solid var(--line);border-radius:999px;padding:0 14px;font:inherit;font-size:14px;background:var(--bg);color:var(--t1)}
.level{margin-top:26px}
.level-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:8px}
.level-h h2{font-size:19px;letter-spacing:-.01em;margin:0}
.level-h .pill{align-self:center}
.level-h .lg{margin-left:auto;font-size:13px;color:var(--t2)}
.level-h .lg b{color:var(--ok)}
.level-txt{color:var(--t2);font-size:14px;margin:8px 0 10px}
.level.later .level-txt::after{content:" Open it whenever you like: fix in any order that suits you.";color:var(--t3)}
.cards{display:flex;flex-direction:column;gap:10px}
.card{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:var(--bg);transition:border-color .2s,background .2s}
.card.done{background:var(--okb);border-color:transparent}
.c-top{display:flex;gap:12px;align-items:flex-start}
.c-main{flex:1;min-width:0}
.card h3{font-size:16px;margin:0;letter-spacing:-.01em}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.tag{font-size:12px;color:var(--t2);background:var(--s1);border-radius:999px;padding:1px 9px}
.tag.e-easy{background:var(--acc-bg);color:var(--accd);font-weight:600}
.gain{text-align:center;flex-shrink:0;min-width:56px}
.gain b{display:block;font-size:22px;line-height:1.1;color:var(--ok);font-variant-numeric:tabular-nums}
.gain span{font-size:11px;color:var(--t3)}.gain i{font-style:normal}
.card.done .gain b{color:var(--t3);text-decoration:line-through}
.visitor{margin:10px 0 2px}
.nudge{margin:0;color:var(--t2);font-size:14px}
.c-act{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.c-state{font-size:13px;color:var(--t2)}
.c-state.ok{color:var(--ok);font-weight:600}
.c-state.bad{color:var(--p2)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.type-d{margin-top:4px}
.type-d>summary{list-style:none}
.type-body{border-top:1px solid var(--line);margin-top:12px;padding-top:12px}
summary{list-style:none;cursor:pointer}
summary::-webkit-details-marker{display:none}
.chev{width:9px;height:9px;border-right:2px solid var(--t3);border-bottom:2px solid var(--t3);transform:rotate(-45deg);transition:transform .15s;flex-shrink:0;margin-right:2px}
details[open]>summary .chev{transform:rotate(45deg)}
.sum{margin:0 0 6px}
.why{margin:0 0 12px;color:var(--t2)}
.fix{background:var(--s1);border-radius:10px;padding:10px 14px;margin-bottom:12px}
.fix ol{margin:4px 0 0 18px;padding:0}.fix li{margin:2px 0}
.k{font-size:11.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em}
.insts{display:flex;flex-direction:column;gap:6px}
.inst{border:1px solid var(--line);border-radius:10px;background:var(--bg)}
.inst>summary{display:flex;align-items:center;gap:8px;padding:9px 12px}
.inst>summary:hover{background:var(--s1)}
.inst .u{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;color:var(--t2);overflow-wrap:anywhere;flex:1;min-width:0}
.ist{font-size:12px;font-weight:600;color:var(--ok)}
.inst-body{padding:4px 12px 12px;border-top:1px solid var(--line)}
.inst-act{margin-top:10px}
.tick{display:inline-flex;gap:6px;align-items:center;font-size:13px;color:var(--t2);cursor:pointer}
.expl{margin:8px 0 4px}
.meta{font-size:12.5px;color:var(--t3)}
.val{border-left:3px solid var(--acc);background:var(--acc-bg);border-radius:0 8px 8px 0;padding:6px 10px;margin:10px 0}
.val .v{display:flex;gap:10px;align-items:flex-start;font-weight:600}.val .v span{flex:1;overflow-wrap:anywhere}
.copy{border:1px solid var(--line);background:var(--bg);color:var(--t2);border-radius:6px;font:inherit;font-size:12px;padding:1px 8px;cursor:pointer}
.facts{border-collapse:collapse;margin:10px 0;font-size:13px;width:100%}
.facts th{text-align:left;color:var(--t3);font-weight:600;width:140px;vertical-align:top;padding:3px 10px 3px 0}
.facts td{padding:3px 0;overflow-wrap:anywhere}
.found{margin-top:8px}.found .u{display:block;font-size:12px;line-height:1.7}.more{font-size:12px;color:var(--t3)}
figure{margin:12px 0 0}figure img{max-width:100%;width:520px;border:1px solid var(--line);border-radius:8px;display:block}
figcaption{font-size:12px;color:var(--t3);margin-top:4px}
.pill{font-size:11.5px;font-weight:700;border-radius:999px;padding:1px 8px;flex-shrink:0}
.pill.P1{background:var(--p1b);color:var(--p1)}.pill.P2{background:var(--p2b);color:var(--p2)}.pill.P3{background:var(--p3b);color:var(--p3)}
.empty{border:1px dashed var(--line);border-radius:14px;padding:22px;text-align:center;color:var(--t2);margin-top:14px}
.clean{border:1px solid var(--line);border-radius:14px;padding:28px;text-align:center;margin-top:24px}
.flash{animation:fl 1.6s ease}@keyframes fl{0%{box-shadow:0 0 0 3px var(--acc)}100%{box-shadow:0 0 0 3px transparent}}
footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--t3)}
footer p{margin:0 0 6px}
[hidden]{display:none!important}
@media (max-width:640px){.hero{grid-template-columns:1fr;justify-items:start;padding:16px}h1{font-size:23px}.wrap{padding:20px 16px 60px}.facts th{width:100px}.gain b{font-size:19px}}
@media print{.actions,.feed,.filters,.c-act,.inst-act,.copy,.more-posts{display:none!important}.card,.inst{break-inside:avoid}body{font-size:12px}.hero{background:none}.level.later .level-txt::after{content:""}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

// The page's own script: score, levels, ticks, the coach's posts, "Check it now",
// filters and links from the chat. Runs in the browser (its source is copied in).
function liveReport(D) {
    "use strict";
    var $ = function (s, c) { return (c || document).querySelector(s); }, $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
    var all = D.issues.map(function (x) { return { id: x.id, type: x.t, severity: x.s, priority: x.p, pages: x.n }; });
    var byId = {}; all.forEach(function (i) { byId[i.id] = i; });
    var typeTitle = {}; D.types.forEach(function (t) { typeTitle[t.type] = t; });
    var KEY = "sitefix-progress-" + D.runId;
    var state = { fixed: {}, posts: [], visits: 0, last: 0 };
    var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
    function fixedIds() { return Object.keys(state.fixed); }
    function save() {
        state.posts = state.posts.slice(-30);
        if (D.api) { try { fetch(D.api + "progress", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }).catch(function () {}); } catch (e) { } }
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
    }
    function load(done) {
        var local = null;
        try { local = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { }
        if (!D.api) { if (local) state = local; return done(); }
        fetch(D.api + "progress").then(function (r) { return r.ok ? r.json() : null; }).then(function (s) { if (s && s.fixed) state = s; else if (local) state = local; done(); }, function () { if (local) state = local; done(); });
    }
    function fill(tpl, v) { return fillMessage(tpl, v); }
    function badge(g) { return g >= 0.95 ? String(Math.round(g)) : "<1"; }
    // ---------- the score and the level ----------
    var shown = null;
    function paintScore(animate) {
        var s = siteScore(all, fixedIds()), lv = levelOf(all, fixedIds());
        var dash = $(".ring-fg"), r = 52, c = 2 * Math.PI * r;
        if (dash) dash.setAttribute("stroke-dashoffset", (c * (1 - s.score / 100)).toFixed(1));
        var n = $(".dial-n b"), up = $(".up");
        if (shown !== null && s.score !== shown && animate) {
            var from = shown, to = s.score, t0 = performance.now();
            (function step(t) { var k = Math.min(1, (t - t0) / 700); n.textContent = Math.round(from + (to - from) * k); if (k < 1) requestAnimationFrame(step); })(t0);
            up.textContent = to > from ? "+" + (to - from) + " just now" : "";
        } else n.textContent = s.score;
        shown = s.score;
        $(".a-on b").textContent = s.areas["on-page"]; $(".a-tech b").textContent = s.areas.technical; $(".a-off b").textContent = s.areas["off-page"];
        var cur = lv.level <= 3 ? ["", "P1", "P2", "P3"][lv.level] : null;
        $(".lvl .badge").textContent = lv.level <= 3 ? "Level " + lv.level : "Done";
        $(".lvl .ln").textContent = lv.name;
        var tot = cur ? lv.total[cur] : 1, left = cur ? lv.open[cur] : 0;
        $(".prog i").style.width = (cur ? Math.round(100 * (tot - left) / Math.max(1, tot)) : 100) + "%";
        $(".prog-l").textContent = cur ? (tot - left) + " of " + tot + " " + ["", "urgent", "important", "polish"][lv.level] + " fixes done" : "Everything SiteFix checks is fixed";
        // Cards: done state and what each is still worth.
        $$(".card").forEach(function (card) {
            var ids = card._ids, open = ids.filter(function (id) { return !state.fixed[id]; });
            var g = open.length ? gainOf(all, fixedIds(), open) : 0;
            $(".g", card).textContent = badge(g);
            var done = !open.length;
            card.classList.toggle("done", done);
            var verified = ids.every(function (id) { return state.fixed[id] === "verified"; });
            var st = $(".c-state", card);
            if (done) { st.textContent = verified ? "Confirmed on your live site" : "Marked as fixed"; st.className = "c-state ok"; }
            else if (open.length < ids.length) { st.textContent = (ids.length - open.length) + " of " + ids.length + " fixed"; st.className = "c-state"; }
            else if (!st.classList.contains("bad")) { st.textContent = ""; st.className = "c-state"; }
            $(".fixit", card).textContent = done ? "Undo" : "I fixed it";
        });
        $$("input[data-fix]").forEach(function (cb) { cb.checked = Boolean(state.fixed[cb.dataset.fix]); var m = $('.ist[data-id="' + cb.dataset.fix + '"]'); if (m) m.textContent = state.fixed[cb.dataset.fix] === "verified" ? "Confirmed" : state.fixed[cb.dataset.fix] ? "Fixed" : ""; });
        $$(".level").forEach(function (sec) {
            var p = sec.dataset.p, l = { P1: 1, P2: 2, P3: 3 }[p];
            sec.classList.toggle("later", lv.level < l);
            var open = all.filter(function (i) { return i.priority === p && !state.fixed[i.id]; }).map(function (i) { return i.id; });
            var lt = $(".level-txt", sec); if (lt) lt.textContent = open.length ? fill(D.bank.level[l], { count: open.length }) : "All fixed. Nice work.";
            var lg = $(".lg", sec); if (lg) lg.innerHTML = open.length ? "Worth <b>+" + esc(badge(gainOf(all, fixedIds(), open))) + "</b> points" : "<b>All fixed</b>";
        });
        return { s: s, lv: lv };
    }
    // ---------- the coach's posts ----------
    function ago(t) { var m = Math.round((Date.now() - t) / 60000); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; var h = Math.round(m / 60); if (h < 24) return h + " h ago"; return Math.round(h / 24) + " d ago"; }
    function post(text, action) { state.posts.push({ at: Date.now(), text: text, action: action || null }); renderPosts(true); }
    var showAll = false;
    function renderPosts(fresh) {
        var feed = $(".feed"); if (!feed) return;
        var list = state.posts.slice().reverse(), max = showAll ? 12 : 3;
        feed.innerHTML = list.slice(0, max).map(function (p, k) {
            var act = p.action && p.action.type ? '<div class="pa"><button type="button" class="btn small primary" data-show="' + esc(p.action.type) + '">Show me</button></div>' : "";
            return '<div class="post' + (k === 0 && fresh ? " new" : k > 0 ? " old" : "") + '"><span class="av" aria-hidden="true">S</span><div class="pt"><div class="who">SiteFix · ' + ago(p.at) + "</div><p>" + esc(p.text) + "</p>" + act + "</div></div>";
        }).join("") + (list.length > 3 ? '<button type="button" class="more-posts">' + (showAll ? "Show fewer" : "Show earlier messages") + "</button>" : "");
    }
    // The next easy win: the open kind of problem in the current level with the most points, easiest first.
    function nextUp() {
        var lv = levelOf(all, fixedIds()), cur = ["", "P1", "P2", "P3"][lv.level], best = null;
        if (!cur) return null;
        $$(".card").forEach(function (card) {
            if (card.dataset.level !== cur) return;
            var open = card._ids.filter(function (id) { return !state.fixed[id]; }); if (!open.length) return;
            var g = gainOf(all, fixedIds(), open), e = { easy: 0, medium: 1, hard: 2 }[card.dataset.effort];
            if (!best || e < best.e || (e === best.e && g > best.g)) best = { card: card, g: g, e: e };
        });
        return best;
    }
    function suggestNext() {
        var n = nextUp(); if (!n) return;
        post(fill(D.bank.nextUp, { issue: typeTitle[n.card.dataset.type].title, gain: gainText(n.g) }), { type: n.card.dataset.type });
    }
    // ---------- marking fixes ----------
    function mark(ids, how, quiet) {
        var before = siteScore(all, fixedIds()), lvBefore = levelOf(all, fixedIds()).level;
        ids.forEach(function (id) { if (how) state.fixed[id] = how === "verified" || state.fixed[id] !== "verified" ? how : "verified"; else delete state.fixed[id]; });
        var r = paintScore(true);
        if (how && !quiet) {
            var gain = r.s.score - before.score >= 1 ? r.s.score - before.score : Math.max(0, Math.min(0.9, Math.round((r.s.exact - before.exact) * 10) / 10)), type = byId[ids[0]] && byId[ids[0]].type, title = typeTitle[type] ? typeTitle[type].title : "That issue";
            post(fill(how === "verified" ? D.bank.afterVerify : D.bank.afterMark, { issue: title, gain: gainText(gain), score: r.s.score }));
            if (r.lv.level > lvBefore) post(fill(D.bank.levelUp[Math.min(4, r.lv.level)], { score: r.s.score }));
            setTimeout(suggestNext, 600);
        }
        save();
    }
    // ---------- "Check it now": the live site is checked again ----------
    function check(card) {
        var all = card._ids.filter(function (id) { return state.fixed[id] !== "verified"; });
        if (!all.length) all = card._ids.slice();
        var btn = $(".check", card), st = $(".c-state", card), title = typeTitle[card.dataset.type].title;
        var got = {}, rounds = 0;
        btn.disabled = true; btn.textContent = "Checking…"; st.textContent = "Checking your live site"; st.className = "c-state";
        // Big kinds (many pages) are checked in a few rounds: each round sends what is left.
        function round(ids) {
            rounds++;
            return fetch(D.api + "verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(0, 60) }) })
                .then(function (r) { if (!r.ok) throw new Error("bad"); return r.json(); })
                .then(function (d) {
                    var res = d.results || {}, left = [];
                    ids.forEach(function (id) { var x = res[id]; if (!x || x.status === "skipped") left.push(id); else got[id] = x.status; });
                    if (left.length && rounds < 6) { st.textContent = "Checking your live site (" + Object.keys(got).length + " of " + all.length + " done)"; return round(left); }
                    left.forEach(function (id) { got[id] = "unknown"; });
                });
        }
        round(all).then(function () {
            var fixedNow = [], still = [], manual = [], unknown = [];
            all.forEach(function (id) { var s = got[id]; if (s === "fixed") fixedNow.push(id); else if (s === "still") still.push(id); else if (s === "manual") manual.push(id); else unknown.push(id); });
            if (fixedNow.length) mark(fixedNow, "verified");
            if (still.length) {
                still.forEach(function (id) { if (state.fixed[id] !== "verified") delete state.fixed[id]; });
                paintScore(false);
                st.textContent = still.length === all.length ? "Still there on the live site" : still.length + " of " + all.length + " still there on the live site"; st.className = "c-state bad";
                post(fill(D.bank.stillThere, { issue: title }), { type: card.dataset.type }); save();
            } else if (unknown.length && !fixedNow.length) {
                st.textContent = "Couldn't reach your site just now. Try again in a moment."; st.className = "c-state bad";
            } else if (manual.length && !fixedNow.length) {
                st.textContent = "This kind is confirmed on the next inspection. Mark it with “I fixed it” for now."; st.className = "c-state";
            } else if (fixedNow.length < all.length) {
                st.textContent = fixedNow.length + " of " + all.length + " confirmed; the rest are checked on the next inspection"; st.className = "c-state";
            }
        }, function () { st.textContent = "Couldn't reach SiteFix to check. Try again in a moment."; st.className = "c-state bad"; })
            .then(function () { btn.disabled = false; btn.textContent = "Check it now"; });
    }
    // ---------- filters and links from the chat ----------
    var filt = { area: "all", easy: false, types: null, p: null, qw: false, q: "" };
    function applyFilters() {
        var words = filt.q.toLowerCase().split(/\s+/).filter(Boolean), any = false;
        $$(".card").forEach(function (card) {
            var ok = (filt.area === "all" || card.dataset.area === filt.area) && (!filt.easy || card.dataset.effort === "easy") && (!filt.types || filt.types.indexOf(card.dataset.type) !== -1) && (!filt.p || card.dataset.level === filt.p) &&
                (!filt.qw || (card.dataset.effort === "easy" && card.dataset.level !== "P3")) && words.every(function (w) { return card._text.indexOf(w) !== -1; });
            card.hidden = !ok; if (ok) any = true;
        });
        $$(".level").forEach(function (sec) { sec.hidden = !$$(".card", sec).some(function (c) { return !c.hidden; }); });
        var none = $("#none"); if (none) none.hidden = any;
        $$(".chip[data-area]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.area === filt.area)); });
        var e = $(".chip[data-easy]"); if (e) e.setAttribute("aria-pressed", String(filt.easy));
    }
    function openCard(card, instId) {
        var d = $(".type-d", card); d.open = true; $(".how", card).setAttribute("aria-expanded", "true"); $(".how", card).textContent = "Hide details";
        var target = instId ? document.getElementById(instId) : card;
        if (instId && target) target.open = true;
        (target || card).scrollIntoView({ behavior: "smooth", block: "center" });
        (target || card).classList.add("flash"); setTimeout(function () { (target || card).classList.remove("flash"); }, 1700);
    }
    function fromHash(h) {
        var m = h.match(/^(type|p|qw)=([a-z0-9,-]+)$/i);
        if (!m) { var inst = document.getElementById(h); if (inst && inst.classList.contains("inst")) openCard(inst.closest(".card"), h); return; }
        if (m[1] === "type") filt.types = m[2].split(","); else if (m[1] === "p") filt.p = m[2].toUpperCase(); else filt.qw = true;
        applyFilters();
        var first = $$(".card").filter(function (c) { return !c.hidden; })[0]; if (first) first.scrollIntoView();
    }
    // ---------- start ----------
    $$(".card").forEach(function (card) { card._ids = $$("input[data-fix]", card).map(function (i) { return i.dataset.fix; }); card._text = card.textContent.toLowerCase(); });
    load(function () {
        var firstVisit = !state.visits;
        state.visits = (state.visits || 0) + 1;
        var r = paintScore(false);
        if (firstVisit) {
            var urgent = r.lv.total.P1;
            post(urgent ? fill(D.bank.intro, { site: D.site, score: r.s.score, urgent: urgent, level: r.lv.name }) : fill(D.bank.level[Math.min(4, r.lv.level)], { count: r.lv.level <= 3 ? r.lv.open[["", "P1", "P2", "P3"][r.lv.level]] : 0 }));
            suggestNext();
        } else if (Date.now() - (state.last || 0) > 30 * 60000) {
            var cur = ["", "P1", "P2", "P3"][r.lv.level];
            post(cur ? fill(D.bank.welcomeBack, { score: r.s.score, left: r.lv.open[cur], level: r.lv.name }) : fill(D.bank.level[4], {}));
        } else renderPosts(false);
        state.last = Date.now();
        save();
        if (location.hash) fromHash(decodeURIComponent(location.hash.slice(1)));
        // Now and then, when the page has been left open, suggest the next easy win.
        setInterval(function () { var lp = state.posts[state.posts.length - 1]; if (!document.hidden && (!lp || Date.now() - lp.at > 10 * 60000)) suggestNext(); save(); renderPosts(false); }, 60000);
    });
    document.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        var card = b.closest(".card");
        if (b.classList.contains("how")) { var d = $(".type-d", card), open = !d.open; d.open = open; b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "Hide details" : "How to fix"; return; }
        if (b.classList.contains("fixit")) { var undo = card.classList.contains("done"); mark(card._ids, undo ? null : "marked"); return; }
        if (b.classList.contains("check")) { check(card); return; }
        if (b.dataset.show) { var c = $('.card[data-type="' + b.dataset.show + '"]'); if (c) { filt = { area: "all", easy: false, types: null, p: null, qw: false, q: "" }; applyFilters(); openCard(c); } return; }
        if (b.classList.contains("more-posts")) { showAll = !showAll; renderPosts(false); return; }
        if (b.dataset.area) { filt.area = b.dataset.area; applyFilters(); return; }
        if (b.dataset.easy !== undefined) { filt.easy = !filt.easy; applyFilters(); return; }
        if (b.id === "reset") { filt = { area: "all", easy: false, types: null, p: null, qw: false, q: "" }; var q = $("#q"); if (q) q.value = ""; applyFilters(); return; }
        if (b.classList.contains("copy")) { e.preventDefault(); var done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1200); }; if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, function () { }); }
    });
    document.addEventListener("change", function (e) {
        var cb = e.target.closest("input[data-fix]"); if (!cb) return;
        mark([cb.dataset.fix], cb.checked ? "marked" : null, false);
    });
    var q = $("#q"); if (q) q.addEventListener("input", function () { filt.q = q.value; applyFilters(); });
    window.addEventListener("beforeprint", function () { $$("details").forEach(function (d) { d.dataset.was = d.open ? "1" : "0"; d.open = true; }); });
    window.addEventListener("afterprint", function () { $$("details").forEach(function (d) { d.open = d.dataset.was === "1"; }); });
}

export function buildWebReport({ report, shotSrc = null, standalone = false, links = {} }) {
    const run = report.run || {};
    const all = flatten(report);
    const site = run.startUrl || "";
    const siteHref = safeHref(site);
    const bank = report.coach?.bank || standardBank((report.types || []).map((t) => ({ type: t.type, why: t.why, effort: t.issues[0]?.effort })));
    // Reports made before the coach: any missing type gets the standard lines.
    const std = standardBank((report.types || []).map((t) => ({ type: t.type, why: t.why, effort: t.issues[0]?.effort })));
    for (const t of report.types || []) if (!bank.types[t.type]) bank.types[t.type] = std.types[t.type];
    const live = !standalone && Boolean(links.api);
    const score = siteScore(all, []);
    const lv = levelOf(all, []);
    const ctx = { all, bank, shotSrc, live };

    const actions = [];
    if (!standalone && links.download) actions.push(`<a class="btn primary" href="${esc(links.download)}" download>Download this report</a>`);
    if (!standalone && links.pdf) actions.push(`<a class="btn" href="${esc(links.pdf)}" target="_blank" rel="noopener">Open PDF</a>`);
    actions.push(`<button class="btn" type="button" onclick="window.print()">Print</button>`);

    // Levels: each kind of problem sits in the level of its most urgent issue; inside a
    // level, easy ones first, then the most points.
    const typesByLevel = { P1: [], P2: [], P3: [] };
    for (const t of report.types || []) {
        const top = [...t.issues].sort((a, b) => ORDER[a.priority] - ORDER[b.priority])[0];
        if (top) typesByLevel[top.priority]?.push({ t, effort: EFFORT_ORDER[top.effort] ?? 1, gain: gainOf(all, [], t.issues.map((i) => i.id)) });
    }
    const levelHtml = LEVELS.map((L) => {
        const list = typesByLevel[L.p].sort((a, b) => a.effort - b.effort || b.gain - a.gain);
        if (!list.length) return "";
        const open = all.filter((i) => i.priority === L.p).length;
        const levelGain = gainOf(all, [], all.filter((i) => i.priority === L.p).map((i) => i.id));
        return `<section class="level${lv.level < L.n ? " later" : ""}" data-p="${L.p}">
<div class="level-h"><span class="pill ${L.p}">${L.p}</span><h2>Level ${L.n} · ${L.name}</h2><span class="lg">Worth <b>+${esc(gainBadge(levelGain))}</b> points</span></div>
<p class="level-txt">${esc(fillMessage(bank.level[L.n], { count: open }))}</p>
<div class="cards">${list.map((x) => typeCard(x.t, ctx)).join("\n")}</div>
</section>`;
    }).join("\n");

    const data = {
        runId: run.id || "report",
        site: hostOf(site).replace(/^www\./, ""),
        api: live ? links.api : null,
        bank: { intro: bank.intro, welcomeBack: bank.welcomeBack, level: bank.level, levelUp: bank.levelUp, afterMark: bank.afterMark, afterVerify: bank.afterVerify, stillThere: bank.stillThere, nextUp: bank.nextUp },
        types: (report.types || []).map((t) => ({ type: t.type, title: t.title })),
        issues: all.map((i) => ({ id: i.id, t: i.type, s: i.severity, p: i.priority, n: (i.foundOn || []).length || 1 })),
    };
    const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    const script = `${areaOf.toString()}\n${siteScore.toString()}\n${gainOf.toString()}\n${gainText.toString()}\n${levelOf.toString()}\n${fillMessage.toString()}\n(${liveReport.toString()})(JSON.parse(document.getElementById("sf-data").textContent));`;

    const body = all.length ? `
<section class="hero" aria-label="Site score">
  <div class="dial">${ring(score.score)}<div class="dial-n"><b>${score.score}</b><span>out of 100</span></div></div>
  <div class="h-txt">
    <div class="lvl"><span class="badge">Level ${lv.level <= 3 ? lv.level : "done"}</span><span class="ln">${esc(lv.name)}</span></div>
    <div class="prog" aria-hidden="true"><i></i></div>
    <div class="prog-l">${lv.level <= 3 ? `0 of ${lv.total[["", "P1", "P2", "P3"][lv.level]]} ${["", "urgent", "important", "polish"][lv.level]} fixes done` : ""}</div>
    <div class="up" aria-live="polite"></div>
    <div class="areas"><span class="a-on">On-page <b>${score.areas["on-page"]}</b></span><span class="a-tech">Technical <b>${score.areas.technical}</b></span><span class="a-off">Off-page <b>${score.areas["off-page"]}</b></span><span class="note">Off-page covers sharing tags and links to other sites; backlinks and reviews aren't measured yet.</span></div>
  </div>
</section>
<div class="feed" aria-live="polite" aria-label="Messages from SiteFix"><div class="post"><span class="av" aria-hidden="true">S</span><div class="pt"><div class="who">SiteFix</div><p>${esc(lv.total.P1 ? fillMessage(bank.intro, { site: hostOf(site).replace(/^www\./, ""), score: score.score, urgent: lv.total.P1, level: lv.name }) : fillMessage(bank.level[Math.min(4, lv.level)], { count: lv.level <= 3 ? lv.open[["", "P1", "P2", "P3"][lv.level]] : 0 }))}</p></div></div></div>
<div class="filters" role="group" aria-label="Show">
  <button type="button" class="chip" data-area="all" aria-pressed="true">All</button>
  <button type="button" class="chip" data-area="on-page" aria-pressed="false">On-page</button>
  <button type="button" class="chip" data-area="technical" aria-pressed="false">Technical</button>
  <button type="button" class="chip" data-area="off-page" aria-pressed="false">Off-page</button>
  <button type="button" class="chip" data-easy aria-pressed="false">Easy only</button>
  <input type="search" id="q" placeholder="Search issues or pages" aria-label="Search issues or pages">
</div>
<div id="issues">${levelHtml}</div>
<div class="empty" id="none" hidden>Nothing matches these filters. <button class="btn small" type="button" id="reset">Show everything</button></div>`
        : `<div class="clean"><h2 style="margin-top:0">No issues found</h2><p class="lede">None of SiteFix's checks found a problem on the ${plural(run.pagesCrawled ?? 0, "page")} crawled. Your score is 100.</p></div>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Website audit: ${esc(hostOf(site))} · SiteFix</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand"><span class="dot" aria-hidden="true"></span>SiteFix website audit</div>
  <h1>${siteHref ? `<a href="${siteHref}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none">${esc(site)}</a>` : esc(site)}</h1>
  <p class="lede">Inspected ${esc(fmtDate(run.finishedAt || run.startedAt))} · ${plural(run.pagesCrawled ?? 0, "page")} crawled${run.partial?.reason === "time" ? ` (a share of every section of a larger site: at least ${esc(String(run.partial.pagesFound))} pages found)` : run.capReached ? " (page limit reached, some pages not checked)" : ""}</p>
  <div class="actions">${actions.join("")}</div>
</header>
<main>${body}</main>
<footer><p>The score starts at 100 and loses points for each kind of problem SiteFix measured: more for serious ones and ones on many pages, levelling off so one problem can't sink it. Fixing an issue gives back exactly the points it costs. Levels follow priority: urgent (P1), important (P2), polish (P3), and you can fix in any order.</p>
<p>${report.coach?.source === "ai" ? "SiteFix's messages are worded by AI; every issue, number and score in them comes from the measurements. " : ""}${report.ai?.provider && report.ai.provider !== "none" ? "Explanations are written by AI from the evidence the crawler measured, and checked automatically before they are shown. " : "Explanations use SiteFix's guidance for each type of issue. "}Every finding was measured by the crawler; nothing here is guessed. Report generated ${esc(fmtDate(report.generatedAt))}.</p></footer>
</div>
${all.length ? `<script type="application/json" id="sf-data">${json}</script>\n<script>${script}</script>` : ""}
</body>
</html>`;
}
