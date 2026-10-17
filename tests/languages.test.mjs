// languages.feature: five languages, lang attributes, language menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, i18n, prefix, hreflang, read, fileFor, htmlPages, htmlLang, links, hreflangs } from "./lib/site.mjs";

const langMenu = (html) => {
  const m = html.match(/<div class="lang-dropdown-menu"[\s\S]*?<\/div>/);
  assert.ok(m, "language menu missing");
  return links(m[0]);
};

for (const lang of LANGS) {
  test(`home ${prefix(lang)} is built with lang="${hreflang(lang)}"`, () => {
    assert.equal(htmlLang(read(prefix(lang))), hreflang(lang));
  });
  test(`help ${prefix(lang)}help.html is built with lang="${hreflang(lang)}"`, () => {
    assert.equal(htmlLang(read(`${prefix(lang)}help.html`)), hreflang(lang));
  });
}

test("every blog post has the lang of its folder", () => {
  const posts = htmlPages().filter((p) => /\/blog\/[^/]+\.html$/.test(p));
  assert.ok(posts.length > 20);
  for (const p of posts) {
    const html = read(p);
    if (/<meta http-equiv="refresh"/.test(html)) continue;
    const folder = p.split("/")[1];
    const lang = LANGS.includes(folder) ? folder : "en";
    assert.equal(htmlLang(html), hreflang(lang), p);
  }
});

test("help page language menu links to all five help pages, current one marked", () => {
  const menu = langMenu(read("/tr/help.html"));
  assert.deepEqual(menu.map((a) => a.href).sort(), LANGS.map((l) => `${prefix(l)}help.html`).sort());
  const current = menu.filter((a) => a.attrs.includes("is-current"));
  assert.deepEqual(current.map((a) => a.text), ["Türkçe"]);
});

test("home language menu links to all five home pages, English current on /", () => {
  const menu = langMenu(read("/"));
  assert.deepEqual(menu.map((a) => a.href).sort(), LANGS.map(prefix).sort());
  assert.deepEqual(menu.filter((a) => a.attrs.includes("is-current")).map((a) => a.text), ["English"]);
  assert.deepEqual(menu.map((a) => a.text).sort(), LANGS.map((l) => i18n[l].name).sort());
});

test("no language menu link or hreflang on any page points to a missing page", () => {
  for (const p of htmlPages()) {
    const html = read(p);
    if (!html.includes("lang-dropdown-menu")) continue;
    for (const a of langMenu(html)) assert.ok(fileFor(a.href), `${p}: menu -> ${a.href}`);
    for (const href of Object.values(hreflangs(html))) {
      assert.ok(fileFor(href.replace("https://tetherlinkutility.com", "")), `${p}: hreflang -> ${href}`);
    }
  }
});
