// The coach: the short messages the live report posts as the client works through the
// fixes ("3 broken links are sending visitors to an error page. They're quick to fix
// and take your score to 67."). AI writes the words; it never decides the facts.
//
// Every number, issue name and site name is a {placeholder} the code fills in from the
// measured data and the score (lib/score.js). The AI's text is checked before it is
// used: no digits, addresses or site names of its own, only the placeholders allowed
// for that message, no promises about rankings or traffic, no other issue's name in a
// message about one issue, no HTML, and a length limit. Any message that fails, and
// every message when AI is off, comes from the built-in set below, so the report never
// shows a wrong fact or an error.
//
// buildCoach({ types, provider, cache }) -> { bank, source, problems }
//   types: [{ type, title, why, severity, priority, area, effort, count }]
//   bank:  { intro, welcomeBack, level: {1..4}, levelUp: {2..4}, afterMark, afterSelect, afterVerify,
//            stillThere, nextUp, types: { [type]: { visitor, nudge } } }
// checkMessage(text, slot, otherTitles) -> null when fine, else the problem
// fillMessage(template, values) -> text (values are inserted as they are; escape for HTML yourself)
// standardBank(types) -> the built-in bank (also for reports made before the coach existed)

import { createHash } from "node:crypto";

// Which placeholders each message may use. Numbers and names only ever come from these.
export const SLOTS = {
    intro: ["site", "score", "urgent", "level"],
    welcomeBack: ["score", "left", "level"],
    "level.1": ["count"], "level.2": ["count"], "level.3": ["count"], "level.4": [],
    "levelUp.2": ["score"], "levelUp.3": ["score"], "levelUp.4": ["score"],
    afterMark: ["issue", "gain", "score"],
    afterSelect: ["count", "gain", "score"],
    selectionCleared: ["score"],
    afterKeep: ["issue", "score"],
    afterVerify: ["issue", "gain", "score"],
    stillThere: ["issue"],
    nextUp: ["issue", "gain"],
    "type.visitor": [],
    "type.nudge": ["count", "gain"],
};

export const STANDARD = {
    intro: "Your site scores {score} out of 100 today. There are {urgent} urgent things to fix first, and each one you fix raises your score straight away.",
    welcomeBack: "Welcome back. Your score is {score}, with {left} left in {level}.",
    level: {
        1: "Urgent fixes: problems visitors run into right now, like broken pages and missing information. {count} to go.",
        2: "Important fixes: things that hold your pages back in search and on phones. {count} to go.",
        3: "Polish: small improvements that make the site feel finished. {count} to go.",
        4: "Everything SiteFix checks is in good shape. Keep it that way with a new inspection now and then.",
    },
    levelUp: {
        2: "All urgent problems are fixed, and visitors no longer run into them. Your score is {score}. Next: the important fixes.",
        3: "The important fixes are done too. Your score is {score}. What's left is polish.",
        4: "Everything is fixed. Your score is {score}. Run a new inspection to confirm it on the live site.",
    },
    afterMark: "Nice. {issue} marked as fixed, worth {gain} points: your score is now {score}. Check it on the live site whenever you're ready.",
    afterSelect: "{count} fixes selected, worth {gain} points. Your score would go to {score}.",
    selectionCleared: "No fixes selected right now, so your score stays at {score}. Tick any fix to see how far it can go.",
    afterKeep: "Got it: {issue} stays as it is, on purpose. It no longer counts against your score, which is now {score}.",
    afterVerify: "Confirmed on your live site: {issue} is fixed. That's {gain} points, and your score is {score}.",
    stillThere: "{issue} is still showing on the live site. It may need a moment to update, or one more change.",
    nextUp: "Next easy win: {issue}, worth {gain} points.",
    types: {},
};

const STANDARD_NUDGE = {
    easy: "Quick to fix, and worth {gain} points to your score.",
    medium: "Worth {gain} points to your score once it's fixed.",
    hard: "A bigger job, worth {gain} points to your score.",
};

const BANNED = /\bguarantee|\b(rank|ranking)s?\s+(#|number|first|top|higher)|\btop of google\b|\b(double|triple|quadruple)s?\b|\b10x\b|\b100\s*%|\bovernight\b|\bwill (definitely|certainly)\b/i;

export function checkMessage(text, slot, otherTitles = []) {
    if (typeof text !== "string") return "not text";
    const t = text.trim();
    if (t.length < 8 || t.length > 260) return "too long or too short";
    if (/[<>]/.test(t)) return "contains HTML";
    // The one number a message may write itself: the scale, "out of 100".
    if (/\d/.test(t.replace(/\{[a-z]+\}/gi, "").replace(/\bout of 100\b/gi, ""))) return "contains a number of its own (numbers must be placeholders)";
    if (/https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|in|co|ai|app|dev|services|uk)\b/i.test(t)) return "contains an address";
    if (BANNED.test(t)) return "promises results";
    const allowed = new Set(SLOTS[slot] || []);
    for (const m of t.matchAll(/\{([^}]*)\}/g)) if (!allowed.has(m[1])) return `uses {${m[1]}}, which this message can't use`;
    if (/[{}]/.test(t.replace(/\{[a-z]+\}/gi, ""))) return "has a broken placeholder";
    const low = t.toLowerCase();
    for (const o of otherTitles) if (o && o.length > 6 && low.includes(o.toLowerCase())) return `names another issue ("${o}")`;
    return null;
}

// Also mends what a number can do to the words around it: "1 points" becomes "1 point",
// "There are 1 urgent things" becomes "There is 1 urgent thing".
export function fillMessage(template, values) {
    return String(template || "")
        .replace(/\{([a-z]+)\}/gi, (m, k) => (values[k] !== undefined && values[k] !== null ? String(values[k]) : m))
        .replace(/\b(are|were) (?<![\d.])1 (\w+ )?(\w+?)s\b/gi, (m, verb, mid, noun) => `${verb.toLowerCase() === "are" ? "is" : "was"} 1 ${mid || ""}${noun}`)
        .replace(/(?<![\d.])\b1 ((?:urgent |important |polish )?)fixes\b/gi, "1 $1fix")
        .replace(/(?<![\d.])\b1 (point|issue|page|thing|fix|problem|mistake|link|image)s\b/gi, "1 $1")
        .replace(/(?<![\d.])\b1 (urgent|important|polish|broken|more) (point|issue|page|thing|fix|problem|mistake|link|image)s\b/gi, "1 $1 $2");
}

export const COACH_SYSTEM = `You write the short coaching messages for SiteFix's live website report. A small-business owner reads them while fixing their site. Tone: warm, encouraging, plain words, like a helpful expert next to them. Never pushy, never alarming.

You receive the kinds of problems found on their site. Write every message asked for in "slots" and, for every problem type, a "visitor" line and a "nudge" line.

Hard rules (a message that breaks one is thrown away):
1. NO digits or numbers written as words that count things (the only exception: "out of 100" after {score}). Every number and name is a placeholder in curly braces, and you may use only the placeholders listed for that message, e.g. {score}, {gain}, {count}, {issue}, {site}.
2. No web addresses, page names, brand or company names.
3. Do not change what the problem is or how it is fixed: describe its effect on visitors only, using the "why" you are given. No new technical claims.
4. No promises about rankings, traffic or sales ("guarantee", "rank first", "double your traffic").
5. "visitor": one sentence on what a visitor or Google experiences because of this problem. No placeholders.
6. "nudge": one short sentence encouraging the fix, may use {gain} and {count}.
7. Each message at most 2 short sentences (under 240 characters). Plain text, no HTML, no emoji.
Reply with JSON only: {"slots": {"<slot>": "..."}, "types": {"<type>": {"visitor": "...", "nudge": "..."}}}`;

const SLOT_HELP = {
    intro: "first message when the client opens the report: their score and that urgent fixes come first",
    welcomeBack: "when they come back: score and how many are left in the current level",
    "level.1": "what the urgent level (P1) is about for visitors", "level.2": "what the important level (P2) is about",
    "level.3": "what the polish level (P3) is about", "level.4": "everything fixed",
    "levelUp.2": "celebrate: all urgent fixes done", "levelUp.3": "celebrate: important fixes done", "levelUp.4": "celebrate: everything done",
    afterMark: "they marked {issue} as fixed: celebrate, new score, suggest checking it live",
    afterSelect: "they ticked {count} fixes to make, worth {gain} points, taking the score to {score}: encourage, no pressure",
    selectionCleared: "they unticked everything: the score stays at {score}; invite them to pick any fix, no pressure",
    afterKeep: "they chose to keep {issue} as it is, on purpose (it is not a real problem for them); acknowledge their choice, no judgement, new score {score}",
    afterVerify: "the live site confirmed {issue} is fixed",
    stillThere: "the live check found {issue} still there: reassure, no blame",
    nextUp: "suggest the next easy fix {issue} and its {gain}",
};

function flatSlots(bank) {
    return {
        intro: bank.intro, welcomeBack: bank.welcomeBack,
        "level.1": bank.level[1], "level.2": bank.level[2], "level.3": bank.level[3], "level.4": bank.level[4],
        "levelUp.2": bank.levelUp[2], "levelUp.3": bank.levelUp[3], "levelUp.4": bank.levelUp[4],
        afterMark: bank.afterMark, afterSelect: bank.afterSelect, selectionCleared: bank.selectionCleared, afterKeep: bank.afterKeep, afterVerify: bank.afterVerify, stillThere: bank.stillThere, nextUp: bank.nextUp,
    };
}

export function standardBank(types) {
    const bank = JSON.parse(JSON.stringify({ ...STANDARD, types: {} }));
    for (const t of types) bank.types[t.type] = { visitor: t.why || "Visitors and search engines may notice this problem.", nudge: STANDARD_NUDGE[t.effort] || STANDARD_NUDGE.medium };
    return bank;
}

export async function buildCoach({ types = [], provider = null, cache = null }) {
    const bank = standardBank(types);
    if (!provider || !types.length) return { bank, source: "standard", problems: [] };
    const request = {
        slots: Object.fromEntries(Object.keys(SLOT_HELP).map((k) => [k, { about: SLOT_HELP[k], placeholders: SLOTS[k] }])),
        types: types.map((t) => ({ type: t.type, title: t.title, why: t.why, severity: t.severity, priority: t.priority, area: t.area, effort: t.effort })),
        typePlaceholders: { visitor: SLOTS["type.visitor"], nudge: SLOTS["type.nudge"] },
    };
    const key = createHash("sha1").update(`${provider.name}|${provider.model}|${COACH_SYSTEM}|${JSON.stringify(request)}`).digest("hex");
    const problems = [];
    let used = 0;
    try {
        let raw = cache?.get(key);
        const cached = Boolean(raw);
        if (!raw) raw = await provider.complete({ system: COACH_SYSTEM, user: JSON.stringify(request), maxTokens: 3500 });
        const a = typeof raw === "string" ? JSON.parse(raw) : raw;
        const titles = types.map((t) => t.title);
        const take = (slot, text, others) => {
            const p = checkMessage(text, slot, others);
            if (p) { problems.push(`${slot}: ${p}`); return null; }
            used++;
            return text.trim();
        };
        for (const [slot, text] of Object.entries(a?.slots || {})) {
            if (!(slot in SLOT_HELP)) continue;
            const ok = take(slot, text, []);
            if (!ok) continue;
            const [k, n] = slot.split(".");
            if (n) bank[k][n] = ok; else bank[k] = ok;
        }
        for (const t of types) {
            const got = a?.types?.[t.type];
            if (!got) { problems.push(`${t.type}: missing`); continue; }
            const others = titles.filter((x) => x !== t.title);
            const v = take("type.visitor", got.visitor, others);
            const n = take("type.nudge", got.nudge, others);
            if (v) bank.types[t.type].visitor = v;
            if (n) bank.types[t.type].nudge = n;
        }
        if (used && !cached) cache?.set(key, raw);
    } catch (err) {
        problems.push(`AI: ${err.message}`);
    }
    return { bank, source: used ? "ai" : "standard", problems, aiMessages: used };
}

// For the tests: every message in a bank, by slot.
export const bankSlots = flatSlots;
