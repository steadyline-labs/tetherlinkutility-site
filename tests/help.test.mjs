// help_form.feature (static part, also the no-JavaScript path), help_seo.feature and
// help_redirect.feature (static part). Browser behaviour is in help-form.browser.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, SITE_URL, FORMSPREE, i18n, prefix, hreflang, read, textOf, title, canonicals, robots, hreflangs, links } from "./lib/site.mjs";

const PLATFORMS = ["android", "ios", "windows", "mac", "linux", "other"];
const STEPS = ["start_sharing", "install", "scan_qr", "join_wifi", "set_proxy", "no_internet", "other"];
const formOf = (html) => html.match(/<form class="help-form"[\s\S]*?<\/form>/)[0];
const hidden = (form) =>
  Object.fromEntries([...form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2]]));
const radios = (form, name) =>
  [...form.matchAll(new RegExp(`<input type="radio" name="${name}" value="([a-z_]+)"( required)?>`, "g"))].map((m) => ({
    value: m[1],
    required: Boolean(m[2]),
  }));

for (const lang of LANGS) {
  const url = `${prefix(lang)}help.html`;

  test(`${url}: form posts to Formspree with the right hidden fields and choices`, () => {
    const html = read(url);
    const form = formOf(html);
    assert.match(form, new RegExp(`action="${FORMSPREE}" method="POST"`));
    assert.deepEqual(hidden(form), { source: "site", lang, page: "guide", _subject: "TLU help (site)" });
    assert.deepEqual(radios(form, "platform").map((r) => r.value), PLATFORMS);
    assert.deepEqual(radios(form, "step").map((r) => r.value), STEPS);
    // Without JavaScript the browser checks the first radio of each group (required) and shows every step.
    assert.deepEqual(radios(form, "platform").map((r) => r.required), PLATFORMS.map((_, i) => i === 0));
    assert.deepEqual(radios(form, "step").map((r) => r.required), STEPS.map((_, i) => i === 0));
    assert.ok(!/<fieldset[^>]*id="helpSteps"[^>]*hidden/.test(form), "steps hidden in HTML");
    assert.match(form, /<textarea id="helpMessage" name="message"[^>]*maxlength="500"/);
    assert.match(form, /<input id="helpEmail" name="email" type="email" maxlength="120"/);
    assert.match(form, /<input id="helpGotcha" name="_gotcha" type="text" tabindex="-1"/);
    assert.match(form, /<div class="help-hp" aria-hidden="true">/);
    // The JS sender uses the same endpoint as the plain form.
    assert.ok(html.includes(`const HELP_ENDPOINT = "${FORMSPREE}";`));
    assert.equal((html.match(/formspree\.io\/f\//g) || []).length, 2, "Formspree id appears once in the form and once in the script");
  });

  test(`${url}: labels come from i18n and the note links to the local privacy part`, () => {
    const html = read(url);
    const hp = i18n[lang].help;
    const text = textOf(html);
    for (const label of Object.values(hp.platforms).concat(Object.values(hp.steps), [hp.q1, hp.q2, hp.button])) {
      assert.ok(text.includes(textOf(label)), `${lang}: "${label}"`);
    }
    assert.ok(textOf(html.match(/<div class="help-done"[\s\S]*?<\/div>/)[0]).includes(textOf(hp.success)), "thank-you text");
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
