// What the chat box received: a website to inspect, several websites, something that is
// almost a website address, an address that isn't a website, or a question.
// The same function runs in the browser (ui/build-index.js copies its source into the
// page), so it must stay self-contained: no imports, no outside variables.
//
// classifyInput(text) ->
//   { kind: "url", url }                    one website: inspect it
//   { kind: "urls", urls }                  several websites: ask which one first
//   { kind: "near-url", suggestion }        "progrowthservices", "progrowth .services": did you mean…?
//   { kind: "not-web", what }               an email, ftp://, mailto: …: only websites can be checked
//   { kind: "question" }                    anything else: a question about the report on screen
// url / urls / suggestion are full addresses (https:// added; http:// for localhost).

export function classifyInput(text) {
    const s = String(text || "").trim();
    if (!s) return { kind: "question" };
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?$/i;
    const domain = /^(www\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}(:\d+)?([/?#]\S*)?$/i;
    const full = function (t) {
        const u = /^https?:\/\//i.test(t) ? t : (local.test(t) ? "http://" : "https://") + t;
        try {
            const x = new URL(u);
            if (x.protocol !== "http:" && x.protocol !== "https:") return null;
            return x.href;
        } catch (e) { return null; }
    };
    const isSite = function (t) { return /^https?:\/\/\S+$/i.test(t) || local.test(t) || domain.test(t); };
    // Addresses that aren't websites.
    if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return { kind: "not-web", what: "an email address" };
    const scheme = s.match(/^(ftp|sftp|file|mailto|tel|javascript|data|ws|wss|ssh|smb):/i);
    if (scheme && !/\s/.test(s)) return { kind: "not-web", what: scheme[1].toLowerCase() + ": address" };
    // Words in the message, without the punctuation around them.
    const words = s.split(/[\s,;|]+/).map(function (w) { return w.replace(/^[("'<\[]+|[)"'>\].!?:]+$/g, ""); }).filter(Boolean);
    const sites = [];
    for (let i = 0; i < words.length; i++) {
        if (!isSite(words[i])) continue;
        const u = full(words[i]);
        if (u && sites.indexOf(u) === -1) sites.push(u);
    }
    if (sites.length >= 2) return { kind: "urls", urls: sites.slice(0, 10) };
    if (sites.length === 1) {
        // The address alone, or with a word asking to check it ("check progrowth.services").
        const others = words.filter(function (w) { return !isSite(w); }).map(function (w) { return w.toLowerCase(); });
        const asks = /^(please|pls|can|could|you|check|inspect|audit|scan|crawl|analy[sz]e|test|review|run|on|this|site|website|the|my|for|me|and|a|an|now|do|of)$/;
        if (others.every(function (w) { return asks.test(w); })) return { kind: "url", url: sites[0] };
        return { kind: "question" };
    }
    // Almost an address: a dot with spaces around it ("progrowth .services"), or a name
    // run into a common ending ("progrowthservices", "examplecom").
    const spaced = s.match(/^(?:https?:\/\/)?(www\s*\.\s*)?([a-z0-9-]{2,})\s*\.\s*([a-z]{2,24})\s*$/i);
    if (spaced && /\s/.test(s)) return { kind: "near-url", suggestion: full((spaced[1] ? "www." : "") + spaced[2] + "." + spaced[3]) };
    const runOn = s.match(/^(?:https?:\/\/)?(www\.)?([a-z0-9-]{4,})(com|net|org|services|agency|online|store|tech)$/i);
    if (runOn && !/\s/.test(s)) return { kind: "near-url", suggestion: full((runOn[1] || "") + runOn[2] + "." + runOn[3]) };
    return { kind: "question" };
}
