// AI explanations with guardrails. For each issue TYPE found on the site, one AI
// call explains it in plain language, writes fix steps, and explains each instance
// (up to MAX_INSTANCES) from its own evidence. Everything the AI returns is checked;
// anything that fails a check is replaced by the standard guidance in
// lib/explain-templates.js, and the reason is recorded.
//
// buildTypeRequest(type, issues)        -> the exact JSON the AI sees (evidence only)
// validateTypeAnswer(raw, request)      -> cleaned answer + list of problems
// templateInstanceExplanation(issue)    -> plain sentence for an instance without AI
// explainIssues({ issues, provider })   -> types with explanations, fix steps, suggested values

import { createHash } from "node:crypto";
import { templateFor } from "./explain-templates.js";
import { CATALOG } from "./issues.js";

export const MAX_INSTANCES = 8; // instances per AI call; the rest get the standard sentence
export const CONCURRENCY = 6; // AI calls at the same time (one per issue type)

// Types where a ready-to-paste replacement makes sense, and its length limits.
const TITLE = { min: 10, max: 60, label: "Suggested title" };
const DESC = { min: 50, max: 160, label: "Suggested meta description" };
const ALT = { min: 3, max: 125, label: "Suggested alt text (draft: check it matches the image)" };
export const VALUE_RULES = {
    "title-missing": TITLE, "title-too-long": TITLE, "title-too-short": TITLE, "title-duplicate": TITLE,
    "description-missing": DESC, "description-too-long": DESC, "description-too-short": DESC, "description-duplicate": DESC,
    "h1-missing": { min: 3, max: 80, label: "Suggested H1" },
    "image-alt-missing": ALT, "image-alt-unhelpful": ALT, "image-alt-too-long": ALT,
};

export const SYSTEM_PROMPT = `You write issue explanations for SiteFix, a website audit tool used by people who are not web developers.
You receive JSON describing ONE type of problem found on a website, with the real evidence for each instance.

Rules:
1. Use ONLY facts present in the JSON (type, detail, evidence, URLs, counts). Never invent URLs, page names, numbers, tools or facts.
2. Plain language for a site owner: short sentences, everyday words, explain any technical term in a few words.
3. "summary": 1-2 sentences on what this problem is, as it appears on THIS site. "why": 1-2 sentences on the practical impact.
4. "fixSteps": 2 to 5 short, concrete steps. Base them on "standardGuidance.fix" and the evidence; do not add steps that need facts you were not given.
5. For every instance, "explanation": one sentence naming the specific page or element and exactly what is wrong, using its detail and evidence.
6. "suggestedValue": only when "wantsValue" is true, a ready-to-paste replacement within valueRules.min-max characters, based only on the evidence (page title, H1, headings, text, file name). Otherwise null.
7. Reply with JSON only, in exactly this shape:
{"type": "<type>", "summary": "...", "why": "...", "fixSteps": ["..."], "instances": [{"id": "<id>", "explanation": "...", "suggestedValue": null}]}`;

// ---------- request ----------
const clip = (v, n = 300) => (typeof v === "string" && v.length > n ? `${v.slice(0, n)}…` : v);
function compactEvidence(ev = {}) {
    const out = {};
    for (const [k, v] of Object.entries(ev)) {
        if (k === "rawHead") continue; // large and only needed for the JS-only rule
        if (k === "head" && v) {
            out.head = {
                title: v.title ?? null, description: v.description ?? null, h1s: (v.h1s || []).slice(0, 5).map((x) => clip(x, 120)),
                canonicals: v.canonicals || [], robots: v.robots ?? null, viewport: v.viewport ?? null, lang: v.lang ?? null,
                og: v.og || {}, headings: (v.headings || []).slice(0, 15),
            };
        } else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => (typeof x === "string" ? clip(x) : x));
        else out[k] = clip(v);
    }
    return out;
}

export function buildTypeRequest(type, issues) {
    const t = templateFor(type);
    const rule = VALUE_RULES[type] || null;
    return {
        type,
        category: CATALOG[type]?.category || "",
        title: t.title,
        totalInstances: issues.length,
        wantsValue: Boolean(rule),
        valueRules: rule ? { min: rule.min, max: rule.max } : null,
        standardGuidance: { summary: t.summary, why: t.why, fix: t.fix },
        instances: issues.slice(0, MAX_INSTANCES).map((i) => ({
            id: i.id,
            affectedUrl: i.affectedUrl,
            detail: i.detail,
            severity: i.severity,
            foundOnCount: (i.foundOn || []).length,
            foundOnSample: (i.foundOn || []).slice(0, 3),
            evidence: compactEvidence(i.evidence),
        })),
    };
}

// ---------- guardrails ----------
const URL_RE = /https?:\/\/[^\s"'<>()\]]+/g;
const normUrl = (u) => u.replace(/[.,;:!?]+$/, "").replace(/\/$/, "");
export const urlsIn = (text) => (String(text || "").match(URL_RE) || []).map(normUrl);

function allowedUrls(request) {
    return new Set(urlsIn(JSON.stringify(request)));
}

const okText = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max;

export function validateTypeAnswer(raw, request) {
    const problems = [];
    let a;
    try { a = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return { ok: false, problems: ["answer was not valid JSON"] }; }
    if (!a || typeof a !== "object") return { ok: false, problems: ["answer was not a JSON object"] };
    if (a.type !== request.type) return { ok: false, problems: [`answer is for type "${a.type}", expected "${request.type}"`] };

    const allowed = allowedUrls(request);
    const invented = (text) => urlsIn(text).filter((u) => !allowed.has(u));
    const field = (name, max) => {
        const v = a[name];
        if (!okText(v, max)) { problems.push(`${name} missing or too long`); return null; }
        const bad = invented(v);
        if (bad.length) { problems.push(`${name} mentions a URL not in the evidence (${bad[0]})`); return null; }
        return v.trim();
    };
    const summary = field("summary", 500);
    const why = field("why", 500);

    let fixSteps = null;
    if (!Array.isArray(a.fixSteps) || a.fixSteps.length < 1 || a.fixSteps.length > 6 || !a.fixSteps.every((s) => okText(s, 300))) {
        problems.push("fixSteps must be 1 to 6 short steps");
    } else if (a.fixSteps.some((s) => invented(s).length)) {
        problems.push("fixSteps mention a URL not in the evidence");
    } else fixSteps = a.fixSteps.map((s) => s.trim());

    const wanted = new Map(request.instances.map((i) => [i.id, i]));
    const rule = request.valueRules;
    const instances = new Map();
    for (const inst of Array.isArray(a.instances) ? a.instances : []) {
        if (!wanted.has(inst?.id)) { problems.push(`unknown instance id ${inst?.id}`); continue; }
        let explanation = null;
        if (!okText(inst.explanation, 400)) problems.push(`${inst.id}: explanation missing or too long`);
        else if (invented(inst.explanation).length) problems.push(`${inst.id}: explanation mentions a URL not in the evidence`);
        else explanation = inst.explanation.trim();
        let suggestedValue = null;
        if (inst.suggestedValue != null && inst.suggestedValue !== "") {
            const v = String(inst.suggestedValue).trim();
            if (!rule) problems.push(`${inst.id}: suggestedValue given for a type that does not take one`);
            else if (v.length < rule.min || v.length > rule.max) problems.push(`${inst.id}: suggestedValue is ${v.length} characters (allowed ${rule.min}-${rule.max})`);
            else if (urlsIn(v).length) problems.push(`${inst.id}: suggestedValue contains a URL`);
            else suggestedValue = v;
        }
        instances.set(inst.id, { explanation, suggestedValue });
    }
    for (const id of wanted.keys()) if (!instances.has(id)) problems.push(`${id}: no explanation returned`);
    return { ok: true, summary, why, fixSteps, instances, problems };
}

// ---------- without AI ----------
const shortUrl = (u) => { try { const x = new URL(u); return x.pathname + x.search || "/"; } catch { return u; } };
const SHOWN_ON = new Set(["http", "redirect", "image"]);

export function templateInstanceExplanation(issue) {
    const n = (issue.foundOn || []).length;
    if (SHOWN_ON.has(issue.evidence?.kind)) {
        return `${issue.detail}: ${issue.affectedUrl}${n ? ` (on ${n} page${n === 1 ? "" : "s"})` : ""}.`;
    }
    return `On ${shortUrl(issue.affectedUrl)}: ${issue.detail}.`;
}

// ---------- orchestration ----------
const PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2 };
const byPriority = (a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3) || (b.foundOn?.length || 0) - (a.foundOn?.length || 0);

async function mapPool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
    }));
    return out;
}

// issues: registry issues, already triaged (priority, effort, owner, quickWin).
// provider: from lib/ai-provider.js, or null for standard guidance only.
// cache: { get(key), set(key, value) } or null.
// Issues grouped by type, most urgent type first and each type's issues P1 first:
// the order of the report, also used to pick screenshots before the explanations exist.
export function groupByType(issues) {
    const groups = new Map();
    for (const i of issues) {
        if (!groups.has(i.type)) groups.set(i.type, []);
        groups.get(i.type).push(i);
    }
    const types = [...groups].map(([type, list]) => ({ type, list: [...list].sort(byPriority) }));
    types.sort((a, b) => byPriority(a.list[0], b.list[0]) || b.list.length - a.list.length);
    return types;
}

export async function explainIssues({ issues, provider = null, cache = null, onProgress = () => {} }) {
    const types = groupByType(issues);

    let done = 0;
    const results = await mapPool(types, CONCURRENCY, async ({ type, list }) => {
        const t = templateFor(type);
        const request = buildTypeRequest(type, list);
        let answer = null;
        let problems = [];
        let source = "standard";
        if (provider) {
            const key = createHash("sha1").update(`${provider.name}|${provider.model}|${SYSTEM_PROMPT}|${JSON.stringify(request)}`).digest("hex");
            let raw = cache?.get(key);
            const fromCache = Boolean(raw);
            try {
                if (!raw) raw = await provider.complete({ system: SYSTEM_PROMPT, user: JSON.stringify(request) });
                const v = validateTypeAnswer(raw, request);
                problems = v.problems;
                if (v.ok) {
                    answer = v;
                    source = "ai";
                    if (!fromCache) cache?.set(key, raw);
                }
            } catch (err) {
                problems = [err.message];
            }
        }
        done++;
        onProgress({ done, total: types.length, type, source, problems });
        const ai = answer?.instances || new Map();
        return {
            type,
            category: CATALOG[type]?.category || "",
            title: t.title,
            summary: answer?.summary || t.summary,
            why: answer?.why || t.why,
            fixSteps: answer?.fixSteps || t.fix,
            source, // "ai" when the AI answer passed the checks (fields that failed still use the standard text)
            problems,
            valueLabel: VALUE_RULES[type]?.label || null,
            issues: list.map((i) => {
                const a = ai.get(i.id);
                return {
                    ...i,
                    explanation: a?.explanation || templateInstanceExplanation(i),
                    explanationSource: a?.explanation ? "ai" : "standard",
                    suggestedValue: a?.suggestedValue || null,
                };
            }),
        };
    });
    return {
        types: results,
        stats: {
            types: results.length,
            aiTypes: results.filter((r) => r.source === "ai").length,
            standardTypes: results.filter((r) => r.source === "standard").length,
            problems: results.flatMap((r) => r.problems.map((p) => `${r.type}: ${p}`)),
        },
    };
}
