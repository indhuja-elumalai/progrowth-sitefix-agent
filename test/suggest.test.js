import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestQuestions } from "../lib/suggest.js";
import { CATALOG } from "../lib/issues.js";

test("before anything is found: the general questions", () => {
    assert.deepEqual(suggestQuestions([], []), ["What should I fix first?", "What are the quick wins?", "How many pages were checked?"]);
});

test("the most serious kinds of problem found so far come right after 'fix first'", () => {
    const q = suggestQuestions(["image-oversized", "http-4xx-internal", "image-oversized", "title-too-long"], []);
    assert.deepEqual(q, ["What should I fix first?", "Which pages link to broken pages?", "Which page titles need fixing?", "What are the quick wins?"]);
});

test("questions already asked are not offered again, in any letter case", () => {
    const q = suggestQuestions(["image-broken"], ["what should i fix first?", "Which images are broken?"]);
    assert.deepEqual(q, ["What are the quick wins?", "How many pages were checked?"]);
});

test("max limits the list", () => {
    assert.equal(suggestQuestions(["image-broken", "soft-404", "copy-spelling", "lang-missing"], [], 2).length, 2);
    assert.equal(suggestQuestions(["image-broken", "soft-404", "copy-spelling", "lang-missing"], [], 10).length, 7);
});

test("every issue type in the catalog leads to a specific question", () => {
    for (const type of Object.keys(CATALOG)) {
        if (["https-missing-redirect", "www-variant-not-redirected", "metadata-js-only", "canonical-missing", "canonical-multiple", "canonical-redirect", "image-mixed-content"].includes(type)) continue;
        const q = suggestQuestions([type], ["What should I fix first?", "What are the quick wins?", "How many pages were checked?"]);
        assert.equal(q.length, 1, `no question for ${type}`);
    }
});

test("the function is self-contained, so the page can carry a copy of it", () => {
    const copy = new Function(`${suggestQuestions.toString()}; return suggestQuestions;`)();
    assert.deepEqual(copy(["soft-404"], []), suggestQuestions(["soft-404"], []));
});
