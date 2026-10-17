// sitemap.feature: coverage, no noindex pages, no scheduled posts, alternates, robots.txt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, SITE_URL, prefix, hreflang, read, fileFor, robots, sitemap, postSources } from "./lib/site.mjs";
import postData from "../src/_includes/post-data.js";

const entries = sitemap();
const locs = entries.map((e) => e.loc);
const path = (loc) => loc.slice(SITE_URL.length) || "/";

test("all home pages, privacy and pricing.md are listed", () => {
  for (const l of LANGS) assert.ok(locs.includes(`${SITE_URL}${prefix(l)}`), prefix(l));
  assert.ok(locs.includes(`${SITE_URL}/privacy.html`));
  assert.ok(locs.includes(`${SITE_URL}/pricing.md`));
  assert.equal(new Set(locs).size, locs.length, "duplicate URLs");
});

test("every listed URL is built and none is noindex", () => {
  for (const loc of locs) {
    const f = fileFor(path(loc));
    assert.ok(f, `not built: ${loc}`);
    if (f.endsWith(".html")) assert.ok(!String(robots(read(path(loc)))).includes("noindex"), `noindex in sitemap: ${loc}`);
  }
});

test("no help page is listed", () => {
  assert.deepEqual(locs.filter((l) => l.endsWith("/help.html")), []);
});

test("every published blog post is listed, scheduled ones are neither built nor listed", () => {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  for (const lang of LANGS) {
    for (const p of postSources(lang)) {
      const listed = locs.includes(`${SITE_URL}${p.url}`);
      if (p.published > today) {
        assert.ok(!listed && !fileFor(p.url), `scheduled post leaked: ${p.url}`);
      } else {
        assert.ok(listed, `missing in sitemap: ${p.url}`);
      }
    }
  }
});

test("post data: a future published date gives no permalink and is flagged scheduled", () => {
  const d = postData("tr");
  const future = { published: "2999-01-01", page: { fileSlug: "x" } };
  const past = { published: "2020-01-01", page: { fileSlug: "x" } };
  assert.equal(d.permalink(future), false);
  assert.equal(d.eleventyComputed.scheduled(future), true);
  assert.equal(d.permalink(past), "/tr/blog/x.html");
  assert.equal(d.eleventyComputed.scheduled(past), false);
});

test("home entries carry alternates for every language and x-default", () => {
  for (const l of LANGS) {
    const e = entries.find((x) => x.loc === `${SITE_URL}${prefix(l)}`);
    const want = Object.fromEntries(LANGS.map((x) => [hreflang(x), `${SITE_URL}${prefix(x)}`]));
    want["x-default"] = `${SITE_URL}/`;
    assert.deepEqual(e.alternates, want, prefix(l));
  }
});

test("robots.txt points to the sitemap", () => {
  assert.match(read("/robots.txt"), /^Sitemap: https:\/\/tetherlinkutility\.com\/sitemap\.xml$/m);
});
