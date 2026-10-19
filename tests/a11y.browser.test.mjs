// a11y.feature: axe-core in headless Chrome on the key pages (home in every language, help,
// privacy, a setup guide, a carrier post). Fails on any serious or critical violation.
// Skipped locally when Chrome is not found (set CHROME); fails on CI.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { LANGS, prefix, GUIDES } from "./lib/site.mjs";
import { launch, skipBrowser } from "./lib/browser.mjs";

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const PAGES = [
  ...LANGS.map(prefix),
  "/help.html", "/tr/help.html",
  "/privacy.html",
  `/blog/${GUIDES[0]}`, `/tr/blog/${GUIDES[0]}`,
  "/blog/jio-hotspot-data-limit.html", "/tr/blog/turkcell-hotspot-data-limit.html",
  "/blog/",
];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
// Known exceptions: "<path> <rule id>" with a one-line reason. Keep empty unless the owner decides.
const KNOWN = new Map([]);

describe("accessibility (axe-core) in a browser", { skip: skipBrowser() }, () => {
  let browser;
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  async function audit(urlPath, vp) {
    const page = await browser.newPage();
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
    await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.goto(urlPath);
    // Animations off so colour checks see final colours, not a frame of a transition.
    await page.eval(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(s); })()`);
    await page.eval(AXE);
    const result = await page.eval(`axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      resultTypes: ['violations'],
    }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.map(n => ({ target: n.target.join(' '), impact: n.impact, summary: n.failureSummary.split('\\n').slice(0, 3).join(' ') })) })))`);
    await page.close();
    return result;
  }

  for (const p of PAGES) {
    for (const vp of VIEWPORTS) {
      test(`${p} (${vp.name}): no serious or critical axe violations`, async () => {
        const violations = await audit(p, vp);
        const bad = [];
        for (const v of violations) {
          for (const n of v.nodes) {
            const impact = n.impact || v.impact;
            if (impact !== "serious" && impact !== "critical") continue;
            if (KNOWN.has(`${p} ${v.id}`)) continue;
            bad.push(`${impact} ${v.id} (${v.help}) at ${n.target}: ${n.summary}`);
          }
        }
        assert.deepEqual(bad, []);
      });
    }
  }

  test("axe finds a planted violation (the check itself works)", async () => {
    const page = await browser.newPage();
    await page.goto("/privacy.html");
    await page.eval(`(() => { const i = document.createElement('img'); i.src = '/favicon.png'; document.body.prepend(i);
      const b = document.createElement('button'); document.body.prepend(b); })()`);
    await page.eval(AXE);
    const ids = await page.eval(`axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => v.id))`);
    await page.close();
    assert.ok(ids.includes("image-alt"), ids.join(","));
    assert.ok(ids.includes("button-name"), ids.join(","));
  });
});
