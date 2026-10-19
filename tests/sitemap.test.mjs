// sitemap.feature: coverage, no noindex pages, no scheduled posts, alternates, robots.txt, lastmod vs git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import nodePath from "node:path";
import { LANGS, SITE_URL, root, prefix, hreflang, read, fileFor, robots, sitemap, postSources } from "./lib/site.mjs";
import sitemapExtra from "../src/_data/sitemapExtra.json" with { type: "json" };
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

// sitemap.lastmod must not be older than the last git commit that changed the page's source file.
// Counted: commits that modify the file (--diff-filter=M; the commit that added it keeps the date it
// was written with). Not counted: commits whose changed lines are all `lastmod:` or `text:` (llms.txt
// text), since neither is shown on the page and bumping lastmod must not need another bump.
// Needs full git history: in CI, actions/checkout runs with fetch-depth: 0.
test("sitemap lastmod is not older than the last content change in git", () => {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  let shallow;
  try {
    shallow = git("rev-parse", "--is-shallow-repository").trim();
  } catch {
    assert.fail("not a git checkout: the lastmod test needs git history");
  }
  assert.equal(shallow, "false", "shallow clone: fetch the full history (actions/checkout fetch-depth: 0)");

  const lastContentChange = (rel) => {
    const log = git("log", "--diff-filter=M", "--format=@@commit %cs", "-p", "--unified=0", "--", rel);
    for (const chunk of log.split("@@commit ").slice(1)) {
      const [date, ...lines] = chunk.split("\n");
      const changed = lines.filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
      if (changed.some((l) => !/^[+-]\s+(lastmod|text):/.test(l))) return date;
    }
    return null;
  };

  const sources = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(html|njk|md)$/.test(e.name)) {
        const fm = (fs.readFileSync(full, "utf8").match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
        const lastmod = (fm.match(/^sitemap:\n(?:[ \t]+.*\n)*?[ \t]+lastmod:\s*"?([0-9-]+)"?/m) || [])[1];
        if (lastmod) sources.push({ rel: nodePath.relative(root, full), lastmod });
      }
    }
  };
  walk(nodePath.join(root, "src"));
  assert.equal(sources.length + sitemapExtra.length, entries.length, "every sitemap entry has a source with a lastmod");
  for (const e of sitemapExtra) sources.push({ rel: `public${e.url}`, lastmod: e.lastmod });

  const stale = [];
  for (const s of sources) {
    const changed = lastContentChange(s.rel);
    if (changed && s.lastmod < changed) stale.push(`${s.rel}: lastmod ${s.lastmod}, changed ${changed}`);
  }
  assert.deepEqual(stale, [], "bump sitemap.lastmod for these pages");
});
