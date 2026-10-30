// Workspaces: who is using SiteFix and which sites they may inspect. Kept simple on
// purpose for now: a name and website links, no email or password. A browser is tied to
// its workspace by a cookie; every inspection, report, PDF, screenshot and question is
// limited to the workspace's sites (ui/server.js checks each request).
//
//   profiles.json  { profiles: { [id]: { id, name, sites: [url], activeSite, createdAt } } }
//
// Two workspaces that add the same site share its inspections: a site is identified by
// its host, ignoring "www." and http/https.
//
// siteKey(url)            -> "example.com" (lowercase host without www. and port 80/443), or null
// normalizeSite(text)     -> "https://example.com/" from "example.com", "http://www.Example.com/x", … or null
// sameSite(a, b)          -> true when a and b are the same site
// createProfiles({ file }) -> { create, get, addSite, removeSite, setActive, allows }
//   create({ name, site })  -> profile, or throws "bad name" / "bad site"
//   get(id)                 -> profile or null
//   addSite(id, site)       -> profile (the site becomes the active one), or null
//   removeSite(id, site)    -> profile (never removes the last site), or null
//   setActive(id, site)     -> profile, or null when the site isn't in the workspace
//   allows(profile, url)    -> true when url is one of the profile's sites

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

export const MAX_SITES = 50;
const MAX_PROFILES = 5000;
const isProfileId = (id) => typeof id === "string" && /^[0-9a-f]{32}$/.test(id);

// Another scheme (ftp:, mailto:, javascript:) is not a website; "host:8080" is.
const otherScheme = (s) => /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s) && !/^https?:\/\//i.test(s);

export function siteKey(url) {
    if (otherScheme(String(url))) return null;
    let u;
    try { u = new URL(/^https?:\/\//i.test(String(url)) ? String(url) : `https://${url}`); } catch { return null; }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!host) return null;
    return u.port && u.port !== "80" && u.port !== "443" ? `${host}:${u.port}` : host;
}

export function normalizeSite(text) {
    const s = String(text || "").trim();
    if (!s || /\s/.test(s) || s.length > 300 || otherScheme(s)) return null;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(s);
    let u;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : (local ? "http://" : "https://") + s); } catch { return null; }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
    const h = u.hostname;
    const ok = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(h) || /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/i.test(h);
    if (!ok) return null;
    return `${u.protocol}//${u.host.toLowerCase()}/`;
}

export function sameSite(a, b) {
    const x = siteKey(a);
    return Boolean(x) && x === siteKey(b);
}

function cleanName(name) {
    const n = String(name || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    return n || null;
}

export function createProfiles({ file }) {
    let data = null;
    let writes = Promise.resolve();

    async function load() {
        if (data) return data;
        try { data = JSON.parse(await readFile(file, "utf8")); } catch { data = null; }
        if (!data || typeof data.profiles !== "object" || !data.profiles) data = { profiles: {} };
        return data;
    }
    // Written one at a time, through a temp file: a crash never leaves half a file.
    function save() {
        const write = async () => {
            await mkdir(path.dirname(file), { recursive: true });
            const tmp = `${file}.${process.pid}.tmp`;
            await writeFile(tmp, JSON.stringify(data, null, 2));
            await rename(tmp, file);
        };
        writes = writes.then(write, write);
        return writes;
    }

    async function create({ name, site }) {
        const n = cleanName(name);
        if (!n) throw new Error("bad name");
        const url = normalizeSite(site);
        if (!url) throw new Error("bad site");
        const d = await load();
        const ids = Object.keys(d.profiles);
        if (ids.length >= MAX_PROFILES) {
            // The oldest workspaces make room (this is a testing tool, not an account system).
            ids.sort((a, b) => String(d.profiles[a].createdAt).localeCompare(String(d.profiles[b].createdAt)));
            for (const id of ids.slice(0, ids.length - MAX_PROFILES + 1)) delete d.profiles[id];
        }
        const p = { id: randomBytes(16).toString("hex"), name: n, sites: [url], activeSite: url, createdAt: new Date().toISOString() };
        d.profiles[p.id] = p;
        await save();
        return p;
    }

    async function get(id) {
        if (!isProfileId(id)) return null;
        const d = await load();
        return d.profiles[id] || null;
    }

    async function addSite(id, site) {
        const p = await get(id);
        const url = normalizeSite(site);
        if (!p) return null;
        if (!url) throw new Error("bad site");
        const have = p.sites.find((s) => sameSite(s, url));
        if (!have) {
            if (p.sites.length >= MAX_SITES) throw new Error("too many sites");
            p.sites.push(url);
        }
        p.activeSite = have || url;
        await save();
        return p;
    }

    async function removeSite(id, site) {
        const p = await get(id);
        if (!p) return null;
        if (p.sites.length <= 1) throw new Error("last site");
        p.sites = p.sites.filter((s) => !sameSite(s, site));
        if (!p.sites.some((s) => s === p.activeSite)) p.activeSite = p.sites[0];
        await save();
        return p;
    }

    async function setActive(id, site) {
        const p = await get(id);
        if (!p) return null;
        const have = p.sites.find((s) => sameSite(s, site));
        if (!have) return null;
        p.activeSite = have;
        await save();
        return p;
    }

    function allows(profile, url) {
        return Boolean(profile && url && profile.sites.some((s) => sameSite(s, url)));
    }

    return { create, get, addSite, removeSite, setActive, allows };
}
