// help_form.feature and help_redirect.feature in headless Chrome: prefill, validation, honeypot,
// send success and failure (Formspree is intercepted, nothing is sent), the 5 minute guard,
// JavaScript off, and the old /#help redirect. Skipped locally when Chrome is not found (set CHROME); fails on CI.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { LANGS, FORMSPREE, SITE_URL, i18n, prefix } from "./lib/site.mjs";
import { launch, skipBrowser } from "./lib/browser.mjs";

const EN = i18n.en.help;
const TR = i18n.tr.help;

describe("help form in a browser", { skip: skipBrowser() }, () => {
  let browser;
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  // Opens a page with empty local storage and a fresh Formspree mock.
  async function open(urlPath, opts) {
    const page = await browser.newPage(opts);
    await page.goto(urlPath);
    if (opts?.javaScript !== false) {
      await page.eval("localStorage.clear()");
      await page.goto(urlPath);
    }
    return page;
  }
  const state = (page) => page.eval(`(() => {
    const f = document.getElementById('helpForm');
    const val = (n) => (f.querySelector('input[name="' + n + '"]:checked') || {}).value || '';
    const status = document.getElementById('helpStatus');
    return {
      platform: val('platform'), step: val('step'),
      stepsHidden: document.getElementById('helpSteps').hidden,
      hiddenSteps: [...document.querySelectorAll('#helpSteps .help-opt')].filter(o => o.hidden).map(o => o.dataset.step),
      status: status.textContent, statusLink: (status.querySelector('a') || {}).href || '',
      formHidden: f.hidden, doneHidden: document.getElementById('helpDone').hidden,
      sendDisabled: document.getElementById('helpSend').disabled,
      sendText: document.getElementById('helpSend').textContent,
      sent: localStorage.getItem('tlu_help_sent'),
    };
  })()`);
  const pick = (page, name, value) => page.eval(`document.querySelector('input[name="${name}"][value="${value}"]').click()`);
  const type = (page, id, text) => page.eval(`(() => { const el = document.getElementById('${id}'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const send = (page) => page.eval("document.getElementById('helpSend').click()");
  const finished = (page) => page.waitFor(`!document.getElementById('helpSend').disabled && document.getElementById('helpSend').textContent !== document.getElementById('helpSend').dataset.sending`);
  const posts = (page) => page.requests.filter((r) => r.method === "POST");

  test("prefill device and step from the guide link", async () => {
    const page = await open("/help.html?device=ios&step=join-wifi");
    const s = await state(page);
    assert.equal(s.platform, "ios");
    assert.equal(s.step, "join_wifi");
    assert.equal(s.stepsHidden, false);
    assert.deepEqual(s.hiddenSteps.sort(), ["scan_qr", "set_proxy"]);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  for (const [device, want] of [["iPhone", "ios"], ["ipad", "ios"], ["macOS", "mac"], ["WINDOWS", "windows"], ["linux", "linux"]]) {
    test(`device alias "${device}" picks ${want}`, async () => {
      const page = await open(`/help.html?device=${device}`);
      assert.equal((await state(page)).platform, want);
      await page.close();
    });
  }

  test("unknown prefill values are ignored", async () => {
    const page = await open("/help.html?device=xbox&step=teleport");
    const s = await state(page);
    assert.equal(s.platform, "");
    assert.equal(s.step, "");
    assert.equal(s.stepsHidden, true);
    await pick(page, "platform", "windows");
    assert.equal((await state(page)).step, "", "unknown step stays empty after picking a device");
    await page.close();
  });

  test("odd characters in the query do not break the page", async () => {
    const page = await open('/help.html?device=ios%22%5D&step=join_wifi%22%3E');
    const s = await state(page);
    assert.equal(s.platform, "");
    assert.equal(s.step, "");
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test("missing parameters leave the form empty with steps hidden", async () => {
    const page = await open("/help.html");
    const s = await state(page);
    assert.deepEqual([s.platform, s.step, s.stepsHidden], ["", "", true]);
    await page.close();
  });

  test("a step without a device is applied once a matching device is picked", async () => {
    const page = await open("/help.html?step=install");
    assert.equal((await state(page)).platform, "");
    await pick(page, "platform", "windows");
    const s = await state(page);
    assert.equal(s.step, "install");
    assert.equal(s.stepsHidden, false);
    await page.close();
  });

  test("a step the device does not have is not picked", async () => {
    const page = await open("/help.html?device=android&step=set-proxy");
    const s = await state(page);
    assert.equal(s.platform, "android");
    assert.equal(s.step, "");
    assert.ok(s.hiddenSteps.includes("set_proxy"));
    await page.close();
  });

  test("changing the device clears a step it does not have", async () => {
    const page = await open("/help.html?device=windows&step=set-proxy");
    await pick(page, "platform", "android");
    const s = await state(page);
    assert.equal(s.step, "");
    assert.ok(s.hiddenSteps.includes("set_proxy"));
    await page.close();
  });

  test("required choices are checked before sending", async () => {
    const page = await open("/help.html");
    await send(page);
    assert.equal((await state(page)).status, EN.choose);
    assert.deepEqual(page.requests, []);
    await page.close();
  });

  test("a device without a step is not sent", async () => {
    const page = await open("/help.html?device=mac");
    await send(page);
    assert.equal((await state(page)).status, EN.choose);
    assert.deepEqual(page.requests, []);
    await page.close();
  });

  for (const bad of ["not-an-email", "a@b", "two words@x.com", `${"a".repeat(115)}@x.com`]) {
    test(`a wrong email is caught before sending: ${bad.slice(0, 20)}`, async () => {
      const page = await open("/help.html?device=mac&step=set-proxy");
      await type(page, "helpEmail", bad);
      await send(page);
      assert.equal((await state(page)).status, EN.emailBad);
      assert.deepEqual(page.requests, []);
      await page.close();
    });
  }

  test("the honeypot stops bots without telling them", async () => {
    const page = await open("/help.html?device=mac&step=set-proxy");
    await type(page, "helpGotcha", "spam");
    await send(page);
    const s = await state(page);
    assert.equal(s.doneHidden, false);
    assert.equal(s.formHidden, true);
    assert.equal(s.sent, null, "no send recorded");
    assert.deepEqual(page.requests, []);
    await page.close();
  });

  test("successful send (TR): one JSON POST with exactly the form data, thank-you shown", async () => {
    const page = await open("/tr/help.html?device=windows&step=set-proxy");
    await type(page, "helpMessage", "Proxy alanını bulamadım");
    assert.equal(await page.eval("document.getElementById('helpCount').textContent"), "23/500");
    await type(page, "helpEmail", "  user@example.com ");
    await send(page);
    await page.waitFor("!document.getElementById('helpDone').hidden");
    const p = posts(page);
    assert.equal(p.length, 1);
    assert.equal(p[0].url, FORMSPREE);
    assert.equal(p[0].headers["Content-Type"], "application/json");
    assert.equal(p[0].headers.Accept, "application/json");
    assert.deepEqual(JSON.parse(p[0].body), {
      source: "site", platform: "windows", step: "set_proxy", message: "Proxy alanını bulamadım",
      email: "user@example.com", lang: "tr", page: "guide",
      _subject: "TLU help (site): windows / set_proxy", _replyto: "user@example.com",
    });
    const s = await state(page);
    assert.equal(s.formHidden, true);
    assert.ok(Number(s.sent) > 0, "send time stored");
    assert.equal(await page.eval("document.getElementById('helpDone').textContent.trim()"), TR.success);
    assert.deepEqual(page.blocked.filter((u) => u.includes("formspree")), []);
    await page.close();
  });

  for (const lang of LANGS) {
    test(`${prefix(lang)}help.html sends lang "${lang}" and page "guide"`, async () => {
      const page = await open(`${prefix(lang)}help.html?device=android&step=no-internet`);
      await send(page);
      await page.waitFor("!document.getElementById('helpDone').hidden");
      const body = JSON.parse(posts(page)[0].body);
      assert.equal(body.lang, lang);
      assert.equal(body.page, "guide");
      assert.equal(body.email, "");
      assert.equal(body.message, "");
      assert.ok(!("_replyto" in body), "no reply address without email");
      await page.close();
    });
  }

  test("a long message is cut to 500 characters", async () => {
    const page = await open("/help.html?device=linux&step=other");
    await type(page, "helpMessage", "x".repeat(600));
    await send(page);
    await page.waitFor("!document.getElementById('helpDone').hidden");
    assert.equal(JSON.parse(posts(page)[0].body).message.length, 500);
    await page.close();
  });

  test("a second send within 5 minutes is held back in the page", async () => {
    const page = await open("/help.html?device=mac&step=install");
    await page.eval(`localStorage.setItem('tlu_help_sent', String(Date.now() - 60 * 1000))`);
    await send(page);
    assert.equal((await state(page)).status, EN.recent);
    assert.deepEqual(page.requests, []);
    await page.eval(`localStorage.setItem('tlu_help_sent', String(Date.now() - 6 * 60 * 1000))`);
    await send(page);
    await page.waitFor("!document.getElementById('helpDone').hidden");
    assert.equal(posts(page).length, 1, "allowed again after 5 minutes");
    await page.close();
  });

  test("server error is retried once, then the email fallback is shown", async () => {
    const page = await open("/help.html?device=linux&step=install");
    page.replies.push(500);
    await send(page);
    assert.equal((await state(page)).sendText, EN.sending);
    await finished(page);
    const s = await state(page);
    assert.equal(posts(page).length, 2);
    assert.equal(s.status, `${EN.error} support@tetherlinkutility.com`);
    assert.equal(s.statusLink, "mailto:support@tetherlinkutility.com");
    assert.equal(s.sendDisabled, false);
    assert.equal(s.sendText, EN.button);
    assert.equal(s.formHidden, false);
    assert.equal(s.sent, null);
    await page.close();
  });

  test("a network failure is retried once and can succeed", async () => {
    const page = await open("/help.html?device=linux&step=install");
    page.replies.push("network", 200);
    await send(page);
    await page.waitFor("!document.getElementById('helpDone').hidden");
    assert.equal(posts(page).length, 2);
    await page.close();
  });

  test("a validation error (422) is not retried and shows the error", async () => {
    const page = await open("/tr/help.html?device=ios&step=ios-proxy-app");
    page.replies.push(422);
    await send(page);
    await finished(page);
    const s = await state(page);
    assert.equal(posts(page).length, 1);
    assert.equal(s.status, `${TR.error} support@tetherlinkutility.com`);
    await page.close();
  });

  test("rate limit (429) shows the just-sent message", async () => {
    const page = await open("/help.html?device=ios&step=install");
    page.replies.push(429);
    await send(page);
    await finished(page);
    assert.equal((await state(page)).status, EN.recent);
    assert.equal(posts(page).length, 1);
    await page.close();
  });

  test("double click sends only once", async () => {
    const page = await open("/help.html?device=mac&step=join-wifi");
    await page.eval("document.getElementById('helpSend').click(); document.getElementById('helpSend').click()");
    await page.waitFor("!document.getElementById('helpDone').hidden");
    assert.equal(posts(page).length, 1);
    await page.close();
  });

  test("without JavaScript all steps are visible and the form posts to Formspree", async () => {
    const page = await open("/help.html?device=ios&step=join-wifi", { javaScript: false });
    const r = await page.eval(`(() => {
      const f = document.getElementById('helpForm');
      return { action: f.action, method: f.method, noValidate: f.noValidate,
        stepsHidden: document.getElementById('helpSteps').hidden,
        picked: !!f.querySelector('input:checked'),
        valid: f.checkValidity() };
    })()`);
    assert.deepEqual(r, { action: FORMSPREE, method: "post", noValidate: false, stepsHidden: false, picked: false, valid: false });
    await page.close();
  });

  for (const lang of LANGS) {
    test(`${prefix(lang)}#help redirects to ${prefix(lang)}help.html`, async () => {
      const page = await browser.newPage();
      await page.goto(`${prefix(lang)}#help`);
      await page.waitFor(`location.pathname === '${prefix(lang)}help.html'`);
      await page.close();
    });
  }

  test("other anchors on the home page do not redirect", async () => {
    const page = await browser.newPage();
    await page.goto("/#faq");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await page.eval("location.pathname"), "/");
    await page.close();
  });

  test("help pages make no outside requests besides blocked third parties", async () => {
    const page = await open("/help.html");
    assert.deepEqual(page.requests, []);
    assert.ok(page.blocked.every((u) => !u.startsWith(SITE_URL)), page.blocked.join(", "));
    await page.close();
  });
});
