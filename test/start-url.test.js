import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStart } from "../lib/start-url.js";

// A fake server: url -> [status, location]
const site = (map) => async (url) => {
    const [status, location] = map[url] || [200];
    return { status, headers: { get: (h) => (h === "location" ? location || null : null) } };
};

test("follows http -> https and the www twin, so the whole site is crawled", async () => {
    const r = await resolveStart("http://progrowth.services", { fetch: site({ "http://progrowth.services/": [301, "https://progrowth.services/"], "https://progrowth.services/": [308, "https://www.progrowth.services/"] }) });
    assert.deepEqual(r, { url: "https://www.progrowth.services/", changed: true, from: "http://progrowth.services/" });
});

test("relative redirects resolve; no redirect means no change", async () => {
    assert.equal((await resolveStart("https://x.test", { fetch: site({ "https://x.test/": [302, "/en/"] }) })).url, "https://x.test/en/");
    assert.equal((await resolveStart("https://x.test/", { fetch: site({}) })).changed, false);
});

test("a redirect to another site, a loop or an unreachable site is left alone", async () => {
    assert.equal((await resolveStart("https://x.test/", { fetch: site({ "https://x.test/": [301, "https://other.test/"] }) })).url, "https://x.test/");
    assert.equal((await resolveStart("https://x.test/", { fetch: site({ "https://x.test/": [301, "https://www.x.test/"], "https://www.x.test/": [301, "https://x.test/"] }), maxHops: 4 })).changed, false);
    assert.equal((await resolveStart("https://x.test/", { fetch: async () => { throw new Error("ECONNREFUSED"); } })).changed, false);
});
