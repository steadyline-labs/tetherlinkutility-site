import fs from "node:fs";

// Site languages (single source of truth: src/_data/site.json).
const { languages } = JSON.parse(fs.readFileSync(new URL("./src/_data/site.json", import.meta.url), "utf8"));

// Eleventy config for tetherlinkutility.com
// Source pages live in src/, static files in public/ (copied as-is), output goes to _site/.

export default function (eleventyConfig) {
  // Everything in public/ is copied to the site root unchanged
  // (images, video, downloads/, tools/, CNAME, robots.txt, pricing.md, redirect stubs, ...).
  eleventyConfig.addPassthroughCopy({ public: "/" });

  // Page bodies are written as plain HTML: do not run them through a template engine,
  // so the content is copied into the layout exactly as written.
  eleventyConfig.setNunjucksEnvironmentOptions({
    autoescape: false,
    throwOnUndefined: false,
  });

  // Blog posts per language (empty for a language without translated posts), used by the blog index pages, sitemap.xml and llms.txt.
  for (const lang of languages) {
    eleventyConfig.addCollection(`posts_${lang}`, (api) =>
      api
        .getAll()
        .filter((p) => p.data.isPost && p.data.lang === lang && !p.data.scheduled)
        .sort((a, b) => a.data.slug.localeCompare(b.data.slug))
    );
  }

  // Sort helper for hand-ordered lists (blog index, its JSON-LD, llms.txt):
  // sortByKey(posts, "index", "order") sorts by data.index.order. An optional fallback key is
  // used when the key is missing, e.g. sortByKey(posts, "index", "ldOrder", "order").
  // Posts with no value at all are not dropped: they go first (placement "first", used by the
  // blog index so a new post shows at the top) or last ("last"), newest first.
  eleventyConfig.addFilter("sortByKey", (items, field, key, fallbackKey, placement = "last") => {
    const val = (p) => {
      const obj = p.data[field];
      if (!obj) return undefined;
      return obj[key] !== undefined ? obj[key] : fallbackKey ? obj[fallbackKey] : undefined;
    };
    const known = items.filter((p) => val(p) !== undefined).sort((a, b) => val(a) - val(b));
    const unknown = items
      .filter((p) => val(p) === undefined)
      .sort((a, b) => String(b.data.published).localeCompare(String(a.data.published)));
    return placement === "first" ? [...unknown, ...known] : [...known, ...unknown];
  });

  // Blog index order: newest published first; posts from the same day keep their hand-set
  // index.order (then slug) so the order within a day stays stable.
  eleventyConfig.addFilter("byPublished", (items) => {
    const date = (p) => String(p.data.index?.published || p.data.published || "");
    const order = (p) => (p.data.index?.order ?? Infinity);
    return [...items].sort(
      (a, b) => date(b).localeCompare(date(a)) || order(a) - order(b) || a.data.slug.localeCompare(b.data.slug)
    );
  });

  // True if a blog post with this file name exists in that language (for hreflang and
  // the language menu, so a post that is not translated yet does not link to a missing page).
  eleventyConfig.addFilter("hasPost", (collections, lang, slug) =>
    (collections[`posts_${lang}`] || []).some((p) => p.data.slug === slug)
  );

  // True if a language has its own blog: no `blogLang` fallback in i18n.json and at least one
  // published post. A language with 0 posts (e.g. a new ES/PT blog) keeps the site as if it had
  // no blog: its index is noindex and left out of the sitemap, hreflang and language menus.
  const i18nData = JSON.parse(fs.readFileSync(new URL("./src/_data/i18n.json", import.meta.url), "utf8"));
  const hasBlog = (collections, lang) => !i18nData[lang].blogLang && (collections[`posts_${lang}`] || []).length > 0;
  eleventyConfig.addFilter("hasBlog", hasBlog);

  // Languages that have a blog post with this file name. Posts that exist in only one language
  // (e.g. country-specific carrier posts in ES/PT) get no hreflang at all, as Google advises for
  // standalone pages.
  eleventyConfig.addFilter("postLangs", (collections, slug) =>
    languages.filter((l) => (collections[`posts_${l}`] || []).some((p) => p.data.slug === slug))
  );

  // Turns the few HTML entities used in titles back into plain text (for llms.txt).
  eleventyConfig.addFilter("plainText", (s) =>
    String(s).replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
  );

  // A JSON string literal for JSON-LD: tags removed, HTML entities decoded, quotes escaped.
  const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: "\u00a0", rarr: "\u2192", middot: "\u00b7", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026" };
  eleventyConfig.addFilter("ldText", (s) =>
    JSON.stringify(
      String(s ?? "").replace(/<[^>]+>/g, "").replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) =>
        e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m)
    )
  );

  // sitemap.xml entries: every page with `sitemap` front matter, plus files listed in
  // src/_data/sitemapExtra.json (for passthrough files such as pricing.md), sorted by `order`.
  // Pages without an `order` go last, sorted by URL.
  // Each entry may carry `alternates` ([{ hreflang, href }]) for pages that exist in several
  // languages. These match the hreflang tags in the page heads: home pages list every language,
  // blog index pages the languages with their own blog, posts the languages that have that post;
  // x-default is the English URL when there is one. Pages with a single language get no alternates.
  eleventyConfig.addFilter("sitemapEntries", (pages, extra, site, i18n) => {
    const hl = (l) => i18n[l].hreflang || l;
    const postLangs = (slug) =>
      languages.filter((l) => pages.some((p) => p.data.isPost && p.data.lang === l && p.data.slug === slug && !p.data.scheduled));
    const alternatesFor = (p) => {
      const lang = p.data.lang;
      if (!lang || !i18n[lang]) return null;
      const prefix = i18n[lang].prefix;
      const url = p.url.replace(/index\.html$/, "");
      let langs, path;
      if (p.data.isPost) {
        langs = postLangs(p.data.slug);
        path = `blog/${p.data.slug}.html`;
      } else if (url === prefix) {
        langs = languages;
        path = "";
      } else if (url === `${prefix}blog/`) {
        langs = languages.filter(blogLang);
        path = "blog/";
      } else return null;
      if (langs.length < 2) return null;
      return langs
        .map((l) => ({ hreflang: hl(l), href: `${site.url}${i18n[l].prefix}${path}` }))
        .concat(langs.includes("en") ? { hreflang: "x-default", href: `${site.url}/${path}` } : []);
    };
    // A language has its own blog when it has no blogLang fallback and at least one published post.
    const blogLang = (l) => !i18n[l].blogLang && pages.some((p) => p.data.isPost && p.data.lang === l && !p.data.scheduled);
    // Blog index of a language without posts yet: noindex, so not in the sitemap.
    const emptyBlogIndex = (p) =>
      !p.data.isPost && p.data.lang && i18n[p.data.lang] &&
      p.url === `${i18n[p.data.lang].prefix}blog/` && !blogLang(p.data.lang);
    const entries = pages
      .filter((p) => p.data.sitemap && !emptyBlogIndex(p))
      .map((p) => ({
        url: p.url,
        ...p.data.sitemap,
        lastmod: p.data.sitemap.lastmod || p.data.modified || p.data.published,
        alternates: alternatesFor(p),
      }))
      .concat(extra || []);
    const key = (e) => (e.order === undefined ? Infinity : e.order);
    return entries.sort((a, b) => key(a) - key(b) || a.url.localeCompare(b.url));
  });

  // Human-readable dates for the blog index cards, e.g. "September 25, 2026",
  // "25 Eylül 2026", "25 सितंबर, 2026", "25 de septiembre de 2026".
  const MONTHS = {
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    tr: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],
    es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
    pt: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
    hi: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
  };
  eleventyConfig.addFilter("displayDate", (iso, lang) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    const month = MONTHS[lang][m - 1];
    if (lang === "en") return `${month} ${d}, ${y}`;
    if (lang === "hi") return `${d} ${month}, ${y}`;
    if (lang === "es" || lang === "pt") return `${d} de ${month} de ${y}`;
    return `${d} ${month} ${y}`;
  });

  // Carrier page layout (handoff 6a). Post bodies are plain HTML, so the extra blocks are
  // spliced into the rendered body here instead of being written into every post:
  //   - breadcrumb replaces the "Blog" eyebrow
  //   - quick answer + "On this page" (built from the h2s) go right after .post-meta
  //   - the FAQ goes right before the CTA box
  //   - the first two related links become cards (same-region carrier, then the "5 ways" guide)
  // Pages without the matching front matter are returned unchanged.
  const GUIDE_SLUG = "best-ways-to-bypass-hotspot-throttling";
  const slugify = (s) =>
    s.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, "").toLowerCase().trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  const stripTags = (s) => s.replace(/<[^>]+>/g, "").trim();

  // Windows and Mac how-to videos (src/_data/guideVideos.json, the only place their IDs live).
  // TR pages get the Turkish video, every other language the English one.
  const guideVideos = JSON.parse(fs.readFileSync(new URL("./src/_data/guideVideos.json", import.meta.url), "utf8"));
  const VIDEO_GUIDE_SLUG = "socks5-proxy-setup-windows-macos-ios";
  const guideVideo = (lang, device) => {
    const v = guideVideos[device];
    return v && (v[lang] || v.en);
  };
  eleventyConfig.addFilter("guideVideo", guideVideo);
  // "Watch the Windows video (1:22)", plus "en inglés" etc. where the page language has no video of its own.
  const videoText = (labels, lang, device) => {
    const v = guideVideo(lang, device);
    return v && labels && labels[device] ? `${labels[device]} (${v.length}${labels.note ? `, ${labels.note}` : ""})` : "";
  };
  eleventyConfig.addFilter("videoText", videoText);
  const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  eleventyConfig.addFilter("enhancePost", (content, o) => {
    // Code blocks scroll sideways on small screens: make them keyboard-focusable so they can be scrolled.
    let html = content.replace(/<pre(?=[\s>])(?![^>]*\btabindex=)/g, '<pre tabindex="0"');
    // How-to videos: <!--video:<device>--> becomes a click-to-load player (local poster, the
    // youtube-nocookie iframe only after a click), <!--video-hint:<device>--> a short link to it
    // in the setup guide. Labels come from i18n[lang].video.
    if (o.video) {
      html = html
        .replace(/<!--video:([a-z]+)-->/g, (m, device) => {
          const v = guideVideo(o.lang, device);
          if (!v) return "";
          return `<figure class="guide-video" id="${device}-video">
      <div class="video-facade guide-video-frame" data-yt-id="${v.id}" data-yt-title="${attr(v.name)}" role="button" tabindex="0" aria-label="${attr(`${o.video.play}: ${v.name}`)}">
        <img src="${v.cover}" alt="${attr(v.name)}" loading="lazy" decoding="async" width="960" height="540" />
        <span class="video-facade-play" aria-hidden="true"><svg width="68" height="68" viewBox="0 0 60 60"><circle cx="30" cy="30" r="30" fill="rgba(0,0,0,0.6)"/><path d="M24 18l20 12-20 12V18z" fill="#fff"/></svg></span>
      </div>
      <figcaption>${videoText(o.video, o.lang, device)}</figcaption>
    </figure>`;
        })
        .replace(/<!--video-hint:([a-z]+)-->/g, (m, device) => {
          const v = guideVideo(o.lang, device);
          if (!v || !o.video[device]) return "";
          const page = o.slug === VIDEO_GUIDE_SLUG ? "" : `${o.prefix}blog/${VIDEO_GUIDE_SLUG}.html`;
          return ` <a class="video-hint" href="${page}#${device}-video">&#9654;&#xFE0E; ${videoText(o.video, o.lang, device)}</a>`;
        });
    }
    // Setup guide help links: <!--help:<device>:<step>--> at the end of a step becomes a quiet
    // "Stuck on this step?" link, <!--help-end:<device>--> the "Still not connected?" card. Both
    // open this language's /help page with the device (and step) prefilled; device may be empty.
    if (o.help) {
      const helpUrl = (device, step) => {
        const q = [device && `device=${device}`, step && `step=${step}`].filter(Boolean).join("&amp;");
        return `${o.prefix}help.html${q ? `?${q}` : ""}`;
      };
      html = html
        .replace(/<!--help:([a-z]*):([a-z-]+)-->/g, (m, device, step) =>
          `<a class="step-help" href="${helpUrl(device, step)}">${o.help.stepLink}</a>`)
        .replace(/<!--help-end:([a-z]*)-->/g, (m, device) =>
          `<div class="help-end"><p>${o.help.endText}</p><a class="help-end-btn" href="${helpUrl(device)}">${o.help.endButton}</a></div>`);
    }
    if (o.breadcrumb) {
      html = html.replace(/<div class="page-eyebrow">[^<]*<\/div>\s*/, o.breadcrumb);
    }
    if (o.quick) {
      const h2s = [];
      html = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (m, inner) => {
        const id = slugify(inner);
        h2s.push({ id, text: stripTags(inner) });
        return `<h2 id="${id}">${inner}</h2>`;
      });
      if (o.faq) h2s.push({ id: "faq", text: o.labels.faqShort });
      const toc =
        `    <div class="toc" role="navigation" aria-label="${o.labels.onThisPage}"><span class="toc-label">${o.labels.onThisPage}</span>\n` +
        h2s.map((h, i) => `      <a href="#${h.id}">${i + 1} · ${h.text}</a>\n`).join("") +
        `    </div>\n`;
      html = html.replace(/(<div class="post-meta">[\s\S]*?<\/div>\n?)/, `$1${o.quick}${toc}`);
    }
    if (o.faq) {
      // Before the CTA box; posts without one (no app mention) get it before the related links.
      const anchor = [/(\s*)<div class="cta-box">/, /(\s*)<div class="related">/, /(\s*)<\/article>/].find((re) => re.test(html));
      if (anchor) html = html.replace(anchor, (m, ws) => `\n${o.faq}${m}`);
    }
    if (o.region && o.posts) {
      html = html.replace(/<div class="related">([\s\S]*?)<\/div>/, (block, inner) => {
        const links = [...inner.matchAll(/<li>(<a href="([^"]+)">[\s\S]*?<\/a>)<\/li>/g)].map((m) => ({
          li: m[1],
          slug: m[2].split("/").pop().replace(/\.html$/, ""),
        }));
        const bySlug = (slug) => o.posts.find((p) => p.data.slug === slug);
        const sameRegion =
          links.find((l) => bySlug(l.slug)?.data.region === o.region) ||
          o.posts
            .filter((p) => p.data.region === o.region && p.data.slug !== o.slug)
            .map((p) => ({ slug: p.data.slug }))[0];
        const picks = [sameRegion, { slug: GUIDE_SLUG }].filter(Boolean).map((l) => bySlug(l.slug)).filter(Boolean);
        if (!picks.length) return block;
        const cards = picks
          .map((p) => {
            const r = p.data.region;
            const eyebrow = r ? r.toLocaleUpperCase(/ü|ı|ş|ğ/i.test(r) ? "tr-TR" : "en-US") : o.labels.guide;
            const title = p.data.cardTitle || p.data.ogTitle || p.data.title;
            return `        <a class="related-card" href="${p.url}"><span class="related-eyebrow">${eyebrow}</span><span class="related-title">${title}</span></a>\n`;
          })
          .join("");
        const pickedSlugs = picks.map((p) => p.data.slug);
        const rest = links.filter((l) => !pickedSlugs.includes(l.slug));
        const h3 = inner.match(/<h3>[\s\S]*?<\/h3>/)?.[0] || "";
        return (
          `<div class="related">\n      ${h3}\n      <div class="related-cards">\n${cards}      </div>\n` +
          (rest.length ? `      <ul>\n${rest.map((l) => `        <li>${l.li}</li>\n`).join("")}      </ul>\n` : "") +
          `    </div>`
        );
      });
    }
    return html;
  });

  // og:image for a post: the generated card from tools/og.mjs when it exists, otherwise the site default.
  eleventyConfig.addFilter("ogImage", (lang, slug) =>
    fs.existsSync(`public/og/${lang}/${slug}.png`) ? `/og/${lang}/${slug}.png` : "/og-image.png"
  );

  // Keeps "Wi-Fi" on one line (no break at the hyphen) in visible page text. Only text between
  // tags inside <body> is touched; attributes, <script>, <style> and <head> stay byte-identical,
  // so the copy itself (and what search engines index) does not change.
  eleventyConfig.addTransform("nowrapWifi", function (content) {
    if (!(this.page.outputPath || "").endsWith(".html")) return content;
    const bodyStart = content.indexOf("<body");
    if (bodyStart < 0) return content;
    const head = content.slice(0, bodyStart);
    let skip = false;
    const body = content.slice(bodyStart).replace(/(<[^>]*>)|([^<]+)/g, (m, tag, text) => {
      if (tag) {
        if (/^<(script|style)\b/i.test(tag)) skip = true;
        else if (/^<\/(script|style)>/i.test(tag)) skip = false;
        return tag;
      }
      return skip ? text : text.replace(/Wi-Fi/g, '<span class="nowrap">Wi-Fi</span>');
    });
    return head + body;
  });

  // Google Play link with an install referrer, so Play Console shows which page sent the install:
  // utm_medium = page type (home, blog, help), utm_campaign = page slug, utm_content = language.
  // The referrer value is URL-encoded as one parameter. JSON-LD and llms.txt keep the plain site.playUrl.
  const siteData = JSON.parse(fs.readFileSync(new URL("./src/_data/site.json", import.meta.url), "utf8"));
  eleventyConfig.addFilter("playLink", (url, lang) => {
    const rest = String(url || "/").replace(new RegExp(`^/(${languages.join("|")})/`), "/");
    let medium = "home", campaign = "home";
    const post = rest.match(/^\/blog\/([^/]+)\.html$/);
    if (post) { medium = "blog"; campaign = post[1]; }
    else if (rest.startsWith("/blog/")) { medium = "blog"; campaign = "blog-index"; }
    else if (rest !== "/" && rest !== "/index.html") {
      campaign = rest.replace(/^\//, "").replace(/\.html$/, "").replace(/\/$/, "") || "home";
      medium = campaign;
    }
    const referrer = `utm_source=tetherlinkutility.com&utm_medium=${medium}&utm_campaign=${campaign}&utm_content=${lang || "en"}`;
    return `${siteData.playUrl}&referrer=${encodeURIComponent(referrer)}`;
  });

  // VideoObject JSON-LD for one how-to video (setup guide players and the home page video cards).
  const guideVideoLd = (lang, device, siteUrl) => {
    const v = guideVideo(lang, device);
    const ld = {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: v.name,
      description: v.description,
      thumbnailUrl: [`${siteUrl}${v.cover}`, `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`],
      uploadDate: v.uploadDate,
      duration: v.duration,
      embedUrl: `https://www.youtube.com/embed/${v.id}`,
      url: `https://www.youtube.com/watch?v=${v.id}`,
    };
    return `  <script type="application/ld+json">\n  ${JSON.stringify(ld, null, 2).replace(/\n/g, "\n  ")}\n  </script>\n`;
  };
  eleventyConfig.addFilter("guideVideoLd", guideVideoLd);
  // One per how-to video player in a rendered post (see enhancePost).
  eleventyConfig.addFilter("videoJsonLd", (html, lang, siteUrl) =>
    [...String(html).matchAll(/<figure class="guide-video" id="([a-z]+)-video">/g)]
      .map((m) => guideVideoLd(lang, m[1], siteUrl))
      .join(""));

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    templateFormats: ["njk", "html", "md"],
    htmlTemplateEngine: false,
    markdownTemplateEngine: false,
  };
}
