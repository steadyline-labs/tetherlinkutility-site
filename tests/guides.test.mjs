// guides.feature: "Stuck on this step?" links in the setup guides with device and step prefill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, i18n, prefix, read, fileFor, links, GUIDES } from "./lib/site.mjs";

// Steps the help form shows per device (src/_includes/partials/help-form.njk, stepsFor).
const formHtml = read("/help.html");
const STEPS = JSON.parse(formHtml.match(/var STEPS = (\{[^\n]*\});/)[1]);
const PLATFORMS = [...formHtml.matchAll(/name="platform" value="([a-z_]+)"/g)].map((m) => m[1]);

const stepLinks = (html) => links(html).filter((a) => a.cls === "step-help");
const endLinks = (html) => links(html).filter((a) => a.cls === "help-end-btn");
const query = (href) => new URL(href, "https://x").searchParams;

for (const lang of LANGS) {
  for (const g of GUIDES) {
    const url = `${prefix(lang)}blog/${g}`;
    test(`${url}: step links use local text and the local help page`, () => {
      const html = read(url);
      const all = stepLinks(html);
      assert.ok(all.length >= 5, `only ${all.length} step links`);
      for (const a of all) {
        assert.equal(a.text, i18n[lang].help.stepLink);
        const u = new URL(a.href, "https://x");
        assert.equal(u.pathname, `${prefix(lang)}help.html`);
        assert.ok([...u.searchParams.keys()].every((k) => k === "device" || k === "step"), a.href);
        assert.ok(u.searchParams.get("step"), `${a.href}: step`);
      }
      const end = endLinks(html);
      assert.equal(end.length, 1, "one end card");
      assert.equal(end[0].text, i18n[lang].help.endButton);
      assert.equal(new URL(end[0].href, "https://x").pathname, `${prefix(lang)}help.html`);
      assert.ok(!/<!--help(-end)?:/.test(html), "unrendered help marker");
    });
  }
}

test("every prefilled device and step is offered by the form for that device", () => {
  for (const lang of LANGS) {
    for (const g of GUIDES) {
      for (const a of stepLinks(read(`${prefix(lang)}blog/${g}`))) {
        const q = query(a.href);
        const device = q.get("device");
        const step = q.get("step").replace(/-/g, "_");
        const allSteps = Object.keys(i18n[lang].help.steps);
        assert.ok(allSteps.includes(step), `${lang} ${a.href}: step ${step}`);
        if (device) {
          assert.ok(PLATFORMS.includes(device), `${a.href}: device`);
          assert.ok(STEPS[device].split(" ").includes(step), `${lang} ${a.href}: ${step} not shown for ${device}`);
        }
      }
    }
  }
});

test("Android guide prefills android on every step and the end card", () => {
  for (const lang of LANGS) {
    const html = read(`${prefix(lang)}blog/share-mobile-data-android-to-android-qr.html`);
    for (const a of stepLinks(html)) assert.equal(query(a.href).get("device"), "android", a.href);
    assert.equal(endLinks(html)[0].href, `${prefix(lang)}help.html?device=android`);
  }
});

test("SOCKS5 guide: device sections prefill their device, shared steps carry only the step", () => {
  for (const lang of LANGS) {
    const html = read(`${prefix(lang)}blog/socks5-proxy-setup-windows-macos-ios.html`);
    const hrefs = stepLinks(html).map((a) => a.href.replace(prefix(lang), "/"));
    for (const want of [
      "/help.html?device=windows&step=set-proxy",
      "/help.html?device=mac&step=install",
      "/help.html?device=linux&step=set-proxy",
      "/help.html?device=ios&step=ios-proxy-app",
      "/help.html?step=install",
      "/help.html?step=start-sharing",
      "/help.html?step=join-wifi",
    ]) assert.ok(hrefs.includes(want), `${lang}: ${want}`);
    assert.equal(endLinks(html)[0].href, `${prefix(lang)}help.html`);
  }
});

test("step link targets exist", () => {
  for (const lang of LANGS) for (const g of GUIDES) {
    for (const a of stepLinks(read(`${prefix(lang)}blog/${g}`))) assert.ok(fileFor(a.href), a.href);
  }
});
