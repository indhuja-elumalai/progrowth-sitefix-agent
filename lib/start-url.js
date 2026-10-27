// The address to crawl from. "progrowth.services" often redirects to
// "https://www.progrowth.services/": if the crawl kept the typed host, every page link
// would point to "another site" and only the first page would be read. So the start
// address follows its redirects, but only to the same site: http -> https and the
// www / non-www twin. A redirect to any other site is left alone (it is reported).
//
// resolveStart(url, { fetch, maxHops }) -> { url, changed, from }

const bare = (h) => h.replace(/^www\./, "").toLowerCase();

export async function resolveStart(url, { fetch: get = fetch, maxHops = 5, timeoutMs = 10000 } = {}) {
    const from = new URL(url).href;
    let current = from;
    for (let hop = 0; hop < maxHops; hop++) {
        let res;
        try {
            res = await get(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
        } catch {
            break; // unreachable: the crawl reports it as usual
        }
        const loc = res.headers?.get?.("location");
        if (!(res.status >= 300 && res.status < 400) || !loc) break;
        let next;
        try { next = new URL(loc, current); } catch { break; }
        if (!/^https?:$/.test(next.protocol) || bare(next.hostname) !== bare(new URL(from).hostname)) break;
        current = next.href;
    }
    return { url: current, changed: current !== from, from };
}
