// Helpers for the site tests: read the Eleventy build in _site/ and pull values out of the HTML.
// Run `npm test` (it builds first). The scenarios these tests cover are in ../e2e/website/*.feature
// next to this repository.
import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const siteDir = path.join(root, "_site");
export const SITE_URL = "https://tetherlinkutility.com";
export const FORMSPREE = "https://formspree.io/f/xjygjryg";

if (!fs.existsSync(path.join(siteDir, "index.html"))) {
  throw new Error("_site/ is missing: run `npm run build` first (npm test does this).");
}

const json = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
export const site = json("src/_data/site.json");
export const i18n = json("src/_data/i18n.json");
export const LANGS = site.languages;
export const prefix = (lang) => i18n[lang].prefix;
export const hreflang = (lang) => i18n[lang].hreflang || lang;

// URL path ("/tr/", "/help.html") -> file in _site, or null.
export function fileFor(urlPath) {
  if (urlPath.startsWith(SITE_URL)) urlPath = urlPath.slice(SITE_URL.length) || "/";
  let p = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(siteDir, p);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  if (fs.existsSync(path.join(f, "index.html"))) return path.join(f, "index.html");
  return null;
}

export function read(urlPath) {
  const f = fileFor(urlPath);
  if (!f) throw new Error(`not built: ${urlPath}`);
  return fs.readFileSync(f, "utf8");
}

// Every built .html file as a URL path ("/tr/blog/foo.html").
export function htmlPages() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".html")) out.push("/" + path.relative(siteDir, full).split(path.sep).join("/"));
    }
  };
  walk(siteDir);
  return out.sort();
}

export const isRedirectStub = (html) => /<meta http-equiv="refresh"/i.test(html);

export const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// Visible text: tags removed, entities decoded, whitespace collapsed.
export const textOf = (html) => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ");

export const htmlLang = (html) => (html.match(/<html[^>]*\slang="([^"]+)"/) || [])[1];
export const title = (html) => decode(((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").trim());
export const canonicals = (html) => [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
export const robots = (html) => (html.match(/<meta name="robots" content="([^"]+)"/) || [])[1];
export const metaDescription = (html) => (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
export const hreflangs = (html) =>
  Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]));

// All <a> tags as { href, cls, text, attrs }.
export function links(html) {
  return [...html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    attrs: m[1],
    href: decode((m[1].match(/href="([^"]*)"/) || [])[1] || ""),
    cls: (m[1].match(/class="([^"]*)"/) || [])[1] || "",
    text: decode(m[2].replace(/<[^>]+>/g, "").trim()),
  }));
}

// Parsed JSON-LD blocks, and every @type found anywhere inside them.
export const jsonLd = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
export function ldTypes(blocks) {
  const types = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (v["@type"]) types.push(...[].concat(v["@type"]));
      Object.values(v).forEach(walk);
    }
  };
  walk(blocks);
  return types;
}
export function ldFind(blocks, type) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if ([].concat(v["@type"] || []).includes(type)) found.push(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(blocks);
  return found;
}

// Sitemap entries: [{ loc, alternates: { hreflang: href } }].
export function sitemap() {
  const xml = read("/sitemap.xml");
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: (m[1].match(/<loc>([^<]+)<\/loc>/) || [])[1],
    alternates: Object.fromEntries(
      [...m[1].matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((a) => [a[1], a[2]])
    ),
  }));
}

// Blog post sources per language folder, with their front matter `published` date.
export function postSources(lang) {
  const dir = path.join(root, "src", lang === "en" ? "" : lang, "blog");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      const fm = (src.match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
      const published = ((fm.match(/^published:\s*"?([0-9-]+)"?/m) || [])[1]) || "";
      return { lang, file: f, published, url: `${prefix(lang)}blog/${f}` };
    });
}

export const GUIDES = ["socks5-proxy-setup-windows-macos-ios.html", "share-mobile-data-android-to-android-qr.html"];

// Every start tag as { name, attrs } (lower-case names; entities in values decoded). Comments and the
// bodies of <script>, <style> and <template> are skipped; their own start tags are kept.
export function tags(html) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<(script|style|template)\b[^>]*>)[\s\S]*?<\/\2>/gi, "$1");
  return [...body.matchAll(/<([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)].map((m) => {
    const attrs = {};
    for (const a of m[2].matchAll(/([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const k = a[1].toLowerCase();
      if (!(k in attrs)) attrs[k] = decode(a[2] ?? a[3] ?? a[4] ?? "");
    }
    return { name: m[1].toLowerCase(), attrs };
  });
}

// Fragment targets on a page: every id, plus <a name>.
export function ids(html) {
  const out = new Set();
  for (const t of tags(html)) {
    if (t.attrs.id !== undefined) out.add(t.attrs.id);
    if (t.name === "a" && t.attrs.name) out.add(t.attrs.name);
  }
  return out;
}
