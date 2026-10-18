// Reads a page's HTML into plain facts. No rules and no judgement in here:
// lib/seo.js, lib/social.js and lib/page-setup.js decide what is an issue.
// Pure functions (HTML text in, facts out), so everything can be unit-tested.
//
// extractHead(html) -> {
//   title, titleCount, description, descriptionCount, robots, canonicals,   (read from <head>)
//   og: { "og:title": ..., ... }, twitter: { "twitter:card": ..., ... }, viewport,  (read from <head>)
//   lang,                                                                   (from <html lang>)
//   h1s, headings: [{ level, text }]                                        (from the whole page, in order)
// }
// sameUrl(a, b)     -> true when two URLs differ only by a trailing slash or #fragment

const ENTITIES = [
    [/&amp;/g, "&"], [/&quot;/g, '"'], [/&#39;/g, "'"], [/&apos;/g, "'"],
    [/&lt;/g, "<"], [/&gt;/g, ">"], [/&nbsp;/g, " "],
];
function decode(s) {
    let out = s;
    for (const [re, to] of ENTITIES) out = out.replace(re, to);
    return out;
}
const clean = (s) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// Reads attributes out of one tag, whatever the quote style or order.
function parseAttrs(tag) {
    const attrs = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let m;
    const inner = tag.replace(/^<\w+/, "").replace(/\/?>$/, "");
    while ((m = re.exec(inner))) {
        attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    return attrs;
}

const MAX_HEADINGS = 100; // enough for any real outline; keeps report.json small

export function extractHead(html) {
    const text = html || "";
    // Title, meta and link tags only count inside <head>. This stops an inline
    // <svg><title> in the body from being mistaken for the page title.
    const headEnd = text.search(/<\/head\s*>/i);
    const head = headEnd === -1 ? text : text.slice(0, headEnd);

    const titles = [...head.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => clean(m[1]));
    const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => parseAttrs(m[0]));
    const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => parseAttrs(m[0]));

    const metaByName = (name) =>
        metas.filter((a) => (a.name || "").toLowerCase() === name).map((a) => clean(a.content || ""));
    const descriptions = metaByName("description");
    const robots = metaByName("robots").join(", ").toLowerCase() || null;
    const viewport = metaByName("viewport")[0] ?? null;

    // Open Graph uses property="og:..."; many sites also write name="og:...". Accept both.
    // Twitter uses name="twitter:..." (some write property=). First value wins.
    const prefixed = (prefix) => {
        const out = {};
        for (const a of metas) {
            const key = (a.property || a.name || "").toLowerCase();
            if (key.startsWith(prefix) && !(key in out)) out[key] = clean(a.content || "");
        }
        return out;
    };

    const canonicals = links
        .filter((a) => (a.rel || "").toLowerCase().split(/\s+/).includes("canonical"))
        .map((a) => (a.href || "").trim());

    const htmlTag = text.match(/<html\b[^>]*>/i);
    const lang = htmlTag ? (parseAttrs(htmlTag[0]).lang || "").trim() || null : null;

    const headings = [...text.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
        .slice(0, MAX_HEADINGS)
        .map((m) => ({ level: Number(m[1]), text: clean(m[2]).slice(0, 120) }));
    const h1s = [...text.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1]));

    return {
        title: titles[0] ?? null,
        titleCount: titles.length,
        description: descriptions[0] ?? null,
        descriptionCount: descriptions.length,
        h1s,
        canonicals,
        robots,
        og: prefixed("og:"),
        twitter: prefixed("twitter:"),
        viewport,
        lang,
        headings,
    };
}

// Used to compare URLs without caring about a trailing slash or a #fragment.
export function sameUrl(a, b) {
    const n = (u) => { try { const x = new URL(u); x.hash = ""; return x.href.replace(/\/$/, ""); } catch { return u; } };
    return n(a) === n(b);
}
