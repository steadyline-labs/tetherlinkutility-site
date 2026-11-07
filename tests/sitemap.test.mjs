// sitemap.feature: coverage, no noindex pages, no scheduled posts, alternates, robots.txt, lastmod from git.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import nodePath from "node:path";
import { LANGS, SITE_URL, root, prefix, hreflang, read, fileFor, robots, sitemap, postSources } from "./lib/site.mjs";
import sitemapExtra from "../src/_data/sitemapExtra.json" with { type: "json" };
import postData from "../src/_includes/post-data.js";
import { DATA_DEPS, gitLastmods, shallowRepo } from "../tools/git-lastmod.mjs";

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

// The built sitemap's lastmod must not be older than the last visible change to the page's source
// in git. The sitemap takes it from git at build time (tools/git-lastmod.mjs), so nobody bumps it
// by hand; this checks that every entry is wired to its source and the dates came through.
// Needs full git history: in CI, actions/checkout runs with fetch-depth: 0.
test("sitemap lastmod is not older than the last content change in git", () => {
  const shallow = shallowRepo();
  assert.notEqual(shallow, null, "not a git checkout: the lastmod test needs git history");
  assert.equal(shallow, false, "shallow clone: fetch the full history (actions/checkout fetch-depth: 0)");

  // Sitemap URL -> its source file (src/ page, or public/ for sitemapExtra entries).
  const sourceFor = (loc) => {
    const p = path(loc);
    const base = p.endsWith("/") ? `${p}index` : p.replace(/\.html$/, "");
    const candidates = sitemapExtra.some((e) => e.url === p)
      ? [`public${p}`]
      : [`src${base}.njk`, `src${base}.html`, `src${base}.md`];
    return candidates.find((c) => fs.existsSync(nodePath.join(root, c)));
  };

  const { gitLastmod } = gitLastmods();
  const stale = [];
  for (const e of entries) {
    const rel = sourceFor(e.loc);
    assert.ok(rel, `no source file for ${e.loc}`);
    assert.match(String(e.lastmod), /^\d{4}-\d{2}-\d{2}$/, `lastmod of ${e.loc}`);
    const changed = gitLastmod(rel);
    if (changed && e.lastmod < changed) stale.push(`${rel}: lastmod ${e.lastmod}, changed ${changed}`);
  }
  for (const [page, deps] of Object.entries(DATA_DEPS)) {
    assert.ok(fs.existsSync(nodePath.join(root, page)), `DATA_DEPS page missing: ${page}`);
    for (const d of deps) assert.ok(fs.existsSync(nodePath.join(root, d)), `DATA_DEPS file missing: ${d}`);
  }
  assert.deepEqual(stale, [], "sitemap lastmod older than the git history");
});
