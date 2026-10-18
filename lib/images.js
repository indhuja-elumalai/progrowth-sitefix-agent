// Image rules. Pure functions: facts about <img> tags in, issues out.
// No network and no browser in here, so every rule can be unit-tested.
//
// pickImageSrc(raw, pageUrl)        -> the absolute URL the image loads from (or null)
// isDecorative(raw)                 -> true when the image is marked as decorative
// isUnhelpfulAlt(alt)               -> true for alt text like "IMG_0042.jpg" or "image"
// summarizeImages(occurrences)      -> one entry per image URL, with the pages it is on
// imageFindings(summary, check)     -> issues for one image, ready for the registry
//
// An "occurrence" is one <img> on one page, as read from the rendered DOM:
//   { pageUrl, src, alt, decorative }   (alt is null when the attribute is absent)
// A "check" is the HTTP result for the image URL (see crawl.js checkImage):
//   { status, classification, bytes, contentType, finalUrl, error }

export const IMAGE_LIMITS = {
    altMax: 125, // screen readers and Google both favour short alt text
    maxBytes: 300 * 1024, // 300 KB
};

const SKIP_SCHEMES = /^(data|blob|about|javascript):/i;

// First usable candidate: what the browser loaded, then the src attribute,
// then common lazy-load attributes, then the first srcset entry.
export function pickImageSrc(raw, pageUrl) {
    const fromSrcset = (raw.srcset || "").split(",")[0].trim().split(/\s+/)[0];
    const candidates = [raw.currentSrc, raw.src, raw.dataSrc, fromSrcset];
    for (const c of candidates) {
        const value = (c || "").trim();
        if (!value || SKIP_SCHEMES.test(value)) continue;
        let u;
        try { u = new URL(value, pageUrl); } catch { continue; }
        if (u.protocol !== "http:" && u.protocol !== "https:") continue;
        u.hash = "";
        return u.href;
    }
    return null;
}

// alt="" is the standard way to say "decorative, screen readers skip this".
// role="presentation" / role="none" and aria-hidden="true" mean the same.
export function isDecorative(raw) {
    const role = (raw.role || "").trim().toLowerCase();
    return raw.alt === "" || role === "presentation" || role === "none" || (raw.ariaHidden || "").trim().toLowerCase() === "true";
}

const GENERIC_ALT = new Set([
    "image", "img", "photo", "picture", "pic", "graphic", "banner", "logo", "icon",
    "placeholder", "untitled", "alt", "alt text", "null", "undefined", "spacer", "thumbnail",
]);

export function isUnhelpfulAlt(alt) {
    const a = (alt || "").trim().toLowerCase();
    if (!a) return false; // empty alt is handled as decorative, not as unhelpful
    if (GENERIC_ALT.has(a)) return true;
    if (/\.(jpe?g|png|gif|webp|svg|avif|bmp|tiff?|heic)$/i.test(a)) return true; // a file name
    if (/^(img|dsc|dscn|dcim|pxl|screenshot|photo|image|untitled)[-_ ]?\d+/i.test(a)) return true; // camera / export names
    if (/^[a-f0-9]{16,}$/i.test(a)) return true; // a hash
    if (/^[\d\W_]+$/.test(a)) return true; // only digits and punctuation
    return false;
}

// Group occurrences by image URL. Each alt problem keeps the pages it was seen
// on, because the same image can have good alt text on one page and none on another.
export function summarizeImages(occurrences) {
    const byUrl = new Map();
    for (const o of occurrences) {
        if (!o.src) continue;
        if (!byUrl.has(o.src)) {
            byUrl.set(o.src, { url: o.src, pages: new Set(), altMissingOn: new Set(), unhelpfulAlt: new Map(), longAlt: new Map(), mixedContentOn: new Set() });
        }
        const s = byUrl.get(o.src);
        s.pages.add(o.pageUrl);
        if (o.pageUrl.startsWith("https:") && o.src.startsWith("http:")) s.mixedContentOn.add(o.pageUrl);
        if (o.decorative) continue;
        const alt = typeof o.alt === "string" ? o.alt.trim() : null;
        if (alt === null) s.altMissingOn.add(o.pageUrl);
        else if (isUnhelpfulAlt(alt)) addTo(s.unhelpfulAlt, alt, o.pageUrl);
        else if (alt.length > IMAGE_LIMITS.altMax) addTo(s.longAlt, alt, o.pageUrl);
    }
    return [...byUrl.values()].map((s) => ({
        url: s.url,
        pages: [...s.pages].sort(),
        altMissingOn: [...s.altMissingOn].sort(),
        unhelpfulAlt: fromMap(s.unhelpfulAlt),
        longAlt: fromMap(s.longAlt),
        mixedContentOn: [...s.mixedContentOn].sort(),
    }));
}
function addTo(map, alt, page) {
    if (!map.has(alt)) map.set(alt, new Set());
    map.get(alt).add(page);
}
const fromMap = (map) => [...map].map(([alt, pages]) => ({ alt, pages: [...pages].sort() }));
const pagesOf = (list) => [...new Set(list.flatMap((x) => x.pages))].sort();

export const formatBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);

// Issues for one summarized image, given its HTTP check.
// Returns drafts in the registry's shape: { type, affectedUrl, foundOn, detail, evidence }.
export function imageFindings(image, check, limits = IMAGE_LIMITS) {
    const out = [];
    const http = {
        kind: "image",
        src: image.url,
        status: check?.status ?? null,
        finalUrl: check?.finalUrl && check.finalUrl !== image.url ? check.finalUrl : null,
        contentType: check?.contentType ?? null,
        bytes: check?.bytes ?? null,
        pages: image.pages.length,
    };
    const add = (type, foundOn, detail, extra = {}) =>
        out.push({ type, affectedUrl: image.url, foundOn, detail, evidence: { ...http, ...extra } });

    if (check?.classification === "broken") {
        add("image-broken", image.pages, check.status ? `Image returns ${check.status}` : `Image could not be loaded (${check.error || "redirect loop"})`);
    }
    if (image.altMissingOn.length) {
        add("image-alt-missing", image.altMissingOn, "No alt attribute (and not marked as decorative)", { alt: null });
    }
    if (image.unhelpfulAlt.length) {
        const alts = image.unhelpfulAlt.map((x) => x.alt);
        add("image-alt-unhelpful", pagesOf(image.unhelpfulAlt), `Alt text "${alts[0]}" does not describe the image`, { alt: alts });
    }
    if (image.longAlt.length) {
        const longest = Math.max(...image.longAlt.map((x) => x.alt.length));
        add("image-alt-too-long", pagesOf(image.longAlt), `${longest} characters (limit ${limits.altMax})`, { alt: image.longAlt.map((x) => x.alt) });
    }
    if (image.mixedContentOn.length) {
        add("image-mixed-content", image.mixedContentOn, "Loaded over http:// on an https:// page; browsers block or warn");
    }
    if (check?.classification !== "broken" && typeof check?.bytes === "number" && check.bytes > limits.maxBytes) {
        add("image-oversized", image.pages, `${formatBytes(check.bytes)} (limit ${formatBytes(limits.maxBytes)})`);
    }
    return out;
}
