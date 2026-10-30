import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProfiles, siteKey, normalizeSite, sameSite, MAX_SITES } from "../lib/profiles.js";

const fresh = async () => path.join(await mkdtemp(path.join(tmpdir(), "sitefix-prof-")), "profiles.json");

test("a site is its host: www., http/https, paths and case don't matter", () => {
    assert.equal(siteKey("https://www.Example.com/about?x=1"), "example.com");
    assert.equal(siteKey("example.com"), "example.com");
    assert.equal(siteKey("http://localhost:4000/"), "localhost:4000");
    assert.equal(siteKey("https://example.com:443/"), "example.com");
    assert.ok(sameSite("http://www.example.com", "https://example.com/blog"));
    assert.equal(sameSite("https://example.com", "https://example.org"), false);
    assert.equal(sameSite("https://shop.example.com", "https://example.com"), false);
    assert.equal(sameSite(null, "example.com"), false);
    assert.equal(siteKey("ftp://example.com"), null);
    assert.equal(siteKey("https://medium.com/@someone"), "medium.com");
    assert.equal(siteKey("https://user@evil.com"), null);
});

test("normalizeSite keeps websites only, as https://host/", () => {
    assert.equal(normalizeSite("Example.com/page"), "https://example.com/");
    assert.equal(normalizeSite("http://www.example.com"), "http://www.example.com/");
    assert.equal(normalizeSite("localhost:4000"), "http://localhost:4000/");
    for (const bad of ["", "hello", "two words.com", "mailto:a@b.com", "ftp://example.com", "javascript:alert(1)", "a".repeat(400) + ".com"]) assert.equal(normalizeSite(bad), null, bad);
});

test("a workspace has a name and a site; adding sites switches to them, and it is kept on disk", async () => {
    const file = await fresh();
    const p = createProfiles({ file });
    const me = await p.create({ name: "  Indhuja <b>E</b> ", site: "www.example.com" });
    assert.match(me.id, /^[0-9a-f]{32}$/);
    assert.equal(me.name, "Indhuja bE/b");
    assert.deepEqual(me.sites, ["https://www.example.com/"]);
    assert.equal(me.activeSite, "https://www.example.com/");
    const two = await p.addSite(me.id, "example.org");
    assert.deepEqual(two.sites, ["https://www.example.com/", "https://example.org/"]);
    assert.equal(two.activeSite, "https://example.org/");
    // The same site again (another spelling) is not added twice, just switched to.
    const again = await p.addSite(me.id, "http://example.com/x");
    assert.equal(again.sites.length, 2);
    assert.equal(again.activeSite, "https://www.example.com/");
    assert.equal((await p.setActive(me.id, "EXAMPLE.org")).activeSite, "https://example.org/");
    assert.equal(await p.setActive(me.id, "elsewhere.net"), null);
    // Read back by a new instance, from the file.
    const back = await createProfiles({ file }).get(me.id);
    assert.equal(back.activeSite, "https://example.org/");
    assert.equal(JSON.parse(await readFile(file, "utf8")).profiles[me.id].name, "Indhuja bE/b");
});

test("access: only the workspace's sites; bad input is refused", async () => {
    const p = createProfiles({ file: await fresh() });
    const me = await p.create({ name: "A", site: "example.com" });
    assert.equal(p.allows(me, "https://www.example.com/page"), true);
    assert.equal(p.allows(me, "https://example.org/"), false);
    assert.equal(p.allows(null, "https://example.com/"), false);
    assert.equal(p.allows(me, undefined), false);
    await assert.rejects(p.create({ name: "", site: "example.com" }), /bad name/);
    await assert.rejects(p.create({ name: "A", site: "not a site" }), /bad site/);
    await assert.rejects(p.addSite(me.id, "nope"), /bad site/);
    assert.equal(await p.get("../../etc/passwd"), null);
    assert.equal(await p.get("0".repeat(32)), null);
});

test("removing a site never removes the last one, and moves to another when it was active", async () => {
    const p = createProfiles({ file: await fresh() });
    const me = await p.create({ name: "A", site: "example.com" });
    await assert.rejects(p.removeSite(me.id, "example.com"), /last site/);
    await p.addSite(me.id, "example.org");
    const after = await p.removeSite(me.id, "example.org");
    assert.deepEqual(after.sites, ["https://example.com/"]);
    assert.equal(after.activeSite, "https://example.com/");
});

test("a workspace holds up to MAX_SITES sites", async () => {
    const p = createProfiles({ file: await fresh() });
    const me = await p.create({ name: "A", site: "site0.com" });
    for (let i = 1; i < MAX_SITES; i++) await p.addSite(me.id, `site${i}.com`);
    await assert.rejects(p.addSite(me.id, "one-more.com"), /too many sites/);
});
