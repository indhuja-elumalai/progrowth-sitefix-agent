// Builds the printable report (HTML, turned into a PDF by report.js). Pure: data in, HTML out.
//
// buildReportHtml({ report, shots }) where
//   report = audit-report/explained.json (run, summary, ai, types[])
//   shots  = Map issueId -> data: URI of the screenshot (optional)

export const MAX_INSTANCES_IN_PDF = 25; // per issue type; the rest are counted

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PRIORITY_NAME = { P1: "Fix first", P2: "Fix soon", P3: "When you can" };
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }); } catch { return iso || ""; } };

const chip = (cls, text) => `<span class="chip ${cls}">${esc(text)}</span>`;

export function evidenceFacts(ev = {}) {
    const rows = [];
    const add = (k, v) => { if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) rows.push([k, Array.isArray(v) ? v.join(", ") : String(v)]); };
    if (ev.kind === "http") add("HTTP status", ev.status ?? ev.error);
    if (ev.kind === "redirect") { add("Redirect chain", (ev.chain || []).join(" → ")); add("Ends with status", ev.finalStatus); }
    if (ev.kind === "image") { add("Image", ev.src); add("Status", ev.status); add("Size", ev.bytes ? `${Math.round(ev.bytes / 1024)} KB` : null); add("Alt text", Array.isArray(ev.alt) ? ev.alt.join(" | ") : ev.alt === null ? "none" : undefined); }
    if (ev.kind === "head" && ev.head) { add("Title", ev.head.title); add("Meta description", ev.head.description); add("H1", ev.head.h1s); add("Canonical", ev.head.canonicals); }
    if (ev.kind === "soft-404") add("Signals", (ev.signals || []).map((s) => s.detail));
    if (ev.kind === "content") {
        add("Words on page", ev.words);
        add("Similar to", (ev.similarTo || []).map((s) => `${s.url} (${Math.round(s.similarity * 100)}%)`));
        if ((ev.matches || []).some((m) => m.correction)) for (const [n, m] of (ev.matches || []).slice(0, 4).entries()) add(n ? "" : "Corrections", `"${m.text}" → "${m.correction}"${m.alsoOn?.length ? ` (also on ${m.alsoOn.length} other page${m.alsoOn.length === 1 ? "" : "s"})` : ""}`);
        else add("Found text", (ev.matches || []).map((m) => m.text));
    }
    if (ev.kind === "site-check") add("Detail", ev.detail);
    if (ev.kind === "speed") {
        const s = (ms) => (ms == null ? null : `${(ms / 1000).toFixed(1)} s`);
        const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
        const rows = {
            lcp: () => add("Main content (LCP)", ev.lcpMs == null ? null : `${s(ev.lcpMs)}${ev.lcpElement ? `: ${ev.lcpElement}` : ""}`),
            cls: () => add("Layout shift (CLS)", ev.cls == null ? null : `${ev.cls}${ev.shifts?.[0]?.el ? `: ${ev.shifts[0].el} moves most` : ""}`),
            tbt: () => add("Blocking time (TBT)", ev.tbtMs == null ? null : `${Math.round(ev.tbtMs)} ms`),
            ttfb: () => add("Server response (TTFB)", s(ev.ttfbMs)),
            bytes: () => add("Page weight", ev.bytes == null ? null : `${kb(ev.bytes)} in ${ev.requests} files`),
        };
        // The metric of this issue first (with the largest files when they are the cause), then the others.
        (rows[ev.metric] || (() => { }))();
        if (ev.metric === "bytes" || ev.metric === "tbt") add("Largest files", (ev.biggest || []).filter((f) => ev.metric !== "tbt" || f.type === "script").slice(0, 3).map((f) => `${f.url.split("/").pop().split("?")[0] || f.url} (${kb(f.bytes)})`));
        for (const [k, f] of Object.entries(rows)) if (k !== ev.metric) f();
    }
    return rows.slice(0, 5).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v.length > 300 ? `${v.slice(0, 300)}…` : v)}</td></tr>`).join("");
}

function instanceCard(i, valueLabel, shots) {
    const shot = shots?.get(i.id);
    const foundOn = (i.foundOn || []);
    return `<div class="inst">
  <div class="inst-head">${chip(`p ${i.priority}`, i.priority)}<span class="url">${esc(i.affectedUrl)}</span></div>
  <p class="expl">${esc(i.explanation)}</p>
  ${i.suggestedValue ? `<div class="value"><div class="value-k">${esc(valueLabel || "Suggested value")}</div><div class="value-v">${esc(i.suggestedValue)}</div></div>` : ""}
  ${evidenceFacts(i.evidence) ? `<table class="facts">${evidenceFacts(i.evidence)}</table>` : ""}
  ${foundOn.length ? `<div class="found">${["image", "http", "redirect"].includes(i.evidence?.kind) ? "Found on" : "Linked from"} ${foundOn.length} page${foundOn.length === 1 ? "" : "s"}: ${foundOn.slice(0, 3).map(esc).join(", ")}${foundOn.length > 3 ? ` (+${foundOn.length - 3} more)` : ""}</div>` : ""}
  ${shot ? `<figure><img src="${shot}" alt=""><figcaption>Screenshot${["soft-404", "content-thin", "content-duplicate"].includes(i.type) ? ": the whole page is the problem" : ", with the problem outlined in red"}</figcaption></figure>` : ""}
</div>`;
}

function typeSection(t, shots) {
    const shown = t.issues.slice(0, MAX_INSTANCES_IN_PDF);
    const rest = t.issues.length - shown.length;
    const first = t.issues[0];
    return `<section class="type">
  <div class="type-head">
    <h2>${esc(t.title)}</h2>
    <div class="type-meta">${chip("cat", t.category)}${chip(`p ${first.priority}`, `${first.priority} · ${PRIORITY_NAME[first.priority]}`)}${chip("eff", `Effort: ${first.effort}`)}${chip("own", first.owner)}${chip("count", `${t.issues.length} found`)}</div>
  </div>
  <p class="summary">${esc(t.summary)}</p>
  ${t.why ? `<p class="why"><b>Why it matters:</b> ${esc(t.why)}</p>` : ""}
  <div class="fix"><div class="fix-k">How to fix</div><ol>${t.fixSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>
  ${shown.map((i) => instanceCard(i, t.valueLabel, shots)).join("")}
  ${rest > 0 ? `<p class="more">… and ${rest} more of this type, listed in issues.json.</p>` : ""}
</section>`;
}

export function buildReportHtml({ report, shots = new Map() }) {
    const s = report.summary;
    const allIssues = report.types.flatMap((t) => t.issues.map((i) => ({ ...i, title: t.title })));
    const cats = {};
    for (const i of allIssues) {
        cats[i.category] ||= { total: 0, P1: 0, P2: 0, P3: 0 };
        cats[i.category].total++; cats[i.category][i.priority]++;
    }
    const order = { P1: 0, P2: 1, P3: 2 };
    const effortOrder = { easy: 0, medium: 1, hard: 2 };
    const first = [...allIssues].sort((a, b) => order[a.priority] - order[b.priority] || effortOrder[a.effort] - effortOrder[b.effort]).slice(0, 8);
    const ai = report.ai || {};
    const aiLine = ai.provider && ai.provider !== "none"
        ? "Explanations are written by AI from the evidence the crawler measured, and checked automatically before they are shown."
        : "Explanations use SiteFix's guidance for each type of issue.";

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SiteFix report: ${esc(report.run?.startUrl)}</title>
<style>
@page{size:A4;margin:16mm 14mm}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;font-size:10.5pt;line-height:1.45;margin:0}
h1{font-size:22pt;margin:0 0 4pt;letter-spacing:-.02em;word-break:break-all}
h2{font-size:14pt;margin:0}
.brand{display:flex;align-items:center;gap:8pt;font-weight:700;font-size:12pt;margin-bottom:18pt}
.dot{width:16pt;height:16pt;border-radius:50%;background:#b8ff00;display:inline-block}
.muted{color:#6e6e73}
.cover{page-break-after:always}
.kpis{display:flex;gap:8pt;margin:14pt 0}
.kpi{flex:1;border:1px solid #e5e5ea;border-radius:10pt;padding:10pt 12pt}
.kpi b{display:block;font-size:20pt;letter-spacing:-.02em}
.kpi.P1 b{color:#d70015}.kpi.P2 b{color:#b25000}.kpi.P3 b{color:#0066cc}
table{border-collapse:collapse;width:100%}
.cats th,.cats td{text-align:left;padding:3pt 6pt;border-bottom:1px solid #e5e5ea}
.cats th{font-size:9pt;color:#6e6e73;font-weight:600}
.first{margin:4pt 0 0 14pt;padding:0}.first li{margin-bottom:2pt;font-size:9.5pt}
.note{margin-top:18pt;font-size:9pt;color:#6e6e73;border-top:1px solid #e5e5ea;padding-top:8pt}
.type{page-break-before:always}
.type-head{border-bottom:2px solid #b8ff00;padding-bottom:6pt;margin-bottom:8pt}
.type-meta{margin-top:5pt}
.chip{display:inline-block;font-size:8pt;font-weight:600;padding:1pt 6pt;border-radius:20pt;background:#f2f2f7;color:#515154;margin:0 3pt 3pt 0}
.chip.p.P1{background:#fde7e9;color:#d70015}.chip.p.P2{background:#fff1e0;color:#b25000}.chip.p.P3{background:#e6f0fb;color:#0066cc}
.summary{font-size:11pt;margin:6pt 0}
.why{margin:4pt 0 8pt}
.fix{background:#f5f5f7;border-radius:8pt;padding:8pt 12pt;margin-bottom:10pt}
.fix-k,.value-k{font-size:8.5pt;font-weight:700;color:#6e6e73;text-transform:uppercase;letter-spacing:.04em}
.fix ol{margin:4pt 0 0 14pt;padding:0}
.inst{border:1px solid #e5e5ea;border-radius:8pt;padding:8pt 10pt;margin-bottom:8pt;page-break-inside:avoid}
.inst-head{display:flex;align-items:center;gap:6pt}
.url{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:8.5pt;color:#515154;word-break:break-all}
.expl{margin:5pt 0}
.value{border-left:3px solid #b8ff00;background:#fafff0;padding:5pt 8pt;margin:5pt 0}
.value-v{font-weight:600}
.facts th{text-align:left;font-weight:600;color:#6e6e73;font-size:8.5pt;width:110pt;vertical-align:top;padding:2pt 6pt 2pt 0}
.facts td{font-size:8.5pt;padding:2pt 0;word-break:break-word}
.found{font-size:8.5pt;color:#6e6e73;margin-top:4pt;word-break:break-all}
figure{margin:6pt 0 0}
figure img{width:72%;max-height:85mm;object-fit:contain;object-position:top left;border:1px solid #e5e5ea;border-radius:6pt}
figcaption{font-size:8pt;color:#6e6e73;margin-top:2pt}
.more{color:#6e6e73;font-style:italic}
</style></head><body>
<div class="cover">
  <div class="brand"><span class="dot"></span>SiteFix website audit</div>
  <h1>${esc(report.run?.startUrl)}</h1>
  <div class="muted">Inspected ${esc(fmtDate(report.run?.finishedAt || report.run?.startedAt))} · ${esc(report.run?.pagesCrawled ?? "?")} pages crawled · report generated ${esc(fmtDate(report.generatedAt))}</div>
  <div class="kpis">
    <div class="kpi"><b>${allIssues.length}</b>issues</div>
    <div class="kpi P1"><b>${s.byPriority.P1}</b>P1 · fix first</div>
    <div class="kpi P2"><b>${s.byPriority.P2}</b>P2 · fix soon</div>
    <div class="kpi P3"><b>${s.byPriority.P3}</b>P3 · when you can</div>
    <div class="kpi"><b>${s.quickWins}</b>quick wins</div>
  </div>
  <h2>Issues by category</h2>
  <table class="cats"><tr><th>Category</th><th>Issues</th><th>P1</th><th>P2</th><th>P3</th></tr>
  ${Object.entries(cats).sort((a, b) => b[1].P1 - a[1].P1 || b[1].total - a[1].total).map(([c, v]) => `<tr><td>${esc(c)}</td><td>${v.total}</td><td>${v.P1}</td><td>${v.P2}</td><td>${v.P3}</td></tr>`).join("")}
  </table>
  <h2 style="margin-top:16pt">Fix these first</h2>
  <ol class="first">${first.map((i) => `<li><b>${esc(i.title)}</b> (${i.priority}, ${esc(i.effort)} fix, ${esc(i.owner)}): <span class="url">${esc(i.affectedUrl)}</span></li>`).join("")}</ol>
  <p class="note">Priority: P1 fix first, P2 fix soon, P3 when you can (severity, raised when an issue reaches 10+ pages or the home page). Effort is the usual size of the fix. ${aiLine} Every finding is measured by the crawler; nothing in this report is guessed.</p>
</div>
${report.types.map((t) => typeSection(t, shots)).join("\n")}
</body></html>`;
}
