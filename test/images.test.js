import { test } from "node:test";
import assert from "node:assert/strict";
import { pickImageSrc, isDecorative, isUnhelpfulAlt, summarizeImages, imageFindings, formatBytes, IMAGE_LIMITS } from "../lib/images.js";

const PAGE = "https://x.test/blog/post";
// Real-looking alt text of an exact length (letters and spaces, so it never looks like a hash).
const altOf = (n) => "Team photo at the annual offsite ".repeat(10).slice(0, n).replace(/ $/, "x");
const ok = (extra = {}) => ({ status: 200, classification: "ok", bytes: 20_000, contentType: "image/png", finalUrl: null, ...extra });
const types = (findings) => findings.map((f) => f.type).sort();

// ---------- pickImageSrc ----------
test("resolves relative src against the page and drops the #fragment", () => {
    assert.equal(pickImageSrc({ src: "../img/a.png#x" }, PAGE), "https://x.test/img/a.png");
});

test("prefers what the browser actually loaded (currentSrc)", () => {
    assert.equal(pickImageSrc({ currentSrc: "https://cdn.test/a@2x.png", src: "/a.png" }, PAGE), "https://cdn.test/a@2x.png");
});

test("lazy-loaded images: skips a data: placeholder and uses data-src", () => {
    assert.equal(pickImageSrc({ src: "data:image/gif;base64,R0lGOD", dataSrc: "/real.jpg" }, PAGE), "https://x.test/real.jpg");
});

test("falls back to the first srcset candidate", () => {
    assert.equal(pickImageSrc({ srcset: "/s.jpg 480w, /m.jpg 800w" }, PAGE), "https://x.test/s.jpg");
});

test("returns null when there is nothing loadable", () => {
    assert.equal(pickImageSrc({ src: "" }, PAGE), null);
    assert.equal(pickImageSrc({ src: "data:image/png;base64,AAA" }, PAGE), null);
    assert.equal(pickImageSrc({ src: "blob:https://x.test/123" }, PAGE), null);
});

// ---------- isDecorative ----------
test("alt=\"\", role=presentation/none and aria-hidden mark an image as decorative", () => {
    assert.equal(isDecorative({ alt: "" }), true);
    assert.equal(isDecorative({ alt: null, role: "presentation" }), true);
    assert.equal(isDecorative({ alt: null, role: "None" }), true);
    assert.equal(isDecorative({ alt: null, ariaHidden: "true" }), true);
    assert.equal(isDecorative({ alt: null }), false);
    assert.equal(isDecorative({ alt: "A red bicycle" }), false);
});

// ---------- isUnhelpfulAlt ----------
test("file names, camera names, hashes and filler words are unhelpful", () => {
    for (const a of ["IMG_0042.jpg", "hero-banner.webp", "DSC01234", "PXL_20240101", "Screenshot 2024", "image", "Photo", "logo",
        "a3f9c2e81b7d4f60", "1234", "---"]) {
        assert.equal(isUnhelpfulAlt(a), true, a);
    }
});

test("real descriptions are fine, even when they contain a filler word", () => {
    for (const a of ["Fixture logo", "Photo of the team at the 2024 offsite", "Image page hero showing a laptop", ""]) {
        assert.equal(isUnhelpfulAlt(a), false, a);
    }
});

// ---------- summarizeImages ----------
test("groups the same image across pages and keeps alt problems per page", () => {
    const [s] = summarizeImages([
        { pageUrl: "https://x.test/a", src: "https://x.test/i.png", alt: "A red bicycle", decorative: false },
        { pageUrl: "https://x.test/b", src: "https://x.test/i.png", alt: null, decorative: false },
        { pageUrl: "https://x.test/c", src: "https://x.test/i.png", alt: null, decorative: false },
    ]);
    assert.deepEqual(s.pages, ["https://x.test/a", "https://x.test/b", "https://x.test/c"]);
    assert.deepEqual(s.altMissingOn, ["https://x.test/b", "https://x.test/c"]);
});

test("decorative images skip alt rules but still count for mixed content", () => {
    const [s] = summarizeImages([{ pageUrl: "https://x.test/a", src: "http://x.test/d.png", alt: null, decorative: true }]);
    assert.deepEqual(s.altMissingOn, []);
    assert.deepEqual(s.mixedContentOn, ["https://x.test/a"]);
});

test("occurrences without a src are ignored", () => {
    assert.deepEqual(summarizeImages([{ pageUrl: "https://x.test/a", src: null, alt: null, decorative: false }]), []);
});

// ---------- imageFindings ----------
const one = (occ) => summarizeImages(occ.map((o) => ({ pageUrl: "https://x.test/a", src: "https://x.test/i.png", decorative: false, ...o })))[0];

test("a healthy image with good alt text produces no issues", () => {
    assert.deepEqual(imageFindings(one([{ alt: "A red bicycle" }]), ok()), []);
});

test("broken image: 4xx/5xx after redirects", () => {
    const f = imageFindings(one([{ alt: "A red bicycle" }]), { status: 404, classification: "broken", bytes: null });
    assert.deepEqual(types(f), ["image-broken"]);
    assert.equal(f[0].detail, "Image returns 404");
    assert.deepEqual(f[0].foundOn, ["https://x.test/a"]);
    assert.equal(f[0].evidence.kind, "image");
});

test("a blocked or timed-out image (unverified) is not reported as broken", () => {
    assert.deepEqual(imageFindings(one([{ alt: "A red bicycle" }]), { status: 403, classification: "unverified" }), []);
});

test("missing, unhelpful and too-long alt text", () => {
    assert.deepEqual(types(imageFindings(one([{ alt: null }]), ok())), ["image-alt-missing"]);
    const unhelpful = imageFindings(one([{ alt: "IMG_0042.jpg" }]), ok());
    assert.deepEqual(types(unhelpful), ["image-alt-unhelpful"]);
    assert.deepEqual(unhelpful[0].evidence.alt, ["IMG_0042.jpg"]);
    const long = altOf(IMAGE_LIMITS.altMax + 1);
    const tooLong = imageFindings(one([{ alt: long }]), ok());
    assert.deepEqual(types(tooLong), ["image-alt-too-long"]);
    assert.equal(tooLong[0].detail, `${IMAGE_LIMITS.altMax + 1} characters (limit ${IMAGE_LIMITS.altMax})`);
});

test("alt text exactly at the limit is fine", () => {
    assert.deepEqual(imageFindings(one([{ alt: altOf(IMAGE_LIMITS.altMax) }]), ok()), []);
});

test("mixed content: http image on an https page only", () => {
    const img = summarizeImages([
        { pageUrl: "https://x.test/a", src: "http://x.test/i.png", alt: "A red bicycle", decorative: false },
        { pageUrl: "http://x.test/b", src: "http://x.test/i.png", alt: "A red bicycle", decorative: false },
    ])[0];
    const f = imageFindings(img, ok());
    assert.deepEqual(types(f), ["image-mixed-content"]);
    assert.deepEqual(f[0].foundOn, ["https://x.test/a"]);
});

test("oversized: over the byte limit, never for broken images, never when size is unknown", () => {
    const big = imageFindings(one([{ alt: "A red bicycle" }]), ok({ bytes: IMAGE_LIMITS.maxBytes + 1 }));
    assert.deepEqual(types(big), ["image-oversized"]);
    assert.match(big[0].detail, /limit 300 KB/);
    assert.deepEqual(imageFindings(one([{ alt: "A red bicycle" }]), ok({ bytes: IMAGE_LIMITS.maxBytes })), []);
    assert.deepEqual(imageFindings(one([{ alt: "A red bicycle" }]), ok({ bytes: null })), []);
    assert.deepEqual(types(imageFindings(one([{ alt: "A red bicycle" }]), { status: 500, classification: "broken", bytes: 999_999 })), ["image-broken"]);
});

test("one image can carry several issues, each with only its own pages", () => {
    const img = summarizeImages([
        { pageUrl: "https://x.test/a", src: "https://x.test/i.png", alt: null, decorative: false },
        { pageUrl: "https://x.test/b", src: "https://x.test/i.png", alt: "IMG_1.png", decorative: false },
    ])[0];
    const f = imageFindings(img, ok({ bytes: 900_000 }));
    assert.deepEqual(types(f), ["image-alt-missing", "image-alt-unhelpful", "image-oversized"]);
    assert.deepEqual(f.find((x) => x.type === "image-alt-missing").foundOn, ["https://x.test/a"]);
    assert.deepEqual(f.find((x) => x.type === "image-alt-unhelpful").foundOn, ["https://x.test/b"]);
    assert.deepEqual(f.find((x) => x.type === "image-oversized").foundOn, ["https://x.test/a", "https://x.test/b"]);
});

test("evidence records where a redirecting image ends up", () => {
    const f = imageFindings(one([{ alt: null }]), ok({ finalUrl: "https://cdn.test/i.png" }));
    assert.equal(f[0].evidence.finalUrl, "https://cdn.test/i.png");
});

test("formatBytes", () => {
    assert.equal(formatBytes(300 * 1024), "300 KB");
    assert.equal(formatBytes(2.5 * 1024 * 1024), "2.5 MB");
    assert.equal(formatBytes(312), "312 bytes");
});
