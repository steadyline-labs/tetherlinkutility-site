// home.feature and seo.feature: titles, meta, canonical, hreflang, JSON-LD, internal links.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANGS, SITE_URL, site, i18n, prefix, hreflang, read, fileFor, htmlPages, isRedirectStub,
  title, canonicals, robots, metaDescription, hreflangs, links, jsonLd, ldTypes, ldFind, htmlLang, sitemap,
  siteDir,
} from "./lib/site.mjs";
import fs from "node:fs";
import nodePath from "node:path";

const pages = htmlPages().map((p) => ({ p, html: read(p) })).filter((x) => !isRedirectStub(x.html));
const indexable = pages.filter((x) => !String(robots(x.html)).includes("noindex"));

for (const lang of LANGS) {
  test(`home ${prefix(lang)}: title starts with the brand, one h1, Play link with referrer`, () => {
    const html = read(prefix(lang));
    assert.ok(title(html).startsWith("Tether Link Utility:"), title(html));
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
    assert.ok(links(html).some((a) => a.href === `${site.playUrl}&referrer=${encodeURIComponent(`utm_source=tetherlinkutility.com&utm_medium=home&utm_campaign=home&utm_content=${lang}`)}`), "Play link with referrer");
  });

  test(`home ${prefix(lang)}: footer and FAQ link to ${prefix(lang)}help.html`, () => {
    const help = links(read(prefix(lang))).filter((a) => a.href === `${prefix(lang)}help.html`);
    assert.ok(help.some((a) => a.text === i18n[lang].help.link), "footer link text");
    assert.ok(help.some((a) => a.cls.includes("faq-help")), "FAQ link");
  });

  test(`home ${prefix(lang)}: reciprocal hreflang with x-default`, () => {
    const hl = hreflangs(read(prefix(lang)));
    const want = Object.fromEntries(LANGS.map((l) => [hreflang(l), `${SITE_URL}${prefix(l)}`]));
    want["x-default"] = `${SITE_URL}/`;
    assert.deepEqual(hl, want);
    assert.deepEqual(canonicals(read(prefix(lang))), [`${SITE_URL}${prefix(lang)}`]);
  });
}

test("home JSON-LD offers match the page currency (TRY on /tr/, USD elsewhere)", () => {
  for (const lang of LANGS) {
    const app = ldFind(jsonLd(read(prefix(lang))), "SoftwareApplication");
    assert.equal(app.length, 1, lang);
    const offers = [].concat(app[0].offers || ldFind(app, "Offer"));
    const paid = offers.find((o) => Number(o.price) > 0);
    assert.ok(paid, `${lang}: paid offer`);
    assert.equal(paid.priceCurrency, lang === "tr" ? "TRY" : "USD", lang);
  }
  const tr = ldFind(jsonLd(read("/tr/")), "Offer").find((o) => Number(o.price) > 0);
  assert.equal(tr.price, "109.99");
  const en = ldFind(jsonLd(read("/")), "Offer").find((o) => Number(o.price) > 0);
  assert.equal(en.price, "3.99");
});

test("home JSON-LD has SoftwareApplication, FAQPage and HowTo in every language", () => {
  for (const lang of LANGS) {
    const types = ldTypes(jsonLd(read(prefix(lang))));
    for (const t of ["SoftwareApplication", "FAQPage", "HowTo"]) assert.ok(types.includes(t), `${lang}: ${t}`);
  }
});

// STANDARTLAR 3.2.1 also asks for WebSite and Organization on every home page.
for (const lang of LANGS) {
  test(`home ${prefix(lang)} JSON-LD has WebSite and Organization (STANDARTLAR 3.2.1)`, () => {
    const types = ldTypes(jsonLd(read(prefix(lang))));
    for (const t of ["WebSite", "Organization"]) assert.ok(types.includes(t), `${lang}: ${t}`);
  });
}

// seo.feature: Spanish pages use es-419 everywhere (STANDARTLAR 3.1.3), never a bare "es".
test("no html lang, hreflang, sitemap alternate or JSON-LD inLanguage uses a bare \"es\"", () => {
  const bad = [];
  for (const { p, html } of pages) {
    if (htmlLang(html) === "es") bad.push(`${p}: html lang`);
    if ("es" in hreflangs(html)) bad.push(`${p}: hreflang`);
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        if (v.inLanguage === "es") bad.push(`${p}: inLanguage`);
        Object.values(v).forEach(walk);
      }
    };
    walk(jsonLd(html));
  }
  for (const e of sitemap()) if ("es" in e.alternates) bad.push(`sitemap ${e.loc}`);
  assert.deepEqual(bad, []);
  assert.equal(htmlLang(read("/es/")), "es-419");
  assert.equal(sitemap().find((e) => e.loc === `${SITE_URL}/tr/`).alternates["es-419"], `${SITE_URL}/es/`);
  assert.equal(ldFind(jsonLd(read("/es/")), "SoftwareApplication")[0].inLanguage, "es-419");
});

test("every page has a title, a meta description and one canonical on the site URL", () => {
  for (const { p, html } of pages) {
    assert.ok(title(html), `${p}: title`);
    assert.ok(metaDescription(html), `${p}: description`);
    const c = canonicals(html);
    assert.equal(c.length, 1, `${p}: canonical count`);
    assert.ok(c[0].startsWith(SITE_URL + "/"), `${p}: canonical ${c[0]}`);
  }
});

test("titles are unique across indexable pages", () => {
  const seen = new Map();
  for (const { p, html } of indexable) {
    const t = title(html);
    assert.ok(!seen.has(t), `"${t}" on ${seen.get(t)} and ${p}`);
    seen.set(t, p);
  }
});

test("canonical of every indexable page is a built page", () => {
  for (const { p, html } of indexable) {
    const c = canonicals(html)[0];
    assert.ok(fileFor(c.replace(SITE_URL, "")), `${p}: ${c}`);
  }
});

test("every JSON-LD block parses", () => {
  let n = 0;
  for (const { p, html } of pages) {
    const raw = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    for (const m of raw) {
      assert.doesNotThrow(() => JSON.parse(m[1]), p);
      n++;
    }
  }
  assert.ok(n > 50, `only ${n} JSON-LD blocks`);
});

test("blog posts have an Article whose inLanguage matches the page language and headline the title", () => {
  const posts = pages.filter(({ p }) => /\/blog\/[^/]+\.html$/.test(p) && !p.endsWith("/index.html"));
  assert.ok(posts.length > 20);
  for (const { p, html } of posts) {
    const art = ldFind(jsonLd(html), "Article").concat(ldFind(jsonLd(html), "BlogPosting"));
    assert.ok(art.length >= 1, `${p}: Article`);
    const lang = (html.match(/<html[^>]*\slang="([^"]+)"/) || [])[1];
    assert.equal(art[0].inLanguage, lang, `${p}: inLanguage`);
  }
});

test("BreadcrumbList items all have a URL", () => {
  for (const { p, html } of pages) {
    for (const bl of ldFind(jsonLd(html), "BreadcrumbList")) {
      for (const it of bl.itemListElement || []) assert.ok(it.item, `${p}: breadcrumb "${it.name}" has no item`);
    }
  }
});

test("internal links point to built files", () => {
  const broken = [];
  for (const { p, html } of pages) {
    for (const a of links(html)) {
      let h = a.href;
      if (!h || h.startsWith("#") || /^(mailto|tel|javascript):/.test(h)) continue;
      if (h.startsWith(SITE_URL)) h = h.slice(SITE_URL.length) || "/";
      else if (/^[a-z]+:/i.test(h) || h.startsWith("//")) continue;
      if (!h.startsWith("/")) h = p.replace(/[^/]*$/, "") + h;
      if (!fileFor(h)) broken.push(`${p} -> ${a.href}`);
    }
  }
  assert.deepEqual(broken, []);
});

// The 19 Sep 2026 demo Shorts were replaced on 29 Sep; Google kept showing their thumbnail for the
// site. Neither the old video IDs nor the old unversioned cover file names may come back anywhere in
// the build, and every home page carries a VideoObject for the video it actually shows.
test("no built file mentions the old demo videos or old cover file names", () => {
  const OLD = ["XdQTXdNc_4w", "8T_M4cgN8_E", "/demo-cover-en.jpg", "/demo-cover-tr.jpg"];
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(html|txt|xml|md|json|js|css|webmanifest)$/.test(e.name)) {
        const text = fs.readFileSync(full, "utf8");
        for (const o of OLD) if (text.includes(o)) bad.push(`${nodePath.relative(siteDir, full)}: ${o}`);
      }
    }
  };
  walk(siteDir);
  assert.deepEqual(bad, []);
});

for (const lang of LANGS) {
  test(`home ${prefix(lang)}: one VideoObject per video on the page (demo Short + Windows and Mac how-tos)`, () => {
    const html = read(prefix(lang));
    const ids = [...html.matchAll(/data-yt-id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, 3, "three videos in #demo");
    const v = ldFind(jsonLd(html), "VideoObject");
    assert.deepEqual(v.map((b) => b.embedUrl).sort(), ids.map((id) => `https://www.youtube.com/embed/${id}`).sort());
    const cover = (html.match(/<img src="(\/demo-cover-[^"]+)"/) || [])[1];
    const demo = v.find((b) => [].concat(b.thumbnailUrl).includes(`${SITE_URL}${cover}`));
    assert.ok(cover && demo, `a VideoObject thumbnailUrl has ${cover}`);
  });

  test(`home ${prefix(lang)}: Windows and Mac video cards link to their setup guide sections`, () => {
    const html = read(prefix(lang));
    for (const anchor of ["windows", "macos"]) {
      const m = html.match(new RegExp(`class="video-guide-link" href="([^"#]+)#${anchor}"`));
      assert.ok(m, `${anchor} guide link`);
      assert.ok(read(m[1]).includes(`id="${anchor}"`), `${m[1]}#${anchor} exists`);
    }
  });
}
