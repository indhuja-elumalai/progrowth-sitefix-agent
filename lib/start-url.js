// The address to crawl from. "progrowth.services" often redirects to
// "https://www.progrowth.services/": if the crawl kept the typed host, every page link
// would point to "another site" and only the first page would be read. So the start
// address follows its redirects, but only to the same site: http -> https and the
// www / non-www twin. A redirect to any other site is left alone (it is reported).
//
// It is also the first look at the site: when the address can't be reached at all
// (no such domain, connection refused, invalid certificate), the inspection stops
// there with a plain reason instead of reporting an empty site as clean.
//
// resolveStart(url, { fetch, maxHops }) -> { url, changed, from, error }
//   error: { code, message } when the site could not be reached (null otherwise; a
//   slow answer is not an error here, the browser gets longer to try)
// whyUnreachable(err)      -> { code, message } for a network error, or null
// whyNoPages(status, err)  -> { code, message } when not one page could be opened

const bare = (h) => h.replace(/^www\./, "").toLowerCase();

export async function resolveStart(url, { fetch: get = fetch, maxHops = 5, timeoutMs = 10000 } = {}) {
    const from = new URL(url).href;
    let current = from, error = null;
    for (let hop = 0; hop < maxHops; hop++) {
        let res;
        try {
            res = await get(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
        } catch (err) {
            if (hop === 0) error = whyUnreachable(err);
            break;
        }
        const loc = res.headers?.get?.("location");
        if (!(res.status >= 300 && res.status < 400) || !loc) break;
        let next;
        try { next = new URL(loc, current); } catch { break; }
        if (!/^https?:$/.test(next.protocol) || bare(next.hostname) !== bare(new URL(from).hostname)) break;
        current = next.href;
    }
    return { url: current, changed: current !== from, from, error };
}

// The network error behind a failed request, in words a site owner understands.
// Slow answers (timeouts) and anything unclear return null: the crawl tries anyway.
export function whyUnreachable(err) {
    const code = String(err?.cause?.code || err?.code || "");
    if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME/.test(code)) return { code: "no-dns", message: "the address doesn't exist (no website is registered at that name). Check the spelling?" };
    if (/ECONNREFUSED/.test(code)) return { code: "refused", message: "the server refused the connection (the site may be down)." };
    if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return { code: "certificate", message: "its security certificate isn't valid, so browsers would show a warning instead of the site." };
    if (/ECONNRESET|EHOSTUNREACH|ENETUNREACH/.test(code)) return { code: "unreachable", message: "the server couldn't be reached (the connection was cut off)." };
    return null;
}

// After the crawl, when not one page opened: why, from the first page's answer.
export function whyNoPages(status, error) {
    if (status === 401 || status === 403) return { code: "blocked", message: `the site turned the visit away (${status}). It may block automated visitors or need a login.` };
    if (status === 404 || status === 410) return { code: "not-found", message: `that page doesn't exist (${status}). Check the address, or try the home page.` };
    if (status === 429) return { code: "rate-limited", message: "the site asked for fewer visits (429). Try again in a few minutes." };
    if (status >= 500) return { code: "server-error", message: `the site's server had an error (${status}). It may be down; try again later.` };
    if (status >= 400) return { code: "error", message: `the site answered with an error (${status}).` };
    return { code: "no-answer", message: `the page didn't load${error ? ` (${String(error).replace(/^TypeError: /, "").slice(0, 80)})` : ""}. The site may be down or very slow.` };
}
