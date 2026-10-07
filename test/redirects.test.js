// Unit tests for lib/redirects.js. No network: requests are faked.
// Run:  npm test
import test from "node:test";
import assert from "node:assert/strict";
import { followRedirects, classifyRedirect, redirectIssueType, siteLevelChecks } from "../lib/redirects.js";

// A fake `check`: a table of url -> { status, location }. Unknown URLs are unreachable.
const fake = (table) => async (url) => {
  const e = table[url];
  if (!e) return { status: null, location: null, classification: "unreachable", error: "ENOTFOUND" };
  const s = e.status;
  const classification = s >= 300 && s < 400 ? "redirect" : s >= 200 && s < 300 ? "ok" : [401, 403, 429, 999].includes(s) ? "unverified" : "broken";
  return { status: s, location: e.location ?? null, classification };
};
const run = async (table, start) => {
  const r = await followRedirects(start, fake(table));
  const c = classifyRedirect(r);
  return { r, c, type: redirectIssueType(c) };
};

test("a single redirect to a working page is not an issue", async () => {
  const { c, type } = await run({ "http://x/a": { status: 301, location: "/b" }, "http://x/b": { status: 200 } }, "http://x/a");
  assert.equal(c.kind, "single");
  assert.equal(c.hops, 1);
  assert.equal(type, null);
});

test("three hops is a redirect chain", async () => {
  const { c, type } = await run({
    "http://x/a": { status: 301, location: "/b" }, "http://x/b": { status: 301, location: "/c" },
    "http://x/c": { status: 301, location: "/d" }, "http://x/d": { status: 200 },
  }, "http://x/a");
  assert.equal(c.kind, "chain");
  assert.equal(c.hops, 3);
  assert.equal(c.finalUrl, "http://x/d");
  assert.equal(type, "redirect-chain");
});

test("two redirects pointing at each other is a loop", async () => {
  const { c, type } = await run({ "http://x/a": { status: 302, location: "/b" }, "http://x/b": { status: 302, location: "/a" } }, "http://x/a");
  assert.equal(c.kind, "loop");
  assert.equal(type, "redirect-loop");
});

test("a redirect that ends in a 404 is reported as redirect-to-error", async () => {
  const { c, type } = await run({ "http://x/a": { status: 302, location: "/gone" }, "http://x/gone": { status: 404 } }, "http://x/a");
  assert.equal(c.kind, "single");
  assert.equal(c.endsInError, true);
  assert.equal(c.finalStatus, 404);
  assert.equal(type, "redirect-to-error");
});

test("a chain that ends in an error is still reported as a chain", async () => {
  const { c, type } = await run({
    "http://x/a": { status: 301, location: "/b" }, "http://x/b": { status: 301, location: "/c" }, "http://x/c": { status: 500 },
  }, "http://x/a");
  assert.equal(c.endsInError, true);
  assert.equal(type, "redirect-chain");
});

test("relative and absolute Location headers both resolve", async () => {
  const { c } = await run({ "http://x/dir/a": { status: 301, location: "../b" }, "http://x/b": { status: 301, location: "https://y/c" }, "https://y/c": { status: 200 } }, "http://x/dir/a");
  assert.deepEqual(c.chain, ["http://x/dir/a", "http://x/b", "https://y/c"]);
});

test("the hop limit stops an endless chain", async () => {
  const endless = async (url) => ({ status: 301, location: url + "x", classification: "redirect" });
  const r = await followRedirects("http://x/", endless, { maxHops: 5 });
  assert.equal(r.tooLong, true);
  assert.equal(classifyRedirect(r).kind, "chain");
});

test("site checks are skipped on localhost", async () => {
  const out = await siteLevelChecks("http://localhost:4000/", fake({}));
  assert.equal(out.skipped, "local address");
});

test("http that redirects to https is fine", async () => {
  const out = await siteLevelChecks("https://example.com/", fake({
    "http://example.com/": { status: 301, location: "https://example.com/" }, "https://example.com/": { status: 200 },
    "https://www.example.com/": { status: 301, location: "https://example.com/" },
  }));
  assert.deepEqual(out.findings, []);
});

test("http that serves content without redirecting is flagged", async () => {
  const out = await siteLevelChecks("https://example.com/", fake({ "http://example.com/": { status: 200 } }));
  assert.equal(out.findings[0].type, "https-missing-redirect");
});

test("a www twin that serves the site itself is flagged", async () => {
  const out = await siteLevelChecks("https://example.com/", fake({
    "http://example.com/": { status: 301, location: "https://example.com/" },
    "https://www.example.com/": { status: 200 },
  }));
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].type, "www-variant-not-redirected");
});

test("a www twin that does not exist is not a finding", async () => {
  const out = await siteLevelChecks("https://example.com/", fake({ "http://example.com/": { status: 301, location: "https://example.com/" } }));
  assert.deepEqual(out.findings, []);
});

test("works the other way round: non-www twin of a www site", async () => {
  const out = await siteLevelChecks("https://www.example.com/", fake({
    "http://www.example.com/": { status: 301, location: "https://www.example.com/" },
    "https://example.com/": { status: 200 },
  }));
  assert.equal(out.findings[0].type, "www-variant-not-redirected");
});