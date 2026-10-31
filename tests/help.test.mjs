// help_contact.feature (WhatsApp button and email, no form), help_seo.feature and
// help_redirect.feature (static part).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, SITE_URL, site, i18n, prefix, hreflang, read, textOf, title, canonicals, robots, hreflangs, links } from "./lib/site.mjs";

const WHATSAPP = "https://wa.me/905512507661?text=Hi%2C%20I%20need%20help%20with%20Tether%20Link%20Utility.";
const EMAIL = "support@tetherlinkutility.com";

test("site.whatsapp is the wa.me link with the English greeting", () => {
  assert.equal(site.whatsapp, WHATSAPP);
  assert.equal(new URL(WHATSAPP).searchParams.get("text"), "Hi, I need help with Tether Link Utility.");
  assert.equal(site.email, EMAIL);
});

for (const lang of LANGS) {
  const url = `${prefix(lang)}help.html`;

  test(`${url}: WhatsApp button and email fallback, no form and no Formspree`, () => {
    const html = read(url);
    const hp = i18n[lang].help;
    const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
    const wa = links(main).filter((a) => a.cls === "help-wa");
    assert.equal(wa.length, 1, "one WhatsApp button");
    assert.equal(wa[0].href, WHATSAPP);
    assert.equal(wa[0].text, hp.whatsapp);
    assert.match(main, /<a class="help-wa" href="[^"]+" target="_blank" rel="noopener">/);
    assert.ok(links(main).some((a) => a.href === `mailto:${EMAIL}` && a.text === EMAIL), "email link");
    assert.ok(textOf(main).includes(`${textOf(hp.emailFallback)} ${EMAIL}`), "email fallback text");
    assert.ok(!/<form|<textarea|<input/.test(main), "no form");
    assert.ok(!/formspree/i.test(html), "no Formspree");
    assert.ok(!/551 ?250|5512507661/.test(textOf(html)), "no visible phone number");
  });

  test(`${url}: texts come from i18n and the note links to the local privacy part`, () => {
    const html = read(url);
    const hp = i18n[lang].help;
    const text = textOf(html);
    for (const label of [hp.title, hp.intro, hp.whatsapp, hp.note]) assert.ok(text.includes(textOf(label)), `${lang}: "${label}"`);
    assert.ok(links(html).some((a) => a.href === hp.privacyHref), hp.privacyHref);
    assert.equal(hp.privacyHref, lang === "en" ? "/privacy.html#help-requests" : `/privacy.html#${lang}-help-requests`);
  });

  test(`${url}: noindex, canonical and reciprocal hreflang`, () => {
    const html = read(url);
    assert.equal(robots(html), "noindex, follow");
    assert.deepEqual(canonicals(html), [`${SITE_URL}${url}`]);
    const want = Object.fromEntries(LANGS.map((l) => [hreflang(l), `${SITE_URL}${prefix(l)}help.html`]));
    want["x-default"] = `${SITE_URL}/help.html`;
    assert.deepEqual(hreflangs(html), want);
  });

  test(`home ${prefix(lang)}: #help redirect script in the head`, () => {
    const html = read(prefix(lang));
    const head = html.slice(0, html.indexOf("</head>"));
    assert.ok(head.includes(`<script>if (location.hash === '#help') location.replace('${prefix(lang)}help.html');</script>`));
  });
}

test("help page titles are unique, Turkish title as written", () => {
  const titles = LANGS.map((l) => title(read(`${prefix(l)}help.html`)));
  assert.equal(new Set(titles).size, LANGS.length);
  assert.equal(title(read("/tr/help.html")), "Bağlantı Yardımı: Tether Link Utility");
});

// help_seo.feature: STANDARTLAR 3.1.3 Spanish code.
test("Spanish hreflang code is es-419 (STANDARTLAR 3.1.3)", () => {
  assert.equal(hreflang("es"), "es-419");
  assert.equal(hreflangs(read("/es/help.html"))["es-419"], `${SITE_URL}/es/help.html`);
});
