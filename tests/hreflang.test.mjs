// seo.feature: canonical and hreflang consistency (STANDARTLAR 3.1.3-3.1.4).
// Canonical: absolute, self-referencing, equal to the sitemap <loc>. hreflang: every language version
// carries the same set (reciprocal), with x-default = the English version, pointing to built pages
// whose <html lang> and canonical match, and the sitemap alternates repeat that set.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANGS, SITE_URL, i18n, prefix, hreflang, read, fileFor, htmlPages, isRedirectStub,
  canonicals, hreflangs, htmlLang, robots, sitemap, tags,
} from "./lib/site.mjs";

const pages = htmlPages().map((p) => ({ p, html: read(p) })).filter((x) => !isRedirectStub(x.html));
const byUrl = new Map(pages.map((x) => [SITE_URL + x.p.replace(/(^|\/)index\.html$/, "$1"), x]));
const noindex = (html) => String(robots(html)).includes("noindex");
const entries = sitemap();
const smByLoc = new Map(entries.map((e) => [e.loc, e]));
const CODES = LANGS.map(hreflang);
const codeToLang = Object.fromEntries(LANGS.map((l) => [hreflang(l), l]));
// Language of a URL path from its prefix: /tr/... -> tr, anything else -> en.
const langOfPath = (p) => LANGS.find((l) => l !== "en" && p.startsWith(prefix(l))) || "en";
const selfUrl = (p) => SITE_URL + p.replace(/(^|\/)index\.html$/, "$1");

test("there are enough pages to check", () => {
  assert.ok(pages.length > 80, `${pages.length} pages`);
});

test("every page has exactly one canonical: absolute, https, on the site URL, self-referencing", () => {
  const bad = [];
  for (const { p, html } of pages) {
    const c = canonicals(html);
    if (c.length !== 1) { bad.push(`${p}: ${c.length} canonicals`); continue; }
    if (!/^https:\/\/tetherlinkutility\.com\//.test(c[0])) bad.push(`${p}: not absolute: ${c[0]}`);
    if (c[0] !== selfUrl(p)) bad.push(`${p}: canonical ${c[0]}, page is ${selfUrl(p)}`);
    if (/index\.html$|[?#]/.test(c[0])) bad.push(`${p}: canonical has index.html, query or hash: ${c[0]}`);
  }
  assert.deepEqual(bad, []);
});

test("og:url equals the canonical wherever it is set", () => {
  const bad = [];
  for (const { p, html } of pages) {
    const og = tags(html).find((t) => t.name === "meta" && t.attrs.property === "og:url");
    if (og && og.attrs.content !== canonicals(html)[0]) bad.push(`${p}: og:url ${og.attrs.content}`);
  }
  assert.deepEqual(bad, []);
});

test("each indexable page's canonical is a sitemap <loc>, and each sitemap <loc> is the canonical of its page", () => {
  const bad = [];
  for (const { p, html } of pages) {
    const c = canonicals(html)[0];
    if (noindex(html)) { if (smByLoc.has(c)) bad.push(`${p}: noindex but in sitemap`); continue; }
    if (!smByLoc.has(c)) bad.push(`${p}: canonical ${c} not in sitemap`);
  }
  for (const e of entries) {
    if (!/\.html$|\/$/.test(e.loc)) continue; // pricing.md and other non-HTML files
    const page = byUrl.get(e.loc);
    if (!page) bad.push(`sitemap ${e.loc}: no page with that URL`);
    else if (canonicals(page.html)[0] !== e.loc) bad.push(`sitemap ${e.loc}: page canonical ${canonicals(page.html)[0]}`);
  }
  assert.deepEqual(bad, []);
});

test("<html lang> matches the locale of the URL prefix on every page", () => {
  const bad = [];
  for (const { p, html } of pages) {
    const want = hreflang(langOfPath(p));
    if (htmlLang(html) !== want) bad.push(`${p}: lang="${htmlLang(html)}", want "${want}"`);
  }
  assert.deepEqual(bad, []);
});

test("og:locale matches the page language wherever it is set", () => {
  const bad = [];
  for (const { p, html } of pages) {
    const og = tags(html).find((t) => t.name === "meta" && t.attrs.property === "og:locale");
    const want = i18n[langOfPath(p)].ogLocale;
    if (og && og.attrs.content !== want) bad.push(`${p}: og:locale ${og.attrs.content}, want ${want}`);
  }
  assert.deepEqual(bad, []);
});

test("hreflang tags: known codes only, no duplicates, absolute URLs", () => {
  const bad = [];
  for (const { p, html } of pages) {
    const raw = tags(html).filter((t) => t.name === "link" && t.attrs.rel === "alternate" && t.attrs.hreflang);
    const codes = raw.map((t) => t.attrs.hreflang);
    if (new Set(codes).size !== codes.length) bad.push(`${p}: duplicate hreflang ${codes}`);
    for (const t of raw) {
      if (![...CODES, "x-default"].includes(t.attrs.hreflang)) bad.push(`${p}: unknown hreflang ${t.attrs.hreflang}`);
      if (!t.attrs.href.startsWith(SITE_URL + "/")) bad.push(`${p}: hreflang href not absolute: ${t.attrs.href}`);
    }
    // hreflangs() (regex) and tags() (parser) agree, so the other tests see every tag.
    if (Object.keys(hreflangs(html)).length !== raw.length) bad.push(`${p}: hreflang markup not in the expected form`);
  }
  assert.deepEqual(bad, []);
});

test("hreflang sets include the page itself and x-default = the English version", () => {
  const bad = [];
  for (const { p, html } of pages) {
    const hl = hreflangs(html);
    if (!Object.keys(hl).length) continue; // local post without counterparts (STANDARTLAR 3.1.4)
    const own = hreflang(langOfPath(p));
    if (hl[own] !== canonicals(html)[0]) bad.push(`${p}: own ${own} -> ${hl[own]}, canonical ${canonicals(html)[0]}`);
    if (!hl["x-default"]) bad.push(`${p}: no x-default`);
    else if (hl["x-default"] !== hl.en) bad.push(`${p}: x-default ${hl["x-default"]} is not the en version ${hl.en}`);
    // A set naming only this page (one language + x-default) says nothing; the sitemap leaves it out.
    if (Object.keys(hl).filter((k) => k !== "x-default").length < 2) bad.push(`${p}: hreflang set with one language`);
  }
  assert.deepEqual(bad, []);
});

test("each hreflang target is built, has that language's prefix, lang and canonical, and the same robots", () => {
  const bad = [];
  for (const { p, html } of pages) {
    for (const [code, href] of Object.entries(hreflangs(html))) {
      const target = byUrl.get(href);
      if (!target) { bad.push(`${p}: ${code} -> ${href} is not a built page${fileFor(href) ? " (redirect stub)" : ""}`); continue; }
      if (code === "x-default") continue;
      const lang = codeToLang[code];
      if (langOfPath(target.p) !== lang) bad.push(`${p}: ${code} -> ${href} is under the ${langOfPath(target.p)} prefix`);
      if (htmlLang(target.html) !== code) bad.push(`${p}: ${code} -> ${href} has lang="${htmlLang(target.html)}"`);
      if (canonicals(target.html)[0] !== href) bad.push(`${p}: ${code} -> ${href} has canonical ${canonicals(target.html)[0]}`);
      if (noindex(target.html) !== noindex(html)) bad.push(`${p}: ${code} -> ${href} differs in noindex`);
    }
  }
  assert.deepEqual(bad, []);
});

test("hreflang sets are reciprocal and identical across all language versions", () => {
  const bad = [];
  let sets = 0;
  for (const { p, html } of pages) {
    const hl = hreflangs(html);
    if (!Object.keys(hl).length) continue;
    sets++;
    for (const [code, href] of Object.entries(hl)) {
      const target = byUrl.get(href);
      if (!target) continue; // reported above
      try {
        assert.deepEqual(hreflangs(target.html), hl);
      } catch {
        bad.push(`${p} and its ${code} version ${href} carry different hreflang sets`);
      }
    }
  }
  assert.ok(sets > 50, `only ${sets} pages with hreflang`);
  assert.deepEqual(bad, []);
});

test("a page without hreflang is never named as an alternate by another page", () => {
  // A page without hreflang must not be named as an alternate by any other page.
  const named = new Set(pages.flatMap(({ html }) => Object.values(hreflangs(html))));
  const bad = pages.filter(({ p, html }) => !Object.keys(hreflangs(html)).length && named.has(selfUrl(p))).map((x) => x.p);
  assert.deepEqual(bad, []);
});

test("sitemap alternates equal the page's hreflang set for every <loc>", () => {
  const bad = [];
  for (const e of entries) {
    const page = byUrl.get(e.loc);
    if (!page) continue;
    try {
      assert.deepEqual(e.alternates, hreflangs(page.html));
    } catch {
      bad.push(`${e.loc}: sitemap ${JSON.stringify(e.alternates)} vs page ${JSON.stringify(hreflangs(page.html))}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("sitemap alternates for every language version list the same set (reciprocal in the sitemap)", () => {
  const bad = [];
  for (const e of entries) {
    for (const href of Object.values(e.alternates)) {
      const other = smByLoc.get(href);
      if (!other) { bad.push(`${e.loc}: alternate ${href} has no <loc>`); continue; }
      try { assert.deepEqual(other.alternates, e.alternates); } catch { bad.push(`${e.loc} vs ${href}`); }
    }
  }
  assert.deepEqual(bad, []);
});
