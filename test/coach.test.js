import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoach, checkMessage, fillMessage, standardBank, bankSlots, SLOTS, STANDARD } from "../lib/coach.js";
import { mockProvider } from "../lib/ai-provider.js";
import { mockRespond } from "../lib/ai-mock.js";

const types = [
    { type: "title-missing", title: "Page has no title", why: "Search results show the address instead.", severity: "high", priority: "P1", area: "on-page", effort: "easy", count: 2 },
    { type: "http-4xx-internal", title: "Broken internal link", why: "Visitors land on an error page.", severity: "high", priority: "P1", area: "technical", effort: "easy", count: 5 },
];
const provider = (answer) => ({ name: "test", model: "t", complete: async () => (typeof answer === "function" ? answer() : answer) });

test("a message may only use its own placeholders: no numbers, addresses, promises or other issues of its own", () => {
    assert.equal(checkMessage("Great work, your score is now {score}.", "afterMark"), null);
    assert.match(checkMessage("Your score jumped by 12 points!", "afterMark"), /number/);
    assert.equal(checkMessage("You are at {score} out of 100 today.", "intro"), null, "the scale is the one number allowed");
    assert.match(checkMessage("You are at {score} out of 1000 today.", "intro"), /number/);
    assert.match(checkMessage("Fix it for {gain} points and see {site}.", "type.nudge"), /\{site\}/);
    assert.match(checkMessage("Visit example.com for more help with this.", "stillThere"), /address/);
    assert.match(checkMessage("This will guarantee more customers for you.", "nextUp"), /promises/);
    assert.match(checkMessage("Fixing this will double your traffic quickly.", "nextUp"), /promises/);
    assert.match(checkMessage("<b>Fix</b> it now, it is easy to do.", "nextUp"), /HTML/);
    assert.match(checkMessage("Fix {issue now please, it is easy.", "nextUp"), /placeholder/);
    assert.match(checkMessage("Short", "nextUp"), /long or too short/);
    assert.match(checkMessage("x".repeat(300), "nextUp"), /long or too short/);
    assert.match(checkMessage("Visitors hit a Broken internal link here.", "type.visitor", ["Broken internal link"]), /another issue/);
    assert.equal(checkMessage(42, "nextUp"), "not text");
});

test("every built-in message passes the same checks", () => {
    for (const [slot, text] of Object.entries(bankSlots(STANDARD))) assert.equal(checkMessage(text, slot), null, slot);
    for (const t of ["Quick to fix, and worth {gain} points to your score.", standardBank([{ type: "a", effort: "hard" }]).types.a.nudge]) assert.equal(checkMessage(t, "type.nudge"), null);
    assert.ok(Object.keys(SLOTS).length >= 14);
});

test("fillMessage puts the measured numbers in and keeps the words right for one", () => {
    assert.equal(fillMessage("Fix {issue} for {gain} points.", { issue: "Missing title", gain: 3 }), "Fix Missing title for 3 points.");
    assert.equal(fillMessage("There are {urgent} urgent things to fix, worth {gain} points.", { urgent: 1, gain: 1 }), "There is 1 urgent thing to fix, worth 1 point.");
    assert.equal(fillMessage("Worth {gain} points.", { gain: "less than 1" }), "Worth less than 1 point.");
    assert.equal(fillMessage("Keep {unknown} as is.", {}), "Keep {unknown} as is.");
});

test("without AI, every message is the built-in one", async () => {
    const c = await buildCoach({ types, provider: null });
    assert.equal(c.source, "standard");
    assert.equal(c.bank.intro, STANDARD.intro);
    assert.equal(c.bank.types["title-missing"].visitor, "Search results show the address instead.");
    assert.match(c.bank.types["title-missing"].nudge, /\{gain\}/);
});

test("AI words are used only where they pass; each failure falls back to the built-in text", async () => {
    const answer = {
        slots: { intro: "Hi there! {site} is at {score} today, with {urgent} urgent fixes.", nextUp: "Try {issue}: 7 points!", stillThere: "{issue} is still there, nothing to worry about.", made_up: "ignored" },
        types: {
            "title-missing": { visitor: "People see a bare address in search results.", nudge: "Takes minutes and adds {gain} points." },
            "http-4xx-internal": { visitor: "Visitors hit a dead end; Page has no title also hurts.", nudge: "Guaranteed to rank first!" },
        },
    };
    const c = await buildCoach({ types, provider: provider(JSON.stringify(answer)) });
    assert.equal(c.source, "ai");
    assert.equal(c.bank.intro, answer.slots.intro);
    assert.equal(c.bank.nextUp, STANDARD.nextUp, "a number of its own: thrown away");
    assert.equal(c.bank.stillThere, answer.slots.stillThere);
    assert.equal(c.bank.types["title-missing"].nudge, "Takes minutes and adds {gain} points.");
    assert.equal(c.bank.types["http-4xx-internal"].visitor, "Visitors land on an error page.", "named another issue: thrown away");
    assert.equal(c.bank.types["http-4xx-internal"].nudge, standardBank(types).types["http-4xx-internal"].nudge);
    assert.ok(!("made_up" in c.bank));
    assert.equal(c.problems.length, 3);
});

test("an AI that fails or answers nonsense never breaks the report", async () => {
    for (const p of [provider(() => { throw new Error("timeout"); }), provider("not json"), provider(JSON.stringify({ slots: "x", types: null }))]) {
        const c = await buildCoach({ types, provider: p });
        assert.equal(c.source, "standard");
        assert.deepEqual(c.bank, standardBank(types));
    }
});

test("answers are cached, so the same report gets the same words", async () => {
    const store = new Map();
    const cache = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
    let calls = 0;
    const p = provider(() => { calls++; return JSON.stringify({ slots: { nextUp: "Next up: {issue}, worth {gain} points." }, types: {} }); });
    const a = await buildCoach({ types, provider: p, cache });
    const b = await buildCoach({ types, provider: p, cache });
    assert.equal(calls, 1);
    assert.deepEqual(a.bank, b.bank);
});

test("the mock AI answers the coach in the real shape", async () => {
    const c = await buildCoach({ types, provider: mockProvider(mockRespond) });
    assert.equal(c.source, "ai");
    assert.match(c.bank.nextUp, /\{issue\}.*\{gain\}/);
});
