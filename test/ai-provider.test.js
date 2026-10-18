import { test } from "node:test";
import assert from "node:assert/strict";
import { aiConfig, openAiProvider, mockProvider, DEFAULT_MODEL } from "../lib/ai-provider.js";
import { parseEnv, loadEnv } from "../lib/env.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("parseEnv: comments, export, quotes and inline comments", () => {
    assert.deepEqual(parseEnv('# comment\nexport A=1\nB="two words"\nC=\'x\'\nD=val # note\nbad line\n'), { A: "1", B: "two words", C: "x", D: "val" });
});

test("loadEnv never overrides a variable that is already set", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "env-"));
    const file = path.join(dir, ".env");
    writeFileSync(file, "OPENAI_API_KEY=from-file\nAI_MODEL=m1\n");
    const env = { OPENAI_API_KEY: "from-shell" };
    loadEnv(file, env);
    assert.equal(env.OPENAI_API_KEY, "from-shell");
    assert.equal(env.AI_MODEL, "m1");
    assert.deepEqual(loadEnv(path.join(dir, "missing"), {}), {});
});

test("aiConfig: openai when a key is set, none without, mock on request, clear problems", () => {
    assert.equal(aiConfig({ OPENAI_API_KEY: "sk-x" }).provider, "openai");
    assert.equal(aiConfig({ OPENAI_API_KEY: "sk-x" }).model, DEFAULT_MODEL);
    assert.equal(aiConfig({ OPENAI_API_KEY: "sk-x" }).problem, null);
    assert.equal(aiConfig({}).provider, "none");
    assert.match(aiConfig({}).problem, /No OPENAI_API_KEY/);
    assert.match(aiConfig({ AI_PROVIDER: "openai" }).problem, /empty/);
    assert.equal(aiConfig({ AI_PROVIDER: "mock" }).problem, null);
    assert.match(aiConfig({ AI_PROVIDER: "gemini" }).problem, /Unknown AI_PROVIDER/);
    assert.equal(aiConfig({ OPENAI_API_KEY: "k", AI_BASE_URL: "https://proxy.test/v1/", AI_MODEL: "my-model" }).baseUrl, "https://proxy.test/v1");
});

const fakeFetch = (responses, calls) => async (url, init) => {
    calls.push({ url, init: { ...init, body: JSON.parse(init.body) } });
    const r = responses.shift();
    return { ok: r.status < 400, status: r.status, statusText: "x", json: async () => r.body };
};

test("openAiProvider sends a JSON-mode chat request with the key and returns the message", async () => {
    const calls = [];
    const p = openAiProvider({ apiKey: "sk-test", model: "m", fetchImpl: fakeFetch([{ status: 200, body: { choices: [{ message: { content: '{"ok":true}' } }] } }], calls) });
    assert.equal(await p.complete({ system: "S", user: "U" }), '{"ok":true}');
    const c = calls[0];
    assert.equal(c.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(c.init.headers.authorization, "Bearer sk-test");
    assert.deepEqual(c.init.body.response_format, { type: "json_object" });
    assert.deepEqual(c.init.body.messages, [{ role: "system", content: "S" }, { role: "user", content: "U" }]);
    assert.equal(c.init.body.model, "m");
});

test("openAiProvider retries rate limits and server errors, then reports the API's message", async () => {
    const calls = [];
    const ok = openAiProvider({ apiKey: "k", model: "m", fetchImpl: fakeFetch([{ status: 429, body: {} }, { status: 200, body: { choices: [{ message: { content: "{}" } }] } }], calls) });
    assert.equal(await ok.complete({ system: "s", user: "u" }), "{}");
    assert.equal(calls.length, 2);
    const bad = openAiProvider({ apiKey: "k", model: "m", fetchImpl: fakeFetch([{ status: 401, body: { error: { message: "Incorrect API key provided" } } }], []) });
    await assert.rejects(bad.complete({ system: "s", user: "u" }), /401.*Incorrect API key/);
});

test("mockProvider passes the parsed request to its responder", async () => {
    const p = mockProvider(({ user }) => ({ echo: user.x }));
    assert.equal(await p.complete({ system: "s", user: JSON.stringify({ x: 7 }) }), '{"echo":7}');
});
