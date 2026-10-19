// seo.feature: JSON-LD validity (STANDARTLAR 3.2). Every block parses, carries the fields its @type
// needs, and agrees with the page it is on: headline = title, page URLs = canonical, dates are real
// ISO dates in order, FAQ questions are visible, blog index entries match the posts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SITE_URL, site, read, htmlPages, isRedirectStub, title, canonicals, htmlLang, ldFind, textOf, fileFor,
} from "./lib/site.mjs";

const pages = htmlPages().map((p) => ({ p, html: read(p) })).filter((x) => !isRedirectStub(x.html));
// Blocks that do not parse are left out here and reported by the parse test below.
const parsed = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((m) => { try { return [JSON.parse(m[1])]; } catch { return []; } });
const withLd = pages.map((x) => ({ ...x, ld: parsed(x.html) })).filter((x) => x.ld.length);
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const KNOWN = new Set([
  "WebSite", "Organization", "SoftwareApplication", "MobileApplication", "Offer", "FAQPage", "Question", "Answer",
  "HowTo", "HowToStep", "BlogPosting", "Article", "Blog", "BreadcrumbList", "ListItem", "ImageObject", "VideoObject",
]);

const isIsoDate = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/.test(s)) return false;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const isAbsUrl = (s) => typeof s === "string" && /^https:\/\/[^\s/]+\.[^\s/]+/.test(s) && (() => { try { return !!new URL(s); } catch { return false; } })();
const nonEmpty = (v) => typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : v != null;
const urlOf = (v) => (typeof v === "string" ? v : v && (v["@id"] || v.url));
const visible = (html) => textOf(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "").replace(/<head>[\s\S]*?<\/head>/, ""));

// Required fields per @type (dotted paths are checked on the nested object).
const REQUIRED = {
  WebSite: ["name", "url"],
  Organization: ["name"],
  SoftwareApplication: ["name", "operatingSystem", "applicationCategory", "offers"],
  MobileApplication: ["name", "operatingSystem", "applicationCategory", "offers"],
  Offer: ["price", "priceCurrency"],
  FAQPage: ["mainEntity"],
  Question: ["name", "acceptedAnswer"],
  Answer: ["text"],
  HowTo: ["name", "step"],
  HowToStep: ["text"],
  BlogPosting: ["headline", "datePublished", "author", "publisher"],
  Article: ["headline", "datePublished", "author", "publisher"],
  Blog: ["name", "url"],
  BreadcrumbList: ["itemListElement"],
  ListItem: ["position", "name", "item"],
  ImageObject: ["url"],
  VideoObject: ["name", "description", "thumbnailUrl", "uploadDate"],
};

// Every object with an @type, with its parent type: [{ node, parent }].
function nodes(blocks) {
  const out = [];
  const walk = (v, parent) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, parent));
    if (v && typeof v === "object") {
      if (v["@type"]) out.push({ node: v, parent });
      for (const x of Object.values(v)) walk(x, v["@type"] ? v : parent);
    }
  };
  walk(blocks, null);
  return out;
}

test("there is JSON-LD to check", () => {
  assert.ok(withLd.length > 80, `${withLd.length} pages with JSON-LD`);
});

test("every ld+json block is a JSON object with @context https://schema.org and a known @type", () => {
  const bad = [];
  for (const { p, html } of pages) {
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let b;
      try { b = JSON.parse(m[1]); } catch (e) { bad.push(`${p}: does not parse: ${e.message}`); continue; }
      for (const top of [].concat(b["@graph"] || b)) {
        if (b["@context"] !== "https://schema.org") bad.push(`${p}: @context ${b["@context"]}`);
        if (!top["@type"]) bad.push(`${p}: top-level block without @type`);
      }
      for (const { node } of nodes(b)) for (const t of [].concat(node["@type"])) if (!KNOWN.has(t)) bad.push(`${p}: unknown @type ${t} (add its rules here)`);
    }
    // Other script types with JSON-LD-looking content would be ignored by search engines.
    if (/<script[^>]+type=["']?application\/ld\+json["']?[^>]*\s(async|defer|src)=/.test(html)) bad.push(`${p}: ld+json with src/async`);
  }
  assert.deepEqual(bad, []);
});

test("required fields are present and non-empty for every @type", () => {
  const bad = [];
  for (const { p, ld } of withLd) {
    for (const { node, parent } of nodes(ld)) {
      for (const t of [].concat(node["@type"])) {
        // Posts listed inside a Blog are summaries: headline, url and date are enough there.
        const req = t === "BlogPosting" && parent?.["@type"] === "Blog" ? ["headline", "url", "datePublished"] : REQUIRED[t] || [];
        for (const f of req) if (!nonEmpty(node[f])) bad.push(`${p}: ${t}.${f} missing`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("no JSON-LD string carries HTML tags or entities (&amp; etc.)", () => {
  const bad = [];
  for (const { p, ld } of withLd) {
    const walk = (v, k) => {
      if (typeof v === "string") { if (/&(#x?[0-9a-f]+|[a-z]+);|<\/?[a-z][^>]*>/i.test(v)) bad.push(`${p}: ${k}: ${v.slice(0, 80)}`); }
      else if (v && typeof v === "object") for (const [kk, x] of Object.entries(v)) walk(x, kk);
    };
    walk(ld, "");
  }
  assert.deepEqual(bad, []);
});

test("URL fields are absolute https URLs; the site's own URLs point to built files", () => {
  const bad = [];
  const URL_KEYS = new Set(["url", "item", "logo", "mainEntityOfPage", "installUrl", "downloadUrl", "sameAs", "image", "@id", "thumbnailUrl", "embedUrl", "contentUrl"]);
  for (const { p, ld } of withLd) {
    const walk = (v, k) => {
      if (Array.isArray(v)) return v.forEach((x) => walk(x, k));
      if (v && typeof v === "object") return Object.entries(v).forEach(([kk, x]) => walk(x, kk));
      if (!URL_KEYS.has(k) || typeof v !== "string") return;
      if (!isAbsUrl(v)) bad.push(`${p}: ${k} not an absolute https URL: ${v}`);
      else if (v.startsWith(SITE_URL) && !fileFor(v)) bad.push(`${p}: ${k} -> ${v} not built`);
    };
    walk(ld, "");
  }
  assert.deepEqual(bad, []);
});

test("inLanguage, where set, equals <html lang>", () => {
  const bad = [];
  for (const { p, html, ld } of withLd) {
    for (const { node } of nodes(ld)) if (node.inLanguage !== undefined && node.inLanguage !== htmlLang(html)) bad.push(`${p}: ${node["@type"]} inLanguage ${node.inLanguage}`);
  }
  assert.deepEqual(bad, []);
});

test("WebSite and Organization: url is the site root, Organization logo set", () => {
  const bad = [];
  for (const { p, ld } of withLd) {
    for (const w of ldFind(ld, "WebSite")) if (w.url !== `${SITE_URL}/`) bad.push(`${p}: WebSite.url ${w.url}`);
    for (const o of ldFind(ld.filter((b) => b["@type"] === "Organization"), "Organization")) {
      if (o.url !== `${SITE_URL}/`) bad.push(`${p}: Organization.url ${o.url}`);
      if (!urlOf(o.logo)) bad.push(`${p}: Organization.logo missing`);
    }
  }
  assert.deepEqual(bad, []);
});

test("SoftwareApplication: Play URL in sameAs, offers with numeric price and ISO currency, publisher named", () => {
  const bad = [];
  let n = 0;
  for (const { p, ld } of withLd) {
    for (const app of [...ldFind(ld, "SoftwareApplication"), ...ldFind(ld, "MobileApplication")]) {
      n++;
      if (![].concat(app.sameAs || []).includes(site.playUrl)) bad.push(`${p}: sameAs without the Play URL`);
      if (!app.publisher?.name) bad.push(`${p}: publisher.name`);
      if (!isAbsUrl(app.url)) bad.push(`${p}: url`);
      const offers = [].concat(app.offers || []);
      if (!offers.length) bad.push(`${p}: no offers`);
      for (const o of offers) {
        if (!/^\d+(\.\d{1,2})?$/.test(String(o.price))) bad.push(`${p}: price ${o.price}`);
        if (!/^[A-Z]{3}$/.test(o.priceCurrency || "")) bad.push(`${p}: priceCurrency ${o.priceCurrency}`);
      }
      if (!offers.some((o) => Number(o.price) === 0)) bad.push(`${p}: no free offer`);
    }
  }
  assert.ok(n >= 5, `${n} apps`);
  assert.deepEqual(bad, []);
});

test("BlogPosting/Article: headline = <title> (STANDARTLAR 3.2.3), mainEntityOfPage/url = canonical, at most 110 characters", () => {
  const bad = [];
  let n = 0;
  for (const { p, html, ld } of withLd) {
    for (const a of ld.filter((b) => ["BlogPosting", "Article"].includes(b["@type"]))) {
      n++;
      if (a.headline !== title(html)) bad.push(`${p}: headline "${a.headline}" vs title "${title(html)}"`);
      if (a.headline.length > 110) bad.push(`${p}: headline ${a.headline.length} chars`);
      const c = canonicals(html)[0];
      for (const k of ["mainEntityOfPage", "url"]) if (a[k] !== undefined && urlOf(a[k]) !== c) bad.push(`${p}: ${k} ${urlOf(a[k])} vs canonical ${c}`);
      if (a.mainEntityOfPage === undefined && a.url === undefined) bad.push(`${p}: neither mainEntityOfPage nor url`);
      if (!a.author?.name || !a.publisher?.name) bad.push(`${p}: author/publisher name`);
      if (!a.description) bad.push(`${p}: description`);
    }
  }
  assert.ok(n > 60, `${n} posts`);
  assert.deepEqual(bad, []);
});

test("dates are real ISO dates, datePublished <= dateModified <= today", () => {
  const bad = [];
  for (const { p, ld } of withLd) {
    for (const { node } of nodes(ld)) {
      for (const k of ["datePublished", "dateModified", "dateCreated", "uploadDate"]) {
        if (node[k] !== undefined && !isIsoDate(node[k])) bad.push(`${p}: ${node["@type"]}.${k} "${node[k]}"`);
        else if (node[k] !== undefined && node[k].slice(0, 10) > today) bad.push(`${p}: ${node["@type"]}.${k} ${node[k]} is in the future`);
      }
      if (node.datePublished && node.dateModified && node.dateModified < node.datePublished) bad.push(`${p}: dateModified before datePublished`);
    }
  }
  assert.deepEqual(bad, []);
});

test("FAQPage: every question and answer is visible on the page, no duplicates", () => {
  const bad = [];
  let n = 0;
  for (const { p, html, ld } of withLd) {
    const text = visible(html);
    for (const faq of ldFind(ld, "FAQPage")) {
      const qs = [].concat(faq.mainEntity);
      if (new Set(qs.map((q) => q.name)).size !== qs.length) bad.push(`${p}: duplicate question`);
      for (const q of qs) {
        n++;
        if (q["@type"] !== "Question") bad.push(`${p}: mainEntity ${q["@type"]}`);
        if (!text.includes(q.name)) bad.push(`${p}: question not on the page: ${q.name}`);
        const a = String(q.acceptedAnswer?.text || "").replace(/\s+/g, " ");
        if (!text.includes(a.slice(0, 60))) bad.push(`${p}: answer not on the page: ${a.slice(0, 60)}`);
      }
    }
  }
  assert.ok(n > 150, `${n} questions`);
  assert.deepEqual(bad, []);
});

test("HowTo: steps are HowToStep with name and text", () => {
  const bad = [];
  for (const { p, ld } of withLd) {
    for (const h of ldFind(ld, "HowTo")) {
      const steps = [].concat(h.step);
      if (steps.length < 2) bad.push(`${p}: ${steps.length} steps`);
      for (const s of steps) if (s["@type"] !== "HowToStep" || !s.text) bad.push(`${p}: bad step ${JSON.stringify(s).slice(0, 60)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("BreadcrumbList: positions 1..n, every item a built URL (STANDARTLAR 3.2.4), last item = canonical", () => {
  const bad = [];
  let n = 0;
  for (const { p, html, ld } of withLd) {
    for (const bl of ldFind(ld, "BreadcrumbList")) {
      n++;
      const items = [].concat(bl.itemListElement);
      items.forEach((it, i) => {
        if (it["@type"] !== "ListItem") bad.push(`${p}: ${it["@type"]}`);
        if (it.position !== i + 1) bad.push(`${p}: position ${it.position} at index ${i}`);
        if (!urlOf(it.item) || !fileFor(urlOf(it.item))) bad.push(`${p}: item ${urlOf(it.item)}`);
      });
      if (items.length && urlOf(items.at(-1).item) !== canonicals(html)[0]) bad.push(`${p}: last item ${urlOf(items.at(-1).item)}`);
    }
  }
  assert.ok(n > 30, `${n} breadcrumbs`);
  assert.deepEqual(bad, []);
});

test("Blog index: url = canonical; blogPost entries are the posts linked on the page, with their own headline and date", () => {
  const bad = [];
  let n = 0;
  for (const { p, html, ld } of withLd) {
    for (const blog of ld.filter((b) => b["@type"] === "Blog")) {
      if (blog.url !== canonicals(html)[0]) bad.push(`${p}: Blog.url ${blog.url}`);
      for (const bp of [].concat(blog.blogPost || [])) {
        n++;
        if (!html.includes(`href="${bp.url.slice(SITE_URL.length)}"`) && !html.includes(`href="${bp.url}"`)) bad.push(`${p}: ${bp.url} not linked`);
        if (!fileFor(bp.url)) { bad.push(`${p}: ${bp.url} not built`); continue; }
        const post = parsed(read(bp.url)).find((b) => b["@type"] === "BlogPosting");
        if (!post) { bad.push(`${p}: ${bp.url} has no BlogPosting`); continue; }
        if (bp.headline !== post.headline) bad.push(`${p}: ${bp.url} headline "${bp.headline}" vs post "${post.headline}"`);
        if (bp.datePublished !== post.datePublished) bad.push(`${p}: ${bp.url} date ${bp.datePublished} vs ${post.datePublished}`);
      }
    }
  }
  assert.ok(n > 60, `${n} index entries`);
  assert.deepEqual(bad, []);
});
