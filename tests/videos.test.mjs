// How-to videos (src/_data/guideVideos.json): click-to-load players in the setup guide, VideoObject
// JSON-LD, "watch the video" links and the help page hint. TR uses the Turkish videos, others English.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LANGS, prefix, read, root, jsonLd, ldFind, htmlPages } from "./lib/site.mjs";

const videos = JSON.parse(fs.readFileSync(path.join(root, "src/_data/guideVideos.json"), "utf8"));
const DEVICES = ["windows", "mac"];
const pick = (lang, device) => videos[device][lang] || videos[device].en;
const GUIDE = "blog/socks5-proxy-setup-windows-macos-ios.html";

for (const lang of LANGS) {
  const url = `${prefix(lang)}${GUIDE}`;
  test(`${url}: Windows and Mac players with this language's videos, nothing loaded from YouTube up front`, () => {
    const html = read(url);
    for (const d of DEVICES) {
      const v = pick(lang, d);
      const fig = html.match(new RegExp(`<figure class="guide-video" id="${d}-video">([\\s\\S]*?)</figure>`));
      assert.ok(fig, `${d} player`);
      assert.match(fig[1], new RegExp(`data-yt-id="${v.id}"`));
      assert.match(fig[1], new RegExp(`src="${v.cover}"`));
      assert.ok(fs.existsSync(path.join(root, "public", v.cover)), `${v.cover} exists`);
      const ld = ldFind(jsonLd(html), "VideoObject").filter((b) => b.embedUrl.endsWith(`/${v.id}`));
      assert.equal(ld.length, 1, `${d} VideoObject`);
      assert.equal(ld[0].uploadDate, v.uploadDate);
    }
    assert.ok(html.indexOf('id="windows-video"') > html.indexOf('id="windows"'), "Windows video inside the Windows section");
    assert.ok(html.indexOf('id="mac-video"') > html.indexOf('id="macos"'), "Mac video inside the macOS section");
    assert.doesNotMatch(html, /<iframe|<img[^>]+ytimg\.com/);
    assert.match(html, /youtube-nocookie\.com\/embed\//);
  });

  test(`${prefix(lang)}help.html: Windows and Mac video links point to the guide players`, () => {
    const html = read(`${prefix(lang)}help.html`);
    for (const d of DEVICES) assert.match(html, new RegExp(`data-device="${d}" href="${prefix(lang)}${GUIDE.replace(/\./g, "\\.")}#${d}-video"`));
  });
}

test("every video hint link and player id resolves", () => {
  let count = 0;
  for (const page of htmlPages()) {
    const html = read(page);
    for (const m of html.matchAll(/class="video-hint" href="([^"#]*)#([a-z]+-video)"/g)) {
      const target = m[1] ? read(m[1]) : html;
      assert.ok(target.includes(`id="${m[2]}"`), `${page} -> ${m[1]}#${m[2]}`);
      count++;
    }
  }
  assert.ok(count >= 10, `hint links found: ${count}`);
});
