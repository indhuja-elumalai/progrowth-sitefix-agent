import { test } from "node:test";
import assert from "node:assert/strict";
import { triage, triageSummary, hasRule, WIDE_REACH } from "../lib/triage.js";
import { CATALOG } from "../lib/issues.js";
import { TEMPLATES } from "../lib/explain-templates.js";

const issue = (over) => ({ type: "title-too-long", severity: "low", affectedUrl: "https://x.test/a", foundOn: ["https://x.test/"], evidence: { kind: "head" }, ...over });

test("every issue type in the catalog has a triage rule and standard guidance", () => {
    for (const t of Object.keys(CATALOG)) {
        assert.ok(hasRule(t), `no triage rule for ${t}`);
        const g = TEMPLATES[t];
        assert.ok(g && g.title && g.summary && g.why && g.fix.length >= 1, `no complete template for ${t}`);
    }
});

test("priority follows severity: high P1, medium P2, low P3", () => {
    assert.equal(triage(issue({ severity: "high" })).priority, "P1");
    assert.equal(triage(issue({ severity: "medium" })).priority, "P2");
    assert.equal(triage(issue({ severity: "low" })).priority, "P3");
});

test("an issue on 10+ pages goes up one level, and the reason says so", () => {
    const many = Array.from({ length: WIDE_REACH }, (_, i) => `https://x.test/p${i}`);
    const t = triage(issue({ severity: "low", foundOn: many }));
    assert.equal(t.priority, "P2");
    assert.match(t.priorityReason, /on 10 pages/);
    assert.equal(triage(issue({ severity: "high", foundOn: many })).priority, "P1");
});

test("the home page bumps priority when it is the affected page or shows the broken link/image", () => {
    const home = "https://x.test/";
    assert.equal(triage(issue({ affectedUrl: home }), { startUrl: home }).priority, "P2");
    assert.equal(triage(issue({ type: "image-alt-missing", severity: "medium", affectedUrl: "https://x.test/i.png", evidence: { kind: "image" }, foundOn: [home] }), { startUrl: home }).priority, "P1");
});

test("a page that is merely linked from the home page is not bumped", () => {
    assert.equal(triage(issue({ foundOn: ["https://x.test/"] }), { startUrl: "https://x.test/" }).priority, "P3");
});

test("owner, effort and quick wins", () => {
    const t = triage(issue({ type: "title-missing", severity: "high" }));
    assert.deepEqual([t.owner, t.effort, t.quickWin], ["Content writer", "easy", true]);
    assert.deepEqual([triage(issue({ type: "content-duplicate", severity: "medium" })).effort, triage(issue({ type: "content-duplicate", severity: "medium" })).quickWin], ["hard", false]);
    assert.equal(triage(issue({ type: "title-too-long", severity: "low" })).quickWin, false); // P3 is not a "quick win"
});

test("triageSummary counts priorities, efforts, owners and quick wins", () => {
    const items = [{ priority: "P1", effort: "easy", owner: "Developer", quickWin: true }, { priority: "P3", effort: "hard", owner: "Content writer", quickWin: false }];
    const s = triageSummary(items);
    assert.deepEqual(s.byPriority, { P1: 1, P2: 0, P3: 1 });
    assert.deepEqual(s.byEffort, { easy: 1, medium: 0, hard: 1 });
    assert.equal(s.quickWins, 1);
});
