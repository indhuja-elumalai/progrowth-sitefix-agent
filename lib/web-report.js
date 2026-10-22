// The web report: one HTML page per inspection that can be opened in the UI or
// downloaded and sent to a client. Pure: data in, HTML out.
//
// buildWebReport({ report, shotSrc, standalone, links })
//   report     = explained.json (run, summary, ai, types[])
//   shotSrc    = (issue) -> image URL or data: URI, or null for no screenshot
//   standalone = true for the downloaded file (no links back to the SiteFix server)
//   links      = { pdf, download } URLs shown as buttons on the live page
// reportFileName(report) -> "sitefix-example.com-2026-10-22.html"
//
// Everything is rendered on the server, so the page reads fine without JavaScript.
// A small inline script adds filters, search, expand all and copy buttons. The page
// loads nothing from the network: no fonts, scripts or styles from elsewhere.

import { evidenceFacts } from "./report-html.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const PRIORITY_NAME = { P1: "Fix first", P2: "Fix soon", P3: "When you can" };
const ORDER = { P1: 0, P2: 1, P3: 2 };
const EFFORT_ORDER = { easy: 0, medium: 1, hard: 2 };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"; } catch { return iso || ""; } };
const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u || "site"); } };
const safeHref = (u) => (/^https?:\/\//i.test(String(u || "")) ? esc(u) : null);

export function reportFileName(report) {
    const host = hostOf(report?.run?.startUrl).replace(/[^a-z0-9.-]+/gi, "-");
    const day = String(report?.run?.startedAt || report?.generatedAt || "").slice(0, 10) || "report";
    return `sitefix-${host}-${day}.html`;
}

// All instances, flattened, with their type's title.
const flatten = (report) => (report.types || []).flatMap((t) => t.issues.map((i) => ({ ...i, title: t.title })));

// The short list on top: P1 first, then quick wins, easiest first; one entry per type and page.
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
<summary><span class="pill ${esc(i.priority)}">${esc(i.priority)}</span><span class="u">${esc(i.affectedUrl)}</span>${i.quickWin ? '<span class="pill qw">Quick win</span>' : ""}<span class="chev" aria-hidden="true"></span></summary>
<div class="inst-body">
<p class="expl">${esc(i.explanation || i.detail)}</p>
<div class="meta">${esc(i.effort)} fix · ${esc(i.owner)}${i.priorityReason ? ` · priority: ${esc(i.priorityReason)}` : ""}${href ? ` · <a href="${href}" target="_blank" rel="noopener noreferrer">open page</a>` : ""}</div>
${i.suggestedValue ? `<div class="val"><div class="k">${esc(t.valueLabel || "Suggested value")}</div><div class="v"><span>${esc(i.suggestedValue)}</span><button type="button" class="copy" data-copy="${esc(i.suggestedValue)}">Copy</button></div></div>` : ""}
${facts ? `<table class="facts">${facts}</table>` : ""}
${found.length ? `<div class="found"><div class="k">Found on ${plural(found.length, "page")}</div>${found.slice(0, 10).map((u) => `<div class="u">${esc(u)}</div>`).join("")}${found.length > 10 ? `<div class="more">and ${found.length - 10} more</div>` : ""}</div>` : ""}
${shot ? `<figure><a href="${esc(shot)}" target="_blank" rel="noopener"><img src="${esc(shot)}" alt="Screenshot of ${esc(i.affectedUrl)}" loading="lazy"></a><figcaption>Screenshot${["image", "http", "redirect"].includes(i.evidence?.kind) ? ", with the problem outlined in red where it could be found" : ""}</figcaption></figure>` : ""}
</div>
</details>`;
}

function typeCard(t, shotSrc) {
    const issues = [...t.issues].sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
    const top = issues[0];
    return `<section class="type" data-type="${esc(t.type)}">
<details class="type-d">
<summary>
  <span class="pill ${esc(top.priority)}">${esc(top.priority)}</span>
  <span class="tt"><span class="title">${esc(t.title)}</span><span class="sub">${esc(t.category)} · ${esc(top.effort)} fix · ${esc(top.owner)}</span></span>
  <span class="count" data-total="${issues.length}">${issues.length}</span><span class="chev" aria-hidden="true"></span>
</summary>
<div class="type-body">
<p class="sum">${esc(t.summary)}</p>
${t.why ? `<p class="why"><b>Why it matters.</b> ${esc(t.why)}</p>` : ""}
${(t.fixSteps || []).length ? `<div class="fix"><div class="k">How to fix</div><ol>${t.fixSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>` : ""}
<div class="insts">${issues.map((i) => instance(i, t, shotSrc)).join("\n")}</div>
</div>
</details>
</section>`;
}

const CSS = `
:root{--bg:#fff;--s1:#f5f5f7;--s2:#ececf0;--line:#e3e3e8;--t1:#1d1d1f;--t2:#515154;--t3:#86868b;--acc:#b8ff00;--accd:#5c8000;--acc-bg:rgba(184,255,0,.18);
--p1:#d70015;--p1b:#fde7e9;--p2:#a85000;--p2b:#fff0dc;--p3:#0060c0;--p3b:#e5effb;--link:#0060c0;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--s1:#1d1d20;--s2:#2a2a2e;--line:#2f2f34;--t1:#f2f2f5;--t2:#c3c3c8;--t3:#8e8e93;--acc-bg:rgba(184,255,0,.14);--accd:#b8ff00;
--p1:#ff6b7a;--p1b:rgba(255,69,88,.16);--p2:#ffb15c;--p2b:rgba(255,159,10,.15);--p3:#6cb4ff;--p3b:rgba(10,132,255,.16);--link:#6cb4ff;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--t1);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--link)}
.wrap{max-width:980px;margin:0 auto;padding:28px 20px 80px}
header .brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;color:var(--t2)}
.dot{width:12px;height:12px;border-radius:50%;background:var(--acc)}
h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:14px 0 6px;overflow-wrap:anywhere}
.lede{color:var(--t2);margin:0}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--t1);font:inherit;font-size:13.5px;font-weight:500;text-decoration:none;cursor:pointer}
.btn:hover{background:var(--s1)}
.btn.primary{background:var(--acc);border-color:var(--acc);color:#1d1d1f}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:26px 0 8px}
.kpi{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:var(--bg);text-align:left;font:inherit;color:inherit;cursor:pointer}
.kpi:hover{background:var(--s1)}
.kpi[aria-pressed=true]{outline:2px solid var(--accd);outline-offset:-1px}
.kpi b{display:block;font-size:28px;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi span{font-size:13px;color:var(--t2)}
.kpi.P1 b{color:var(--p1)}.kpi.P2 b{color:var(--p2)}.kpi.P3 b{color:var(--p3)}.kpi.qw b{color:var(--accd)}
h2{font-size:19px;letter-spacing:-.01em;margin:34px 0 10px}
.first{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.first li{border-top:1px solid var(--line)}.first li:first-child{border-top:none}
.first a{display:flex;gap:10px;align-items:baseline;padding:11px 14px;text-decoration:none;color:inherit}
.first a:hover{background:var(--s1)}
.first .t{font-weight:500}.first .u{color:var(--t3);font-size:12.5px;font-family:ui-monospace,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.cats{width:100%;border-collapse:collapse;font-size:14px}
.cats th,.cats td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
.cats th{font-size:12px;color:var(--t3);font-weight:600}
.cats td:not(:first-child),.cats th:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
.cats button{all:unset;cursor:pointer;color:var(--link)}
.cats button:hover{text-decoration:underline}
.bar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-bottom:1px solid var(--line);margin:30px -20px 0;padding:12px 20px}
.bar-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.bar input[type=search]{flex:1 1 220px;min-width:0;height:36px;border:1px solid var(--line);border-radius:999px;padding:0 14px;font:inherit;font-size:14px;background:var(--bg);color:var(--t1)}
.bar select{height:36px;border:1px solid var(--line);border-radius:999px;padding:0 12px;font:inherit;font-size:13.5px;background:var(--bg);color:var(--t1);max-width:100%}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden}
.seg button{border:none;background:transparent;color:var(--t2);font:inherit;font-size:13px;font-weight:500;padding:0 12px;height:34px;cursor:pointer}
.seg button[aria-pressed=true]{background:var(--t1);color:var(--bg)}
.tog{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;color:var(--t2);cursor:pointer;user-select:none}
.status{font-size:12.5px;color:var(--t3);margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.status button{all:unset;cursor:pointer;color:var(--link)}
.types{display:flex;flex-direction:column;gap:10px;margin-top:16px}
.type-d{border:1px solid var(--line);border-radius:14px;background:var(--bg);overflow:hidden}
summary{list-style:none;cursor:pointer}
summary::-webkit-details-marker{display:none}
.type-d>summary{display:flex;align-items:center;gap:12px;padding:14px 16px}
.type-d>summary:hover{background:var(--s1)}
.tt{flex:1;min-width:0;display:flex;flex-direction:column}
.title{font-weight:600}
.sub{font-size:12.5px;color:var(--t3)}
.count{font-size:12.5px;font-weight:600;color:var(--t2);background:var(--s2);border-radius:999px;padding:1px 9px;font-variant-numeric:tabular-nums}
.chev{width:9px;height:9px;border-right:2px solid var(--t3);border-bottom:2px solid var(--t3);transform:rotate(-45deg);transition:transform .15s;flex-shrink:0;margin-right:2px}
details[open]>summary .chev{transform:rotate(45deg)}
.type-body{border-top:1px solid var(--line);padding:14px 16px 16px}
.sum{margin:0 0 6px;font-size:15.5px}
.why{margin:0 0 12px;color:var(--t2)}
.fix{background:var(--s1);border-radius:10px;padding:10px 14px;margin-bottom:12px}
.fix ol{margin:4px 0 0 18px;padding:0}.fix li{margin:2px 0}
.k{font-size:11.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em}
.insts{display:flex;flex-direction:column;gap:6px}
.inst{border:1px solid var(--line);border-radius:10px}
.inst>summary{display:flex;align-items:center;gap:8px;padding:9px 12px}
.inst>summary:hover{background:var(--s1)}
.inst .u{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;color:var(--t2);overflow-wrap:anywhere;flex:1;min-width:0}
.inst-body{padding:4px 12px 12px;border-top:1px solid var(--line)}
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
.pill.qw{background:var(--acc-bg);color:var(--accd)}
.empty{border:1px dashed var(--line);border-radius:14px;padding:28px;text-align:center;color:var(--t2)}
.clean{border:1px solid var(--line);border-radius:14px;padding:28px;text-align:center}
.flash{animation:fl 1.6s ease}@keyframes fl{0%{box-shadow:0 0 0 3px var(--acc)}100%{box-shadow:0 0 0 3px transparent}}
footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--t3)}
[hidden]{display:none!important}
@media (max-width:720px){.kpis{grid-template-columns:repeat(2,1fr)}.kpi:first-child{grid-column:1/-1}h1{font-size:24px}.wrap{padding:20px 16px 60px}.bar{margin:24px -16px 0;padding:10px 16px}.facts th{width:100px}}
@media print{.bar,.actions,.copy{display:none!important}.type-d,.inst{break-inside:avoid}body{font-size:12px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

// Filters, search, expand all, copy. Works on the rendered HTML, so the page is
// complete without it.
const SCRIPT = `(function(){"use strict";
var $=function(s,c){return(c||document).querySelector(s)},$$=function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};
var insts=$$(".inst"),types=$$(".type"),q=$("#q"),cat=$("#cat"),own=$("#own"),qw=$("#qw"),st=$("#shown"),none=$("#none");
var state={p:"all"};
insts.forEach(function(i){i._t=i.textContent.toLowerCase();});
function apply(){
  var words=(q.value||"").toLowerCase().trim().split(/\\s+/).filter(Boolean),n=0;
  insts.forEach(function(i){
    var ok=(state.p==="all"||i.dataset.p===state.p)&&(!cat.value||i.dataset.cat===cat.value)&&(!own.value||i.dataset.owner===own.value)&&(!qw.checked||i.dataset.qw==="1")&&words.every(function(w){return i._t.indexOf(w)!==-1||(i.closest(".type").querySelector(".title").textContent.toLowerCase().indexOf(w)!==-1);});
    i.hidden=!ok;if(ok)n++;
  });
  types.forEach(function(t){var v=$$(".inst",t).filter(function(i){return!i.hidden;}).length,c=$(".count",t);t.hidden=!v;c.textContent=v===+c.dataset.total?c.dataset.total:v+" of "+c.dataset.total;});
  st.textContent=n+" of "+insts.length+" issue"+(insts.length===1?"":"s")+" shown";
  none.hidden=n>0;
  $$(".kpi").forEach(function(k){var p=k.dataset.p||"all",on=p==="qw"?(qw.checked&&state.p==="all"):(p===state.p&&!qw.checked);k.setAttribute("aria-pressed",String(on));});
}
function setP(p){state.p=p;$$(".seg button").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.p===p));});apply();}
$$(".seg button").forEach(function(b){b.addEventListener("click",function(){setP(b.dataset.p);});});
$$(".kpi").forEach(function(k){k.addEventListener("click",function(){var p=k.dataset.p;if(p==="qw"){qw.checked=true;setP("all");}else{qw.checked=false;setP(p||"all");}document.getElementById("issues").scrollIntoView({behavior:"smooth"});});});
[q,cat,own,qw].forEach(function(e){e.addEventListener("input",apply);e.addEventListener("change",apply);});
$$("[data-cat-pick]").forEach(function(b){b.addEventListener("click",function(){cat.value=b.dataset.catPick;apply();document.getElementById("issues").scrollIntoView({behavior:"smooth"});});});
$("#reset").addEventListener("click",function(){q.value="";cat.value="";own.value="";qw.checked=false;setP("all");});
var openAll=$("#openall");openAll.addEventListener("click",function(){var open=openAll.dataset.open!=="1";$$(".type-d").forEach(function(d){d.open=open;});openAll.dataset.open=open?"1":"0";openAll.textContent=open?"Collapse all":"Expand all";});
document.addEventListener("click",function(e){var c=e.target.closest(".copy");if(!c)return;e.preventDefault();var done=function(){c.textContent="Copied";setTimeout(function(){c.textContent="Copy";},1200);};if(navigator.clipboard)navigator.clipboard.writeText(c.dataset.copy).then(done,function(){});});
function reveal(id){var i=document.getElementById(id);if(!i||!i.classList.contains("inst"))return;if(i.hidden){$("#reset").click();}i.closest(".type-d").open=true;i.open=true;i.scrollIntoView({behavior:"smooth",block:"center"});i.classList.add("flash");setTimeout(function(){i.classList.remove("flash");},1700);}
$$(".first a").forEach(function(a){a.addEventListener("click",function(e){e.preventDefault();history.replaceState(null,"",a.getAttribute("href"));reveal(a.getAttribute("href").slice(1));});});
if(location.hash)reveal(location.hash.slice(1));
window.addEventListener("beforeprint",function(){$$("details").forEach(function(d){d.dataset.was=d.open?"1":"0";d.open=true;});});
window.addEventListener("afterprint",function(){$$("details").forEach(function(d){d.open=d.dataset.was==="1";});});
apply();
})();`;

export function buildWebReport({ report, shotSrc = null, standalone = false, links = {} }) {
    const run = report.run || {};
    const s = report.summary || { byPriority: { P1: 0, P2: 0, P3: 0 }, quickWins: 0 };
    const all = flatten(report);
    const types = [...(report.types || [])].sort((a, b) =>
        Math.min(...a.issues.map((i) => ORDER[i.priority])) - Math.min(...b.issues.map((i) => ORDER[i.priority])) || b.issues.length - a.issues.length);
    const cats = {};
    for (const i of all) {
        cats[i.category] ||= { total: 0, P1: 0, P2: 0, P3: 0 };
        cats[i.category].total++; cats[i.category][i.priority]++;
    }
    const owners = [...new Set(all.map((i) => i.owner).filter(Boolean))].sort();
    const first = fixFirst(report);
    const ai = report.ai || {};
    const aiLine = ai.provider && ai.provider !== "none"
        ? `Explanations written by AI (${esc(ai.model)}) from the crawler's evidence and checked automatically${ai.standardTypes ? `; ${ai.standardTypes} issue type(s) use SiteFix standard guidance where the AI answer did not pass the checks` : ""}.`
        : "Explanations use SiteFix standard guidance (AI was off for this report).";
    const site = run.startUrl || "";
    const siteHref = safeHref(site);

    const actions = [];
    if (!standalone && links.download) actions.push(`<a class="btn primary" href="${esc(links.download)}" download>Download this report</a>`);
    if (!standalone && links.pdf) actions.push(`<a class="btn" href="${esc(links.pdf)}" target="_blank" rel="noopener">Open PDF</a>`);
    actions.push(`<button class="btn" type="button" onclick="window.print()">Print</button>`);

    const body = all.length ? `
<div class="kpis" role="group" aria-label="Filter by priority">
  <button class="kpi" type="button"><b>${all.length}</b><span>${all.length === 1 ? "issue" : "issues"} in total</span></button>
  <button class="kpi P1" type="button" data-p="P1"><b>${s.byPriority.P1}</b><span>P1 · fix first</span></button>
  <button class="kpi P2" type="button" data-p="P2"><b>${s.byPriority.P2}</b><span>P2 · fix soon</span></button>
  <button class="kpi P3" type="button" data-p="P3"><b>${s.byPriority.P3}</b><span>P3 · when you can</span></button>
  <button class="kpi qw" type="button" data-p="qw"><b>${s.quickWins}</b><span>quick wins</span></button>
</div>
${first.length ? `<h2>Fix these first</h2>
<ol class="first">${first.map((i) => `<li><a href="#${esc(i.id)}"><span class="pill ${esc(i.priority)}">${esc(i.priority)}</span><span class="t">${esc(i.title)}</span><span class="u">${esc(i.affectedUrl)}</span>${i.quickWin ? '<span class="pill qw">Quick win</span>' : ""}</a></li>`).join("")}</ol>` : ""}
<h2>By category</h2>
<table class="cats"><thead><tr><th>Category</th><th>Issues</th><th>P1</th><th>P2</th><th>P3</th></tr></thead><tbody>
${Object.entries(cats).sort((a, b) => b[1].P1 - a[1].P1 || b[1].total - a[1].total).map(([c, v]) => `<tr><td><button type="button" data-cat-pick="${esc(c)}">${esc(c)}</button></td><td>${v.total}</td><td>${v.P1}</td><td>${v.P2}</td><td>${v.P3}</td></tr>`).join("")}
</tbody></table>
<h2 id="issues">All issues</h2>
<div class="bar">
  <div class="bar-row">
    <input type="search" id="q" placeholder="Search issues, pages or text" aria-label="Search issues">
    <div class="seg" role="group" aria-label="Priority">${["all", "P1", "P2", "P3"].map((p) => `<button type="button" data-p="${p}" aria-pressed="${p === "all"}">${p === "all" ? "All" : p}</button>`).join("")}</div>
    <select id="cat" aria-label="Category"><option value="">All categories</option>${Object.keys(cats).sort().map((c) => `<option>${esc(c)}</option>`).join("")}</select>
    <select id="own" aria-label="Who fixes it"><option value="">Anyone</option>${owners.map((o) => `<option>${esc(o)}</option>`).join("")}</select>
    <label class="tog"><input type="checkbox" id="qw"> Quick wins only</label>
  </div>
  <div class="status"><span id="shown" aria-live="polite"></span><button type="button" id="openall">Expand all</button><button type="button" id="reset">Clear filters</button></div>
</div>
<div class="types">${types.map((t) => typeCard(t, shotSrc)).join("\n")}</div>
<div class="empty" id="none" hidden>No issues match these filters. <button class="btn" type="button" onclick="document.getElementById('reset').click()">Clear filters</button></div>`
        : `<div class="clean"><h2 style="margin-top:0">No issues found</h2><p class="lede">None of SiteFix's checks found a problem on the ${plural(run.pagesCrawled ?? 0, "page")} crawled.</p></div>`;

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
  <p class="lede">Inspected ${esc(fmtDate(run.finishedAt || run.startedAt))} · ${plural(run.pagesCrawled ?? 0, "page")} crawled${run.capReached ? " (page limit reached, some pages not checked)" : ""}</p>
  <div class="actions">${actions.join("")}</div>
</header>
<main>${body}</main>
<footer>Priority: P1 fix first, P2 fix soon, P3 when you can. It starts from how serious the issue is and goes up a level when it reaches 10+ pages or the home page. A quick win is a P1 or P2 issue that is easy to fix. ${aiLine} Every finding was measured by the crawler; nothing here is guessed. Report generated ${esc(fmtDate(report.generatedAt))}.</footer>
</div>
${all.length ? `<script>${SCRIPT}</script>` : ""}
</body>
</html>`;
}
