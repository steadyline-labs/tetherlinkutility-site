// privacy.feature and app_ads.feature.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, SITE_URL, i18n, prefix, read, links, robots, canonicals } from "./lib/site.mjs";

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

for (const lang of LANGS) {
  test(`privacy ${lang}: names Analytics, Crashlytics, Remote Config, AdMob and the consent message`, () => {
    const s = SECTIONS[lang];
    for (const k of ["Firebase Analytics", "Crashlytics", "Remote Config", "AdMob"]) assert.ok(s.includes(k), `${lang}: ${k}`);
    assert.ok(s.includes(CONSENT[lang]), `${lang}: consent message`);
  });

  test(`privacy ${lang}: help requests part names WhatsApp (Meta) and email, no Formspree or Firestore`, () => {
    const s = helpPart(lang);
    for (const k of ["WhatsApp", "WhatsApp LLC / Meta", "support@tetherlinkutility.com", "Pro"]) assert.ok(s.includes(k), `${lang}: ${k}`);
    assert.ok(!/Formspree|Firestore/i.test(SECTIONS[lang]), `${lang}: no Formspree or Firestore`);
    assert.ok(links(html).some((a) => a.href === `${prefix(lang)}help.html`), `link to ${prefix(lang)}help.html`);
  });
}

// privacy.feature: the help requests part names the help page like the site's help links.
for (const lang of LANGS) {
  test(`privacy ${lang}: help page is called "${i18n[lang].help.link}" in the text and in its link`, () => {
    const label = i18n[lang].help.link;
    assert.ok(helpPart(lang).includes(`"${label}"`), `${lang}: help page name in text`);
    const help = links(html).filter((a) => a.href === `${prefix(lang)}help.html`);
    assert.ok(help.length > 0 && help.every((a) => a.text === label), `${lang}: link text ${help.map((a) => a.text)}`);
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
