// downloads.feature: the /downloads/ page in every language, src/_data/downloads.json (the release
// job's data file) against the files in public/downloads/, and the version file the scripts read.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { LANGS, root, siteDir, i18n, prefix, read, htmlPages, textOf, title, robots, links } from "./lib/site.mjs";
import downloads from "../src/_data/downloads.json" with { type: "json" };

const PLATFORMS = downloads.platforms;
const sha256 = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const pub = (url) => path.join(root, "public", url);
const available = PLATFORMS.filter((p) => p.status === "available");

test("downloads.json: Windows, Mac and Linux, each with a known status and a stable latest URL", () => {
  assert.deepEqual(PLATFORMS.map((p) => p.id), ["windows", "mac", "linux"]);
  for (const p of PLATFORMS) {
    assert.ok(["available", "soon"].includes(p.status), `${p.id}: status ${p.status}`);
    assert.equal(p.latestUrl, `/downloads/${p.file}`, `${p.id}: latest URL`);
    assert.ok(p.versions.length >= 1, `${p.id}: no versions`);
  }
  // Stable URLs that shipped scripts, the app and older pages link to.
  assert.equal(PLATFORMS[0].latestUrl, "/downloads/TLU-Windows-Setup.cmd");
  assert.equal(PLATFORMS[1].latestUrl, "/downloads/tlu-mac-tunnel.zip");
  assert.equal(PLATFORMS[2].latestUrl, "/downloads/tlu-linux-tunnel.sh");
});

for (const p of available) {
  test(`downloads.json ${p.id}: versions newest first, each archived with the right hash, size and notes`, () => {
    const versions = p.versions.map((v) => v.version);
    assert.deepEqual(versions, [...versions].sort().reverse(), "newest first");
    assert.equal(new Set(versions).size, versions.length, "no duplicates");
    for (const v of p.versions) {
      assert.match(v.version, /^\d{8}$/);
      assert.equal(v.date.replaceAll("-", ""), v.version, `${v.version}: date matches the version`);
      assert.equal(v.url, `/downloads/archive/${p.id}/${v.version}/${p.file}`);
      assert.ok(fs.existsSync(pub(v.url)), `missing ${v.url}`);
      assert.equal(sha256(pub(v.url)), v.sha256, `${v.url}: sha256`);
      assert.equal(fs.statSync(pub(v.url)).size, v.size, `${v.url}: size`);
      for (const l of LANGS) assert.ok(v.notes[l], `${v.version}: no "what's new" in ${l}`);
    }
  });

  test(`${p.latestUrl} is the newest archived version and carries its version number`, () => {
    const v = p.versions[0];
    assert.equal(sha256(pub(p.latestUrl)), v.sha256, "latest file equals the newest archive copy");
    const script = p.id === "mac" ? "/downloads/tlu-mac-tunnel/tlu-mac-tunnel.sh" : p.latestUrl;
    const src = fs.readFileSync(pub(script), "utf8");
    const own = p.id === "windows" ? /^\$ScriptVersion = (\d{8})\r?$/m : /^SCRIPT_VERSION=(\d{8})$/m;
    assert.equal((src.match(own) || [])[1], v.version, `${script}: version inside the file`);
  });
}

test("/downloads/desktop-versions.txt: one <id>=<version> line per available platform", () => {
  const txt = fs.readFileSync(path.join(siteDir, "downloads/desktop-versions.txt"), "utf8");
  assert.equal(txt, available.map((p) => `${p.id}=${p.versions[0].version}\n`).join(""));
  // What each script's own check reads.
  for (const p of available) {
    assert.match(txt, new RegExp(`^${p.id}=${p.versions[0].version}$`, "m"));
  }
  assert.ok(!fs.existsSync(path.join(root, "public/downloads/desktop-versions.txt")), "built from downloads.json only");
});

for (const lang of LANGS) {
  const url = `${prefix(lang)}downloads/`;

  test(`${url}: one card per platform with version, date, what's new, download, steps and needs`, () => {
    const html = read(url);
    const dl = i18n[lang].downloads;
    assert.equal(title(html), textOf(dl.metaTitle));
    assert.equal(robots(html), "index, follow");
    const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
    for (const p of PLATFORMS) {
      const card = (main.match(new RegExp(`<section class="dl-card" id="${p.id}"[\\s\\S]*?</section>`)) || [])[0];
      assert.ok(card, `${p.id}: no card`);
      const text = textOf(card);
      if (p.status !== "available") {
        assert.ok(text.includes(dl.soon), `${p.id}: coming soon`);
        assert.ok(!links(card).length, `${p.id}: no download while coming soon`);
        continue;
      }
      const v = p.versions[0];
      assert.ok(text.includes(v.version), `${p.id}: version`);
      assert.ok(text.includes(textOf(v.notes[lang])), `${p.id}: what's new in ${lang}`);
      const btn = links(card).filter((a) => a.cls === "dl-btn");
      assert.equal(btn.length, 1, `${p.id}: one download button`);
      assert.equal(btn[0].href, p.latestUrl);
      assert.equal(btn[0].text, dl.download.replace("{name}", p.name));
      assert.equal((card.match(/<ol class="dl-steps">([\s\S]*?)<\/ol>/)[1].match(/<li>/g) || []).length, 3, `${p.id}: 3 steps`);
      assert.ok(text.includes(textOf(dl.need[p.id])), `${p.id}: requirements`);
      assert.ok(links(card).some((a) => a.href.endsWith(`socks5-proxy-setup-windows-macos-ios.html#${p.guideAnchor}`)), `${p.id}: guide link`);
      const prev = links(card.slice(card.indexOf('class="dl-previous"'))).map((a) => a.href);
      assert.deepEqual(prev, p.versions.map((x) => x.url), `${p.id}: previous versions list`);
    }
  });

  test(`${url}: language menu and footer link to the downloads pages`, () => {
    const html = read(url);
    const start = html.indexOf('id="langDropdownMenu"');
    const menu = html.slice(start, html.indexOf("</div>", start));
    assert.deepEqual(links(menu).map((a) => a.href), LANGS.map((l) => `${prefix(l)}downloads/`));
    const footer = html.slice(html.indexOf("<footer"));
    assert.ok(links(footer).some((a) => a.href === url && a.text === i18n[lang].downloads.link));
  });
}

test("every page's footer links to its language's downloads page", () => {
  const bad = [];
  for (const p of htmlPages()) {
    const html = read(p);
    if (!html.includes("<footer")) continue;
    const footer = html.slice(html.indexOf("<footer"));
    if (!links(footer).some((a) => /^\/([a-z]{2}\/)?downloads\/$/.test(a.href))) bad.push(p);
  }
  assert.deepEqual(bad, []);
});

test("the unlinked test copy in /downloads/w7k2/ is linked from no page", () => {
  const bad = htmlPages().filter((p) => read(p).includes("w7k2"));
  assert.deepEqual(bad, []);
  assert.ok(!read("/llms.txt").includes("w7k2"));
  assert.ok(!read("/sitemap.xml").includes("w7k2"));
});
