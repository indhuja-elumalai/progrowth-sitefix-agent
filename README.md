# progrowth-sitefix-agent

An internal AI-assisted agent that inspects any client website, flags
technical, SEO, and accessibility faults with evidence, and, only after
human approval, applies the fix and verifies it actually worked.

This is **not** a website builder and **not** a CMS. It is a technical QA
and error-rectification agent that sits on top of a site that already
exists.

**Status:** Phase 1, Day 2 of 12 complete. See [Current sprint](#10-current-sprint-oct-5-to-oct-17-2026).

---

## 1. Why this exists

Today, when a client site has a problem, the workflow is entirely manual:
someone inspects the site, hunts for broken pages, checks SEO and metadata
by hand, decides what to change, makes the change, and manually re-checks
that it worked. This agent is built to take over that loop (detection,
explanation, proposal, approval, execution, and verification) without
removing the human from any decision that matters.

## 2. The one rule the whole design follows

> **The AI never decides facts. It only explains and proposes.**

A crawler and a set of deterministic checks establish every raw fact (a
status code, a canonical tag, a missing title). Only after a fact exists
does the AI layer explain it in plain language and suggest a fix. The AI
never crawls, never invents a fact, never applies a fix, and never closes
an issue. A human approves every fix before it ships, and a separate
verification step, not the act of applying the fix, is what closes an
issue.

## 3. Architecture

```mermaid
flowchart TD
    A[Access & connect<br/>public / staging / connected source] --> B[Crawl & render]
    B --> C[Deterministic detectors]
    C --> D[Evidence store<br/>HTTP, DOM, screenshots, linking pages]
    D --> E[AI reasoning<br/>explains & proposes only]
    E --> F[Issue registry]
    F --> G[Human approval]
    G --> H[Fix executor<br/>platform adapters]
    H --> I[Re-crawl]
    I --> J[Verification]
    J -->|failed| G
    J -->|passed| K[Issue closed]
```

Each stage produces a typed artifact the next stage consumes. Nothing
downstream re-derives a fact a stage above it already established, and
nothing in the pipeline can skip the human-approval step.

## 4. What Phase 1 detects

| Category | What we check for |
|---|---|
| HTTP and URLs | 404 / 410 / 5xx pages, broken links, redirect chains and loops, HTTP/HTTPS and www mismatches |
| Soft 404s | Pages that return 200 OK but read like an error page (not-found title or H1, near-empty body) |
| SEO and metadata | Missing or duplicate titles and meta descriptions, missing H1, broken heading structure |
| Canonical tags | Missing or duplicate canonical tag, canonical pointing to a 404 or to a redirect |
| Sitemap and robots | robots.txt errors, sitemap URLs that error, redirect, or are wrongly marked noindex |
| Images | Broken images, missing alt text, oversized files, HTTP images on HTTPS pages |
| Links | Broken or redirected internal/external links, plus every page that links to the broken one |
| Structured data and accessibility | Invalid schema/Open Graph tags, missing form labels, heading structure, contrast signals |

Every finding carries evidence (a status code, a screenshot, or a DOM
snippet), never a guess. This list is adapted from the overlapping
categories used by established site-audit tools (Semrush, Ahrefs,
Sitebulb), consolidated into a set sized for Phase 1 rather than a full
clone of a mature enterprise crawler.

**Coverage in the current sprint (to Oct 17):** HTTP/URLs, links, soft
404s, canonical and metadata are built and tested; image and sitemap
checks are basic; robots.txt parsing, structured data and accessibility
follow in the next block.

## 5. How a fix is classified

| Fix category | Examples | Who decides the content | Who executes |
|---|---|---|---|
| Safe / deterministic | Redirecting a known-broken link to its one obvious replacement, removing byte-identical duplicate meta tags | A rule engine; the answer is unambiguous | Adapter, after human approval |
| AI-proposed, human-approved | Generating a meta description, choosing a redirect target among several candidates, generating alt text | AI, from evidence only | Adapter, after human approval |
| Detected, not yet automatable | Most performance and accessibility findings; any platform without a working adapter | N/A | Routed to a manual engineering ticket |
| Never autonomous | Deleting pages, changing auth, modifying databases, payment logic, DNS, destructive production changes | N/A | Never this system |

Classification goes by **what the change touches** (which file, API, or
table), not by the issue's category label alone.

## 6. Access model and platform adapters

| Level | What it is | Unlocks |
|---|---|---|
| 1: Public | The live URL, no credentials | Detection only |
| 2: Staging | Login credentials or custom headers for a gated site | Detection on pre-release environments |
| 3: Connected source | GitHub, WordPress, or Webflow access | Required before any fix can be executed |

| Platform | How we connect | How a fix lands |
|---|---|---|
| **GitHub sites (pilot)** | Scoped token or GitHub App, one repo only | Branch, patch, diff, pull request, CI, human merges |
| WordPress | REST API, scoped application password | Title/meta/alt text: direct write. Canonical: only if the site's SEO plugin exposes it for writing (Yoast's REST API is read-only by default). Redirects: need a redirect plugin or server rule |
| Webflow | CMS API; Designer API for structural fields | Content fields via CMS API. Redirects and canonical usually need a manual Designer step |
| Anything else | No adapter built yet | A fully-specified ticket a human applies by hand |

Behind the GitHub adapter, any framework in the repo rides the same
branch/PR/CI flow: Next.js, React, static HTML, PHP/Laravel, custom CMS.
The AI never holds these credentials; only the adapter layer does, and
only after a human approves. None of the adapters are built yet.

## 7. Phase boundaries

- **Phase 1 (this repo):** detect, explain, propose, get human approval,
  execute only low-risk fixes, verify. No content editing, no CMS, no
  autonomous production changes.
- **Phase 2 (later, separate effort):** an editable CMS layer for page
  content, sections and images. Deliberately kept out of Phase 1's schema
  and UI so it can be added later without a rebuild.

**Out of scope for Phase 1:** a visual CMS or content editor, publishing
new pages, autonomous or unapproved production changes, full performance
re-engineering, content strategy work, and heavy infrastructure
(multi-agent orchestration, Kubernetes) before it is needed.

## 8. Tech stack

| Layer | Tool | Status |
|---|---|---|
| Crawler and renderer | Node.js, Playwright (headless Chromium) | In use |
| Test fixture and scoring | Node.js built-ins (`http`, `fetch`) | In use |
| CI | GitHub Actions | In use |
| Issue registry | JSON file now, PostgreSQL later | Planned |
| AI reasoning | Claude API | Planned |
| Fix adapter | GitHub REST API | Planned |
| Secrets | GitHub Actions secrets now, a secrets manager later | Planned |
| Dashboard | React + Tailwind | Planned |

## 9. Repository layout

```
progrowth-sitefix-agent/
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md      every PR must fill this in
│   └── workflows/
│       ├── crawl.yml                  run the crawler on any URL (manual)
│       └── fixture-selfcheck.yml      verify, crawl and score the fixture on every change
├── fixture/                           controlled test site with planted faults
│   ├── generate-site.js               writes the 12 HTML pages into site/
│   ├── server.js                      serves them with real HTTP redirects
│   ├── selfcheck.js                   proves the fixture behaves as claimed
│   ├── score.js                       scores crawler output against the planted issues
│   ├── expected-issues.json           ground truth: the 10 planted issues
│   └── site/                          generated pages
├── crawl.js                           the crawler (page crawl + direct link checks)
├── package.json
├── .gitignore
└── README.md
```

## 10. Current sprint: Oct 5 to Oct 17, 2026

Goal: turn the Week 1 crawler into a tested detection engine that records
every finding with evidence in an issue registry, with an AI layer that
explains each finding from that evidence only. 12 working days, Monday to
Saturday. Fridays are a half day of build plus review preparation.

| Day | Date | Aim | Status |
|---|---|---|---|
| 1 | Mon Oct 5 | Test fixture with planted faults and ground truth | **Done** |
| 2 | Tue Oct 6 | Crawl coverage: configurable page cap, check every link directly, found-on map | **Done** |
| 3 | Wed Oct 7 | HTTP and redirect detector | Planned |
| 4 | Thu Oct 8 | Metadata and canonical detector | Planned |
| 5 | Fri Oct 9 | Soft-404 rule, then Week 1 review prep | Planned |
| 6 | Sat Oct 10 | Evidence capture and issue schema, registry v0 | Planned |
| 7 | Mon Oct 12 | Registry across runs, image and sitemap checks | Planned |
| 8 | Tue Oct 13 | AI layer: input and output contract | Planned |
| 9 | Wed Oct 14 | AI layer: guardrails and evaluation | Planned |
| 10 | Thu Oct 15 | Readable report | Planned |
| 11 | Fri Oct 16 | Live-site runs, then Week 2 review prep | Planned |
| 12 | Sat Oct 17 | Validation and close-out | Planned |

Beyond this sprint, the Phase 1 plan continues with the approval queue,
the GitHub adapter and the verification engine (re-crawl, then close or
reopen), which together complete the detect-to-verify loop end to end.

## 11. Getting started

Requirements: Node.js 22 or newer, Git.

```bash
git clone https://github.com/indhuja-elumalai/progrowth-sitefix-agent.git
cd progrowth-sitefix-agent
npm install
npx playwright install chromium
```

### Run the crawler

```bash
node crawl.js https://your-site.com --max-pages 100
```

Options: `--max-pages N` (default 100) and `--delay-ms N` (pause between
link checks, default 150). It writes two files:

- `report.json`: one entry per crawled page (raw vs rendered status, title,
  word count, broken resources).
- `links.json`: a summary plus one entry per distinct link found, internal
  and external, each checked directly (HEAD, falling back to GET on 405/501,
  redirects not followed). Every link lists the pages it was **found on** and
  is classed `ok`, `redirect`, `broken` (4xx/5xx), `unverified` (timeout, or
  blocked with 401/403/429/999) or `unreachable` (network error).

It only reads; it never writes to the site.

Or run it with no local setup: GitHub, **Actions**, **Run Crawler**,
**Run workflow**, choose the branch, enter a URL and a `max_pages` value
(the workflow must exist on `main` to appear in that list).

**Known limits of the current crawler:** only `<a href>` links in the
rendered page are checked (not images, scripts or links added after user
interaction); redirect chains and loops are not yet classified; and there is
no soft-404, canonical, duplicate-title or sitemap detection yet. The
`jsChangedTitle` field gives false flags on pages with no body (redirects,
404s, missing titles).

### Run the test fixture

The fixture is a small site with a known set of planted faults, used to
measure whether each detector finds everything and nothing extra.

```bash
node fixture/generate-site.js         # write the pages (re-run after editing the generator)
node fixture/server.js                # terminal 1: site on :4000, "external" site on :4001
node fixture/selfcheck.js             # terminal 2: expects "All checks passed."
node crawl.js http://localhost:4000   # crawl the fixture
node fixture/score.js                 # compare the crawl with the answer key
```

It uses a local Node server rather than GitHub Pages because Pages cannot
serve real HTTP 301/302 redirects, so a redirect chain or loop cannot be
planted there. The same server runs in CI (`fixture-selfcheck.yml`), which
also crawls and scores the fixture on every push.

**The 10 planted issues** (`fixture/expected-issues.json`):

| ID | Planted fault |
|---|---|
| F-01 | Internal link returns 404 |
| F-02 | External link returns 404 |
| F-03 | Broken image (404) |
| F-04 | Redirect chain, 3 hops |
| F-05 | Redirect loop |
| F-06 | Soft 404 (200 OK, not-found title and H1, short body) |
| F-07 | Missing title |
| F-08, F-09 | Duplicate title (one entry per page) |
| F-10 | Canonical pointing at a 404 |

Four control pages (`/`, `/about.html`, `/contact.html`, `/final.html`)
must produce no issues; `/contact.html` is deliberately short but valid,
to catch soft-404 false alarms. Not yet planted: http-to-https and www
mismatches (Day 3), sitemap and robots faults and image alt text (Day 7).

## 12. Results so far

### Week 1: crawler tested on two live sites

| Site | Finding |
|---|---|
| progrowth.services | Two crawler bugs: `&amp;` in titles read as a JavaScript change, and `/industries/` pages failing to render because they never reach network-idle. Both fixed (entity decoding; wait for `domcontentloaded`). |
| sonagroup.ae | Fixes confirmed on a second site. Found 5 real broken product thumbnails across 4 pages, all under `/public/products-images/thumb-image/`. |

### Day 1: baseline of the Week 1 crawler on the fixture

| Planted issue | What the crawler shows today |
|---|---|
| F-01 internal 404 | Visible (page entry with status 404), not labelled |
| F-02 external 404 | Missed |
| F-03 broken image | Visible (`404 /img/missing.jpg`), not labelled |
| F-04 redirect chain | Visible as a bare 301, hops not counted |
| F-05 redirect loop | Visible as a null render status, not labelled |
| F-06 soft 404 | Missed |
| F-07 missing title | Missed (a false `jsChangedTitle` flag appears instead) |
| F-08, F-09 duplicate titles | Missed |
| F-10 canonical to 404 | Missed |

**4 of 10 have a visible signal, 0 of 10 are labelled as issues, 6 are
missed.** `jsChangedTitle` also gave 4 false flags. Days 2 to 5 close
these gaps; every detector is measured against `expected-issues.json`.

### Day 2: crawl coverage

Page cap replaced by `--max-pages`; every link is now checked directly with
found-on pages. On the fixture the score went from 0 to **2 of 10 planted
issues found** (F-01 internal 404, F-02 external 404, both with the correct
found-on page) with **0 false positives**. Redirecting links are listed (2 on
the fixture) but chains and loops are classified on Day 3. CI now crawls and
scores the fixture on every push (`--require 2`).
Real-site check (sonagroup.ae, 40 pages crawled with 4,290 still queued, mostly
`products.html` filter variants; 689 links checked): 0 broken, 97 redirecting.
Of the redirects, 9 internal links redirect to `/404.html`, which returns 200
with the title "404" and no H1 (a verified soft 404; `/faqs.html` alone is
linked from every crawled page), 85 are `products.html/?...` filter links that
301 because of a trailing slash, and 3 brand links redirect to the generic
products page. The homepage rejects HEAD requests with 403, so link checks now
retry with GET before judging.

## 13. Security principles

- Every client site is its own isolated tenant: separate credentials,
  separate evidence storage, separate issue registry partition.
- Credentials live only in a secrets manager (GitHub Actions secrets
  during development), never in code, config, or logs.
- Each adapter requests the narrowest possible scope (one repo, one
  application-password user), never admin or org-wide access.
- The AI reasoning service never holds fix-execution credentials; that is
  an architectural boundary, not a permissions setting.
- Every fix requires human approval. No silent auto-apply exists in
  Phase 1, even for "safe/deterministic" fixes.
- Every stage (detection, proposal, approval, execution, verification)
  is logged append-only and tied to the issue it belongs to.

## 14. Contributing

Work is done on short-lived branches off `main` (`feature/...`, `fix/...`,
`chore/...`), merged by pull request, and the branch is deleted after
merging. `main` is never pushed to directly.

Every PR uses [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md):
what it does, which roadmap item it closes, how it was tested, the
outcome, and any risk notes. A PR is done when its checks pass against the
fixture and it is merged to `main`. Never commit tokens, `.env` files,
`report.json` or `links.json`.