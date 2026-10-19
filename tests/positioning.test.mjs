// Positioning (since 2026-09-25): Tether Link Utility is a data-sharing app. No page, URL, meta tag,
// JSON-LD block, sitemap or llms.txt entry may describe it as a way around carrier limits.
// Old URLs that contained such words survive only as noindex redirect stubs.
// Carrier guides may still explain what a carrier does (caps, slowdowns); that is not checked here.
// One exception: owner override 2026-09-27 keeps the "5 ways" guide at its old URL as a search page
// until about 50K users (brand-kit README). Its slug is allowed; its text is still checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlPages, read, isRedirectStub, robots, sitemap, links, decode } from "./lib/site.mjs";

// Words that frame the app as evading the carrier, in any language the site uses.
const BANNED = [
  /bypass/i,
  /circumvent/i,
  /undetect/i,
  /no restrictions/i,
  /without restrictions/i,
  /looks like normal/i,
  /carrier can(?:no|')t (?:see|detect|tell)/i,
  /\bevad(?:e|ing)\b/i,
];

const ALLOWED_SLUGS = ["best-ways-to-bypass-hotspot-throttling"];
const strip = (s) => ALLOWED_SLUGS.reduce((acc, slug) => acc.split(slug).join(""), s);
const banned = (s) => BANNED.some((re) => re.test(strip(s)));

const pages = htmlPages().map((p) => ({ p, html: read(p) }));
const live = pages.filter(({ html }) => !isRedirectStub(html));

test("no live page URL contains banned wording", () => {
  const bad = live.filter(({ p }) => banned(p)).map(({ p }) => p);
  assert.deepEqual(bad, []);
});

test("pages with banned words in their URL are noindex redirect stubs", () => {
  const bad = pages
    .filter(({ p }) => banned(p))
    .filter(({ html }) => !isRedirectStub(html) || !/noindex/.test(robots(html) || ""))
    .map(({ p }) => p);
  assert.deepEqual(bad, []);
});

test("no live page contains banned wording in its HTML (text, meta, JSON-LD, links)", () => {
  const bad = [];
  for (const { p, html } of live) {
    const body = strip(decode(html));
    for (const re of BANNED) if (re.test(body)) bad.push(`${p}: ${body.match(re)[0]}`);
  }
  assert.deepEqual(bad, []);
});

test("no live page links to a URL with banned wording", () => {
  const bad = [];
  for (const { p, html } of live) {
    for (const { href } of links(html)) if (banned(href)) bad.push(`${p} -> ${href}`);
  }
  assert.deepEqual(bad, []);
});

test("sitemap.xml and llms.txt contain no banned wording", () => {
  const urls = sitemap().flatMap((e) => [e.loc, ...Object.values(e.alternates)]);
  assert.deepEqual(urls.filter(banned), []);
  for (const f of ["/sitemap.xml", "/llms.txt"]) {
    const text = strip(read(f));
    assert.deepEqual(BANNED.filter((re) => re.test(text)).map(String), [], f);
  }
});
