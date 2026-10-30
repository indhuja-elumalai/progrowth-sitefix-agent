// The one place that talks to an AI model. Everything else gets a provider object
// with a single method, complete({ system, user }) -> text (JSON), so the rest of
// the code (and the tests) never depend on a vendor.
//
// Configured from the environment (or a .env file, see lib/env.js):
//   AI_PROVIDER     openai | mock | none   (default: openai when OPENAI_API_KEY is set, else none)
//   OPENAI_API_KEY  your key (never commit it; .env is gitignored)
//   AI_MODEL        model name (default gpt-4o-mini; use any chat model your account has)
//   AI_BASE_URL     default https://api.openai.com/v1 (any OpenAI-compatible endpoint works)
//
// "mock" needs no key and no network: it builds answers from the standard guidance
// in lib/explain-templates.js. It exists for demos, tests and CI.

export const DEFAULT_MODEL = "gpt-4o-mini";
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function aiConfig(env = process.env) {
    const key = (env.OPENAI_API_KEY || "").trim();
    const provider = (env.AI_PROVIDER || (key ? "openai" : "none")).trim().toLowerCase();
    return {
        provider,
        model: (env.AI_MODEL || "").trim() || (provider === "mock" ? "mock" : DEFAULT_MODEL),
        baseUrl: ((env.AI_BASE_URL || "").trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
        apiKey: key,
        // Why AI is off, in words a person can act on (null when it is on).
        problem: provider === "openai" && !key ? "AI_PROVIDER is openai but OPENAI_API_KEY is empty"
            : !["openai", "mock", "none"].includes(provider) ? `Unknown AI_PROVIDER "${provider}" (use openai, mock or none)`
                : provider === "none" ? "No OPENAI_API_KEY set" : null,
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OpenAI Chat Completions with JSON output. Retries rate limits and server errors
// (up to 3 tries, with backoff); any other error is thrown with the API's message.
export function openAiProvider({ apiKey, model, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, timeoutMs = 90000, retries = 2 }) {
    return {
        name: "openai",
        model,
        // history: earlier turns of a conversation ({ role: "user" | "assistant", content }), sent between the system and the new message
        async complete({ system, user, maxTokens = 2000, temperature = 0.2, history = [] }) {
            const body = {
                model,
                temperature,
                max_tokens: maxTokens,
                response_format: { type: "json_object" },
                messages: [{ role: "system", content: system }, ...history, { role: "user", content: user }],
            };
            for (let attempt = 0; ; attempt++) {
                let res;
                try {
                    res = await fetchImpl(`${baseUrl}/chat/completions`, {
                        method: "POST",
                        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
                        body: JSON.stringify(body),
                        signal: AbortSignal.timeout(timeoutMs),
                    });
                } catch (err) {
                    if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
                    throw new Error(`AI request failed: ${err.cause?.code || err.message}`);
                }
                if ((res.status === 429 || res.status >= 500) && attempt < retries) {
                    await sleep(1000 * 2 ** attempt);
                    continue;
                }
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(`AI request failed (${res.status}): ${data?.error?.message || res.statusText || "no details"}`);
                const text = data?.choices?.[0]?.message?.content;
                if (typeof text !== "string") throw new Error("AI response had no message content");
                return text;
            }
        },
    };
}

// Deterministic stand-in. `respond` gets the parsed request and returns an object.
export function mockProvider(respond) {
    return {
        name: "mock",
        model: "mock",
        async complete({ system, user, history = [] }) {
            return JSON.stringify(respond({ system, user: JSON.parse(user), history }));
        },
    };
}

// The provider for a config from aiConfig(): a real one, the mock, or null (AI off).
export async function providerFromConfig(config) {
    if (config.provider === "mock") {
        const { mockRespond } = await import("./ai-mock.js");
        return mockProvider(mockRespond);
    }
    if (config.provider === "openai" && config.apiKey) return openAiProvider({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl });
    return null;
}
