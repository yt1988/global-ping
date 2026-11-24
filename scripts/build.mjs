#!/usr/bin/env node
// Builds the site in public/ from src/ and static/ (public/ is not committed: Workers Builds runs this, then deploys):
//   index.html, <lang>/index.html                          the test per language
//   <lang>/<continent>/, <lang>/<cc>/                      one page per continent (6) and country (86), every language
//   assets/app.<hash>.js, assets/app.<hash>.css            the page's code and styles, shared by every page
//   assets/l.<lang>.<hash>.js                              the strings the browser code needs, per language
//   sitemap.xml, robots.txt, llms.txt, _headers            SEO and security headers
//   static/…                                               copied as it is: fonts, logos, flags, the share dialog, og/
// The code and styles are bundled with esbuild; everything else is written as it is.
// Usage: node scripts/build.mjs
import { cp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import { countryName, flagCode } from "../src/model.mjs";
import { CONTINENTS, COUNTRIES, countryByCc, countryDir, picksOf, neighboursOf, isMain, englishName, noteFor } from "../src/regions.mjs";

const SITE = (process.env.SITE_URL || "https://ping.1ms.dog").replace(/\/+$/, "");
const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url), stat = new URL("../static/", import.meta.url);
export const REPO = "https://github.com/yt1988/global-ping";
// language, URL folder, og:locale; the first is the root
export const LANGS = [["en", "", "en_US"], ["zh-CN", "zh-cn", "zh_CN"], ["zh-TW", "zh-tw", "zh_TW"], ["ja", "ja", "ja_JP"], ["ko", "ko", "ko_KR"],
  ["es", "es", "es_ES"], ["fr", "fr", "fr_FR"], ["de", "de", "de_DE"], ["pt", "pt", "pt_BR"], ["ru", "ru", "ru_RU"]];

// Runs before first paint: apply the saved theme. On an English page, send visitors to their language's (a saved
// choice first, then the browser languages), keeping the query (a shared target) and the path (a country page).
const PREPAINT = `(function(){var d=document.documentElement,th=null,s=null;try{th=localStorage.getItem("globalping:theme");s=localStorage.getItem("globalping:lang")}catch(e){}if(th==="light"||th==="dark")d.setAttribute("data-theme",th);if(!d.hasAttribute("data-root"))return;var P=JSON.parse(d.getAttribute("data-paths")||"{}"),l=null;try{var q=new URLSearchParams(location.search).get("lang");if(P[q])l=q}catch(e){}if(!l&&P[s])l=s;for(var ls=navigator.languages||[navigator.language||"en"],i=0;!l&&!s&&i<ls.length;i++){var x=String(ls[i]).toLowerCase(),b=x.split("-")[0];l=b==="zh"?(/tw|hk|mo|hant/.test(x)?"zh-TW":"zh-CN"):P[b]?b:null}if(l&&l!=="en"&&location.pathname===P.en)location.replace(P[l]+location.search+location.hash)})();`;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 10);
const sha = s => createHash("sha256").update(s).digest("base64");
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const json = x => JSON.stringify(x).replace(/</g, "\\u003c");
const num = (n, lang) => { try { return new Intl.NumberFormat(lang).format(n); } catch { return String(n); } };

export async function loadI18n() {
  const out = {};
  for (const f of (await readdir(new URL("i18n/", src))).filter(f => f.endsWith(".mjs")))
    out[f.slice(0, -4)] = (await import(new URL("i18n/" + f, src).href + "?" + Date.now())).default;
  return out;
}

// Strings only the build uses (the page already shows them); everything else goes to the browser
const BUILD_ONLY = new Set(["name", "seo_title", "seo_desc", "seo_kw", "og_sub", "h1", "intro", "docs", "faq_h",
  "a_help", "a_close", "a_prev", "a_next", "a_lang", "a_theme", "lang_label", "f_target", "f_target_ph", "f_ipv",
  "share", "h_regions", "sort_label", "sort_median", "sort_jitter", "sort_loss", "lg_replied", "lg_missing", "lg_median",
  "lg_jitter", "lg_loss", "t_tokyo_only", "src_gp", "foot_src",
  // country and continent pages: the static text the build writes into them
  "cont_EU", "cont_NA", "cont_AS", "cont_SA", "cont_OC", "cont_AF", "a_crumbs", "nav_regions",
  "country_h1", "country_title", "country_desc", "country_intro", "c_probes", "near_h", "cont_h1", "cont_title", "cont_desc", "cont_intro", "cont_test",
  "cont_countries", "route_EU", "route_NA", "route_AS", "route_SA", "route_OC", "route_AF",
  "cc_test", "filter_ph", "filter_none", "filter_clear"]);

// Data sources named in the page link to their sites
const SOURCES = { gp: ["Globalping", "https://globalping.io"] };
const links = s => esc(s).replace(/\{(\w+)\}/g, (m, k) => SOURCES[k] ? `<a href="${SOURCES[k][1]}" target="_blank" rel="noopener">${SOURCES[k][0]}</a>` : m);

const pathOf = (slug, dir = "") => "/" + (slug ? slug + "/" : "") + (dir ? dir + "/" : "");

const GLOBE = '<svg class="rg-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c1.8 1.7 2.7 3.8 2.7 6.2S9.8 12.5 8 14.2C6.2 12.5 5.3 10.4 5.3 8S6.2 3.5 8 1.8z"/></svg>';
const flag = (cc, cls = "rg-flag") => `<img class="${cls}" src="/flags/${flagCode(cc)}.svg" alt="" width="20" height="15" loading="lazy">`;

// The head both kinds of page share: title, description, canonical and every language, Open Graph, JSON-LD.
function head({ title, desc, kw, ogTitle, ogDesc, url, locale, lang, appName, alts, graph }) {
  const image = `${SITE}/og/${lang.toLowerCase()}.png`;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="keywords" content="${esc(kw)}">`,
    `<meta name="robots" content="index, follow">`,
    `<meta name="application-name" content="${esc(appName)}">`,
    `<meta name="theme-color" content="#f6f6f7" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)">`,
    `<link rel="canonical" href="${url}">`,
    alts,
    `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`,
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="1ms.dog">`,
    `<meta property="og:title" content="${esc(ogTitle)}">`, `<meta property="og:description" content="${esc(ogDesc)}">`, `<meta property="og:url" content="${url}">`,
    `<meta property="og:locale" content="${locale}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(ogTitle)}">`,
    `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:image" content="${image}">`,
    `<meta name="twitter:title" content="${esc(ogTitle)}">`, `<meta name="twitter:description" content="${esc(ogDesc)}">`,
    `<script type="application/ld+json">${json({ "@context": "https://schema.org", "@graph": graph })}</script>`,
  ].join("\n");
}

const appSchema = ({ name, url, desc, lang }) => ({ "@type": "WebApplication", name, url, applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any", browserRequirements: "Requires JavaScript", description: desc, inLanguage: lang, isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } });

// What a country can be found by: its name here, its English name and its code (typing "US", "cn", "Germany").
const searchOf = (cc, lang) => `${countryName(cc, lang)}|${englishName(cc)} ${countryName(cc, "en")}|${cc}`;

// The filter above a country list: it hides rows as you type, shows "N / all" and says when nothing matches.
function filterBox(T, lang, total, cls) {
  return `<div class="rg-filter ${cls}"><div class="rg-frow"><input class="rg-q" type="search" placeholder="${esc(T("filter_ph"))}" aria-label="${esc(T("filter_ph"))}" autocomplete="off" spellcheck="false"><span class="rg-count">${num(total, lang)} / ${num(total, lang)}</span><button class="rg-clear" type="button" hidden>${esc(T("filter_clear"))}</button></div><p class="rg-none" hidden>${esc(T("filter_none"))}</p></div>`;
}

// The bottom navigation: continents by probe count, every country under its continent, the current page marked.
// Globalping's own probe counts are not shown (they are its inventory, not our coverage).
function regionNav(T, slug, current) {
  const items = CONTINENTS.map(c => {
    const open = current.cont === c.code ? " open" : "";
    const cc = c.countries.map(x => {
      const here = current.kind === "country" && current.cc === x.cc ? ' aria-current="page"' : "";
      return `<li><a href="${esc(pathOf(slug, countryDir(x)))}"${here} data-s="${esc(searchOf(x.cc, current.lang))}">${flag(x.cc)}<span class="rg-cname">${esc(countryName(x.cc, current.lang))}</span></a></li>`;
    }).join("");
    return `<details class="rg-cont"${open}><summary aria-label="${esc(T("cont_" + c.code))}">${GLOBE}<span class="rg-cname">${esc(T("cont_" + c.code))}</span></summary><ul class="rg-cc">${cc}</ul></details>`;
  }).join("");
  return `<nav class="region-nav" aria-labelledby="regionNavH"><h2 id="regionNavH">${esc(T("nav_regions"))}</h2>${filterBox(T, current.lang, COUNTRIES.length, "rg-filter-nav")}<div class="rg-list">${items}</div></nav>`;
}

function crumbs(T, slug, current) {
  const home = `<a href="${esc(pathOf(slug))}">${esc(T("app_name"))}</a>`;
  if (current.kind === "continent") return `${home}<span aria-hidden="true">/</span><span>${esc(T("cont_" + current.cont))}</span>`;
  const contName = T("cont_" + current.cont);
  return `${home}<span aria-hidden="true">/</span><a href="${esc(pathOf(slug, current.contSlug))}">${esc(contName)}</a><span aria-hidden="true">/</span><span>${esc(countryName(current.cc, current.lang))}</span>`;
}

// What a country page has besides the test: where it is, its neighbours, and (when the shared list carries it) a
// hand-written note on the country's networks. No Globalping inventory numbers: those rank its probes, they are not
// our coverage.
function countrySections(T, lang, c, slug, note = "") {
  const near = neighboursOf(c).map(x => `<li><a href="${esc(pathOf(slug, countryDir(x)))}" data-s="${esc(searchOf(x.cc, lang))}">${flag(x.cc)}<span class="rg-cname">${esc(countryName(x.cc, lang))}</span></a></li>`).join("");
  return `${note ? `<section class="card sec"><p class="route">${esc(note)}</p></section>` : ""}
  <section class="card sec">
    <h2>${esc(fill(T("near_h"), { continent: T("cont_" + c.cont) }))}</h2>
    <ul class="rg-near">${near}</ul>
    <p class="hint"><a href="${esc(pathOf(slug, c.contSlug))}">${esc(fill(T("cont_countries"), { continent: T("cont_" + c.cont) }))}</a></p>
  </section>
  <section class="card sec xlink" hidden data-tool="reach" data-x="${esc(countryDir(c) + "/")}" data-where="${esc(countryName(c.cc, lang))}"></section>`;
}

// What a continent has: its route note, how many countries it covers, and the list of them (each one testable on its
// own). The list is filterable; the page's test uses the countries with the most probes.
function continentSections(T, lang, c, slug) {
  const name = T("cont_" + c.code);
  const cards = c.countries.map(x => `<li><a href="${esc(pathOf(slug, countryDir(x)))}" data-s="${esc(searchOf(x.cc, lang))}">${flag(x.cc)}<span class="rg-cc-name">${esc(countryName(x.cc, lang))}</span><span class="rg-cc-test">${esc(T("cc_test"))}</span></a></li>`).join("");
  return `<section class="card sec page-facts">
    <p class="page-sub">${esc(fill(T("cont_countries"), { continent: name }))}: ${num(c.countries.length, lang)}</p>
    <p class="route">${esc(T("route_" + c.code))}</p>
  </section>
  <section class="card sec">
    <h2>${esc(fill(T("cont_countries"), { continent: name }))}</h2>
    ${filterBox(T, lang, c.countries.length, "rg-filter-cards")}
    <ul class="rg-ccards">${cards}</ul>
  </section>
  <section class="card sec xlink" hidden data-tool="reach" data-x="${esc(c.slug + "/")}" data-where="${esc(name)}"></section>`;
}

export async function build() {
  const t0 = Date.now();
  const I = await loadI18n(), en = I.en;
  if (!en) throw new Error("src/i18n/en.mjs is missing");
  const langs = LANGS.filter(([l]) => I[l]);
  for (const [l] of langs) for (const k of Object.keys(en)) if (!(k in I[l])) throw new Error(`i18n/${l}.mjs is missing "${k}"`);
  const homeTpl = await readFile(new URL("page.html", src), "utf8");
  const topicTpl = await readFile(new URL("topic.html", src), "utf8");

  // A full rebuild: static files first (the bundle imports /assets/share/codec.js from public, and the Worker does too:
  // src/code.mjs points at it), then everything generated, so a country that leaves the list cannot leave a page
  // behind. public/ is not committed (Workers Builds runs this before `wrangler deploy`).
  await rm(pub, { recursive: true, force: true });
  await mkdir(pub, { recursive: true });
  await cp(stat, pub, { recursive: true });

  // The page's code, with the result-link code it imports (src/code.mjs and 1ms.dog's shared codec, shared with the
  // Worker), as one script for ES2019 browsers: one unparsable token would stop the whole page.
  const js = (await bundle({ entryPoints: [fileURLToPath(new URL("app.js", src))], bundle: true, format: "iife",
    target: ["es2019", "chrome70", "safari13", "firefox68", "edge79"], legalComments: "none", write: false,
    external: ["/assets/share/share.js*"] })).outputFiles[0].text;
  const css = (await readFile(new URL("fonts.css", src), "utf8")) + "\n" + await readFile(new URL("base.css", src), "utf8") + "\n" + await readFile(new URL("style.css", src), "utf8");
  const jsName = `app.${hash(js)}.js`, cssName = `app.${hash(css)}.css`;
  const files = { ["assets/" + jsName]: js, ["assets/" + cssName]: css };

  // page dirs, in the order a visitor meets them; the home page first, then each continent and its countries
  const dirs = [{ dir: "", kind: "home" }];
  for (const c of CONTINENTS) {
    dirs.push({ dir: c.slug, kind: "continent", cont: c.code });
    for (const x of c.countries) dirs.push({ dir: countryDir(x), kind: "country", cont: c.code, cc: x.cc });
  }

  for (const [lang, slug, locale] of langs) {
    const d = I[lang], T = k => { if (!(k in d)) throw new Error(`i18n/${lang}.mjs has no "${k}"`); return d[k]; };
    const strings = Object.fromEntries(Object.keys(en).filter(k => !BUILD_ONLY.has(k)).map(k => [k, T(k)]));
    const sjs = `window.L1MS=${JSON.stringify(strings).replace(/</g, "\\u003c")};\n`;
    const sName = `l.${lang.toLowerCase()}.${hash(sjs)}.js`;
    files["assets/" + sName] = sjs;

    const docs = T("docs").map(([q, a]) => ({ q, h: a.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join(""), t: a.replace(/\n+/g, " ") }));
    // the topic pages' help keeps the three answers a country page raises: what it measures, the allowance, the address
    const topicDocs = [0, 3, 7].map(i => docs[i]).filter(Boolean);
    const faq = { "@type": "FAQPage", mainEntity: docs.map(x => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.t } })) };
    const langOpts = langs.map(([l]) => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(I[l].name)}</option>`).join("");

    for (const pg of dirs) {
      const at = sl => pathOf(sl, pg.dir), url = SITE + at(slug), isTopic = pg.kind !== "home";
      const alts = langs.map(([l, sl]) => `<link rel="alternate" hreflang="${l}" href="${SITE + at(sl)}">`).join("\n") +
        `\n<link rel="alternate" hreflang="x-default" href="${SITE + pathOf("", pg.dir)}">`;
      const paths = Object.fromEntries(langs.map(([l, sl]) => [l, at(sl)]));
      const helpDocs = isTopic ? topicDocs : docs;
      const helpNav = helpDocs.map((x, i) => `<button type="button" role="tab" data-hq="${i}" aria-selected="${i === 0}">${esc(x.q)}</button>`).join("");
      const helpC = helpDocs.map((x, i) => `<article data-hqb="${i}"${i ? " hidden" : ""}><h3>${esc(x.q)}</h3>${x.h}</article>`).join("");

      let title, desc, kw, og, html, data, graph;
      if (!isTopic) {
        title = T("seo_title"); desc = T("seo_desc"); kw = T("seo_kw"); og = T("og_sub");
        graph = [appSchema({ name: T("app_name") + " · 1ms.dog", url, desc, lang }), faq];
        html = homeTpl
          .replace(/(<(\w+)\b[^>]*\sdata-i="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, k, inner, close) => open + esc(T(k)) + close)
          .replace(/\{\{a:(\w+)\}\}/g, (m, k) => esc(T(k)))   // translated attribute values (aria-label, placeholders)
          .replace("{{lang}}", lang).replace("{{pathsAttr}}", esc(JSON.stringify(paths))).replace("{{rootAttr}}", slug ? "" : " data-root")
          .replace("{{prepaint}}", PREPAINT)
          .replace("{{css}}", cssName).replace("{{js}}", jsName).replace("{{strings}}", sName)
          .replace("{{homeHref}}", pathOf(slug)).replace("{{appName}}", esc(T("app_name"))).replace("{{langOpts}}", langOpts).replace("{{h1}}", esc(T("h1")))
          .replace("{{helpNav}}", helpNav).replace("{{helpC}}", helpC)
          .replace("{{srcGp}}", links(T("src_gp"))).replace("{{footSrc}}", links(T("foot_src")))
          .replace("{{data}}", json({ lang, paths, langPath: pathOf(slug) }));
      } else {
        const c = pg.kind === "continent" ? CONTINENTS.find(x => x.code === pg.cont) : countryByCc(pg.cc);
        const name = pg.kind === "continent" ? T("cont_" + pg.cont) : countryName(pg.cc, lang);
        const v = pg.kind === "continent"
          ? { continent: name, c: num(c.countries.length, lang), k: num(picksOf(c).length, lang) }
          : { country: name };
        title = fill(pg.kind === "continent" ? T("cont_title") : T("country_title"), v) + " · " + T("app_name");
        desc = fill(pg.kind === "continent" ? T("cont_desc") : T("country_desc"), v);
        kw = T("seo_kw") + ", " + name;
        og = desc;
        const h1 = fill(pg.kind === "continent" ? T("cont_h1") : T("country_h1"), v);
        const intro = fill(pg.kind === "continent" ? T("cont_intro") : T("country_intro"), v);
        // A continent tests its five countries in one request; a country asks for three probes of its own.
        const ranges = pg.kind === "continent"
          ? picksOf(c).map(x => ({ key: "c:" + x.cc, g: "topic", cc: x.cc, loc: { country: x.cc } }))
          : [0, 1, 2].map(i => ({ key: `c:${pg.cc}:${i}`, g: "topic", cc: pg.cc, n: i + 1, loc: { country: pg.cc }, label: fill(T("probe_n"), { n: i + 1 }) }));
        const tableH = pg.kind === "continent" ? fill(T("cont_countries"), { continent: name }) : T("c_probes");
        const goText = pg.kind === "continent" ? fill(T("cont_test"), { k: num(ranges.length, lang) }) : T("go");
        const sections = pg.kind === "continent" ? continentSections(T, lang, c, slug) : countrySections(T, lang, c, slug, noteFor(c.cc, lang));
        const cur = { kind: pg.kind, cont: pg.cont, contSlug: c.contSlug || c.slug, cc: pg.cc, lang };
        const crumbsHtml = crumbs(T, slug, cur);
        graph = [appSchema({ name: `${T("app_name")} · ${name}`, url, desc, lang }), { "@type": "BreadcrumbList", itemListElement: [
          { "@type": "ListItem", position: 1, name: T("app_name"), item: SITE + pathOf(slug) },
          ...(pg.kind === "continent" ? [{ "@type": "ListItem", position: 2, name, item: url }]
            : [{ "@type": "ListItem", position: 2, name: T("cont_" + pg.cont), item: SITE + pathOf(slug, cur.contSlug) },
              { "@type": "ListItem", position: 3, name, item: url }]),
        ] }];
        data = { lang, paths, langPath: pathOf(slug), kind: pg.kind, ranges };
        html = topicTpl
          .replace(/(<(\w+)\b[^>]*\sdata-i="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, k, inner, close) => open + esc(T(k)) + close)
          .replace(/\{\{a:(\w+)\}\}/g, (m, k) => esc(T(k)))
          .replace("{{lang}}", lang).replace("{{pathsAttr}}", esc(JSON.stringify(paths))).replace("{{rootAttr}}", slug ? "" : " data-root")
          .replace("{{prepaint}}", PREPAINT)
          .replace("{{css}}", cssName).replace("{{js}}", jsName).replace("{{strings}}", sName)
          .replace("{{homeHref}}", pathOf(slug)).replace("{{appName}}", esc(T("app_name"))).replace("{{langOpts}}", langOpts)
          .replace("{{crumbs}}", () => crumbsHtml).replace("{{h1}}", esc(h1)).replace("{{intro}}", esc(intro))
          .replace("{{tableH}}", () => esc(tableH)).replace("{{goText}}", () => esc(goText)).replace("{{sections}}", () => sections).replace("{{nav}}", () => regionNav(T, slug, cur))
          .replace("{{helpNav}}", () => helpNav).replace("{{helpC}}", () => helpC)
          .replace("{{data}}", () => json(data));
      }
      const headHtml = head({ title, desc, kw, ogTitle: title, ogDesc: og, url, locale, lang, appName: T("app_name"), alts, graph });
      html = html.split("{{head}}").join(headHtml);
      if (/\{\{[\w:]+\}\}/.test(html)) throw new Error("unfilled placeholder in " + at(slug) + ": " + /\{\{[\w:]+\}\}/.exec(html)[0]);
      files[at(slug).slice(1) + "index.html"] = html;
    }
  }

  // The sitemap: every page in every language, with its other languages and a priority from the probe count.
  const contDirs = new Set(CONTINENTS.map(c => c.slug));
  const prioOf = dir => !dir ? "1.0" : contDirs.has(dir) ? "0.8" : isMain(countryByCc(dir.split("/")[1].toUpperCase())) ? "0.7" : "0.5";
  const dirList = dirs.map(x => x.dir);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    langs.flatMap(([l, s2]) => dirList.map(dir => `  <url>\n    <loc>${SITE + pathOf(s2, dir)}</loc>\n` +
      langs.map(([l3, s3]) => `    <xhtml:link rel="alternate" hreflang="${l3}" href="${SITE + pathOf(s3, dir)}"/>`).join("\n") +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE + pathOf("", dir)}"/>\n    <priority>${prioOf(dir)}</priority>\n  </url>`).join("\n")) +
    "\n</urlset>\n";
  files["sitemap.xml"] = sitemap;
  files["robots.txt"] = `User-agent: *\nAllow: /\nDisallow: /r/\nDisallow: /*/r/\n\nSitemap: ${SITE}/sitemap.xml\n`;
  files["llms.txt"] = `# ${en.app_name} · 1ms.dog

> Free global ping: enter a domain or IP, choose nothing else, and 18 locations worldwide (Globalping's volunteer
> probes: China Telecom, China Unicom and China Mobile; Hong Kong; Taiwan, China; Tokyo; Korea; Singapore; India;
> Australia; London; Frankfurt; Russia; the UAE; South Africa; Los Angeles; New York; São Paulo) each send 16 ICMP
> echo requests to it. Every packet is shown, so you see the latency of each of the 16 packets, the jitter, and where
> packets went missing (the probe's raw seq numbers tell us). A second view comes from 1ms.dog's own server in Tokyo:
> the same 16 packets, no Globalping allowance used, and the only view that always knows the real loss positions.
> The page shows how many of Globalping's 250 hourly region checks (per IP) are left; one test uses 18. Nothing is
> stored, the Tokyo server keeps no log, and private addresses are never probed.

- Page: ${SITE}/ (also ${langs.slice(1).map(([, s]) => "/" + s + "/").join(", ")})
- Test a target directly (prefills, does not start a test): ${SITE}/?t=<domain or IP>
- Country pages (86 countries, 10 languages, e.g. ${SITE}/us/): ${SITE}/<country code>/
- Continent pages: ${CONTINENTS.map(c => SITE + "/" + c.slug + "/").join(", ")}
- Source code: ${REPO}
- Uses the Globalping API: https://globalping.io/docs/api.globalping.io
`;
  // The only inline script is the pre-paint snippet, identical on every page: one hash covers the site.
  // connect-src is https: because the browser calls Globalping and our Tokyo server on another host and port.
  const csp = ["default-src 'self'", `script-src 'self' 'sha256-${sha(PREPAINT)}'`, "style-src 'self'", "font-src 'self'", "img-src 'self' data: blob:",
    "connect-src 'self' https:", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
  files["_headers"] = `# Generated by scripts/build.mjs
/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
/assets/*
  Cache-Control: public, max-age=604800
/assets/app.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/l.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/fonts/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/share/*
  ! Cache-Control
  Cache-Control: public, max-age=0, must-revalidate
/flags/*
  Cache-Control: public, max-age=604800
/og/*
  Cache-Control: public, max-age=604800
/llms.txt
  Access-Control-Allow-Origin: *
  Content-Type: text/plain; charset=utf-8
`;

  for (const [f, body] of Object.entries(files)) {
    const out = new URL(f, pub);
    await mkdir(new URL(".", out), { recursive: true });
    await writeFile(out, body);
  }
  const pages = langs.length * dirs.length;
  const sitemapUrls = (sitemap.match(/<loc>/g) || []).length;
  console.log(`${pages} pages (${langs.length} × ${dirs.length}: home, ${CONTINENTS.length} continents, ${COUNTRIES.length} countries); sitemap ${sitemapUrls} URLs; ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  return { pages, sitemapUrls, dirs: dirs.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await build();
