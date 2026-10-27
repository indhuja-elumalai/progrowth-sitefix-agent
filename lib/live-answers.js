// Instant answers to questions about the inspection itself (how it works, why it
// takes this long, how long is left, what has been found so far, whether the site is
// changed). They need no AI and no finished report: they use the live numbers, so the
// chat can answer them while the crawl is still running, and after it from the run's
// own timings. Anything else returns null and goes to the AI as usual.
//
// The same function runs in the browser (ui/build-index.js copies its source into the
// page), so it must stay self-contained: no imports, no outside variables.
//
// answerProcessQuestion(question, ctx) -> { kind, answer } or null
//   ctx.running   true while the inspection runs
//   ctx.site      the site's address
//   ctx.phase     crawl | links | images | seo | content | spelling | crawled | report | pdf
//   ctx.pages     { done, found, sitemap, cap }      ctx.checks { done, total }
//   ctx.issues    { high, medium, low, total }        ctx.findings [{ type, severity, url }]
//   ctx.elapsedMs, ctx.etaMs, ctx.avgLoadMs, ctx.slowDowns
//   ctx.seconds   when finished: { total, pages, ... } from the run (links.json summary)
//   ctx.partial   when finished early on a large site: { reason, pagesFound } (issues.json run)
//   ctx.label     (type) -> plain name of an issue type

export function answerProcessQuestion(question, ctx) {
    ctx = ctx || {};
    const q = " " + String(question || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ") + " ";
    const has = function (re) { return re.test(q); };
    const pages = ctx.pages || {};
    const done = pages.done || 0;
    const total = Math.max(pages.found || 0, pages.sitemap || 0, done);
    const label = ctx.label || function (t) { return t; };
    const site = ctx.site ? String(ctx.site).replace(/^https?:\/\//, "").replace(/\/$/, "") : "your site";
    const plural = function (n, w) { return n + " " + w + (n === 1 ? "" : "s"); };
    const dur = function (ms) {
        const s = Math.round(ms / 1000);
        if (s < 60) return plural(s, "second");
        const m = Math.floor(s / 60), r = s % 60;
        return plural(m, "minute") + (r ? " " + plural(r, "second") : "");
    };
    const path = function (u) { try { const x = new URL(u); return x.pathname + x.search; } catch (e) { return u || ""; } };
    const STEP = { crawl: "reading pages", links: "finishing the link and image checks", images: "finishing the image checks", seo: "comparing titles, tags and headings across pages", content: "comparing page content", spelling: "checking spelling and grammar", speed: "timing pages on a phone over 4G", crawled: "preparing the report", report: "writing the explanations and taking screenshots", pdf: "building the PDF and web report" };

    // 1. Will it change my site?
    if (has(/ (change|changes|changing|modify|edit|touch|break|harm|damage|affect|hurt) .*(site|website|page|server|anything)|read only|is (it|this) safe|safe to run|do you (change|edit|fix)/)) {
        return { kind: "safe", answer: "No. I only read " + site + ", the same way a visitor's browser does: I open pages and check links and images. I never log in, submit forms, book anything or change anything on the site. I also pace my requests, and slow down straight away if the server asks me to, so it is never overloaded." };
    }

    // 2. How does it work?
    if (has(/ how (does|do|is|are) (the |this |it |you )?(crawl|crawling|crawler|inspection|inspect|scan|check|checking|work|working)| mechanism | (how|what) (it|this) (works|does)| what happens | explain (the |how )?(crawl|process|inspection)|how are you (crawling|checking|doing this)| process behind /)) {
        return {
            kind: "how",
            answer: "Here's how it works:\n" +
                "- I start at the home page and the sitemap, and follow every link to " + site + " until I've found every page I can reach" + (done ? " (" + plural(done, "page") + " read so far)" : "") + ".\n" +
                "- I open each page in a real browser, the way a visitor would, so content added by JavaScript counts too. I read 8 pages at a time.\n" +
                "- On each page I read the title, description, headings, links, images and text. Every link and image is checked once, directly, while the crawl carries on.\n" +
                "- When all pages are read, I compare them with each other (duplicate titles, near-identical content) and check spelling and grammar.\n" +
                "- Then I time up to 40 pages the way a visitor on a phone over 4G sees them: how fast the main content shows, whether the layout jumps, and how heavy each page is.\n" +
                "- Then I write the report: what to fix first, why it matters, how to fix it, with screenshots.\n" +
                "I only read the site; nothing on it is changed.",
        };
    }

    // 3. Why does it take this long?
    if (has(/ why .*(long|slow|taking|time)| so (long|slow) | taking (so |this |that )?(long|much time|a while)| (speed|hurry) (it )?up | (be |go |run )?faster | slow | takes? (so |this )?long /)) {
        if (ctx.running) {
            const perMin = ctx.elapsedMs > 5000 && done ? Math.round(done / (ctx.elapsedMs / 60000)) : null;
            const lines = [];
            lines.push("- Size: " + site + " has " + (pages.found > done ? "at least " : "") + plural(total, "page") + (pages.sitemap ? " (" + pages.sitemap + " listed in its sitemap)" : "") + ", and I check every one of them" + (ctx.checks && ctx.checks.total ? ", plus " + plural(ctx.checks.total, "link and image") .replace("link and images", "links and images") : "") + ".");
            if (ctx.avgLoadMs) lines.push("- Your server: each page takes about " + (Math.round(ctx.avgLoadMs / 100) / 10) + " s to load" + (ctx.avgLoadMs >= 2000 ? ". That's slow, and it's the biggest factor right now" : "") + ".");
            lines.push("- Real browser: I open each page the way a visitor's browser does, so content added by JavaScript is included. That's slower than just downloading the HTML, but it's what your visitors and Google actually see.");
            if (ctx.slowDowns) lines.push("- Your server asked me to slow down " + plural(ctx.slowDowns, "time") + ", and I did, so it isn't overloaded.");
            const pace = ctx.phase === "crawl"
                ? (perMin ? "I'm reading about " + perMin + " pages a minute" + (ctx.etaMs ? ", so about " + dur(ctx.etaMs) + " are left for the pages" : "") + ". " : "") + "After that, the comparisons and the report usually take about a minute."
                : "All the pages are read; I'm now " + (STEP[ctx.phase] || "finishing up") + ". That's the last part.";
            return { kind: "why-long", answer: "Here's where the time goes:\n" + lines.join("\n") + "\n" + pace };
        }
        if (ctx.seconds && ctx.seconds.total) {
            const s = ctx.seconds;
            return {
                kind: "why-long",
                answer: "This inspection took " + dur(s.total * 1000) + " to check " + plural(done, "page") + ". " +
                    (s.pages ? "Reading the pages took " + dur(s.pages * 1000) + "; that part grows with the number of pages and with how fast the server answers" + (ctx.avgLoadMs ? " (about " + (Math.round(ctx.avgLoadMs / 100) / 10) + " s per page here)" : "") + ". " : "") +
                    "I open every page in a real browser so that content added by JavaScript is included, and I pace my requests so the server is never overloaded.",
            };
        }
        return null;
    }

    // 4. How long is left / how far along is it?
    if (has(/ how (long|much longer|much more|much time)| when (will|is|does) .*(done|finish|finished|ready|end)| time left | eta | how far | progress | almost (done|there) | how many pages /)) {
        if (ctx.running) {
            if (ctx.phase === "crawl") {
                return { kind: "eta", answer: plural(done, "page") + " read out of " + (pages.found > done && !pages.cap ? "at least " : "") + (pages.cap ? Math.min(total, pages.cap) : total) + (ctx.etaMs ? ", about " + dur(ctx.etaMs) + " left for the pages" : "") + ". After that: comparing pages, spelling, then the report, usually about a minute. You can keep asking me things meanwhile." };
            }
            return { kind: "eta", answer: "All " + plural(done, "page") + " are read. I'm now " + (STEP[ctx.phase] || "finishing up") + ", the last part. It usually takes about a minute." };
        }
        if (ctx.seconds && ctx.seconds.total) return { kind: "eta", answer: "It's finished: " + plural(done, "page") + " checked in " + dur(ctx.seconds.total * 1000) + "." + (ctx.partial && ctx.partial.pagesFound > done ? " The site is larger (at least " + ctx.partial.pagesFound + " pages found), so I read a share of every section to keep the inspection short." : "") };
        return null;
    }

    // 5. What gets checked?
    if (has(/ what (are|do|will|did) you (check|checking|look|looking|test|testing)| what (gets|is|was|are|were) (being )?(checked|tested)| which checks | what do you look for /)) {
        return {
            kind: "what",
            answer: "On every page I check:\n" +
                "- Links and redirects: broken links, redirect chains and loops, error pages that pretend to be fine.\n" +
                "- Search: titles, meta descriptions, headings, canonical tags, and pages hidden from Google.\n" +
                "- Sharing: how links to your pages look on social media.\n" +
                "- Images: broken images, missing or unhelpful alt text, oversized files.\n" +
                "- Content: thin or near-duplicate pages, leftover placeholder text, spelling and grammar.\n" +
                "- Page setup: mobile viewport and page language.\n" +
                "- Page speed: how fast the main content shows on a phone over 4G, layout jumps, blocking scripts, server response and page weight.\n" +
                "Each problem gets a priority, who should fix it, and how.",
        };
    }

    // 6. What has been found so far? (only while running; afterwards the report answers it)
    if (ctx.running && has(/ so far | (found|spotted|seen|noticed) (anything|something|any|problems|issues)| (anything|something) (wrong|bad|broken)| any (problems|issues|errors) (yet|now)| what (have|did) you (found|find|spotted)/)) {
        const i = ctx.issues || {};
        const f = (ctx.findings || []).slice();
        if (!i.total && !f.length) return { kind: "found", answer: "Nothing yet. Problems show up here as soon as I find them." };
        const order = { high: 0, medium: 1, low: 2 };
        const rank = function (x) { return x.severity in order ? order[x.severity] : 3; };
        f.sort(function (a, b) { return rank(a) - rank(b); });
        const top = [], seenTypes = {};
        for (let k = 0; k < f.length && top.length < 3; k++) {
            if (seenTypes[f[k].type]) continue;
            seenTypes[f[k].type] = 1;
            top.push("- " + label(f[k].type) + (f[k].url ? " (" + path(f[k].url) + ")" : ""));
        }
        return {
            kind: "found",
            answer: "So far: " + (i.high || 0) + " high, " + (i.medium || 0) + " medium and " + (i.low || 0) + " low priority problems." + (top.length ? " The most serious:\n" + top.join("\n") : "") + "\nThis is a live count; the full list with explanations comes with the report.",
        };
    }
    return null;
}
