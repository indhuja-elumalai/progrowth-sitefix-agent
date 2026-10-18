// Loads KEY=value lines from a .env file into process.env, without overwriting
// anything already set (so a real environment variable always wins).
// Tiny on purpose: no dependency, and .env is in .gitignore so keys never get committed.
import { readFileSync } from "node:fs";

export function parseEnv(text) {
    const out = {};
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m) continue;
        let value = m[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        else value = value.replace(/\s+#.*$/, ""); // inline comment after an unquoted value
        out[m[1]] = value;
    }
    return out;
}

export function loadEnv(path = ".env", env = process.env) {
    let text;
    try { text = readFileSync(path, "utf8"); } catch { return {}; }
    const parsed = parseEnv(text);
    for (const [k, v] of Object.entries(parsed)) if (env[k] === undefined) env[k] = v;
    return parsed;
}
