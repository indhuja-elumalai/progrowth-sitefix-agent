import { test } from "node:test";
import assert from "node:assert/strict";
import { siteScore, gainOf, gainText, levelOf, areaOf } from "../lib/score.js";

const i = (id, type, severity, priority, pages = 1) => ({ id, type, severity, priority, pages });

test("areas: sharing tags and outside links are off-page, page content is on-page, the rest technical", () => {
    assert.equal(areaOf("og-missing"), "off-page");
    assert.equal(areaOf("http-4xx-external"), "off-page");
    for (const t of ["title-missing", "description-too-long", "h1-multiple", "heading-skip", "content-thin", "copy-spelling", "image-alt-missing"]) assert.equal(areaOf(t), "on-page", t);
    for (const t of ["http-4xx-internal", "redirect-chain", "robots-noindex", "speed-lcp-slow", "image-broken", "viewport-missing", "canonical-missing"]) assert.equal(areaOf(t), "technical", t);
});

test("a site with no issues scores 100, and the score never reaches 0", () => {
    assert.deepEqual(siteScore([], []).areas, { "on-page": 100, technical: 100, "off-page": 100 });
    assert.equal(siteScore([], []).score, 100);
    const kinds = ["title-x", "og-x", "speed-x"];
    const awful = Array.from({ length: 90 }, (_, k) => i(`ISS-${k}`, `${kinds[k % 3]}${k}`, "high", "P1", 200));
    const s = siteScore(awful, []);
    assert.ok(s.score > 0 && s.score < 30, `got ${s.score}`);
    assert.ok(Object.values(s.areas).every((a) => a > 0));
});

test("serious problems and problems on many pages cost more; one kind can't sink the score", () => {
    const one = (sev, pages) => 100 - siteScore([i("a", "x", sev, "P1", pages)], []).exact;
    assert.ok(one("high", 1) > one("medium", 1) && one("medium", 1) > one("low", 1));
    assert.ok(one("high", 50) > one("high", 1));
    const many = Array.from({ length: 170 }, (_, k) => i(`ISS-${k}`, "image-alt-missing", "medium", "P2"));
    assert.ok(siteScore(many, []).areas["on-page"] >= 90, "170 of one medium problem costs at most its cap");
});

test("the same issues always give the same score, in any order", () => {
    const list = [i("a", "title-missing", "high", "P1", 3), i("b", "og-missing", "low", "P3"), i("c", "speed-lcp-slow", "medium", "P2", 12)];
    assert.deepEqual(siteScore(list, []), siteScore([...list].reverse(), []));
});

test("fixing raises the score by exactly the points gainOf promised", () => {
    const list = [i("a", "title-missing", "high", "P1", 3), i("b", "title-missing", "high", "P1", 1), i("c", "og-missing", "low", "P3"), i("d", "http-4xx-internal", "high", "P1", 20)];
    for (const ids of [["a"], ["a", "b"], ["d"], ["c"], ["a", "b", "c", "d"]]) {
        const g = gainOf(list, [], ids);
        const moved = siteScore(list, ids).score - siteScore(list, []).score;
        if (g >= 1) assert.equal(g, moved, ids.join());
        else assert.ok(moved === 0 && g > 0 && g < 1, `${ids}: ${g}`);
    }
    assert.equal(siteScore(list, ["a", "b", "c", "d"]).score, 100);
    assert.equal(gainOf(list, ["a", "b", "c", "d"], ["a"]), 0, "nothing left to gain");
    assert.equal(gainText(3), "3");
    assert.equal(gainText(0.4), "less than 1");
});

test("levels follow priority: urgent while P1 is open, then important, then polish, then done", () => {
    const list = [i("a", "x", "high", "P1"), i("b", "y", "medium", "P2"), i("c", "z", "low", "P3")];
    assert.deepEqual([[], ["a"], ["a", "b"], ["a", "b", "c"]].map((f) => levelOf(list, f).level), [1, 2, 3, 4]);
    assert.equal(levelOf(list, []).name, "Urgent fixes");
    assert.deepEqual(levelOf(list, ["b"]).open, { P1: 1, P2: 0, P3: 1 });
    assert.equal(levelOf([], []).name, "Top shape");
});

test("the score functions are self-contained, so the web report can copy them into the page", () => {
    const src = [areaOf, siteScore, gainOf, gainText, levelOf].map((f) => f.toString()).join("\n");
    const fns = new Function(`${src}\nreturn { siteScore, gainOf, levelOf };`)();
    const list = [i("a", "title-missing", "high", "P1", 3), i("b", "og-missing", "low", "P3")];
    assert.deepEqual(fns.siteScore(list, ["b"]), siteScore(list, ["b"]));
    assert.equal(fns.gainOf(list, [], ["a"]), gainOf(list, [], ["a"]));
});

test("only broken links, images and redirects count the pages they were found on", () => {
    const linking = Array.from({ length: 40 }, (_, k) => `https://e.com/${k}`);
    const page = siteScore([{ id: "a", type: "copy-spelling", severity: "medium", foundOn: linking, evidence: { kind: "content" } }], []);
    const one = siteScore([{ id: "a", type: "copy-spelling", severity: "medium", foundOn: [], evidence: { kind: "content" } }], []);
    assert.deepEqual(page, one, "pages that link to a misspelt page don't make the mistake bigger");
    const link = siteScore([{ id: "b", type: "http-4xx-internal", severity: "high", foundOn: linking, evidence: { kind: "http" } }], []);
    const linkOnce = siteScore([{ id: "b", type: "http-4xx-internal", severity: "high", foundOn: linking.slice(0, 1), evidence: { kind: "http" } }], []);
    assert.ok(link.exact < linkOnce.exact, "a broken link on 40 pages costs more than on one");
});
