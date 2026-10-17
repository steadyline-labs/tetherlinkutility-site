// privacy.feature and app_ads.feature.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, SITE_URL, prefix, read, links, robots, canonicals } from "./lib/site.mjs";

const html = read("/privacy.html");
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// English comes first, then one section per language starting at id="<lang>".
function sections() {
  const starts = LANGS.filter((l) => l !== "en")
    .map((l) => [l, html.indexOf(`id="${l}"`)])
    .sort((a, b) => a[1] - b[1]);
  const out = {};
  let from = 0, cur = "en";
  for (const [l, at] of starts) {
    assert.ok(at > 0, `section #${l}`);
    out[cur] = text(html.slice(from, at));
    from = at;
    cur = l;
  }
  out[cur] = text(html.slice(from, html.indexOf("</main>")));
  return out;
}
const SECTIONS = sections();

// The help requests part: from id="<lang>-help-requests" to the next h2.
function helpPart(lang) {
  const id = lang === "en" ? "help-requests" : `${lang}-help-requests`;
  const at = html.indexOf(`id="${id}"`);
  assert.ok(at > 0, id);
  const end = html.indexOf("<h2", at + 10);
  return text(html.slice(at, end > 0 ? end : undefined));
}

const CONSENT = { en: "consent message", tr: "onay mesajı", es: "mensaje de consentimiento", pt: "mensagem de consentimento", hi: "सहमति संदेश" };
const SCREENS = { en: "app screens", tr: "uygulama ekranları", es: "pantallas de la app", pt: "telas do app", hi: "स्क्रीन" };

for (const lang of LANGS) {
  test(`privacy ${lang}: names Analytics, Crashlytics, Remote Config, AdMob and the consent message`, () => {
    const s = SECTIONS[lang];
    for (const k of ["Firebase Analytics", "Crashlytics", "Remote Config", "AdMob"]) assert.ok(s.includes(k), `${lang}: ${k}`);
    assert.ok(s.includes(CONSENT[lang]), `${lang}: consent message`);
  });

  test(`privacy ${lang}: help requests part has Formspree, Firestore, recent screens and 90 days`, () => {
    const s = helpPart(lang);
    for (const k of ["Formspree", "Firestore", "90", SCREENS[lang]]) assert.ok(s.includes(k), `${lang}: ${k}`);
    assert.ok(links(html).some((a) => a.href === `${prefix(lang)}help.html`), `link to ${prefix(lang)}help.html`);
  });
}

test("privacy page is indexable with its canonical", () => {
  assert.equal(robots(html), "index, follow");
  assert.deepEqual(canonicals(html), [`${SITE_URL}/privacy.html`]);
});

test("app-ads.txt has exactly the AdMob line", () => {
  const lines = read("/app-ads.txt").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(lines, ["google.com, pub-3077005473656617, DIRECT, f08c47fec0942fa0"]);
});
