// Writes the fixture's HTML pages into fixture/site/.
// Run:  node fixture/generate-site.js
// Re-run it any time you change a page below. Every page is clean
// (title, description, H1, canonical, long body) except the faults
// planted on purpose and listed in expected-issues.json.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
mkdirSync(path.join(siteDir, "img"), { recursive: true });

const BASE = "http://localhost:4000";
// Shared body text, over 200 words so no clean page is "thin". Because it is on
// most pages, the content rules treat it as boilerplate (like a menu or footer)
// and ignore it when comparing pages for near-duplicates.
const FILLER =
  "This page belongs to a controlled test site built to validate a website crawler. Every page here is written to be " +
  "technically clean unless a fault was planted on purpose, so that anything a detector reports can be compared against a " +
  "known list. The site is served by a small local server that answers with real status codes and real redirects, which " +
  "is something a static hosting service cannot do. Each planted fault is described in a separate answer key, together " +
  "with the page it lives on and the pages that link to it, and a scoring script compares every crawl with that key. " +
  "A detector passes only when it finds every planted fault and reports nothing else, because a tool that cries wolf " +
  "is as unhelpful as one that misses problems. Control pages carry no faults at all and must stay quiet in every run. " +
  "The body text on each page is deliberately long, written in plain sentences, and checked by hand, so that rules about " +
  "short pages, repeated words or leftover template text have a fair and realistic page to read. When a new detector " +
  "is added, a new page with exactly one new fault is added beside it, the answer key grows by one entry, and the " +
  "continuous integration job raises the number of faults it expects to find before any change can be merged. " +
  "Nothing on this site is real: the offices, services and people named here exist only to give the detectors something " +
  "believable to read, and no page collects any data from the people or tools that visit it. Anyone can run the whole " +
  "site on a laptop in a few seconds, which keeps the feedback loop short for everyone working on the crawler.";
// The page's own sentence first, then the shared filler as its own paragraph (so it is
// recognised as boilerplate, like a repeated footer block).
const long = (extra) => `<p>${extra}</p>\n<p>${FILLER}</p>`;
const LOCATION = (city) =>
  `Our ${city} office helps local law firms win more clients online. We build fast websites, write useful pages for every ` +
  "practice area, run search campaigns and report every month on calls, forms and signed cases. Firms that work with us " +
  "usually see more enquiries within the first quarter, and every plan includes a named strategist, monthly reviews and " +
  `clear pricing with no long contracts. Book a free audit and we will show you exactly where your ${city} firm is losing ` +
  "visitors and what to fix first. Our process starts with a technical review of your current site, then a competitor " +
  "study, then a ninety day plan with weekly milestones. We handle hosting, security updates, page speed and " +
  "accessibility, so your team can focus on clients instead of software. Every page we write is checked by an editor " +
  "and by a licensed attorney before it goes live, and every claim links to a source. Clients range from solo " +
  "practitioners to firms with forty lawyers, across personal injury, family law, immigration, estate planning and " +
  "employment cases. We publish our results openly, including the campaigns that did not work and what we changed " +
  `afterwards. If you run a practice in ${city} and want a second opinion on your marketing, our strategists are happy ` +
  "to talk it through without any obligation. Most first calls last thirty minutes, cover your current traffic, your " +
  "competitors and your goals for the year, and end with a short written summary you can share with your partners. " +
  "There is no setup fee, reports arrive on the first working day of each month, and you can pause or cancel any plan " +
  "with thirty days of notice if it is not delivering what we promised at the start.";
const LONG_ALT =
  "Bar chart comparing quarterly visitor numbers for every page on the fixture site across four years, " +
  "with a separate line showing the average bounce rate for each quarter";

// Every page gets lang, viewport and complete Open Graph tags unless a fault
// is planted on purpose:
//   og: true (title, description, image from the page) | false (none) | { "og:...": value } (exactly these)
//   robots: content of <meta name="robots">;  viewport / lang: false to leave them out
function page({ file, title, desc, h1, body, canonical, og = true, robots = null, viewport = true, lang = true }) {
  const titleTag = title ? `<title>${title}</title>\n` : "";
  const ogTags = og === true ? { "og:title": title || h1, "og:description": desc, "og:image": `${BASE}/img/logo.svg` } : og || {};
  const ogHtml = Object.entries(ogTags).map(([k, v]) => `<meta property="${k}" content="${v}">\n`).join("");
  const html = `<!doctype html>
<html${lang ? ' lang="en"' : ""}>
<head>
<meta charset="utf-8">
${viewport ? '<meta name="viewport" content="width=device-width, initial-scale=1">\n' : ""}${titleTag}<meta name="description" content="${desc}">
<link rel="canonical" href="${canonical || `${BASE}/${file}`}">
${robots ? `<meta name="robots" content="${robots}">\n` : ""}${ogHtml}</head>
<body>
<h1>${h1}</h1>
${body}
</body>
</html>
`;
  writeFileSync(path.join(siteDir, file), html);
}

const navLinks = [
  ["about.html", "About"], ["contact.html", "Contact"], ["final.html", "Final destination"],
  ["broken-links.html", "Links page"], ["broken-image.html", "Image page"], ["redirects.html", "Redirect page"],
  ["soft-404.html", "Soft 404 page"], ["missing-title.html", "Missing title page"],
  ["dup-title-1.html", "Duplicate title one"], ["dup-title-2.html", "Duplicate title two"],
  ["canonical-to-404.html", "Canonical page"], ["image-alt.html", "Image alt text page"],
  ["large-image.html", "Large image page"], ["noindex.html", "Hidden from search page"],
  ["heading-skip.html", "Heading order page"], ["no-social.html", "No share tags page"],
  ["social-partial.html", "Partial share tags page"], ["page-setup.html", "Page setup page"],
  ["location-austin.html", "Austin office"], ["location-denver.html", "Denver office"], ["draft-page.html", "Draft page"],
  ["typos-page.html", "Typos page"],
  ["slow-hero.html", "Slow hero page"], ["layout-shift.html", "Layout shift page"], ["busy-page.html", "Busy page"],
  ["heavy-page.html", "Heavy page"],
];
const nav = navLinks.map(([f, l]) => `<li><a href="/${f}">${l}</a></li>`).join("");

const pages = [
  {
    file: "index.html", title: "Fixture Home: Test Site for Crawler Validation",
    desc: "Entry page of the controlled test site used to validate every detector against a known set of planted issues.",
    h1: "Fixture test site", body: long("Use the links below to reach every page on the site.") + `<ul>${nav}</ul>`
  },

  // ---- clean control pages ----
  {
    file: "about.html", title: "About the Fixture Site and Its Purpose",
    desc: "Explains why this site exists: a controlled set of pages with a known number of planted technical faults.",
    h1: "About this fixture",
    body: long("This is the main clean control page.") + '<img src="/img/logo.svg" alt="Fixture logo" width="64" height="64">'
  },
  {
    file: "contact.html", title: "Contact the Fixture Team for Questions",
    desc: "How to reach the fixture team, a deliberately short but valid page used as a soft-404 negative test.",
    h1: "Contact us", body: "<p>Email hello@example.test or call 555-0100. We reply within one working day.</p>"
  },
  {
    file: "final.html", title: "Final Destination Page After Redirects",
    desc: "The page every redirect in the chain finally lands on, served normally with a 200 status.",
    h1: "Final destination", body: long("Redirect chains end here.")
  },

  // ---- planted faults ----
  {
    file: "broken-links.html", title: "Links Page with Two Dead Links Planted",
    desc: "Contains one dead internal link and one dead external link, plus a working external link as a control.",
    h1: "Resources",
    body: long("Below are three links.") +
      '<ul><li><a href="/does-not-exist.html">Old services page</a></li>' +
      '<li><a href="http://localhost:4001/gone">Partner resource</a></li>' +
      '<li><a href="http://localhost:4001/ok">Working partner link</a></li></ul>'
  },
  {
    file: "broken-image.html", title: "Image Page with One Missing Image Planted",
    desc: "Contains one image that returns 404 and one image that loads correctly, both with alt text.",
    h1: "Gallery",
    body: long("Two images follow.") +
      '<img src="/img/missing.jpg" alt="Missing hero image" width="200" height="100">' +
      '<img src="/img/logo.svg" alt="Fixture logo" width="64" height="64">'
  },
  {
    file: "redirects.html", title: "Redirect Page with a Chain and a Loop Planted",
    desc: "Links to a three-hop redirect chain, a redirect loop and a redirect to a missing page for testing redirect detection.",
    h1: "Redirect tests",
    body: long("Three redirect links follow.") +
      '<ul><li><a href="/redirect-chain-start">Old page, three hops to the new one</a></li>' +
      '<li><a href="/loop-a">Page that redirects in a loop</a></li>' +
      '<li><a href="/old-page">Old page that redirects to a missing page</a></li>' +
      '<li><a href="/old-help">Old help page</a></li>' +
      '<li><a href="/old-faq">Old FAQ page</a></li></ul>'
  },
  // Mimics sonagroup.ae/404.html: answers 200, says "404", and is never linked
  // directly; two old links redirect into it. Not in the nav on purpose.
  {
    file: "gone.html", title: "Error 404: Content Unavailable",
    desc: "A help page that answers 200 OK but is really an error page, reached only through redirects.",
    h1: "Fixture help centre", body: long("Two old links redirect to this page.")
  },
  {
    file: "soft-404.html", title: "Page Not Found | Fixture Site",
    desc: "Sorry, we could not find the page you were looking for on this site.",
    h1: "Sorry, this page doesn't exist",
    body: "<p>The page you are looking for may have been moved or deleted. Return to the home page.</p>"
  },
  {
    file: "missing-title.html", title: null,
    desc: "A page with every tag present except the title, used to test missing-title detection.",
    h1: "Page without a title", body: long("The title tag is missing on purpose.")
  },
  {
    file: "dup-title-1.html", title: "Duplicate Title Example Page",
    desc: "First of two pages sharing the same title, used to test duplicate-title detection.",
    h1: "Duplicate title page one", body: long("This page shares its title with page two.")
  },
  {
    file: "dup-title-2.html", title: "Duplicate Title Example Page",
    desc: "Second of two pages sharing the same title, used to test duplicate-title detection.",
    h1: "Duplicate title page two", body: long("This page shares its title with page one.")
  },
  {
    file: "image-alt.html", title: "Image Alt Text Page with Three Faults Planted",
    desc: "Contains one image without alt text, one with a file name as alt text, one with over-long alt text, and two decorative images.",
    h1: "Team gallery",
    body: long("Five images follow: three with planted alt-text faults and two decorative controls.") +
      // F-13: no alt attribute at all
      '<img src="/img/office.svg" width="64" height="64">' +
      // F-14: the alt text is just a camera file name
      '<img src="/img/team-photo.svg" alt="IMG_0042.jpg" width="64" height="64">' +
      // F-15: alt text over 125 characters
      `<img src="/img/chart.svg" alt="${LONG_ALT}" width="64" height="64">` +
      // Controls: decorative images must NOT be flagged (alt="" and aria-hidden)
      '<img src="/img/divider.svg" alt="" width="64" height="4">' +
      '<img src="/img/pattern.svg" aria-hidden="true" width="64" height="64">'
  },
  {
    file: "large-image.html", title: "Large Image Page with One Oversized Image",
    desc: "Contains one well described image whose file is larger than 300 KB, used to test the oversized-image rule.",
    h1: "Product showcase",
    // F-16: fixture/server.js generates /img/large-banner.svg in memory (over 300 KB), so no big file is committed
    body: long("One large image follows.") +
      '<img src="/img/large-banner.svg" alt="Wide product banner showing the full fixture range" width="640" height="160">'
  },
  // ---- SEO: indexing ----
  {
    // F-17 and F-18: robots meta asks search engines not to index or follow this page
    file: "noindex.html", title: "Page Hidden From Search with Noindex Planted",
    desc: "A normal page whose robots meta tag says noindex, nofollow, so search engines are told to drop it and ignore its links.",
    h1: "Hidden from search", body: long("The robots meta tag on this page says noindex, nofollow."),
    robots: "noindex, nofollow"
  },
  // ---- SEO: titles & descriptions ----
  {
    // F-19: heading levels skip from H2 straight to H4
    file: "heading-skip.html", title: "Heading Order Page with One Skipped Level",
    desc: "A page whose headings go from H2 straight to H4, skipping H3, used to test the heading-order rule.",
    h1: "Service overview",
    body: long("The headings below skip a level on purpose.") +
      "<h2>What we offer</h2><p>Three service tiers.</p><h4>Tier details</h4><p>Details for each tier.</p>"
  },
  // ---- Social sharing ----
  {
    // F-20: no Open Graph tags at all
    file: "no-social.html", title: "Page with No Open Graph Share Tags Planted",
    desc: "A page with no Open Graph tags, so a shared link shows no title, description or preview image.",
    h1: "No share tags", body: long("This page has no Open Graph tags."), og: false
  },
  {
    // F-21: og:description missing; F-22: og:image points at a missing file
    file: "social-partial.html", title: "Page with Partial Open Graph Tags Planted",
    desc: "A page with an Open Graph title and a share image that returns 404, but no Open Graph description.",
    h1: "Partial share tags", body: long("This page has incomplete Open Graph tags."),
    og: { "og:title": "Partial share tags", "og:image": `${BASE}/img/missing-share.png` }
  },
  // ---- Page setup ----
  {
    // F-23: no viewport meta tag; F-24: no lang on <html>
    file: "page-setup.html", title: "Page Setup Page Missing Viewport and Language",
    desc: "A page with no viewport meta tag and no lang attribute on the html element, used to test the page-setup rules.",
    h1: "Page setup test", body: long("This page has no viewport tag and no language attribute."),
    viewport: false, lang: false
  },
  // ---- Content ----
  // F-26 and F-27: two location pages built from one template with only the city
  // swapped, the classic near-duplicate pattern (no shared filler, all their own text).
  {
    file: "location-austin.html", title: "Austin Office for Law Firm Marketing",
    desc: "Law firm marketing from our Austin office: websites, practice area pages, search campaigns and monthly reporting.",
    h1: "Law firm marketing in Austin", body: `<p>${LOCATION("Austin")}</p>`
  },
  {
    file: "location-denver.html", title: "Denver Office for Law Firm Marketing",
    desc: "Law firm marketing from our Denver office: websites, practice area pages, search campaigns and monthly reporting.",
    h1: "Law firm marketing in Denver", body: `<p>${LOCATION("Denver")}</p>`
  },
  {
    // F-28: leftover placeholder text (lorem ipsum and an unfilled template tag)
    // F-29: a word repeated twice in a row ("the the")
    file: "draft-page.html", title: "Draft Page Published with Placeholder Text",
    desc: "A page that went live before it was finished: it still has lorem ipsum, an unfilled template tag and a doubled word.",
    h1: "Our services",
    body: long("This page was published before its copy was finished.") +
      "<p>Welcome to {{ company_name }}, your trusted partner.</p>" +
      "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>" +
      "<p>Contact the the team for a free consultation.</p>"
  },
  {
    // F-30: two common misspellings ("recieve", "seperate") in otherwise clean copy.
    // AI proofreading is skipped on local addresses, so only the built-in list runs here.
    file: "typos-page.html", title: "Typos Page with Two Misspellings Planted",
    desc: "A support page whose copy contains two common misspellings, used to test the spelling check against a known answer.",
    h1: "How we handle enquiries",
    body: long("This page explains how enquiries are handled.") +
      "<p>We recieve every enquiry through the contact form and reply within one working day.</p>" +
      "<p>Our team will seperate urgent requests from routine ones so nothing important waits.</p>"
  },
  // ---- Page speed (lib/speed.js, a phone over slow 4G) ----
  {
    // F-31: the hero image fills the first screen and fixture/server.js sends it after
    // 4.5 seconds, so the main content (LCP) appears late on any connection.
    file: "slow-hero.html", title: "Slow Hero Page with a Late Main Image",
    desc: "A landing page whose large hero image arrives late from the server, used to test the slow main content rule.",
    h1: "Welcome to the studio",
    body: '<img src="/img/slow-hero.svg" alt="Studio reception with the team at work" width="412" height="700" style="display:block;width:100%;height:700px;object-fit:cover">' +
      long("The hero image above is the largest thing on the first screen.")
  },
  {
    // F-32: half a second after loading, a tall banner is inserted at the top and
    // pushes the whole page down (a large layout shift).
    file: "layout-shift.html", title: "Layout Shift Page with a Late Top Banner",
    desc: "A page where a banner appears at the top after loading and pushes the content down, used to test layout shift.",
    h1: "Spring offers",
    body: long("A banner appears above this text shortly after the page loads.") +
      "<script>setTimeout(function(){var b=document.createElement('div');b.style.cssText='height:420px;background:#EE6C4D;color:#fff;padding:20px';" +
      "b.textContent='Book a free audit this month.';document.body.insertBefore(b,document.body.firstChild);},500);</script>"
  },
  {
    // F-33: after loading, three scripts each keep the page busy for 400 ms, so taps
    // would not respond for over a second (total blocking time).
    file: "busy-page.html", title: "Busy Page with Long Scripts After Loading",
    desc: "A page that runs three long scripts after it loads, so it cannot respond to taps, used to test blocking time.",
    h1: "Interactive pricing",
    body: long("The pricing calculator on this page runs heavy scripts after loading.") +
      "<script>addEventListener('load',function(){function busy(){var t=Date.now();while(Date.now()-t<400){}}" +
      "setTimeout(busy,0);setTimeout(busy,450);setTimeout(busy,900);});</script>"
  },
  {
    // F-34: a small decorative background image that is a 3.3 MB file, so the page
    // downloads over 3 MB in total. A CSS background is not an <img>, so the
    // oversized-image rule does not see it; the page weight does.
    file: "heavy-page.html", title: "Heavy Page with a Very Large Background File",
    desc: "A page with a small decorative background that is a very large file, used to test the total page weight rule.",
    h1: "Our materials",
    body: long("A small textured badge sits below this text.") +
      '<div style="width:24px;height:24px;background:url(/img/heavy-texture.png) center/cover"></div>'
  },
  {
    file: "canonical-to-404.html", title: "Canonical Pointing at a Missing Page",
    desc: "This page declares a canonical URL that returns 404, which search engines cannot use.",
    h1: "Canonical test", body: long("The canonical tag points at a page that does not exist."),
    canonical: `${BASE}/gone-page.html`
  },
];

pages.forEach(page);

// Small SVG images (a letter on a coloured square). large-banner.svg is not
// written here: fixture/server.js generates it in memory.
const svg = (letter, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="${color}"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#fff" font-family="Arial">${letter}</text></svg>\n`;
const images = {
  "logo.svg": svg("F", "#2B7A78"),
  "office.svg": svg("O", "#3D5A80"),
  "team-photo.svg": svg("T", "#98C1D9"),
  "chart.svg": svg("C", "#EE6C4D"),
  "divider.svg": svg("-", "#CCCCCC"),
  "pattern.svg": svg("~", "#DDDDDD"),
};
for (const [name, body] of Object.entries(images)) writeFileSync(path.join(siteDir, "img", name), body);
console.log(`Wrote ${pages.length} pages and ${Object.keys(images).length} images to ${siteDir}`);