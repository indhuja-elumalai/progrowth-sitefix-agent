import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreSummary, pathTo, answerScoreQuestion } from "../lib/site-score.js";
import { siteScore, pointsOf, projected } from "../lib/score.js";

// A small report: a few kinds of problem in each area.
const issue = (id, type, severity, priority = "P2") => ({ id: `ISS-${String(id).padStart(10, "0")}`, type, severity, priority });
const report = {
    run: { id: "run-20261030T100000" },
    types: [
        { type: "http-4xx-internal", title: "Broken link to your own page", issues: [issue(1, "http-4xx-internal", "high", "P1"), issue(2, "http-4xx-internal", "high", "P1")] },
        { type: "title-missing", title: "Page has no title", issues: [issue(3, "title-missing", "high", "P1")] },
        { type: "description-missing", title: "No meta description", issues: [issue(4, "description-missing", "medium"), issue(5, "description-missing", "medium")] },
        { type: "og-missing", title: "No sharing tags", issues: [issue(6, "og-missing", "low", "P3")] },
        { type: "image-alt-missing", title: "Image has no alt text", issues: [issue(7, "image-alt-missing", "low", "P3")] },
    ],
};
const all = report.types.flatMap((t) => t.issues);
const ID = (n) => `ISS-${String(n).padStart(10, "0")}`;

test("the score is the report's score: the same functions, nothing fixed yet", () => {
    const s = scoreSummary(report, null);
    assert.equal(s.score, siteScore(all, []).score);
    assert.equal(s.total, 7);
    assert.equal(s.open, 7);
    assert.equal(s.withSelected, s.score);
    assert.ok(["Needs work", "Fair", "Good", "Excellent"].includes(s.band));
    // Biggest gain first, and fixing everything gets to 100.
    for (let i = 1; i < s.next.length; i++) assert.ok(s.next[i - 1].points >= s.next[i].points);
    assert.equal(Math.round(s.exact + s.next.reduce((n, t) => n + t.points, 0)), 100);
});

test("confirmed fixes and kept pages count today, selected ones give the score to aim for", () => {
    const progress = { verified: { [ID(3)]: 1 }, kept: { [ID(7)]: 1 }, selected: { [ID(1)]: true, [ID(2)]: true, [ID(3)]: true } };
    const s = scoreSummary(report, progress);
    const P = pointsOf(all, [ID(3)]);
    assert.equal(s.score, projected(P, [ID(7)]).score);
    assert.equal(s.withSelected, projected(P, [ID(7), ID(1), ID(2)]).score);
    assert.equal(s.verified, 1);
    assert.equal(s.kept, 1);
    assert.equal(s.selected, 2); // the confirmed one is not counted again
    assert.equal(s.open, 5);
    assert.ok(!s.next.some((t) => t.type === "title-missing" || t.type === "image-alt-missing"));
});

test("pathTo: the fewest kinds of problem, biggest first, that reach the target", () => {
    const s = scoreSummary(report, null);
    const p = pathTo(s, Math.min(100, s.score + 5));
    assert.equal(p.reached, false);
    assert.ok(p.steps.length >= 1);
    assert.ok(Math.round(s.exact + p.points) >= s.score + 5);
    const less = p.points - p.steps[p.steps.length - 1].points;
    assert.ok(Math.round(s.exact + less) < s.score + 5); // one fewer would not be enough
    assert.equal(pathTo(s, s.score).reached, true);
});

test("score questions get exact answers; other questions are left to the chat", () => {
    const s = scoreSummary(report, null);
    const a = answerScoreQuestion("What's my score?", report, null);
    assert.equal(a.source, "score");
    assert.match(a.answer, new RegExp(`Your score today is \\*\\*${s.score}\\*\\*`));
    assert.match(a.answer, /The biggest gains:/);
    const g = answerScoreQuestion(`how do I get to ${s.score + 5}?`, report, null);
    assert.match(g.answer, new RegExp(`To reach \\*\\*${s.score + 5}\\*\\*`));
    assert.match(answerScoreQuestion("how is my site doing", report, null).answer, /Your score today/);
    assert.match(answerScoreQuestion(`could I reach ${s.score}`, report, null).answer, /already at/);
    for (const q of ["which images are broken?", "what should I fix first?", "how long did it take", "get me 3 quick wins"]) assert.equal(answerScoreQuestion(q, report, null), null, q);
    assert.equal(answerScoreQuestion("what's my score", null, null), null);
    assert.equal(answerScoreQuestion("get my score to 500", report, null), null);
});
