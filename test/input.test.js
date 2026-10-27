import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyInput as c } from "../lib/input.js";

test("one website, typed in any usual way, is inspected", () => {
    assert.deepEqual(c("progrowth.services"), { kind: "url", url: "https://progrowth.services/" });
    assert.deepEqual(c("  https://www.progrowth.services/blog  "), { kind: "url", url: "https://www.progrowth.services/blog" });
    assert.deepEqual(c("localhost:4000"), { kind: "url", url: "http://localhost:4000/" });
    assert.deepEqual(c("check progrowth.services please"), { kind: "url", url: "https://progrowth.services/" });
    assert.deepEqual(c("Inspect example.co.uk."), { kind: "url", url: "https://example.co.uk/" });
});

test("several websites: all of them are listed so the person can pick, without repeats", () => {
    assert.deepEqual(c("site1.com site2.com"), { kind: "urls", urls: ["https://site1.com/", "https://site2.com/"] });
    assert.deepEqual(c("check a.com, b.org and a.com"), { kind: "urls", urls: ["https://a.com/", "https://b.org/"] });
});

test("almost an address gets a suggestion", () => {
    assert.deepEqual(c("progrowthservices"), { kind: "near-url", suggestion: "https://progrowth.services/" });
    assert.deepEqual(c("progrowth .services"), { kind: "near-url", suggestion: "https://progrowth.services/" });
    assert.deepEqual(c("www. example . com"), { kind: "near-url", suggestion: "https://www.example.com/" });
});

test("addresses that aren't websites are named", () => {
    assert.deepEqual(c("info@progrowth.services"), { kind: "not-web", what: "an email address" });
    assert.deepEqual(c("ftp://files.example.com"), { kind: "not-web", what: "ftp: address" });
});

test("questions stay questions, even when they mention a site", () => {
    for (const q of ["Which images are broken?", "What should I fix first?", "is progrowth.services fast?", "how many pages were checked", "hello", "why is it slow"]) assert.equal(c(q).kind, "question", q);
});

test("the function is self-contained, so the page can carry a copy of it", () => {
    const copy = new Function(`${c.toString()}; return classifyInput;`)();
    assert.deepEqual(copy("a.com b.com"), c("a.com b.com"));
});
