import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHead } from "../lib/head.js";
import { pageSetupIssues } from "../lib/page-setup.js";

const types = (html) => pageSetupIssues(extractHead(html)).map((i) => i.type);

test("viewport and lang present: no issues", () => {
    assert.deepEqual(types('<html lang="en"><head><meta name="viewport" content="width=device-width"></head></html>'), []);
});

test("no viewport tag", () => {
    assert.deepEqual(types('<html lang="en"><head><title>T</title></head></html>'), ["viewport-missing"]);
});

test("no lang attribute, or an empty one", () => {
    assert.deepEqual(types('<html><head><meta name="viewport" content="width=device-width"></head></html>'), ["lang-missing"]);
    assert.deepEqual(types('<html lang=""><head><meta name="viewport" content="width=device-width"></head></html>'), ["lang-missing"]);
});

test("both missing", () => {
    assert.deepEqual(types("<html><head></head></html>"), ["viewport-missing", "lang-missing"]);
});
