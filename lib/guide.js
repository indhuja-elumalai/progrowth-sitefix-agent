// What SiteFix knows about itself, for the chat: how it works, what it checks and the
// limits it checks against, the score, and how to use the report. The numbers come from
// the checks themselves, so the chat's answers about them are always the real ones.
// It goes to the AI with every question, next to the inspection's data.
//
// GUIDE -> { about, howItWorks, checks, limits, score, report, workspace }

import { LIMITS as SEO } from "./seo.js";
import { IMAGE_LIMITS } from "./images.js";
import { CONTENT_LIMITS } from "./content.js";
import { LIMITS as SPEED } from "./speed.js";

export const GUIDE = {
    about: "SiteFix inspects a website the way a visitor and a search engine see it, finds what is broken or missing, explains each problem in plain words, and says what to fix first. It never changes the site.",
    howItWorks: [
        "Press Inspect: SiteFix reads the site's pages (following its links and its sitemap), checks every link and image, reads titles, tags, headings and text, checks spelling and grammar, and times a sample of pages on a phone over 4G.",
        "A large site is read in part (a share of every section) to keep an inspection to a couple of minutes; Stop ends it early and the report covers the pages read.",
        "Then it writes the report: each kind of problem with what visitors face, why it matters, the steps to fix it, who usually does it, every page it is on, and screenshots with the problem outlined.",
        "You can ask questions while it runs and after.",
    ],
    checks: [
        "Broken links to the site's own pages and to other sites, redirect chains and loops, http to https and www redirects, error pages that say they are fine (soft 404)",
        "Page titles, meta descriptions, H1 and heading levels, canonical tags, pages hidden from search (noindex), tags that only appear after JavaScript runs",
        "Social sharing tags (Open Graph) and share images, viewport (mobile) and page language",
        "Broken images, missing or unhelpful alt text, oversized images, http images on https pages",
        "Thin pages, near-duplicate pages, placeholder text, repeated words, spelling and grammar",
        "Page speed on a phone over 4G: main content (LCP), layout jumps (CLS), too busy to respond (TBT), server response (TTFB), page weight",
    ],
    limits: {
        title: `${SEO.titleMin} to ${SEO.titleMax} characters`,
        metaDescription: `${SEO.descriptionMin} to ${SEO.descriptionMax} characters`,
        altText: `up to ${IMAGE_LIMITS.altMax} characters`,
        imageSize: `up to ${Math.round(IMAGE_LIMITS.maxBytes / 1024)} KB`,
        thinPage: `fewer than ${CONTENT_LIMITS.minWords} words`,
        nearDuplicate: `${Math.round(CONTENT_LIMITS.nearDuplicate * 100)}% of phrases the same`,
        mainContentLCP: `good under ${SPEED.lcp.good / 1000} s, poor over ${SPEED.lcp.poor / 1000} s`,
        layoutShiftCLS: `good under ${SPEED.cls.good}, poor over ${SPEED.cls.poor}`,
        busyTBT: `good under ${SPEED.tbt.good} ms, poor over ${SPEED.tbt.poor} ms`,
        serverTTFB: `good under ${SPEED.ttfb.good / 1000} s, poor over ${SPEED.ttfb.poor / 1000} s`,
        pageWeight: `good under ${SPEED.bytes.good / 1024 / 1024} MB, poor over ${SPEED.bytes.poor / 1024 / 1024} MB`,
    },
    score: "The score is 0 to 100, from three areas: Technical (45%), On-page (40%) and Off-page (15%). Bands: 0-49 Needs work, 50-69 Fair, 70-84 Good, 85-100 Excellent. Every kind of problem costs points, more for serious ones and ones on many pages; fixing all of them gets to 100. It is rule-based, so the same site always gets the same score.",
    priorities: "P1 fix first, P2 fix soon, P3 when you can. Quick wins are easy fixes rated P1 or P2.",
    report: [
        "Open report shows the Fix tab: the score, the three areas, and the fixes, ticked to see the score they lead to before anything changes.",
        "Clicking a fix opens it: what visitors face, why, the steps, every page, and Check it now, which checks the live site again after you fixed it yourself; a confirmed fix counts in the score.",
        "Keep as is marks a problem the site has on purpose (for example a page hidden from search on purpose); it stops counting against the score.",
        "All issues lists everything with search and filters. Export has the PDF, a download to send to someone, and Print.",
        "Fixing the site for you (the Fix button) is coming later; for now SiteFix finds, explains and checks.",
    ],
    workspace: "The workspace is the user's name and site links. The site menu at the top switches sites, adds a site link, or signs out. Each site has its own inspections in the sidebar. Inspect starts a new inspection of the site on screen.",
};
