import { test } from "node:test";
import assert from "node:assert/strict";
import { createThrottle, createPool } from "../lib/throttle.js";

// A fake clock: sleep() moves time forward instantly, so the tests run in milliseconds.
function clock() {
    let t = 0;
    const slept = [];
    return { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, slept, advance: (ms) => { t += ms; } };
}

test("at most perHost requests run at once per host; other hosts are not held up", async () => {
    const th = createThrottle({ perHost: 2 });
    let active = 0, peak = 0, otherPeak = 0, other = 0;
    const job = (host, track) => th.run(`https://${host}/x`, async () => {
        if (track) { active++; peak = Math.max(peak, active); } else { other++; otherPeak = Math.max(otherPeak, other); }
        await new Promise((r) => setTimeout(r, 5));
        if (track) active--; else other--;
        return { status: 200 };
    });
    await Promise.all([...Array.from({ length: 7 }, () => job("a.test", true)), ...Array.from({ length: 3 }, () => job("b.test", false))]);
    assert.equal(peak, 2);
    assert.equal(otherPeak, 2);
});

test("a 429 doubles the pause for that host only; success shrinks it back to the base", async () => {
    const c = clock();
    const th = createThrottle({ sleep: c.sleep, now: c.now });
    th.note("https://a.test/1", 429);
    await th.wait("https://a.test/2");
    assert.deepEqual(c.slept, [500]);
    th.note("https://a.test/2", 429);
    await th.wait("https://a.test/3");
    assert.equal(c.slept.at(-1), 1000);
    await th.wait("https://b.test/1"); // another host is not slowed
    assert.equal(c.slept.length, 2);
    for (let i = 0; i < 12; i++) { th.note("https://a.test/ok", 200); await th.wait("https://a.test/ok"); }
    const before = c.slept.length;
    th.note("https://a.test/ok", 200);
    await th.wait("https://a.test/ok");
    assert.equal(c.slept.length, before, "back to no pause");
    assert.deepEqual(th.stats(), { slowDowns: 2, maxDelayMs: 1000, hosts: ["a.test"] });
});

test("Retry-After is respected (seconds or an HTTP date) and capped at 30 seconds", async () => {
    const c = clock();
    const th = createThrottle({ sleep: c.sleep, now: c.now });
    th.note("https://a.test/", 503, "4");
    await th.wait("https://a.test/");
    assert.equal(c.slept.at(-1), 4000);
    th.note("https://b.test/", 429, new Date(c.now() + 10000).toUTCString());
    await th.wait("https://b.test/");
    assert.ok(c.slept.at(-1) >= 9000 && c.slept.at(-1) <= 10000);
    th.note("https://c.test/", 429, "3600");
    await th.wait("https://c.test/");
    assert.equal(c.slept.at(-1), 30000);
});

test("the pause never grows past maxDelayMs", () => {
    const c = clock();
    const th = createThrottle({ sleep: c.sleep, now: c.now, maxDelayMs: 2000 });
    for (let i = 0; i < 10; i++) th.note("https://a.test/", 429);
    assert.equal(th.stats().maxDelayMs, 2000);
});

test("run() adapts to the status its function returns, and passes the result through", async () => {
    const c = clock();
    const th = createThrottle({ sleep: c.sleep, now: c.now });
    const r = await th.run("https://a.test/", async () => ({ status: 429, retryAfter: "2" }));
    assert.equal(r.status, 429);
    await th.wait("https://a.test/");
    assert.equal(c.slept.at(-1), 2000);
    await assert.rejects(th.run("https://a.test/", async () => { throw new Error("boom"); }), /boom/);
    // a failed call still frees its slot
    assert.equal((await th.run("https://a.test/", async () => ({ status: 200 }))).status, 200);
});

test("a base delay keeps a polite pause between requests to the same host", async () => {
    const c = clock();
    const th = createThrottle({ sleep: c.sleep, now: c.now, baseDelayMs: 150 });
    await th.run("https://a.test/1", async () => ({ status: 200 }));
    await th.run("https://a.test/2", async () => ({ status: 200 }));
    assert.deepEqual(c.slept, [150]);
});

test("createPool runs at most n at once, keeps going after a failure, and returns each result", async () => {
    const pool = createPool(3);
    let active = 0, peak = 0;
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => pool.add(async () => {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 3));
        active--;
        if (i === 4) throw new Error("bad");
        return i * 2;
    })));
    assert.equal(peak, 3);
    assert.equal(results[4].status, "rejected");
    assert.equal(results[9].value, 18);
    assert.equal(pool.size, 0);
});
