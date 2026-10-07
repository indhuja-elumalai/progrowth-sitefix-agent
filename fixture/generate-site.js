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
  ["canonical-to-404.html", "Canonical page"],
];
const nav = navLinks.map(([f, l]) => `<li><a href="/${f}">${l}</a></li>`).join("");

const pages = [
  { file: "index.html", title: "Fixture Home: Test Site for Crawler Validation",
    desc: "Entry page of the controlled test site used to validate every detector against a known set of planted issues.",
    h1: "Fixture test site", body: long("Use the links below to reach every page on the site.") + `<ul>${nav}</ul>` },

  // ---- clean control pages ----
  { file: "about.html", title: "About the Fixture Site and Its Purpose",
    desc: "Explains why this site exists: a controlled set of pages with a known number of planted technical faults.",
    h1: "About this fixture",
    body: long("This is the main clean control page.") + '<img src="/img/logo.svg" alt="Fixture logo" width="64" height="64">' },
  { file: "contact.html", title: "Contact the Fixture Team for Questions",
    desc: "How to reach the fixture team, a deliberately short but valid page used as a soft-404 negative test.",
    h1: "Contact us", body: "<p>Email hello@example.test or call 555-0100. We reply within one working day.</p>" },
  { file: "final.html", title: "Final Destination Page After Redirects",
    desc: "The page every redirect in the chain finally lands on, served normally with a 200 status.",
    h1: "Final destination", body: long("Redirect chains end here.") },

  // ---- planted faults ----
  { file: "broken-links.html", title: "Links Page with Two Dead Links Planted",
    desc: "Contains one dead internal link and one dead external link, plus a working external link as a control.",
    h1: "Resources",
    body: long("Below are three links.") +
      '<ul><li><a href="/does-not-exist.html">Old services page</a></li>' +
      '<li><a href="http://localhost:4001/gone">Partner resource</a></li>' +
      '<li><a href="http://localhost:4001/ok">Working partner link</a></li></ul>' },
  { file: "broken-image.html", title: "Image Page with One Missing Image Planted",
    desc: "Contains one image that returns 404 and one image that loads correctly, both with alt text.",
    h1: "Gallery",
    body: long("Two images follow.") +
      '<img src="/img/missing.jpg" alt="Missing hero image" width="200" height="100">' +
      '<img src="/img/logo.svg" alt="Fixture logo" width="64" height="64">' },
    { file: "redirects.html", title: "Redirect Page with a Chain and a Loop Planted",
    desc: "Links to a three-hop redirect chain, a redirect loop and a redirect to a missing page for testing redirect detection.",
    h1: "Redirect tests",
    body: long("Three redirect links follow.") +
      '<ul><li><a href="/redirect-chain-start">Old page, three hops to the new one</a></li>' +
      '<li><a href="/loop-a">Page that redirects in a loop</a></li>' +
      '<li><a href="/old-page">Old page that redirects to a missing page</a></li></ul>' },
  { file: "soft-404.html", title: "Page Not Found | Fixture Site",
    desc: "Sorry, we could not find the page you were looking for on this site.",
    h1: "Sorry, this page doesn't exist",
    body: "<p>The page you are looking for may have been moved or deleted. Return to the home page.</p>" },
  { file: "missing-title.html", title: null,
    desc: "A page with every tag present except the title, used to test missing-title detection.",
    h1: "Page without a title", body: long("The title tag is missing on purpose.") },
  { file: "dup-title-1.html", title: "Duplicate Title Example Page",
    desc: "First of two pages sharing the same title, used to test duplicate-title detection.",
    h1: "Duplicate title page one", body: long("This page shares its title with page two.") },
  { file: "dup-title-2.html", title: "Duplicate Title Example Page",
    desc: "Second of two pages sharing the same title, used to test duplicate-title detection.",
    h1: "Duplicate title page two", body: long("This page shares its title with page one.") },
  { file: "canonical-to-404.html", title: "Canonical Pointing at a Missing Page",
    desc: "This page declares a canonical URL that returns 404, which search engines cannot use.",
    h1: "Canonical test", body: long("The canonical tag points at a page that does not exist."),
    canonical: `${BASE}/gone-page.html` },
];

pages.forEach(page);

writeFileSync(
  path.join(siteDir, "img", "logo.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#2B7A78"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#fff" font-family="Arial">F</text></svg>\n'
);
console.log(`Wrote ${pages.length} pages and 1 image to ${siteDir}`);