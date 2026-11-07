// visual.feature: pixel snapshots of home, help and privacy (en + tr) at a fixed desktop and phone
// viewport, compared with baselines in tests/visual/ (pngjs + pixelmatch, small tolerance).
//
// Baselines are rendered on the CI runner (Linux; fonts differ on macOS), so this test runs only on
// Linux unless VISUAL=1 is set. They live on the `visual-baselines` branch, not on main: the deploy
// workflow copies them into tests/visual/ before the tests and pushes changed ones back after.
//
// What fails and what does not:
//   - The page's text or markup changed (hash of the built <body> without <style>/<script>, kept in
//     tests/visual/hashes.json): a deliberate edit that other tests check. The new render becomes the
//     baseline, the old one and a diff go to tests/visual/out/ for review. No failure.
//   - Same markup, different pixels: a CSS, font or layout regression. Fails.
// To re-render every baseline after a deliberate CSS change:
//   gh workflow run deploy.yml --ref main -f update_snapshots=true
// A failing comparison writes <name>.actual.png and <name>.diff.png to tests/visual/out/ (uploaded
// as the visual-snapshots artifact by the workflow).
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import crypto from "node:crypto";
import pixelmatch from "pixelmatch";
import { root, read } from "./lib/site.mjs";
import { launch, skipBrowser } from "./lib/browser.mjs";

const DIR = path.join(root, "tests/visual");
const OUT = path.join(DIR, "out");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";
const HASHES = path.join(DIR, "hashes.json");

// What the page shows, without its inline CSS and scripts: a change here is a content edit.
const markupHash = (urlPath) => {
  const body = (read(urlPath).match(/<body[\s\S]*<\/body>/) || [""])[0]
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
};
// Share of pixels allowed to differ (anti-aliasing noise), and pixelmatch's per-pixel colour threshold.
const MAX_DIFF_RATIO = 0.002;
const THRESHOLD = 0.1;

const SHOTS = [
  { name: "home-en", path: "/" },
  { name: "home-tr", path: "/tr/" },
  { name: "help-en", path: "/help.html" },
  { name: "help-tr", path: "/tr/help.html" },
  { name: "privacy-en", path: "/privacy.html" },
  { name: "privacy-tr", path: "/privacy.html", anchor: "tr" },
];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];

const skip = skipBrowser() || (process.platform !== "linux" && !process.env.VISUAL && "visual baselines are Linux (CI) renders; set VISUAL=1 to run here");

// Rendering flags that remove machine-dependent variation (GPU, LCD text, hinting, colour profile).
const ARGS = ["--hide-scrollbars", "--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none", "--disable-partial-raster", "--disable-skia-runtime-opts", "--force-device-scale-factor=1"];

const FREEZE = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }`;

describe("visual snapshots in a browser", { skip }, () => {
  let browser;
  let hashes = {};
  before(async () => {
    browser = await launch({ args: ARGS });
    fs.mkdirSync(OUT, { recursive: true });
    if (fs.existsSync(HASHES)) hashes = JSON.parse(fs.readFileSync(HASHES, "utf8"));
  });
  after(async () => {
    await browser?.close();
    const sorted = Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(HASHES, JSON.stringify(sorted, null, 2) + "\n");
  });

  async function shoot(shot, vp) {
    const page = await browser.newPage();
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
    await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
    await page.cdp("Emulation.setTimezoneOverride", { timezoneId: "Europe/Istanbul" });
    await page.cdp("Emulation.setLocaleOverride", { locale: "en-US" });
    await page.goto(shot.path);
    await page.eval(`(async () => {
      const s = document.createElement('style'); s.textContent = ${JSON.stringify(FREEZE)}; document.head.appendChild(s);
      for (const img of document.images) img.loading = 'eager';
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
      ${shot.anchor ? `document.getElementById(${JSON.stringify(shot.anchor)}).scrollIntoView({ block: 'start' });` : "window.scrollTo(0, 0);"}
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`);
    const { data } = await page.cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
    await page.close();
    return Buffer.from(data, "base64");
  }

  for (const shot of SHOTS) {
    for (const vp of VIEWPORTS) {
      const name = `${shot.name}-${vp.name}`;
      test(`${name} matches its baseline`, async (t) => {
        const png = await shoot(shot, vp);
        const baseline = path.join(DIR, `${name}.png`);
        const hash = markupHash(shot.path);
        const accept = () => {
          fs.writeFileSync(baseline, png);
          fs.writeFileSync(path.join(OUT, `${name}.png`), png);
          hashes[name] = hash;
        };
        // No baseline yet, or a re-render was asked for: this render is the baseline.
        if (UPDATE || !fs.existsSync(baseline)) return accept();
        const want = PNG.sync.read(fs.readFileSync(baseline));
        const got = PNG.sync.read(png);
        // The page's markup changed since the baseline was taken (a content edit): keep the old
        // render and the diff for review, take the new one as the baseline.
        const contentChanged = hashes[name] !== undefined && hashes[name] !== hash;
        const fail = (msg) => {
          fs.writeFileSync(path.join(OUT, `${name}.actual.png`), png);
          if (contentChanged) {
            fs.copyFileSync(baseline, path.join(OUT, `${name}.previous.png`));
            accept();
            t.diagnostic(`${msg}; markup changed, new baseline taken`);
            return;
          }
          assert.fail(msg);
        };
        if (want.width !== got.width || want.height !== got.height) return fail(`${name}: size ${got.width}x${got.height}, baseline ${want.width}x${want.height}`);
        const diff = new PNG({ width: want.width, height: want.height });
        const n = pixelmatch(want.data, got.data, diff.data, want.width, want.height, { threshold: THRESHOLD });
        const ratio = n / (want.width * want.height);
        if (ratio > MAX_DIFF_RATIO) {
          fs.writeFileSync(path.join(OUT, `${name}.diff.png`), PNG.sync.write(diff));
          return fail(`${name}: ${n} pixels differ (${(ratio * 100).toFixed(2)}%, limit ${MAX_DIFF_RATIO * 100}%)`);
        }
        // Pixels match: record the markup they belong to (first run, or markup-only change).
        hashes[name] = hash;
      });
    }
  }

  test("the comparison catches a real change (one changed heading)", async () => {
    const page = await browser.newPage();
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.goto("/help.html");
    await page.eval(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(FREEZE)}; document.head.appendChild(s); })()`);
    const a = PNG.sync.read(Buffer.from((await page.cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await page.eval(`document.querySelector('h1').textContent = 'Something else entirely'`);
    const b = PNG.sync.read(Buffer.from((await page.cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await page.close();
    const n = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: THRESHOLD });
    assert.ok(n / (a.width * a.height) > MAX_DIFF_RATIO, `only ${n} pixels changed`);
  });
});
