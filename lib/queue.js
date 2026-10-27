// The crawl's queue of pages to read, fair across the site's sections.
//
// A large site can't be read in full in a minute, so when the crawl has a page limit
// or a time budget, which pages it reads first decides what the report covers. Pages
// are grouped by section ("/blog/*", "/products/*", "/p/*", "/about": templateKey in
// lib/speed.js) and taken one section at a time in turn, each section in the order its
// pages were found (closest to the home page first). So 400 pages of a 5,000-page site
// are a share of every section instead of the first 400 blog posts. A site read in full
// is read in full either way.
//
// createQueue() -> { push(url), shift(), get length, sections() }
//   sections() -> [{ key, queued, taken }]  how much of each section was found and read

import { templateKey } from "./speed.js";

export function createQueue() {
    const groups = new Map(); // key -> { key, items: [], head: 0, taken: 0 }
    const order = []; // section keys in the order they were first seen
    let turn = 0, size = 0;
    return {
        push(url) {
            const key = templateKey(url);
            let g = groups.get(key);
            if (!g) { g = { key, items: [], head: 0, taken: 0 }; groups.set(key, g); order.push(key); }
            g.items.push(url);
            size++;
        },
        shift() {
            if (!size) return undefined;
            for (let n = 0; n < order.length; n++) {
                const g = groups.get(order[(turn + n) % order.length]);
                if (g.head < g.items.length) {
                    turn = (turn + n + 1) % order.length;
                    size--;
                    g.taken++;
                    return g.items[g.head++];
                }
            }
            return undefined;
        },
        get length() { return size; },
        sections() { return order.map((k) => { const g = groups.get(k); return { key: k, queued: g.items.length, taken: g.taken }; }); },
    };
}
