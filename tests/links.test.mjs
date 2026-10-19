// links.feature: every internal reference in the build resolves, every #fragment exists, sitemap and
// llms.txt URLs resolve, store links are well-formed. Works on _site/ only; nothing is fetched.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SITE_URL, site, read, fileFor, htmlPages, isRedirectStub, decode, sitemap, tags, ids } from "./lib/site.mjs";

const pages = htmlPages().map((p) => ({ p, html: read(p) }));
const PLAY_ID = new URL(site.playUrl).searchParams.get("id");

// Attributes that load or link to a URL.
const URL_ATTRS = ["href", "src", "poster", "action", "data", "formaction", "xlink:href"];
// <meta> values that are URLs (Open Graph, Twitter, and the refresh target of redirect stubs).
const META_URL = /^(og:(image|url|video|audio)(:secure_url)?|twitter:(image|player)|msapplication-\w+)$/;

// Every URL a page references: [{ url, where }].
function references(html) {
  const out = [];
  for (const t of tags(html)) {
    for (const a of URL_ATTRS) if (t.attrs[a] !== undefined) out.push({ url: t.attrs[a], where: `<${t.name} ${a}>` });
    for (const a of ["srcset", "imagesrcset"]) {
      if (t.attrs[a]) for (const c of t.attrs[a].split(",")) out.push({ url: c.trim().split(/\s+/)[0], where: `<${t.name} ${a}>` });
    }
    if (t.name === "meta") {
      const key = t.attrs.property || t.attrs.name || "";
      if (META_URL.test(key)) out.push({ url: t.attrs.content || "", where: `<meta ${key}>` });
      if (/^refresh$/i.test(t.attrs["http-equiv"] || "")) {
        out.push({ url: ((t.attrs.content || "").match(/url=(.*)$/i) || [])[1] || "", where: "<meta refresh>" });
      }
    }
    if (t.attrs.style) for (const m of t.attrs.style.matchAll(/url\(\s*['"]?([^'")]+)/g)) out.push({ url: m[1], where: "style url()" });
  }
  // Inline <style> blocks.
  for (const s of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const m of s[1].matchAll(/url\(\s*['"]?([^'")]+)/g)) out.push({ url: m[1], where: "<style> url()" });
  }
  // JSON-LD: every string value on the site URL is a link too.
  for (const s of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const walk = (v) => {
      if (typeof v === "string") { if (v.startsWith(SITE_URL)) out.push({ url: v, where: "JSON-LD" }); }
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(s[1]));
  }
  return out;
}

// Classify a reference from page `from`: { kind: "skip" | "external" | "internal", path, fragment }.
function classify(raw, from) {
  const url = decode(raw).trim();
  if (!url) return { kind: "empty" };
  if (/^(mailto|tel|sms|javascript|data|blob|about):/i.test(url)) return { kind: "skip" };
  let abs;
  try {
    abs = new URL(url, SITE_URL + from);
  } catch {
    return { kind: "malformed" };
  }
  if (abs.origin !== SITE_URL) return { kind: "external", url: abs };
  return { kind: "internal", path: abs.pathname, fragment: decodeURIComponent(abs.hash.slice(1)) };
}

const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) idCache.set(file, ids(fs.readFileSync(file, "utf8")));
  return idCache.get(file);
}

test("every internal href/src/poster/srcset/meta/JSON-LD URL resolves to a built file", () => {
  const broken = [];
  let n = 0;
  for (const { p, html } of pages) {
    for (const r of references(html)) {
      const c = classify(r.url, p);
      if (c.kind === "empty" || c.kind === "malformed") broken.push(`${p}: ${r.where} "${r.url}" is ${c.kind}`);
      if (c.kind !== "internal") continue;
      n++;
      if (!fileFor(c.path)) broken.push(`${p}: ${r.where} -> ${r.url}`);
    }
  }
  assert.ok(n > 2000, `only ${n} internal references found: the extractor is broken`);
  assert.deepEqual(broken, []);
});

test("every #fragment exists as an id on the target page", () => {
  const missing = [];
  let n = 0;
  for (const { p, html } of pages) {
    for (const r of references(html)) {
      const c = classify(r.url, p);
      if (c.kind !== "internal" || !c.fragment) continue;
      const f = fileFor(c.path);
      if (!f || !f.endsWith(".html")) continue;
      n++;
      if (!idsOf(f).has(c.fragment)) missing.push(`${p}: ${r.where} -> ${r.url}`);
    }
  }
  assert.ok(n > 20, `only ${n} fragment links found`);
  assert.deepEqual(missing, []);
});

test("ids are unique on every page", () => {
  const dupes = [];
  for (const { p, html } of pages) {
    const seen = new Set();
    for (const t of tags(html)) {
      const id = t.attrs.id;
      if (id === undefined) continue;
      if (seen.has(id)) dupes.push(`${p}: #${id}`);
      seen.add(id);
    }
  }
  assert.deepEqual(dupes, []);
});

test("label for, aria-controls, aria-labelledby and aria-describedby point to ids on the page", () => {
  const missing = [];
  for (const { p, html } of pages) {
    const have = ids(html);
    for (const t of tags(html)) {
      for (const a of ["for", "aria-controls", "aria-labelledby", "aria-describedby", "aria-owns", "list"]) {
        if (t.attrs[a] === undefined) continue;
        for (const id of t.attrs[a].split(/\s+/).filter(Boolean)) if (!have.has(id)) missing.push(`${p}: <${t.name} ${a}="${id}">`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("every sitemap <loc> and alternate resolves to a built file", () => {
  const broken = [];
  const entries = sitemap();
  assert.ok(entries.length > 50);
  for (const e of entries) {
    for (const u of [e.loc, ...Object.values(e.alternates)]) {
      assert.ok(u.startsWith(SITE_URL + "/"), `not on the site URL: ${u}`);
      if (!fileFor(u)) broken.push(u);
    }
  }
  assert.deepEqual(broken, []);
});

// llms.txt lists absolute URLs, bare paths ("/tr/help.html") and #anchors on privacy.html.
for (const file of ["/llms.txt", "/pricing.md", "/robots.txt"]) {
  test(`every site URL and path in ${file} resolves`, () => {
    const text = read(file);
    const broken = [];
    const urls = [...text.matchAll(/https:\/\/tetherlinkutility\.com[^\s)<>"'`]*/g)].map((m) => m[0].replace(/[.,;:]+$/, ""));
    const paths = [...text.matchAll(/(?<![\w/.:])\/(?:[a-z]{2}\/)?[\w./-]+\.(?:html|md|txt|xml)\b/g)].map((m) => m[0]);
    for (const u of [...urls, ...paths]) {
      const c = classify(u, "/");
      if (c.kind !== "internal" || !fileFor(c.path)) broken.push(u);
      else if (c.fragment && !idsOf(fileFor(c.path)).has(c.fragment)) broken.push(`${u} (no #${c.fragment})`);
    }
    if (file === "/llms.txt") {
      assert.ok(urls.length > 20, `only ${urls.length} URLs in llms.txt`);
      // "via #en/#tr/#hi/#es/#pt anchors" on the privacy line.
      const line = text.split("\n").find((l) => l.includes("/privacy.html"));
      const anchors = [...(line || "").matchAll(/#([a-z]{2})\b/g)].map((m) => m[1]);
      assert.ok(anchors.length >= 5, "privacy anchors listed");
      for (const a of anchors) if (!idsOf(fileFor("/privacy.html")).has(a)) broken.push(`/privacy.html#${a}`);
    }
    assert.deepEqual(broken, []);
  });
}

// Store links: well-formed only (never fetched).
function storeProblem(u) {
  if (u.protocol !== "https:") return "not https";
  if (u.hostname === "play.google.com") {
    if (u.pathname !== "/store/apps/details") return `path ${u.pathname}`;
    if (u.searchParams.get("id") !== PLAY_ID) return `id ${u.searchParams.get("id")}`;
    const extra = [...u.searchParams.keys()].filter((k) => !["id", "referrer", "hl", "gl"].includes(k));
    if (extra.length) return `unexpected params ${extra}`;
    const ref = u.searchParams.get("referrer");
    if (ref !== null) {
      const r = new URLSearchParams(ref);
      for (const k of ["utm_source", "utm_medium", "utm_campaign"]) if (!r.get(k)) return `referrer without ${k}`;
      if ([...r.keys()].some((k) => !/^utm_(source|medium|campaign|content|term)$/.test(k))) return `referrer keys ${[...r.keys()]}`;
    }
    return null;
  }
  if (u.hostname === "apps.apple.com") {
    return /^\/([a-z]{2}\/)?app\/([\w%-]+\/)?id\d+$/.test(u.pathname) ? null : `path ${u.pathname}`;
  }
  return null;
}

test("Play and App Store links are well-formed (app id, path, referrer)", () => {
  const bad = [];
  let n = 0;
  for (const { p, html } of pages) {
    for (const r of references(html)) {
      const c = classify(r.url, p);
      if (c.kind !== "external" || !/^(play\.google\.com|apps\.apple\.com|itunes\.apple\.com)$/.test(c.url.hostname)) continue;
      if (c.url.hostname === "itunes.apple.com") { bad.push(`${p}: old itunes host ${r.url}`); continue; }
      n++;
      const why = storeProblem(c.url);
      if (why) bad.push(`${p}: ${why}: ${r.url}`);
    }
  }
  assert.ok(n > 50, `only ${n} store links found`);
  assert.deepEqual(bad, []);
});

test("external links are absolute http(s) URLs with a host", () => {
  const bad = [];
  for (const { p, html } of pages) {
    for (const r of references(html)) {
      const c = classify(r.url, p);
      if (c.kind !== "external") continue;
      if (!/^https?:$/.test(c.url.protocol) || !c.url.hostname.includes(".")) bad.push(`${p}: ${r.url}`);
      else if (c.url.protocol === "http:") bad.push(`${p}: plain http: ${r.url}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("redirect stubs point to a built page", () => {
  const stubs = pages.filter((x) => isRedirectStub(x.html));
  for (const { p, html } of stubs) {
    const target = (references(html).find((r) => r.where === "<meta refresh>") || {}).url;
    assert.ok(target, `${p}: refresh target`);
    assert.ok(fileFor(classify(target, p).path), `${p} -> ${target}`);
  }
});
