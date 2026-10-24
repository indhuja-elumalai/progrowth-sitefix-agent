import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrackerUrl, trackerPatterns } from "../lib/trackers.js";

test("the tracking scripts that held up progrowth.services pages are recognised", () => {
    for (const u of [
        "https://connect.facebook.net/en_US/fbevents.js",
        "https://snap.licdn.com/li.lms-analytics/insight.min.js",
        "https://www.googletagmanager.com/gtm.js?id=GTM-5F2DXKZP",
        "https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1786483426",
        "https://www.clarity.ms/tag/kuad3x0yn4",
        "https://scripts.clarity.ms/0.8.72-beta/clarity.js",
        "https://opps-widget.getwarmly.com/warmly.js",
        "https://static.claydar.com/init.v1.js",
        "https://assets.apollo.io/micro/website-tracker/tracker.iife.js",
        "https://s3-us-west-2.amazonaws.com/b2bjsstore/b/0NW1GH7E3EO4/reb2b.js.gz",
        "https://analytics.ahrefs.com/analytics.js",
        "https://static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d873017",
        "https://www.progrowth.services/_vercel/insights/script.js",
        "https://matomo-final-production.up.railway.app/matomo.js",
    ]) assert.ok(isTrackerUrl(u), u);
});

test("the site's own scripts, styles and pages are never blocked", () => {
    for (const u of [
        "https://www.progrowth.services/",
        "https://www.progrowth.services/assets/Navigation.CuiyzUCY.js",
        "https://www.progrowth.services/assets/CookieConsent.8cyy85p4.js",
        "https://www.progrowth.services/assets/410.CCibK5lj.css",
        "https://www.progrowth.services/blog/analytics-for-b2b/",
        "https://js.hsforms.net/forms/embed/v2.js",
        "https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js",
        "https://www.google.com/recaptcha/api.js",
        "https://www.youtube.com/embed/abc",
        "https://maps.googleapis.com/maps/api/js",
    ]) assert.equal(isTrackerUrl(u), false, u);
});

test("patterns are in the browser's wildcard form", () => {
    const p = trackerPatterns();
    assert.ok(p.includes("*googletagmanager.com*"));
    assert.ok(p.every((x) => x.startsWith("*") && x.endsWith("*")));
});
