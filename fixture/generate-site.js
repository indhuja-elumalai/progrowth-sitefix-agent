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
const FILLER =
  "This page belongs to a controlled test site built to validate a website crawler. Every page here is written to be " +
  "technically clean unless a fault was planted on purpose, so that anything a detector reports can be compared against a " +
  "known list. The body text is deliberately long enough that a short-content rule will never mistake this page for an empty one.";
const long = (extra) => `<p>${FILLER} ${extra}</p>`;
const LONG_ALT =
  "Bar chart comparing quarterly visitor numbers for every page on the fixture site across four years, " +
  "with a separate line showing the average bounce rate for each quarter";

function page({ file, title, desc, h1, body, canonical }) {
  const titleTag = title ? `<title>${title}</title>\n` : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${titleTag}<meta name="description" content="${desc}">
<link rel="canonical" href="${canonical || `${BASE}/${file}`}">
</head>
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
  ["large-image.html", "Large image page"],
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