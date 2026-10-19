// llms.txt: every page listed as "- <url> : <text>" has its built <title> as the text, so a title
// change cannot leave a stale llms.text behind. The text may go on with ": <short description>"
// after the title (the English blog list does this on purpose). Static lines with a label before
// the URL ("- Homepage: <url> : ...") describe the page and are not checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SITE_URL, read, fileFor, title, decode } from "./lib/site.mjs";

// Built titles may also carry numeric entities (&#8217;, &#x2019;) that decode() leaves alone.
const decodeAll = (s) =>
  decode(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const txt = read("/llms.txt");
const listed = [...txt.matchAll(/^- (https:\/\/tetherlinkutility\.com\S*) : (.+)$/gm)].map((m) => ({ url: m[1], text: m[2].trim() }));

test("llms.txt lists pages", () => {
  assert.ok(listed.length >= 20, `only ${listed.length} pages found in llms.txt`);
  assert.ok(listed.some((p) => p.url.startsWith(`${SITE_URL}/es/`)), "no Spanish pages");
  assert.ok(listed.some((p) => p.url.startsWith(`${SITE_URL}/pt/`)), "no Portuguese pages");
});

test("every listed page is built and its llms.txt text starts with its <title>", () => {
  const bad = [];
  for (const { url, text } of listed) {
    assert.ok(fileFor(url), `not built: ${url}`);
    assert.doesNotMatch(text, /&[a-z#0-9]+;/i, `HTML entity in llms.txt: ${url}`);
    const t = decodeAll(title(read(url)));
    assert.ok(t, `no <title>: ${url}`);
    if (text !== t && !text.startsWith(`${t}: `)) bad.push(`${url}\n  llms:  ${text}\n  title: ${t}`);
  }
  assert.deepEqual(bad, [], "llms.txt text differs from the page title (update llms.text in front matter)");
});
