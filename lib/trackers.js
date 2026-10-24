// Tracking, advertising, session-recording and chat scripts. While the crawler reads a
// page they are not loaded: they never change what the checks read (titles, tags, text,
// links, images) but can hold a page up by a second or more and add dozens of requests.
// Matched by host, or by the well-known file names sites copy onto their own servers.
//
// trackerPatterns()  -> URL patterns for the browser's blocked-URL list ("*" = anything)
// isTrackerUrl(url)  -> true when one of those patterns matches (same rule, for tests)

export const TRACKER_HOSTS = ["googletagmanager.com", "google-analytics.com", "analytics.google.com", "doubleclick.net", "googleadservices.com",
    "googlesyndication.com", "adservice.google.com", "connect.facebook.net", "facebook.com/tr", "snap.licdn.com", "px.ads.linkedin.com",
    "clarity.ms", "hotjar.com", "hotjar.io", "getwarmly.com", "claydar.com", "assets.apollo.io/micro/website-tracker", "b2bjsstore", "reb2b.js",
    "analytics.ahrefs.com", "static.cloudflareinsights.com", "plausible.io/js", "cdn.segment.com", "api.segment.io", "cdn.mxpnl.com",
    "cdn.amplitude.com", "heapanalytics.com", "edge.fullstory.com", "widget.intercom.io", "js.intercomcdn.com", "js.driftt.com",
    "client.crisp.chat", "embed.tawk.to", "js.hs-analytics.net", "js.hs-scripts.com", "js.hs-banner.com", "bat.bing.com",
    "static.ads-twitter.com", "analytics.tiktok.com", "ct.pinterest.com", "s.pinimg.com/ct", "mc.yandex.ru", "cdn.matomo.cloud",
    "redditstatic.com/ads", "sc-static.net/scevent", "quantserve.com", "static.zdassets.com", "cdn.livechatinc.com", "tag.clearbitscripts.com",
    "js.zi-scripts.com", "ws.zoominfo.com"];
export const TRACKER_FILES = ["/fbevents.js", "/gtag/js", "/gtm.js?id=", "/matomo.js", "/piwik.js", "/_vercel/insights/", "/_vercel/speed-insights/", "/beacon.min.js"];

export const trackerPatterns = () => [...TRACKER_HOSTS, ...TRACKER_FILES].map((x) => `*${x}*`);

export function isTrackerUrl(url) {
    const u = String(url || "");
    return [...TRACKER_HOSTS, ...TRACKER_FILES].some((x) => u.includes(x));
}
