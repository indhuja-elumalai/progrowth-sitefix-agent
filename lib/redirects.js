// Redirect analysis: follow a redirect hop by hop and say what it is.
//
// The actual HTTP request is passed in as `check(url)`, so this logic is
// plain functions that can be unit tested without a network.
// `check` must return { status, location, classification } and must NOT
// follow redirects itself (crawl.js passes its checkLink function).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Follow redirects one hop at a time, up to maxHops.
// hops = number of redirect responses followed before the final answer.
export async function followRedirects(startUrl, check, { maxHops = 10, delayMs = 0 } = {}) {
  const chain = []; // every URL visited, in order, with its status
  const seen = new Set([startUrl]);
  let url = startUrl;

  for (let i = 0; i <= maxHops; i++) {
    const r = await check(url);
    chain.push({ url, status: r.status });

    if (r.classification !== "redirect" || !r.location) {
      return {
        chain, hops: chain.length - 1, loop: false, tooLong: false,
        final: { url, status: r.status, classification: r.classification },
      };
    }

    let next;
    try { next = new URL(r.location, url).href; } // Location may be relative
    catch {
      return { chain, hops: chain.length - 1, loop: false, tooLong: false, final: { url, status: r.status, classification: "unreachable" } };
    }

    if (seen.has(next)) return { chain, hops: chain.length, loop: true, tooLong: false, final: null };
    seen.add(next);
    url = next;
    if (delayMs) await sleep(delayMs);
  }
  return { chain, hops: chain.length, loop: false, tooLong: true, final: null };
}

// Summarise a followRedirects() result.
//   kind: "loop" | "chain" (2 or more hops, or too long) | "single" (exactly 1 hop)
export function classifyRedirect(r) {
  const endsInError = !!r.final && r.final.status !== null && r.final.status >= 400;
  const kind = r.loop ? "loop" : r.tooLong || r.hops >= 2 ? "chain" : "single";
  return {
    kind,
    hops: r.hops,
    endsInError,
    finalUrl: r.final ? r.final.url : null,
    finalStatus: r.final ? r.final.status : null,
    chain: r.chain.map((c) => c.url),
  };
}

// Which issue (if any) should this redirect be reported as?
// A single redirect to a working page is not an issue by itself.
export function redirectIssueType(c) {
  if (c.kind === "loop") return "redirect-loop";
  if (c.kind === "chain") return "redirect-chain";
  if (c.endsInError) return "redirect-to-error";
  return null;
}

const isLocalHost = (h) => h === "localhost" || /^[\d.]+$/.test(h) || h.includes(":");

// Site-level checks on the start URL's host:
//   1. If the site is https, the plain http:// version should redirect to https.
//   2. The www / non-www twin of the host should redirect to the main host,
//      not serve the same site on a second address.
// Skipped for localhost and IP addresses. An unreachable twin is not a finding.
export async function siteLevelChecks(startUrl, check, options = {}) {
  const u = new URL(startUrl);
  if (isLocalHost(u.hostname)) return { skipped: "local address", findings: [] };
  const findings = [];

  if (u.protocol === "https:") {
    const httpUrl = `http://${u.host}/`;
    const r = await followRedirects(httpUrl, check, options);
    const served = r.final && r.final.status !== null && r.final.status < 400;
    if (served && !r.final.url.startsWith("https://")) {
      findings.push({ type: "https-missing-redirect", url: httpUrl, detail: `http:// answers ${r.final.status} and stays on http:// instead of redirecting to https://` });
    }
  }

  const twinHost = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
  const twinUrl = `${u.protocol}//${twinHost}${u.port ? ":" + u.port : ""}/`;
  const r2 = await followRedirects(twinUrl, check, options);
  const served2 = r2.final && r2.final.status !== null && r2.final.status < 400;
  if (served2 && new URL(r2.final.url).hostname === twinHost) {
    findings.push({ type: "www-variant-not-redirected", url: twinUrl, detail: `${twinHost} answers ${r2.final.status} itself instead of redirecting to ${u.hostname}` });
  }
  return { skipped: null, findings };
}