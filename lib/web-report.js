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
// The live report is a small app with three tabs:
//   Fix       the landing: the site score (lib/score.js) with its three areas, the
//             levels (urgent, important, polish) as steps anyone can open, SiteFix's
//             latest message (lib/coach.js), and a choice of fixes to pick from
//             (recommended, quick wins, biggest boost, by level or area). Nothing is
//             locked: any fix can be opened at any time.
//   All issues  every kind of problem, with search, filters and sorting.
//   Progress  the score then and now, the areas and levels, everything fixed, and
//             all of SiteFix's messages.
// A fix opens in a panel: what visitors face, why it matters, the steps, every page
// with its evidence and screenshot, "I fixed it" (the score rises at once) and "Check
// it now" (the live site is checked again). The words of the messages may come from
// AI; every fact in them (the issue, the numbers, the score) is filled in by the code.
//
// The full report (every kind, its steps and every page) is also on the page as plain
// HTML: it is what prints, and what shows without JavaScript. The page loads nothing
// from the network. Links from the chat still work: #ISS-… opens one issue, #type=a,b
// lists only those kinds, #p=P1 one priority, #qw=1 the quick wins.

import { evidenceFacts } from "./report-html.js";
import { siteScore, gainOf, gainText, levelOf, areaOf } from "./score.js";
import { standardBank, fillMessage } from "./coach.js";

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

// One kind of problem in full: what it is, why it matters, the steps and every page.
// The fix panel shows this; it is also what prints.
function typeDetail(t, ctx) {
    const issues = [...t.issues].sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
    const top = issues[0];
    const area = areaOf(t.type);
    const coach = ctx.bank.types[t.type] || {};
    const gain = gainOf(ctx.all, [], issues.map((i) => i.id));
    return `<section class="tdetail" id="t-${esc(t.type)}" data-type="${esc(t.type)}" data-area="${area}" data-effort="${esc(top.effort)}" data-level="${esc(top.priority)}">
<div class="td-head"><h3>${esc(t.title)}</h3><p class="td-tags"><span class="pill ${esc(top.priority)}">${LEVEL_WORD[top.priority] || esc(top.priority)}</span> ${esc(EFFORT_WORD[top.effort] || top.effort)} · ${AREA_WORD[area]} · ${esc(top.owner)} · ${plural(issues.length, "issue")} · worth +${esc(gainBadge(gain))} points</p>
${coach.visitor ? `<p class="td-vis">${esc(coach.visitor)}</p>` : ""}</div>
<p class="sum">${esc(t.summary)}</p>
${t.why ? `<p class="why"><b>Why it matters.</b> ${esc(t.why)}</p>` : ""}
${(t.fixSteps || []).length ? `<div class="fix"><div class="k">How to fix</div><ol>${t.fixSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>` : ""}
<div class="k pages-k">Where: ${plural(issues.length, "issue")}</div>
<div class="insts">${issues.map((i) => instance(i, t, ctx.shotSrc)).join("\n")}</div>
</section>`;
}

function ring(score, r = 52) {
    const c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" class="ring-bg"/><circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - score / 100)).toFixed(1)}"/></svg>`;
}

const CSS = `
/* SiteFix live report. An app shell: a dark bar with the tabs, light working surfaces,
   the brand lime only on what moves the score (the ring, primary actions, gains). */
:root{--bg:#f3f4ef;--surface:#fff;--sunk:#eceee6;--line:#dfe1d7;--ink:#17181a;--t2:#4f5249;--t3:#83867b;
--bar:#17181a;--score:#17181a;--bar-t:#f3f4ef;--bar-t2:#a9ab9f;--lime:#b8ff00;--lime-ink:#2f4a00;--lime-bg:#eef8cf;--link:#2d5fb3;
--p1:#c4271d;--p1b:#fbe6e3;--p2:#9a5600;--p2b:#fcefd9;--p3:#2d5fb3;--p3b:#e4ecf8;--ok:#237a3b;--okb:#e2f2e5;
--shadow:0 1px 2px rgba(20,22,18,.05),0 6px 20px rgba(20,22,18,.06);--r:14px;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121311;--surface:#1b1c19;--sunk:#22241f;--line:#2e3029;--ink:#eef0e8;--t2:#c0c3b7;--t3:#8c8f84;
--bar:#0b0c0a;--score:#1d2414;--bar-t:#eef0e8;--bar-t2:#8c8f84;--lime-ink:#c9ff4d;--lime-bg:rgba(184,255,0,.12);--link:#86b3ff;
--p1:#ff8a7f;--p1b:rgba(255,99,85,.15);--p2:#ffbe6b;--p2b:rgba(255,170,60,.14);--p3:#86b3ff;--p3b:rgba(90,150,255,.15);--ok:#6fd88a;--okb:rgba(70,200,110,.14);
--shadow:0 1px 2px rgba(0,0,0,.4);color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121311;--surface:#1b1c19;--sunk:#22241f;--line:#2e3029;--ink:#eef0e8;--t2:#c0c3b7;--t3:#8c8f84;
--bar:#0b0c0a;--score:#1d2414;--bar-t:#eef0e8;--bar-t2:#8c8f84;--lime-ink:#c9ff4d;--lime-bg:rgba(184,255,0,.12);--link:#86b3ff;
--p1:#ff8a7f;--p1b:rgba(255,99,85,.15);--p2:#ffbe6b;--p2b:rgba(255,170,60,.14);--p3:#86b3ff;--p3b:rgba(90,150,255,.15);--ok:#6fd88a;--okb:rgba(70,200,110,.14);
--shadow:0 1px 2px rgba(0,0,0,.4);color-scheme:dark}
*{box-sizing:border-box}
html{scroll-padding-top:120px}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--link)}
button{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.in{max-width:1180px;margin:0 auto;padding-left:max(20px,env(safe-area-inset-left,0px));padding-right:max(20px,env(safe-area-inset-right,0px))}
/* ---------- top bar ---------- */
.top{background:var(--bar);color:var(--bar-t);position:sticky;top:0;z-index:20}
.top .in{display:flex;align-items:center;gap:18px;min-height:60px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.dot{width:12px;height:12px;border-radius:50%;background:var(--lime);flex-shrink:0}
.brand b{font-size:15px;letter-spacing:-.01em}
.brand .site{color:var(--bar-t2);font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
.brand .site a{color:inherit;text-decoration:none}
.tabs{display:flex;gap:4px;margin-left:auto;overflow-x:auto;scrollbar-width:none}
.tab{all:unset;cursor:pointer;padding:8px 14px;border-radius:999px;font-size:14px;font-weight:600;color:var(--bar-t2);white-space:nowrap;display:inline-flex;align-items:center;gap:7px}
.tab:hover{color:var(--bar-t)}
.tab[aria-selected=true]{background:rgba(255,255,255,.1);color:var(--bar-t)}
.tab:focus-visible{outline:2px solid var(--lime)}
.tab .n{font-size:12px;font-weight:700;background:rgba(255,255,255,.12);border-radius:999px;padding:0 7px;font-variant-numeric:tabular-nums}
.tab .new{width:7px;height:7px;border-radius:50%;background:var(--lime)}
.export{position:relative}
.export>summary{list-style:none;cursor:pointer;padding:7px 13px;border:1px solid rgba(255,255,255,.18);border-radius:999px;font-size:13.5px;font-weight:600}
.export>summary::-webkit-details-marker{display:none}
.export[open]>summary{background:rgba(255,255,255,.1)}
.menu{position:absolute;right:0;top:calc(100% + 8px);background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);min-width:210px;padding:6px;z-index:30;display:flex;flex-direction:column}
.menu a,.menu button{all:unset;cursor:pointer;padding:9px 12px;border-radius:8px;font-size:14px}
.menu a:hover,.menu button:hover{background:var(--sunk)}
.menu small{display:block;color:var(--t3);font-size:12px}
/* ---------- layout ---------- */
main{padding-block:24px 96px}
.panel[hidden]{display:none}
.lede{color:var(--t2);font-size:13.5px;margin:0 0 18px}
h2.sec{font-size:18px;letter-spacing:-.01em;margin:0}
.sec-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:30px 0 12px}
.sec-h .aside{margin-left:auto;color:var(--t3);font-size:13px}
.box{background:var(--surface);border:1px solid var(--line);border-radius:var(--r)}
/* ---------- Fix tab: score + coach ---------- */
.hero{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px}
.scorecard{background:var(--score);color:var(--bar-t);border-radius:18px;padding:22px 24px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 24px;align-items:center;align-content:center}
.scorecard .dial{grid-row:span 2}.sc-areas{grid-column:2;min-width:0}
.dial{position:relative;width:132px;height:132px}
.ring{width:132px;height:132px;transform:rotate(-90deg)}
.ring-bg{fill:none;stroke:rgba(255,255,255,.1);stroke-width:10}
.ring-fg{fill:none;stroke:var(--lime);stroke-width:10;stroke-linecap:round;transition:stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)}
.dial-n{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.dial-n b{font-size:40px;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.dial-n span{font-size:12px;color:var(--bar-t2)}
.sc-txt{min-width:0}
.sc-lvl{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--bar-t2);font-weight:700}
.sc-name{font-size:21px;font-weight:700;letter-spacing:-.01em;margin:2px 0 2px}
.sc-up{font-size:13px;font-weight:700;color:var(--lime);min-height:19px}
.areas{display:flex;flex-direction:column;gap:7px;margin-top:10px}
.area{display:grid;grid-template-columns:78px 1fr 30px;gap:10px;align-items:center;font-size:13px;color:var(--bar-t2)}
.area i{display:block;height:6px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden}
.area i b{display:block;height:100%;width:0;background:var(--lime);border-radius:6px;transition:width .8s ease}
.area span:last-child{color:var(--bar-t);font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
.area-note{font-size:11.5px;color:var(--bar-t2);margin:8px 0 0}
.side{display:flex;flex-direction:column;gap:12px;min-width:0}
.coach{padding:16px 18px;display:flex;flex-direction:column;gap:10px;min-width:0;flex:1}
.coach-h{display:flex;align-items:center;gap:10px}
.av{width:32px;height:32px;border-radius:50%;background:var(--lime);color:#17181a;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0}
.coach-h b{font-size:14px}.coach-h span{font-size:12.5px;color:var(--t3)}
.bubble{background:var(--sunk);border-radius:4px 14px 14px 14px;padding:12px 14px;font-size:15px;animation:pop .4s ease}
.coach-act{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.linkbtn{all:unset;cursor:pointer;color:var(--link);font-size:13.5px;font-weight:500}
@keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
/* ---------- levels as steps ---------- */
.steps{padding:6px}
.step{all:unset;cursor:pointer;border-radius:10px;padding:9px 12px;display:grid;grid-template-columns:minmax(0,1fr) 120px 92px;gap:12px;align-items:center;transition:background .15s;box-sizing:border-box;width:100%}
.step:hover{background:var(--sunk)}
.step[aria-pressed=true]{background:var(--sunk);box-shadow:inset 0 0 0 1px var(--ink)}
.step .s-top{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2)}
.step .s-top b{color:var(--ink);font-size:14.5px}
.step .s-top b{white-space:nowrap}
.step.cur{box-shadow:inset 3px 0 0 var(--lime)}.step.cur[aria-pressed=true]{box-shadow:inset 3px 0 0 var(--lime),inset 0 0 0 1px var(--ink)}
.step.cur .s-top b::after{content:" \\00b7  you're here";font-size:12px;font-weight:600;color:var(--lime-ink)}
.step .bar{height:6px;border-radius:6px;background:var(--sunk);overflow:hidden}
.step .bar b{display:block;height:100%;background:var(--ink);border-radius:6px;transition:width .6s ease}
.step .s-n{font-size:12.5px;color:var(--t3);font-variant-numeric:tabular-nums;text-align:right}
.step.done .bar b{background:var(--ok)}
/* ---------- choose a fix ---------- */
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{all:unset;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--t2);border-radius:999px;font-size:13px;font-weight:600;padding:6px 13px}
.chip:hover{color:var(--ink)}
.chip[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.chip:focus-visible{outline:2px solid var(--link)}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;margin-top:14px}
.tile{all:unset;cursor:pointer;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:15px 16px;display:flex;flex-direction:column;gap:8px;transition:transform .15s,box-shadow .15s,border-color .15s;animation:pop .35s ease both;min-width:0}
.tile:hover{transform:translateY(-2px);box-shadow:var(--shadow);border-color:var(--t3)}
.tile:focus-visible{outline:2px solid var(--link)}
.t-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--t3)}
.t-title{font-size:15.5px;font-weight:650;letter-spacing:-.01em;line-height:1.3}
.t-vis{font-size:13.5px;color:var(--t2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.t-bot{display:flex;align-items:center;gap:10px;margin-top:auto;padding-top:4px}
.t-gain{font-size:20px;font-weight:800;color:var(--ok);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.t-gain small{font-size:11.5px;font-weight:600;color:var(--t3);margin-left:3px;letter-spacing:0}
.t-pages{font-size:12.5px;color:var(--t3)}
.t-go{margin-left:auto;font-size:13px;font-weight:600;color:var(--ink)}
.tile.done{background:var(--okb);border-color:transparent}
.tile.done .t-gain{color:var(--ok);font-size:14px}
.more-row{margin-top:14px;display:flex;justify-content:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-size:14px;font-weight:600;text-decoration:none;cursor:pointer}
.btn:hover{border-color:var(--t3)}
.btn.primary{background:var(--lime);border-color:var(--lime);color:#17181a}
.btn.primary:hover{filter:brightness(.95)}
.btn.small{padding:6px 12px;font-size:13px}
.btn[disabled]{opacity:.55;cursor:default}
.pill{font-size:11.5px;font-weight:700;border-radius:999px;padding:1px 8px;flex-shrink:0;white-space:nowrap}
.pill.P1{background:var(--p1b);color:var(--p1)}.pill.P2{background:var(--p2b);color:var(--p2)}.pill.P3{background:var(--p3b);color:var(--p3)}
.eff{font-size:12px;font-weight:600;border-radius:999px;padding:1px 8px;background:var(--sunk);color:var(--t2)}
.eff.easy{background:var(--lime-bg);color:var(--lime-ink)}
.empty{border:1px dashed var(--line);border-radius:var(--r);padding:26px;text-align:center;color:var(--t2);grid-column:1/-1}
/* ---------- All issues ---------- */
.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.toolbar input[type=search]{flex:1 1 240px;min-width:0;height:38px;border:1px solid var(--line);border-radius:999px;padding:0 16px;font:inherit;font-size:14px;background:var(--surface);color:var(--ink)}
.toolbar select{height:38px;border:1px solid var(--line);border-radius:999px;padding:0 12px;font:inherit;font-size:13.5px;background:var(--surface);color:var(--ink);max-width:100%}
.presets{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.preset{all:unset;cursor:pointer;font-size:13px;font-weight:600;background:var(--lime-bg);color:var(--lime-ink);border-radius:999px;padding:4px 12px}
.count-line{font-size:13px;color:var(--t3);margin:0 0 8px}
.rows{display:flex;flex-direction:column}
.rows .hdr,.row{display:grid;grid-template-columns:minmax(0,1fr) 92px 92px 96px 64px 120px;gap:12px;align-items:center;padding:11px 16px}
.rows .hdr{font-size:11.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;padding-top:4px;padding-bottom:6px}
.row{all:unset;display:grid;grid-template-columns:minmax(0,1fr) 92px 92px 96px 64px 120px;gap:12px;align-items:center;padding:12px 16px;cursor:pointer;background:var(--surface);border:1px solid var(--line);border-bottom-width:0;font-size:13.5px;color:var(--t2)}
.row:first-of-type{border-top-left-radius:var(--r);border-top-right-radius:var(--r)}
.row:last-child{border-bottom-width:1px;border-bottom-left-radius:var(--r);border-bottom-right-radius:var(--r)}
.row:hover{background:var(--sunk)}
.row:focus-visible{outline:2px solid var(--link);outline-offset:-2px}
.r-title{min-width:0}
.r-meta{display:contents}
.r-title b{display:block;color:var(--ink);font-size:14.5px;font-weight:600}
.r-title small{color:var(--t3);font-size:12.5px}
.r-gain{font-weight:800;color:var(--ok);font-variant-numeric:tabular-nums}
.st{font-size:12.5px;font-weight:600}
.st.open{color:var(--t3)}.st.partial{color:var(--p2)}.st.fixed,.st.confirmed{color:var(--ok)}
/* ---------- Progress ---------- */
.pgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.stat{padding:16px 18px}
.stat .k{margin-bottom:4px}
.stat .big{font-size:30px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat .big small{font-size:15px;color:var(--t3);font-weight:600}
.stat p{margin:2px 0 0;font-size:13px;color:var(--t2)}
.pcols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:12px}
.pcols .box{padding:16px 18px}
.meter{display:grid;grid-template-columns:96px 1fr 70px;gap:10px;align-items:center;font-size:13.5px;margin:8px 0}
.meter i{position:relative;height:8px;border-radius:8px;background:var(--sunk);overflow:hidden}
.meter i b{position:absolute;inset:0 auto 0 0;background:var(--lime);border-radius:8px;transition:width .6s}
.meter i em{position:absolute;inset:0 auto 0 0;background:var(--t3);opacity:.35;border-radius:8px}
.meter span:last-child{text-align:right;font-variant-numeric:tabular-nums;color:var(--t2)}
.timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.timeline li{display:grid;grid-template-columns:auto 1fr;gap:10px}
.timeline .av{width:26px;height:26px;font-size:12px}
.timeline small{display:block;color:var(--t3);font-size:12px}
.fixedlist{list-style:none;margin:0;padding:0}
.fixedlist li{display:flex;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--line);font-size:14px}
.fixedlist li:first-child{border-top:0}
.fixedlist .grow{flex:1;min-width:0}
.k{font-size:11.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em}
/* ---------- the fix panel ---------- */
.scrim{position:fixed;inset:0;background:rgba(10,11,9,.42);z-index:40;opacity:0;transition:opacity .2s}
.scrim.on{opacity:1}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(640px,100%);background:var(--surface);z-index:41;display:flex;flex-direction:column;box-shadow:-10px 0 40px rgba(0,0,0,.18);transform:translateX(100%);transition:transform .28s cubic-bezier(.2,.8,.2,1)}
.drawer.on{transform:none}
.dr-head{padding:18px 22px 14px;padding-top:calc(18px + env(safe-area-inset-top,0px));border-bottom:1px solid var(--line)}
.dr-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--t3)}
.dr-head{position:relative}.dr-head .dr-row{padding-right:40px}
.dr-close{all:unset;cursor:pointer;position:absolute;top:calc(12px + env(safe-area-inset-top,0px));right:14px;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--t2)}
.dr-close:hover{background:var(--sunk)}
.dr-head h2{font-size:21px;letter-spacing:-.015em;margin:8px 0 10px;text-wrap:balance}
.dr-gain{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.dr-gain b{font-size:28px;color:var(--ok);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.dr-gain span{font-size:13.5px;color:var(--t2)}
.dr-body{flex:1;overflow-y:auto;padding:18px 22px 24px;overscroll-behavior:contain}
.face{background:var(--sunk);border-radius:12px;padding:12px 14px;margin-bottom:12px}
.face p{margin:4px 0 0}
.nudge{color:var(--t2);font-size:14px;margin:0 0 14px}
.dr-foot{border-top:1px solid var(--line);padding:12px 22px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:8px;background:var(--surface)}
.dr-btns{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dr-state{font-size:13.5px;color:var(--t2);min-height:20px}
.dr-state.ok{color:var(--ok);font-weight:600}.dr-state.bad{color:var(--p2);font-weight:600}
.dr-next{all:unset;cursor:pointer;font-size:13.5px;color:var(--link);margin-left:auto}
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
.chev{width:8px;height:8px;border-right:2px solid var(--t3);border-bottom:2px solid var(--t3);transform:rotate(-45deg);transition:transform .15s;flex-shrink:0;margin-right:2px}
details[open]>summary .chev{transform:rotate(45deg)}
.inst-body{padding:4px 12px 12px;border-top:1px solid var(--line)}
.inst-act{margin-top:10px}
.tick{display:inline-flex;gap:7px;align-items:center;font-size:13.5px;color:var(--t2);cursor:pointer}
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
.flash{animation:fl 1.6s ease}@keyframes fl{0%{box-shadow:0 0 0 3px var(--lime)}100%{box-shadow:0 0 0 3px transparent}}
/* ---------- toast ---------- */
.toast{position:fixed;left:50%;top:calc(74px + env(safe-area-inset-top,0px));transform:translate(-50%,-16px);background:var(--bar);color:var(--bar-t);border-radius:999px;padding:11px 20px;font-size:14px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;z-index:60;display:block;white-space:nowrap;max-width:calc(100% - 32px);overflow:hidden;text-overflow:ellipsis}
.toast.on{opacity:1;transform:translate(-50%,0)}
.toast b{color:var(--lime)}
.toast.side{left:auto;right:max(22px,env(safe-area-inset-right,0px));top:auto;bottom:calc(110px + env(safe-area-inset-bottom,0px));transform:translateY(16px)}.toast.side.on{transform:none}
.toast.big{padding:14px 24px;font-size:15px}
/* ---------- the full report: print and no-JavaScript ---------- */
.full{display:none}
.nojs .app,.nojs .tabs,.nojs .drawer,.nojs .scrim{display:none!important}
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
@media (max-width:860px){.hero{grid-template-columns:1fr}.pgrid{grid-template-columns:1fr}.pcols{grid-template-columns:1fr}
.rows .hdr{display:none}.row{grid-template-columns:minmax(0,1fr);row-gap:8px;border-radius:12px!important;border-bottom-width:1px;margin-bottom:8px}
.r-meta{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12.5px}.r-meta .r-gain{order:-1}
.toolbar select{flex:1 1 calc(50% - 4px)}}
@media (max-width:620px){.top .in{gap:6px 12px;padding-block:8px}.brand .site{max-width:150px}.tabs{order:3;width:100%;margin-left:0}.export{margin-left:auto}
.scorecard{padding:18px;gap:14px 18px}.scorecard .dial{grid-row:auto}.dial,.ring{width:96px;height:96px}.dial-n b{font-size:30px}.sc-areas{grid-column:1/-1}.step{grid-template-columns:minmax(0,1fr) 70px;}.step .s-n{grid-column:1/-1;text-align:left;margin-top:-4px}.tiles{grid-template-columns:1fr}.dr-head,.dr-body,.dr-foot{padding-left:16px;padding-right:16px}}
@media print{.top,.app,.drawer,.scrim,.toast,.copy,.inst-act{display:none!important}.full,.print-sum{display:block!important}body{background:#fff;color:#000;font-size:12px}
.full .tdetail,.inst{break-inside:avoid}.print-sum{margin-bottom:16px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

// The page's own script (its source is copied into the page): tabs, the score and
// levels, choosing a fix, the fix panel, "I fixed it", "Check it now", the list with
// its filters, progress, SiteFix's messages and links from the chat.
function liveReport(D) {
    "use strict";
    var $ = function (s, c) { return (c || document).querySelector(s); }, $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
    var all = D.issues.map(function (x) { return { id: x.id, type: x.t, severity: x.s, priority: x.p, pages: x.n }; });
    var byId = {}; all.forEach(function (i) { byId[i.id] = i; });
    var T = {}; D.types.forEach(function (t) { T[t.type] = t; t._text = ""; });
    var KEY = "sitefix-progress-" + D.runId;
    var state = { fixed: {}, posts: [], visits: 0, last: 0 };
    var EFF = { easy: "Easy", medium: "Medium", hard: "Bigger job" }, AREA = { "on-page": "On-page", technical: "Technical", "off-page": "Off-page" }, LV = { P1: "Urgent", P2: "Important", P3: "Polish" };
    var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
    var start = siteScore(all, []);
    var ui = { tab: "fix", set: "rec", drawer: null, note: {}, f: { q: "", p: "", area: "", effort: "", owner: "", status: "open", sort: "points", types: null, qw: false } };
    function fixedIds() { return Object.keys(state.fixed); }
    function fill(tpl, v) { return fillMessage(tpl, v); }
    function badge(g) { return g >= 0.95 ? String(Math.round(g)) : "<1"; }
    function openOf(t) { return t.ids.filter(function (id) { return !state.fixed[id]; }); }
    function gainFor(t) { var o = openOf(t); return o.length ? gainOf(all, fixedIds(), o) : 0; }
    function statusOf(t) { var o = openOf(t).length; if (!o) return t.ids.every(function (id) { return state.fixed[id] === "verified"; }) ? "confirmed" : "fixed"; return o < t.ids.length ? "partial" : "open"; }
    var ST_WORD = { open: "Open", partial: "Partly fixed", fixed: "Marked fixed", confirmed: "Confirmed live" };
    function isDone(t) { var s = statusOf(t); return s === "fixed" || s === "confirmed"; }
    // ---------- saving ----------
    function save() {
        state.posts = state.posts.slice(-30);
        if (D.api) { try { fetch(D.api + "progress", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }).catch(function () { }); } catch (e) { } }
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
    }
    function load(done) {
        var local = null;
        try { local = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { }
        if (!D.api) { if (local && local.fixed) state = local; return done(); }
        fetch(D.api + "progress").then(function (r) { return r.ok ? r.json() : null; }).then(function (s) { if (s && s.fixed) state = s; else if (local && local.fixed) state = local; done(); }, function () { if (local && local.fixed) state = local; done(); });
    }
    // ---------- toast ----------
    var toastTimer = null;
    function toast(html, big) {
        var t = $("#toast"), cls = "toast" + (big ? " big" : "") + (ui.drawer ? " side" : "");
        t.innerHTML = html; t.className = cls + " on";
        clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = cls; }, big ? 4200 : 2800);
    }
    // ---------- the score, the areas and the levels ----------
    var shown = null;
    function paint(animate) {
        var s = siteScore(all, fixedIds()), lv = levelOf(all, fixedIds());
        var c = 2 * Math.PI * 52, dash = $(".ring-fg");
        if (dash) dash.setAttribute("stroke-dashoffset", (c * (1 - s.score / 100)).toFixed(1));
        var n = $(".dial-n b");
        if (n && shown !== null && s.score !== shown && animate) {
            var from = shown, to = s.score, t0 = performance.now();
            (function step(t) { var k = Math.min(1, (t - t0) / 800); n.textContent = Math.round(from + (to - from) * k); if (k < 1) requestAnimationFrame(step); })(t0);
        } else if (n) n.textContent = s.score;
        shown = s.score;
        var up = $(".sc-up"); if (up) up.textContent = s.score > start.score ? "+" + (s.score - start.score) + " since the inspection" : "";
        ["on-page", "technical", "off-page"].forEach(function (a) { var el = $('.area[data-a="' + a + '"]'); if (!el) return; $("b", el).style.width = s.areas[a] + "%"; $("span:last-child", el).textContent = s.areas[a]; });
        var nm = $(".sc-name"); if (nm) nm.textContent = lv.name;
        var lvl = $(".sc-lvl"); if (lvl) lvl.textContent = lv.level <= 3 ? "Level " + lv.level + " of 3" : "All levels done";
        $$(".step").forEach(function (b) {
            var p = b.dataset.step, tot = lv.total[p], done = tot - lv.open[p];
            $(".bar b", b).style.width = (tot ? Math.round(100 * done / tot) : 100) + "%";
            $(".s-n", b).textContent = tot ? done + " of " + tot + " fixed" : "Nothing to fix";
            b.classList.toggle("done", tot > 0 && done === tot);
            b.classList.toggle("cur", ["", "P1", "P2", "P3"][lv.level] === p);
            b.setAttribute("aria-pressed", String(ui.set === p));
        });
        var openKinds = D.types.filter(function (t) { return !isDone(t); }).length;
        var tn = $('.tab[data-tab="issues"] .n'); if (tn) tn.textContent = openKinds;
        renderTiles(); renderRows(); renderProgress(); renderDrawer();
        return { s: s, lv: lv };
    }
    // ---------- choosing a fix ----------
    var WEIGHT = { P1: 1.6, P2: 1.2, P3: 1 }, COST = { easy: 1, medium: 1.8, hard: 3 };
    function tileList() {
        var set = ui.set, gains = {};
        D.types.forEach(function (t) { gains[t.type] = gainFor(t); });
        var open = D.types.filter(function (t) { return !isDone(t); }), done = D.types.filter(isDone);
        var byGain = function (a, b) { return gains[b.type] - gains[a.type]; };
        var list;
        if (set === "rec") {
            // The best value fixes, at most three from one level, so there is always a choice across levels.
            var per = { P1: 0, P2: 0, P3: 0 }, ranked = open.slice().sort(function (a, b) { return gains[b.type] * WEIGHT[b.level] / COST[b.effort] - gains[a.type] * WEIGHT[a.level] / COST[a.effort]; });
            list = ranked.filter(function (t) { return per[t.level]++ < 3; }).slice(0, 6);
            if (list.length < 6) list = list.concat(ranked.filter(function (t) { return list.indexOf(t) === -1; })).slice(0, 6);
        }
        else if (set === "quick") list = open.filter(function (t) { return t.effort === "easy"; }).sort(byGain);
        else if (set === "boost") list = open.slice().sort(byGain);
        else {
            var match = function (t) { return /^P\d$/.test(set) ? t.level === set : t.area === set; };
            list = open.filter(match).sort(function (a, b) { return (COST[a.effort] - COST[b.effort]) || byGain(a, b); }).concat(done.filter(match));
        }
        return { list: list, gains: gains };
    }
    function tileHtml(t, g, k) {
        var st = statusOf(t), d = st === "fixed" || st === "confirmed";
        return '<button type="button" class="tile' + (d ? " done" : "") + '" data-open="' + esc(t.type) + '" style="animation-delay:' + (k * 30) + 'ms">' +
            '<span class="t-top"><span class="pill ' + t.level + '">' + LV[t.level] + '</span><span class="eff ' + t.effort + '">' + EFF[t.effort] + "</span><span>" + AREA[t.area] + "</span></span>" +
            '<span class="t-title">' + esc(t.title) + "</span>" +
            '<span class="t-vis">' + esc(t.visitor) + "</span>" +
            '<span class="t-bot">' + (d ? '<span class="t-gain">' + (st === "confirmed" ? "Confirmed live" : "Fixed") + "</span>" : '<span class="t-gain">+' + badge(g) + "<small>points</small></span>") +
            '<span class="t-pages">' + t.pages + " page" + (t.pages === 1 ? "" : "s") + "</span>" + '<span class="t-go">' + (d ? "View" : st === "partial" ? "Continue" : "Fix this") + " →</span></span></button>";
    }
    function renderTiles() {
        var box = $("#tiles"); if (!box) return;
        var r = tileList(), MAX = 9, list = r.list;
        $$(".chip[data-set]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.set === ui.set)); });
        if (!list.length) box.innerHTML = '<div class="empty">' + (ui.set === "rec" || ui.set === "boost" ? "Everything here is fixed. Run a new inspection to confirm it on the live site." : "Nothing open in this group. Pick another one above.") + "</div>";
        else box.innerHTML = list.slice(0, MAX).map(function (t, k) { return tileHtml(t, r.gains[t.type], k); }).join("");
        var more = $("#tiles-more"), extra = list.length - MAX;
        if (more) { more.hidden = ui.set === "rec" ? false : extra <= 0; $("button", more).textContent = ui.set === "rec" ? "See all " + D.types.length + " kinds of problem" : "See all " + list.length + " in the list"; }
    }
    // ---------- the list ----------
    function renderRows() {
        var box = $("#rows"); if (!box) return;
        var f = ui.f, words = f.q.toLowerCase().split(/\s+/).filter(Boolean), gains = {};
        var list = D.types.filter(function (t) {
            var st = statusOf(t);
            gains[t.type] = gainFor(t);
            return (!f.p || t.level === f.p) && (!f.area || t.area === f.area) && (!f.effort || t.effort === f.effort) && (!f.owner || t.owner === f.owner) &&
                (f.status === "all" || (f.status === "open" ? st === "open" || st === "partial" : st === "fixed" || st === "confirmed")) &&
                (!f.types || f.types.indexOf(t.type) !== -1) && (!f.qw || (t.effort === "easy" && t.level !== "P3")) &&
                words.every(function (w) { return t._text.indexOf(w) !== -1; });
        });
        var PO = { P1: 0, P2: 1, P3: 2 }, EO = { easy: 0, medium: 1, hard: 2 };
        var sorts = {
            points: function (a, b) { return gains[b.type] - gains[a.type] || PO[a.level] - PO[b.level]; },
            priority: function (a, b) { return PO[a.level] - PO[b.level] || gains[b.type] - gains[a.type]; },
            pages: function (a, b) { return b.pages - a.pages; },
            easy: function (a, b) { return EO[a.effort] - EO[b.effort] || gains[b.type] - gains[a.type]; },
            az: function (a, b) { return a.title.localeCompare(b.title); },
        };
        list.sort(sorts[f.sort] || sorts.points);
        var issues = list.reduce(function (n, t) { return n + t.ids.length; }, 0);
        $("#count").textContent = "Showing " + list.length + " of " + D.types.length + " kinds of problem (" + issues + " issue" + (issues === 1 ? "" : "s") + ")";
        var pre = [];
        if (f.types) pre.push('<button type="button" class="preset" data-clear="types">Only the problems from the chat ×</button>');
        if (f.qw) pre.push('<button type="button" class="preset" data-clear="qw">Quick wins ×</button>');
        $("#presets").innerHTML = pre.join("");
        if (!list.length) { box.innerHTML = '<div class="empty">Nothing matches. <button class="btn small" type="button" id="reset">Clear the filters</button></div>'; return; }
        box.innerHTML = '<div class="hdr" aria-hidden="true"><span>Problem</span><span>Level</span><span>Area</span><span>Effort</span><span>Points</span><span>Status</span></div>' +
            list.map(function (t) {
                var st = statusOf(t), d = st === "fixed" || st === "confirmed";
                return '<button type="button" class="row" data-open="' + esc(t.type) + '"><span class="r-title"><b>' + esc(t.title) + "</b><small>" + esc(t.owner) + " · " + t.ids.length + " issue" + (t.ids.length === 1 ? "" : "s") + " on " + t.pages + " page" + (t.pages === 1 ? "" : "s") + "</small></span>" +
                    '<span class="r-meta"><span><span class="pill ' + t.level + '">' + LV[t.level] + '</span></span><span class="r-area">' + AREA[t.area] + '</span><span class="r-eff"><span class="eff ' + t.effort + '">' + EFF[t.effort] + "</span></span>" +
                    '<span class="r-gain">' + (d ? "✓" : "+" + badge(gains[t.type])) + '</span><span class="st ' + st + '">' + ST_WORD[st] + "</span></span></button>";
            }).join("");
    }
    // ---------- progress ----------
    function ago(t) { var m = Math.round((Date.now() - t) / 60000); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; var h = Math.round(m / 60); if (h < 24) return h + " h ago"; return Math.round(h / 24) + " d ago"; }
    function renderProgress() {
        var box = $("#progress-body"); if (!box) return;
        var s = siteScore(all, fixedIds()), lv = levelOf(all, fixedIds());
        var nf = fixedIds().filter(function (id) { return byId[id]; }).length, nv = fixedIds().filter(function (id) { return byId[id] && state.fixed[id] === "verified"; }).length;
        var meters = function (rows) { return rows.map(function (r) { return '<div class="meter"><span>' + r[0] + '</span><i><em style="width:' + r[1] + '%"></em><b style="width:' + r[2] + '%"></b></i><span>' + r[3] + "</span></div>"; }).join(""); };
        var areaRows = ["on-page", "technical", "off-page"].map(function (a) { return [AREA[a], start.areas[a], s.areas[a], start.areas[a] + " → " + s.areas[a]]; });
        var lvRows = ["P1", "P2", "P3"].map(function (p) { var tot = lv.total[p], d = tot - lv.open[p]; return [LV[p], 0, tot ? Math.round(100 * d / tot) : 100, d + " of " + tot]; });
        var fixedTypes = D.types.filter(function (t) { return statusOf(t) !== "open"; });
        box.innerHTML =
            '<div class="pgrid"><div class="box stat"><div class="k">Score</div><div class="big">' + s.score + " <small>from " + start.score + "</small></div><p>" + (s.score > start.score ? "+" + (s.score - start.score) + " points since the inspection" : "Fix something to see it climb") + "</p></div>" +
            '<div class="box stat"><div class="k">Issues fixed</div><div class="big">' + nf + " <small>of " + all.length + "</small></div><p>" + (lv.level <= 3 ? lv.open[["", "P1", "P2", "P3"][lv.level]] + " left in " + lv.name.toLowerCase() : "Everything SiteFix checks is fixed") + "</p></div>" +
            '<div class="box stat"><div class="k">Confirmed on the live site</div><div class="big">' + nv + " <small>of " + nf + "</small></div><p>" + (D.api ? "Use Check it now on a fix to confirm it" : "Confirmed at the next inspection") + "</p></div></div>" +
            '<div class="pcols"><div class="box"><div class="k">Areas: at the inspection → now</div>' + meters(areaRows) + '<div class="k" style="margin-top:16px">Levels</div>' + meters(lvRows) + "</div>" +
            '<div class="box"><div class="k">What you fixed</div>' + (fixedTypes.length ? '<ul class="fixedlist">' + fixedTypes.map(function (t) { var st = statusOf(t); return '<li><span class="grow"><button type="button" class="linkbtn" data-open="' + esc(t.type) + '">' + esc(t.title) + '</button></span><span class="st ' + st + '">' + ST_WORD[st] + '</span><button type="button" class="btn small" data-undo="' + esc(t.type) + '">Undo</button></li>'; }).join("") + "</ul>" : '<p class="lede" style="margin:8px 0 0">Nothing yet. Pick a fix on the Fix tab, or from the list.</p>') + "</div></div>" +
            '<div class="sec-h"><h2 class="sec">Messages from SiteFix</h2></div><div class="box" style="padding:16px 18px"><ol class="timeline">' + state.posts.slice().reverse().map(function (p) {
                return '<li><span class="av" aria-hidden="true">S</span><div>' + esc(p.text) + "<small>" + ago(p.at) + (p.action && T[p.action.type] ? ' · <button type="button" class="linkbtn" data-open="' + esc(p.action.type) + '">Open this fix</button>' : "") + "</small></div></li>";
            }).join("") + "</ol></div>";
    }
    // ---------- SiteFix's messages ----------
    function post(text, action) {
        state.posts.push({ at: Date.now(), text: text, action: action || null });
        renderCoach(true);
        if (ui.tab !== "progress") { var d = $('.tab[data-tab="progress"] .new'); if (d) d.hidden = false; }
    }
    function renderCoach(fresh) {
        var p = state.posts[state.posts.length - 1]; if (!p) return;
        var b = $(".bubble"); if (!b) return;
        b.textContent = p.text;
        if (fresh) { b.style.animation = "none"; void b.offsetWidth; b.style.animation = ""; }
        $(".coach-when").textContent = ago(p.at);
        var act = $(".coach-act");
        act.innerHTML = (p.action && T[p.action.type] ? '<button type="button" class="btn small primary" data-open="' + esc(p.action.type) + '">Show me</button>' : "") +
            (state.posts.length > 1 ? '<button type="button" class="linkbtn" data-tab="progress">All ' + state.posts.length + " messages</button>" : "");
    }
    function nextUp(except) {
        var best = null;
        D.types.forEach(function (t) {
            if (isDone(t) || t.type === except) return;
            var g = gainFor(t), k = g * WEIGHT[t.level] / COST[t.effort];
            if (!best || k > best.k) best = { t: t, g: g, k: k };
        });
        return best;
    }
    function suggestNext(except) {
        var n = nextUp(except); if (!n) return;
        post(fill(D.bank.nextUp, { issue: n.t.title, gain: gainText(n.g) }), { type: n.t.type });
    }
    // ---------- marking fixes ----------
    function mark(ids, how, quiet) {
        var before = siteScore(all, fixedIds()), lvBefore = levelOf(all, fixedIds()).level;
        ids.forEach(function (id) { if (how) state.fixed[id] = how === "verified" || state.fixed[id] !== "verified" ? how : "verified"; else delete state.fixed[id]; });
        var r = paint(true);
        var diff = r.s.score - before.score;
        if (how && !quiet) {
            var gain = diff >= 1 ? diff : Math.max(0, Math.min(0.9, Math.round((r.s.exact - before.exact) * 10) / 10)), type = byId[ids[0]] && byId[ids[0]].type, title = T[type] ? T[type].title : "That issue";
            post(fill(how === "verified" ? D.bank.afterVerify : D.bank.afterMark, { issue: title, gain: gainText(gain), score: r.s.score }));
            if (r.lv.level > lvBefore) {
                post(fill(D.bank.levelUp[Math.min(4, r.lv.level)], { score: r.s.score }));
                toast(r.lv.level <= 3 ? "Level up! <b>" + esc(r.lv.name) + "</b> next · score " + r.s.score : "Everything fixed · score <b>" + r.s.score + "</b>", true);
            } else toast(diff >= 1 ? "<b>+" + diff + "</b> points · score " + r.s.score : "Fixed · every bit counts", false);
            setTimeout(function () { suggestNext(type); }, 900);
        } else if (!how && diff < 0) toast("Undone · score " + r.s.score, false);
        save();
    }
    // ---------- "Check it now": the live site is checked again ----------
    function check(type) {
        var t = T[type], ids = t.ids.filter(function (id) { return state.fixed[id] !== "verified"; });
        if (!ids.length) ids = t.ids.slice();
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
            var note;
            if (still.length) note = { text: still.length === ids.length ? "Still there on the live site." : still.length + " of " + ids.length + " still there on the live site.", cls: "bad" };
            else if (unknown.length && !fixedNow.length) note = { text: "Couldn't reach your site just now. Try again in a moment.", cls: "bad" };
            else if (manual.length && !fixedNow.length) note = { text: "This kind is confirmed at the next inspection. Use “I fixed it” for now.", cls: "" };
            else if (fixedNow.length < ids.length) note = { text: fixedNow.length + " of " + ids.length + " confirmed; the rest are checked at the next inspection.", cls: "ok" };
            else note = { text: "Confirmed on your live site.", cls: "ok" };
            ui.note[type] = note;
            if (fixedNow.length) mark(fixedNow, "verified");
            if (still.length) {
                still.forEach(function (id) { if (state.fixed[id] !== "verified") delete state.fixed[id]; });
                paint(false);
                post(fill(D.bank.stillThere, { issue: t.title }), { type: type }); save();
            }
            renderDrawer();
        }, function () { ui.note[type] = { text: "Couldn't reach SiteFix to check. Try again in a moment.", cls: "bad" }; renderDrawer(); });
    }
    // ---------- the fix panel ----------
    var home = {};
    function openDrawer(type, instId) {
        var t = T[type]; if (!t) return;
        if (ui.drawer && ui.drawer !== type) putBack();
        var node = document.getElementById("t-" + type);
        if (node && !home[type]) { home[type] = { parent: node.parentNode, next: node.nextSibling }; $("#dr-detail").appendChild(node); }
        ui.drawer = type;
        $("#dr-vis").textContent = t.visitor;
        $("#dr-face").hidden = !t.visitor;
        renderDrawer();
        $(".scrim").hidden = false; $(".drawer").hidden = false;
        requestAnimationFrame(function () { $(".scrim").classList.add("on"); $(".drawer").classList.add("on"); });
        document.body.style.overflow = "hidden";
        var body = $(".dr-body");
        if (instId) {
            var inst = document.getElementById(instId);
            if (inst) { inst.open = true; setTimeout(function () { inst.scrollIntoView({ block: "center" }); inst.classList.add("flash"); setTimeout(function () { inst.classList.remove("flash"); }, 1700); }, 320); }
        } else body.scrollTop = 0;
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
        putBack(); ui.drawer = null;
        var back = $('[data-open="' + type + '"]'); if (back) back.focus({ preventScroll: true });
    }
    function renderDrawer() {
        var type = ui.drawer; if (!type) return;
        var t = T[type], st = statusOf(t), d = st === "fixed" || st === "confirmed", g = gainFor(t), s = siteScore(all, fixedIds()).score;
        $("#dr-meta").innerHTML = '<span class="pill ' + t.level + '">' + LV[t.level] + '</span><span class="eff ' + t.effort + '">' + EFF[t.effort] + "</span><span>" + AREA[t.area] + " · " + esc(t.owner) + " · " + t.ids.length + " issue" + (t.ids.length === 1 ? "" : "s") + "</span>";
        $("#dr-title").textContent = t.title;
        $("#dr-gain").innerHTML = d ? "<b>✓</b><span>" + ST_WORD[st] + "</span>" : "<b>+" + badge(g) + "</b><span>point" + (badge(g) === "1" ? "" : "s") + " when fixed · your score " + s + " → " + (s + (g >= 0.95 ? Math.round(g) : 0)) + "</span>";
        $("#dr-nudge").textContent = d ? "" : fill(t.nudge, { count: t.ids.length, gain: gainText(g) });
        $("#dr-fix").textContent = d ? "Undo" : st === "partial" ? "I fixed the rest" : "I fixed it";
        $("#dr-fix").className = d ? "btn" : "btn primary";
        var chk = $("#dr-check");
        if (chk) { var busy = ui.note[type] && ui.note[type].busy; chk.disabled = Boolean(busy); chk.textContent = busy ? "Checking…" : "Check it now"; }
        var n = ui.note[type], el = $("#dr-state");
        if (n) { el.textContent = n.text; el.className = "dr-state " + n.cls; } else { el.textContent = st === "partial" ? openOf(t).length + " of " + t.ids.length + " still open" : d ? (st === "confirmed" ? "Confirmed on your live site." : "Marked as fixed." + (D.api ? " Check it now to confirm it on the live site." : "")) : ""; el.className = "dr-state" + (d ? " ok" : ""); }
        var nx = nextUp(type), nb = $("#dr-next");
        nb.hidden = !nx; if (nx) { nb.dataset.open = nx.t.type; nb.textContent = "Next: " + nx.t.title + " →"; }
        $$("input[data-fix]", $("#dr-detail")).forEach(function (cb) { cb.checked = Boolean(state.fixed[cb.dataset.fix]); var m = $('.ist[data-id="' + cb.dataset.fix + '"]'); if (m) m.textContent = state.fixed[cb.dataset.fix] === "verified" ? "Confirmed" : state.fixed[cb.dataset.fix] ? "Fixed" : ""; });
    }
    // ---------- tabs and links from the chat ----------
    function setTab(name, keepScroll) {
        if (!$("#panel-" + name)) return;
        ui.tab = name;
        $$(".tab").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.tab === name)); b.tabIndex = b.dataset.tab === name ? 0 : -1; });
        $$(".panel").forEach(function (p) { p.hidden = p.id !== "panel-" + name; });
        if (name === "progress") { var d = $('.tab[data-tab="progress"] .new'); if (d) d.hidden = true; }
        if (!keepScroll) window.scrollTo(0, 0);
    }
    function resetFilters() { ui.f = { q: "", p: "", area: "", effort: "", owner: "", status: "open", sort: ui.f.sort, types: null, qw: false }; syncControls(); }
    function syncControls() { ["p", "area", "effort", "owner", "status", "sort"].forEach(function (k) { var el = $('#f-' + k); if (el) el.value = ui.f[k]; }); var q = $("#q"); if (q) q.value = ui.f.q; }
    function fromHash(h) {
        if (!h) return;
        if (h === "fix" || h === "issues" || h === "progress") return setTab(h);
        var m = h.match(/^(type|p|qw)=([a-z0-9,-]+)$/i);
        if (!m) { var inst = document.getElementById(h); var sec = inst && inst.closest(".tdetail"); if (sec) openDrawer(sec.dataset.type, h); return; }
        resetFilters(); ui.f.status = "all";
        if (m[1] === "type") ui.f.types = m[2].split(","); else if (m[1] === "p") ui.f.p = m[2].toUpperCase(); else { ui.f.qw = true; ui.f.status = "open"; }
        syncControls(); renderRows(); setTab("issues");
        if (m[1] === "type" && ui.f.types.length === 1 && T[ui.f.types[0]]) openDrawer(ui.f.types[0]);
    }
    function showMore() {
        var s = ui.set; resetFilters();
        if (/^P\d$/.test(s)) ui.f.p = s; else if (AREA[s]) ui.f.area = s; else if (s === "quick") ui.f.effort = "easy";
        ui.f.sort = s === "rec" ? "points" : ui.f.sort;
        syncControls(); renderRows(); setTab("issues");
    }
    // ---------- start ----------
    document.documentElement.classList.remove("nojs");
    // Search looks at the problem's name, what it means, and the pages it is on.
    $$(".tdetail").forEach(function (sec) { var t = T[sec.dataset.type]; if (t) t._text = [t.title, t.visitor, t.owner, ($(".sum", sec) || {}).textContent || ""].concat($$(".inst > summary .u", sec).map(function (u) { return u.textContent; })).join(" ").toLowerCase(); });
    load(function () {
        var firstVisit = !state.visits;
        state.visits = (state.visits || 0) + 1;
        var r = paint(false);
        if (firstVisit) {
            post(r.lv.total.P1 ? fill(D.bank.intro, { site: D.site, score: r.s.score, urgent: r.lv.total.P1, level: r.lv.name }) : fill(D.bank.level[Math.min(4, r.lv.level)], { count: r.lv.level <= 3 ? r.lv.open[["", "P1", "P2", "P3"][r.lv.level]] : 0 }));
            setTimeout(suggestNext, 1200);
        } else if (Date.now() - (state.last || 0) > 30 * 60000) {
            var cur = ["", "P1", "P2", "P3"][r.lv.level];
            post(cur ? fill(D.bank.welcomeBack, { score: r.s.score, left: r.lv.open[cur], level: r.lv.name }) : fill(D.bank.level[4], {}));
        } else renderCoach(false);
        var d = $('.tab[data-tab="progress"] .new'); if (d) d.hidden = true;
        state.last = Date.now();
        save();
        if (location.hash) fromHash(decodeURIComponent(location.hash.slice(1)));
        // When the page is left open, now and then suggest the next fix.
        setInterval(function () { var lp = state.posts[state.posts.length - 1]; if (!document.hidden && !ui.drawer && (!lp || Date.now() - lp.at > 10 * 60000)) suggestNext(); renderCoach(false); }, 60000);
    });
    window.addEventListener("hashchange", function () { fromHash(decodeURIComponent(location.hash.slice(1))); });
    document.addEventListener("click", function (e) {
        var b = e.target.closest("button, .scrim"); if (!b) return;
        if (b.classList.contains("scrim") || b.classList.contains("dr-close")) return closeDrawer();
        if (b.dataset.tab) return setTab(b.dataset.tab);
        if (b.dataset.open) return openDrawer(b.dataset.open);
        if (b.dataset.set) { ui.set = b.dataset.set; renderTiles(); $$(".step").forEach(function (s) { s.setAttribute("aria-pressed", "false"); }); return; }
        if (b.dataset.step) { ui.set = ui.set === b.dataset.step ? "rec" : b.dataset.step; paint(false); var h = $("#choose"); if (h) h.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
        if (b.id === "show-more") return showMore();
        if (b.id === "dr-fix") { var t = T[ui.drawer], undo = isDone(t); mark(undo ? t.ids : openOf(t), undo ? null : "marked"); delete ui.note[ui.drawer]; renderDrawer(); return; }
        if (b.id === "dr-check") return check(ui.drawer);
        if (b.dataset.undo) { delete ui.note[b.dataset.undo]; return mark(T[b.dataset.undo].ids, null); }
        if (b.dataset.clear) { ui.f[b.dataset.clear] = b.dataset.clear === "types" ? null : false; if (!ui.f.types && !ui.f.qw && ui.f.status === "all") ui.f.status = "open"; syncControls(); return renderRows(); }
        if (b.id === "reset") { resetFilters(); return renderRows(); }
        if (b.dataset.print !== undefined) { var ex = b.closest("details"); if (ex) ex.open = false; return window.print(); }
        if (b.classList.contains("copy")) { e.preventDefault(); var done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1200); }; if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, function () { }); }
    });
    document.addEventListener("change", function (e) {
        var cb = e.target.closest("input[data-fix]");
        if (cb) { delete ui.note[ui.drawer]; mark([cb.dataset.fix], cb.checked ? "marked" : null, false); renderDrawer(); return; }
        var sel = e.target.closest("select[data-f]"); if (sel) { ui.f[sel.dataset.f] = sel.value; renderRows(); }
    });
    var q = $("#q"); if (q) q.addEventListener("input", function () { ui.f.q = q.value; renderRows(); });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ui.drawer) closeDrawer();
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
    // Reports made before the coach, or kinds the AI left out: the standard lines.
    for (const t of report.types || []) {
        bank.types[t.type] = { visitor: bank.types[t.type]?.visitor || std.types[t.type].visitor, nudge: bank.types[t.type]?.nudge || std.types[t.type].nudge };
    }
    const live = !standalone && Boolean(links.api);
    const score = siteScore(all, []);
    const lv = levelOf(all, []);
    const ctx = { all, bank, shotSrc, live };

    const menu = [];
    if (!standalone && links.download) menu.push(`<a href="${esc(links.download)}" download>Download this report<small>One file to send to a client</small></a>`);
    if (!standalone && links.pdf) menu.push(`<a href="${esc(links.pdf)}" target="_blank" rel="noopener">Open PDF<small>The full report as a document</small></a>`);
    menu.push(`<button type="button" data-print>Print<small>Every issue, every page</small></button>`);

    // Each kind of problem: its level is that of its most urgent issue.
    const kinds = (report.types || []).filter((t) => t.issues?.length).map((t) => {
        const issues = [...t.issues].sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
        const top = issues[0];
        const pages = new Set(issues.flatMap((i) => (i.foundOn?.length ? i.foundOn : [i.affectedUrl]))).size;
        return { t, top, pages, gain: gainOf(all, [], issues.map((i) => i.id)) };
    }).sort((a, b) => ORDER[a.top.priority] - ORDER[b.top.priority] || EFFORT_ORDER[a.top.effort] - EFFORT_ORDER[b.top.effort] || b.gain - a.gain);

    const owners = [...new Set(kinds.map((k) => k.top.owner).filter(Boolean))].sort();
    const fullHtml = ["P1", "P2", "P3"].map((p, k) => {
        const list = kinds.filter((x) => x.top.priority === p);
        return list.length ? `<h2>Level ${k + 1} · ${["Urgent fixes", "Important fixes", "Polish"][k]}</h2>\n${list.map((x) => typeDetail(x.t, ctx)).join("\n")}` : "";
    }).join("\n");

    const data = {
        runId: run.id || "report",
        site: host.replace(/^www\./, ""),
        api: live ? links.api : null,
        bank: { intro: bank.intro, welcomeBack: bank.welcomeBack, level: bank.level, levelUp: bank.levelUp, afterMark: bank.afterMark, afterVerify: bank.afterVerify, stillThere: bank.stillThere, nextUp: bank.nextUp },
        types: kinds.map(({ t, top, pages }) => ({
            type: t.type, title: t.title, area: areaOf(t.type), effort: EFFORT_WORD[top.effort] ? top.effort : "medium", level: ORDER[top.priority] !== undefined ? top.priority : "P3", owner: top.owner || "",
            visitor: bank.types[t.type].visitor, nudge: bank.types[t.type].nudge, ids: t.issues.map((i) => i.id), pages,
        })),
        issues: all.map((i) => ({ id: i.id, t: i.type, s: i.severity, p: i.priority, n: (i.foundOn || []).length || 1 })),
    };
    const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    const script = `${areaOf.toString()}\n${siteScore.toString()}\n${gainOf.toString()}\n${gainText.toString()}\n${levelOf.toString()}\n${fillMessage.toString()}\n(${liveReport.toString()})(JSON.parse(document.getElementById("sf-data").textContent));`;

    const firstMsg = lv.total.P1 ? fillMessage(bank.intro, { site: host.replace(/^www\./, ""), score: score.score, urgent: lv.total.P1, level: lv.name }) : fillMessage(bank.level[Math.min(4, lv.level)], { count: lv.level <= 3 ? lv.open[["", "P1", "P2", "P3"][lv.level]] : 0 });
    const lede = `Inspected ${esc(fmtDate(run.finishedAt || run.startedAt))} · ${plural(run.pagesCrawled ?? 0, "page")} crawled${run.partial?.reason === "time" ? ` (a share of every section of a larger site: at least ${esc(String(run.partial.pagesFound))} pages found)` : run.capReached ? " (page limit reached, some pages not checked)" : ""}`;
    const areaBar = (a, label) => `<div class="area" data-a="${a}"><span>${label}</span><i><b style="width:${score.areas[a]}%"></b></i><span>${score.areas[a]}</span></div>`;
    const step = (p, k) => `<button type="button" class="step${lv.level === k + 1 ? " cur" : ""}" data-step="${p}" aria-pressed="false"><span class="s-top"><span class="pill ${p}">Level ${k + 1}</span><b>${["Urgent fixes", "Important fixes", "Polish"][k]}</b></span><span class="bar"><b style="width:0"></b></span><span class="s-n">${lv.total[p] ? `0 of ${lv.total[p]} fixed` : "Nothing to fix"}</span></button>`;

    const app = all.length ? `
<div class="app">
<section class="panel" id="panel-fix" role="tabpanel" aria-labelledby="tab-fix">
  <p class="lede">${lede}</p>
  <div class="hero">
    <div class="scorecard" aria-label="Site score">
      <div class="dial">${ring(score.score)}<div class="dial-n"><b>${score.score}</b><span>out of 100</span></div></div>
      <div class="sc-txt">
        <div class="sc-lvl">${lv.level <= 3 ? `Level ${lv.level} of 3` : "All levels done"}</div>
        <div class="sc-name">${esc(lv.name)}</div>
        <div class="sc-up" aria-live="polite"></div>
      </div>
      <div class="sc-areas">
        <div class="areas">${areaBar("on-page", "On-page")}${areaBar("technical", "Technical")}${areaBar("off-page", "Off-page")}</div>
        <p class="area-note">Off-page covers sharing tags and links to other sites; backlinks and reviews aren't measured yet.</p>
      </div>
    </div>
    <div class="side">
      <div class="box coach" aria-live="polite" aria-label="Message from SiteFix">
        <div class="coach-h"><span class="av" aria-hidden="true">S</span><div><b>SiteFix</b><br><span class="coach-when">just now</span></div></div>
        <div class="bubble">${esc(firstMsg)}</div>
        <div class="coach-act"></div>
      </div>
      <div class="box steps" role="group" aria-label="Levels: open any of them">${["P1", "P2", "P3"].map(step).join("")}</div>
    </div>
  </div>
  <div class="sec-h" id="choose"><h2 class="sec">Choose what to fix</h2><span class="aside">Any order you like. Each fix raises your score.</span></div>
  <div class="chips" role="group" aria-label="Show">
    <button type="button" class="chip" data-set="rec" aria-pressed="true">Recommended</button>
    <button type="button" class="chip" data-set="quick" aria-pressed="false">Quick wins</button>
    <button type="button" class="chip" data-set="boost" aria-pressed="false">Biggest boost</button>
    <button type="button" class="chip" data-set="on-page" aria-pressed="false">On-page</button>
    <button type="button" class="chip" data-set="technical" aria-pressed="false">Technical</button>
    <button type="button" class="chip" data-set="off-page" aria-pressed="false">Off-page</button>
  </div>
  <div class="tiles" id="tiles"></div>
  <div class="more-row" id="tiles-more"><button type="button" class="btn" id="show-more">See all</button></div>
</section>
<section class="panel" id="panel-issues" role="tabpanel" aria-labelledby="tab-issues" hidden>
  <div class="sec-h" style="margin-top:0"><h2 class="sec">All issues</h2><span class="aside">Click any problem to fix it.</span></div>
  <div class="toolbar">
    <input type="search" id="q" placeholder="Search problems or pages" aria-label="Search problems or pages">
    <select id="f-p" data-f="p" aria-label="Level"><option value="">All levels</option><option value="P1">Urgent</option><option value="P2">Important</option><option value="P3">Polish</option></select>
    <select id="f-area" data-f="area" aria-label="Area"><option value="">All areas</option><option value="on-page">On-page</option><option value="technical">Technical</option><option value="off-page">Off-page</option></select>
    <select id="f-effort" data-f="effort" aria-label="Effort"><option value="">Any effort</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Bigger job</option></select>
    <select id="f-owner" data-f="owner" aria-label="Who fixes it"><option value="">Anyone</option>${owners.map((o) => `<option>${esc(o)}</option>`).join("")}</select>
    <select id="f-status" data-f="status" aria-label="Status"><option value="open">Still open</option><option value="fixed">Fixed</option><option value="all">Open and fixed</option></select>
    <select id="f-sort" data-f="sort" aria-label="Sort"><option value="points">Most points first</option><option value="priority">Most urgent first</option><option value="easy">Easiest first</option><option value="pages">Most pages first</option><option value="az">A to Z</option></select>
  </div>
  <div class="presets" id="presets"></div>
  <p class="count-line" id="count"></p>
  <div class="rows" id="rows"></div>
</section>
<section class="panel" id="panel-progress" role="tabpanel" aria-labelledby="tab-progress" hidden>
  <div class="sec-h" style="margin-top:0"><h2 class="sec">Your progress</h2></div>
  <div id="progress-body"></div>
</section>
</div>
<div class="print-sum"><p><b>Score ${score.score} / 100</b> · On-page ${score.areas["on-page"]} · Technical ${score.areas.technical} · Off-page ${score.areas["off-page"]} · ${esc(lv.name)}</p><p>${esc(firstMsg)}</p></div>
<div class="full">${fullHtml}</div>
<div class="scrim" hidden></div>
<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title" hidden>
  <div class="dr-head">
    <div class="dr-row"><span id="dr-meta" class="dr-row"></span><button type="button" class="dr-close" aria-label="Close">×</button></div>
    <h2 id="dr-title" tabindex="-1"></h2>
    <div class="dr-gain" id="dr-gain"></div>
  </div>
  <div class="dr-body">
    <div class="face" id="dr-face"><div class="k">What visitors face</div><p id="dr-vis"></p></div>
    <p class="nudge" id="dr-nudge"></p>
    <div id="dr-detail"></div>
  </div>
  <div class="dr-foot">
    <div class="dr-btns"><button type="button" class="btn primary" id="dr-fix">I fixed it</button>${live ? '<button type="button" class="btn" id="dr-check">Check it now</button>' : ""}<button type="button" class="dr-next" id="dr-next" hidden></button></div>
    <div class="dr-state" id="dr-state" aria-live="polite"></div>
  </div>
</aside>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`
        : `<p class="lede">${lede}</p><div class="box clean"><h2 style="margin-top:0">No issues found</h2><p class="lede">None of SiteFix's checks found a problem on the ${plural(run.pagesCrawled ?? 0, "page")} crawled. Your score is 100.</p></div>`;

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
  <div class="brand"><span class="dot" aria-hidden="true"></span><b>SiteFix</b><span class="site">${siteHref ? `<a href="${siteHref}" target="_blank" rel="noopener noreferrer">${esc(site)}</a>` : esc(site)}</span></div>
  ${all.length ? `<nav class="tabs" role="tablist" aria-label="Report">
    <button type="button" class="tab" role="tab" id="tab-fix" data-tab="fix" aria-selected="true" aria-controls="panel-fix">Fix</button>
    <button type="button" class="tab" role="tab" id="tab-issues" data-tab="issues" aria-selected="false" aria-controls="panel-issues" tabindex="-1">All issues <span class="n">${kinds.length}</span></button>
    <button type="button" class="tab" role="tab" id="tab-progress" data-tab="progress" aria-selected="false" aria-controls="panel-progress" tabindex="-1">Progress <span class="new" hidden></span></button>
  </nav>` : ""}
  <details class="export"><summary>Export</summary><div class="menu">${menu.join("")}</div></details>
</div></header>
<main><div class="in">
<h1 class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Website audit: ${esc(site)}</h1>
${app}
<footer><p>The score starts at 100 and loses points for each kind of problem SiteFix measured: more for serious ones and ones on many pages, levelling off so one problem can't sink it. Fixing an issue gives back exactly the points shown. Levels follow priority: urgent (P1), important (P2), polish (P3); fix in any order.</p>
<p>${report.coach?.source === "ai" ? "SiteFix's messages are worded by AI; every issue, number and score in them comes from the measurements. " : ""}${report.ai?.provider && report.ai.provider !== "none" ? "Explanations are written by AI from the evidence the crawler measured, and checked automatically before they are shown. " : "Explanations use SiteFix's guidance for each type of issue. "}Every finding was measured by the crawler; nothing here is guessed. Report generated ${esc(fmtDate(report.generatedAt))}.</p></footer>
</div></main>
${all.length ? `<script type="application/json" id="sf-data">${json}</script>\n<script>${script}</script>` : ""}
</body>
</html>`;
}
