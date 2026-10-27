import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "../lib/queue.js";

test("pages are taken one section at a time in turn, each section in the order found", () => {
    const q = createQueue();
    for (const u of ["/", "/blog/a", "/blog/b", "/blog/c", "/products/x", "/products/y", "/about"]) q.push(`https://x.test${u}`);
    const out = [];
    while (q.length) out.push(new URL(q.shift()).pathname);
    assert.deepEqual(out, ["/", "/blog/a", "/products/x", "/about", "/blog/b", "/products/y", "/blog/c"]);
});

test("a limited crawl of a big site still reaches every section", () => {
    const q = createQueue();
    for (let i = 0; i < 1000; i++) q.push(`https://x.test/blog/post-${i}`);
    for (let i = 0; i < 20; i++) q.push(`https://x.test/services/s-${i}`);
    q.push("https://x.test/contact");
    const first = Array.from({ length: 30 }, () => q.shift());
    assert.ok(first.some((u) => u.includes("/services/")));
    assert.ok(first.includes("https://x.test/contact"));
    assert.equal(q.length, 1021 - 30);
    const s = Object.fromEntries(q.sections().map((x) => [x.key, x]));
    assert.deepEqual([s["/blog/*"].queued, s["/services/*"].queued, s["/contact"].taken], [1000, 20, 1]);
});

test("pages added while crawling join their section; an empty queue gives undefined", () => {
    const q = createQueue();
    assert.equal(q.shift(), undefined);
    q.push("https://x.test/a/1");
    assert.equal(q.shift(), "https://x.test/a/1");
    q.push("https://x.test/a/2");
    q.push("https://x.test/b/1");
    assert.deepEqual([q.shift(), q.shift(), q.shift()], ["https://x.test/a/2", "https://x.test/b/1", undefined]);
});
