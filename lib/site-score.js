// The site's score for the chat: the same numbers the live report shows (lib/score.js),
// with what the client has done there: fixes confirmed on the live site and pages kept
// as they are count in today's score; the selected fixes give the score to aim for.
//
// scoreSummary(report, progress) -> {
//   id, score, exact, band, areas, withSelected, selectedPoints, selected, verified, kept,
//   total, open, next: [{ type, title, points, count, priority }]  (biggest gains first)
// }
// pathTo(summary, target) -> { reached, from, to, steps: next[] that get there, points }
// answerScoreQuestion(question, report, progress) -> { answer, issueIds: [], source: "score" } or null
//   "what's my score", "how is my site doing", "how do I get to 80", "what would get me to 90?"

import { pointsOf, projected, fmtPoints } from "./score.js";
import { bandOf } from "./web-report.js";

const AREA = { "on-page": "On-page", technical: "Technical", "off-page": "Off-page" };

export function scoreSummary(report, progress) {
    const types = report?.types || [];
    const issues = types.flatMap((t) => t.issues || []);
    const has = new Set(issues.map((i) => i.id));
    const pr = progress || {};
    const verified = Object.keys(pr.verified || {}).filter((id) => has.has(id));
    const v = new Set(verified);
    const kept = Object.keys(pr.kept || {}).filter((id) => has.has(id) && !v.has(id));
    const k = new Set(kept);
    const selected = Object.keys(pr.selected || {}).filter((id) => pr.selected[id] && has.has(id) && !v.has(id) && !k.has(id));
    const P = pointsOf(issues, verified);
    const now = projected(P, kept), sel = projected(P, kept.concat(selected));
    const next = types.map((t) => {
        const open = (t.issues || []).filter((i) => !v.has(i.id) && !k.has(i.id));
        const points = open.reduce((n, i) => n + (P.perIssue[i.id]?.points || 0), 0);
        return { type: t.type, title: t.title || t.type, points, count: open.length, priority: open[0]?.priority || null, area: P.types[t.type]?.area || null };
    }).filter((t) => t.count && t.points > 0).sort((a, b) => b.points - a.points);
    return {
        id: report?.run?.id || null,
        score: now.score, exact: now.exact, band: bandOf(now.score).name, areas: now.areas,
        withSelected: sel.score, selectedPoints: Math.max(0, sel.exact - now.exact),
        selected: selected.length, verified: verified.length, kept: kept.length,
        total: issues.length, open: issues.length - verified.length - kept.length,
        next,
    };
}

// The fewest kinds of problem, biggest first, that take the score shown to the target.
export function pathTo(summary, target) {
    const from = summary.score;
    if (from >= target) return { reached: true, from, to: target, steps: [], points: 0 };
    const steps = [];
    let points = 0;
    for (const t of summary.next) {
        if (Math.round(summary.exact + points) >= target) break;
        steps.push(t);
        points += t.points;
    }
    return { reached: false, from, to: target, steps, points, possible: Math.round(summary.exact + points) >= target };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const line = (t) => `- **${t.title}**: +${fmtPoints(t.points)} point${fmtPoints(t.points) === "1" ? "" : "s"}${t.count > 1 ? ` (${t.count} found)` : ""}`;

export function answerScoreQuestion(question, report, progress) {
    const q = String(question || "").toLowerCase();
    if (!report?.types) return null;
    const goal = q.match(/\b(?:get|reach|hit|go|climb|raise|improve|bring|push|make)\b[^?]*?\b(\d{2,3})\b/) || q.match(/\bscore\b[^?]*?\bto\s+(\d{2,3})\b/) || q.match(/\b(\d{2,3})\s*(?:points?|score)\b[^?]*\bhow\b/);
    const asksScore = /\bscore\b|\bhow (good|bad|well) is (my|the|this) (site|website)\b|\bhow is (my|the|this) (site|website) doing\b|\b(my|the) (rating|grade)\b/.test(q);
    if (!goal && !asksScore) return null;
    const s = scoreSummary(report, progress);
    const areas = Object.keys(AREA).map((a) => `${AREA[a]} ${s.areas[a]}`).join(" · ");
    const done = [s.verified ? `${plural(s.verified, "fix")} confirmed on your site`.replace("fixs", "fixes") : "", s.kept ? `${s.kept} kept as is` : ""].filter(Boolean).join(", ");
    const head = `Your score today is **${s.score}** (${s.band})${done ? `, counting ${done}` : ""}. ${areas}.`;
    if (goal) {
        const target = Number(goal[1]);
        if (!(target > 0 && target <= 100)) return null;
        const p = pathTo(s, target);
        if (p.reached) return { answer: `${head}\nYou're already at ${target} or above.${s.next.length ? ` The next biggest gain is ${s.next[0].title} (+${fmtPoints(s.next[0].points)}).` : ""}`, issueIds: [], source: "score" };
        const lines = p.steps.slice(0, 8).map(line).join("\n");
        const more = p.steps.length > 8 ? `\n- and ${p.steps.length - 8} more kinds of problem` : "";
        return {
            answer: `${head}\nTo reach **${target}**, fix ${p.steps.length === 1 ? "this" : `these ${p.steps.length} kinds of problem`}, biggest gain first (+${fmtPoints(p.points)} in all):\n${lines}${more}\nIn the report, tick them on the Fix tab to see your score climb before you change anything.`,
            issueIds: [], source: "score",
        };
    }
    const sel = s.selected ? `\nWith the ${plural(s.selected, "fix").replace("fixs", "fixes")} you selected it would be **${s.withSelected}**.` : "";
    const top = s.next.slice(0, 3);
    const gains = top.length ? `\nThe biggest gains:\n${top.map(line).join("\n")}` : "\nNothing is left to fix.";
    return { answer: head + sel + gains, issueIds: [], source: "score" };
}
