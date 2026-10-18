// Social sharing rules: what Facebook, LinkedIn, WhatsApp, Slack and X read
// when someone shares a link. Pure functions: facts from lib/head.js in, issues out.
//
// socialIssues(head)              -> no Open Graph tags, or some of the essential ones missing
// ogImageUrl(head, pageUrl)       -> the absolute og:image URL (or null)
// ogImageFindings(images)         -> one og-image-broken issue per share image that does not load
//
// Twitter/X falls back to Open Graph when twitter:* tags are absent, so only
// Open Graph is required. The twitter:* tags are still shown in the evidence.

export const OG_REQUIRED = ["og:title", "og:description", "og:image"];

const issue = (type, severity, detail) => ({ type, severity, detail });

export function socialIssues(head) {
    const og = head.og || {};
    const present = OG_REQUIRED.filter((k) => og[k]);
    if (Object.keys(og).length === 0) {
        return [issue("og-missing", "low", "No Open Graph tags: shared links show no title, description or image")];
    }
    const missing = OG_REQUIRED.filter((k) => !present.includes(k));
    if (missing.length) {
        return [issue("og-incomplete", "low", `Missing ${missing.join(", ")}: shared links will look incomplete`)];
    }
    return [];
}

// og:image must be an absolute http(s) URL for most platforms; a relative one
// is resolved against the page so it can still be checked.
export function ogImageUrl(head, pageUrl) {
    const raw = (head.og?.["og:image"] || "").trim();
    if (!raw) return null;
    try {
        const u = new URL(raw, pageUrl);
        return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch {
        return null;
    }
}

// images: [{ url, pages: [pageUrl...], check: { status, classification, error } }]
// Returns drafts in the registry's shape: { type, affectedUrl, foundOn, detail, evidence }.
export function ogImageFindings(images) {
    return images
        .filter((i) => i.check?.classification === "broken")
        .map((i) => ({
            type: "og-image-broken",
            affectedUrl: i.url,
            foundOn: [...i.pages].sort(),
            detail: i.check.status ? `Share image (og:image) returns ${i.check.status}` : `Share image (og:image) could not be loaded (${i.check.error || "redirect loop"})`,
            evidence: { kind: "image", src: i.url, status: i.check.status ?? null, finalUrl: i.check.finalUrl ?? null, contentType: null, bytes: null, pages: i.pages.length, usedAs: "og:image" },
        }));
}
