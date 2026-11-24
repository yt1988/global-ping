// The generated site: one page per language, continent and country, each with the skeleton the tools share, a
// canonical address, every language, and a sitemap entry. The build runs before the tests (`npm test` builds first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { LANGS } from "../scripts/build.mjs";
import { CONTINENTS, COUNTRIES, countryDir, countryByCc, noteFor } from "../src/regions.mjs";

const pub = new URL("../public/", import.meta.url);
const read = f => readFile(new URL(f, pub), "utf8");
const pathOf = (slug, dir) => "/" + (slug ? slug + "/" : "") + (dir ? dir + "/" : "");
const dirs = ["", ...CONTINENTS.map(c => c.slug), ...COUNTRIES.map(countryDir)];

test("every page, for every language, was written", async () => {
  for (const [, slug] of LANGS) for (const dir of dirs) {
    const html = await read(`${slug ? slug + "/" : ""}${dir ? dir + "/" : ""}index.html`).catch(() => null);
    assert.ok(html, `missing page ${pathOf(slug, dir)}`);
    assert.equal((html.match(/<main\b/g) || []).length, 1, `${pathOf(slug, dir)}: one <main>`);
    assert.match(html, /<main[^>]*\sid="main"/, `${pathOf(slug, dir)}: main has id=main`);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${pathOf(slug, dir)}: one <h1>`);
    assert.equal((html.match(/hreflang=/g) || []).length, LANGS.length + 1, `${pathOf(slug, dir)}: every language and x-default`);
    assert.match(html, new RegExp(`<link rel="canonical" href="[^"]*${pathOf(slug, dir)}">`), `${pathOf(slug, dir)}: canonical points at itself`);
    assert.ok(!/\{\{[\w:]+\}\}/.test(html), `${pathOf(slug, dir)}: no unfilled placeholder`);
  }
});

test("the home page links every country page", async () => {
  for (const [lang, slug] of LANGS) {
    const html = await read(`${slug ? slug + "/" : ""}index.html`);
    assert.match(html, /<section class="card sec" id="explore">/, `${lang}: the explore block`);
    assert.equal((html.match(/class="rg-cont"/g) || []).length, CONTINENTS.length, `${lang}: one group per continent`);
    assert.equal((html.match(/class="rg-cont-link"/g) || []).length, CONTINENTS.length, `${lang}: every continent title is a link`);
    assert.equal((html.match(/class="rg-chip"/g) || []).length, COUNTRIES.length, `${lang}: every country is a chip`);
    assert.equal((html.match(/data-s="/g) || []).length, COUNTRIES.length, `${lang}: every country has a search string`);
    assert.ok(html.includes(`rg-filter-explore`), `${lang}: the filter`);
    assert.ok(html.includes(`/${slug ? slug + "/" : ""}europe/de/`), `${lang}: country links keep the language folder`);
  }
});

test("no page has a duplicate title", async () => {
  const seen = new Map();
  for (const [, slug] of LANGS) for (const dir of dirs) {
    const html = await read(`${slug ? slug + "/" : ""}${dir ? dir + "/" : ""}index.html`);
    const title = /<title>([^<]*)<\/title>/.exec(html)[1];
    assert.ok(!seen.has(title), `title used twice: ${title} (${pathOf(slug, dir)} and ${seen.get(title)})`);
    seen.set(title, pathOf(slug, dir));
  }
  assert.equal(seen.size, LANGS.length * dirs.length);
});

test("a country page shows no Globalping inventory, only the test and its neighbours", async () => {
  const us = countryByCc("US");
  const html = await read("zh-cn/" + countryDir(us) + "/index.html");
  assert.match(html, /<h1>[^<]*美国/);
  // probe, city, ASN and eyeball counts stay in the list; they must not appear on the page
  for (const n of [us.probes, us.cities, us.asns, us.eyeball])
    assert.ok(!html.includes(new Intl.NumberFormat("zh-CN").format(n)), `inventory number ${n} is on the page`);
  assert.ok(!html.includes("Los Angeles"), "the city list is not shown");
  assert.ok(!/节点较少|Few probes/.test(html));
  // five probes, each named by the probe itself as soon as the API answers
  const data = JSON.parse(/<script type="application\/json" id="data">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(data.ranges.length, 5);
  assert.deepEqual(data.ranges.map(r => r.cc), ["US", "US", "US", "US", "US"]);
  assert.ok(data.ranges.every(r => !("label" in r) && !("n" in r)), "no probe 1/2/3 labels");
  assert.deepEqual(data.locations, [{ country: "US", limit: 5 }], "one request asks for five probes there");
  // the note, the filter and one navigation only: no "also in this continent" block
  assert.ok(html.includes("rg-filter-nav"));
  assert.equal((html.match(/class="rg-near"/g) || []).length, 0, "no second country list");
  assert.equal((html.match(/rg-cont-link/g) || []).length, CONTINENTS.length, "the navigation still lists every continent");
  assert.ok(html.includes(noteFor("US", "zh-CN")), "the shared note is on the page");
});

test("a note shows only in a language the shared file carries", async () => {
  assert.ok(noteFor("DE", "zh-CN") && noteFor("DE", "en") && noteFor("DE", "fr") && noteFor("DE", "de"));
  assert.equal(noteFor("DE", "pt"), "");   // Portuguese has not been written yet
  const en = await read("europe/de/index.html"), fr = await read("fr/europe/de/index.html"), pt = await read("pt/europe/de/index.html");
  assert.ok(en.includes(noteFor("DE", "en")));
  assert.ok(fr.includes(noteFor("DE", "fr")));
  assert.ok(!pt.includes(noteFor("DE", "en")) && !pt.includes(noteFor("DE", "zh-CN")));
  assert.equal((pt.match(/class="route"/g) || []).length, 0);
});

test("a continent page tests ten countries in one request and lists them all", async () => {
  const asia = CONTINENTS.find(c => c.code === "AS");
  const html = await read("zh-cn/" + asia.slug + "/index.html");
  const data = JSON.parse(/<script type="application\/json" id="data">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(data.kind, "continent");
  assert.equal(data.ranges.length, 10);
  assert.deepEqual(data.ranges.map(r => r.cc), asia.countries.slice(0, 10).map(c => c.cc));
  assert.equal(data.locations.length, 10);
  assert.ok(data.locations.every(l => l.limit === 1));
  assert.equal((html.match(/class="rg-ccards"/g) || []).length, 1);
  // the cards list this continent; the navigation lists the other five, so no country appears twice
  assert.equal((html.match(/data-s="/g) || []).length, COUNTRIES.length, "every country exactly once across cards and navigation");
  assert.equal((html.match(/class="rg-cont"/g) || []).length, CONTINENTS.length - 1, "the page's own continent is not repeated in the navigation");
  assert.ok(html.includes("rg-filter-cards") && html.includes("rg-filter-nav"));
});

test("a country page does not start a test by itself", async () => {
  // The page's code runs start() only from the form and the share banner; no timer or load handler may call it.
  const code = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.ok(!/window\.onload|DOMContentLoaded|setTimeout\(\s*start|addEventListener\("load"[^)]*start/.test(code));
});

test("the sitemap lists every page with the agreed priorities", async () => {
  const xml = await read("sitemap.xml");
  const locs = xml.match(/<loc>/g) || [];
  assert.equal(locs.length, LANGS.length * dirs.length);
  const count = p => (xml.match(new RegExp(`<priority>${p.replace(".", "\\.")}</priority>`, "g")) || []).length;
  assert.equal(count("1.0"), LANGS.length);
  assert.equal(count("0.8"), LANGS.length * CONTINENTS.length);
  const main = COUNTRIES.filter(c => c.probes >= 50).length, small = COUNTRIES.length - main;
  assert.equal(count("0.7"), LANGS.length * main);
  assert.equal(count("0.5"), LANGS.length * small);
});

test("the generated files under public/ are exactly the pages and assets", async () => {
  const walk = async (u, p = "") => {
    const out = [];
    for (const e of await readdir(u, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...await walk(new URL(e.name + "/", u), p + e.name + "/"));
      else out.push(p + e.name);
    }
    return out;
  };
  const files = await walk(pub);
  const pages = files.filter(f => f.endsWith("index.html"));
  assert.equal(pages.length, LANGS.length * dirs.length);
  for (const f of ["sitemap.xml", "robots.txt", "llms.txt", "_headers", "favicon.ico", "flags/us.svg", "og/en.png"])
    assert.ok(files.includes(f), `missing ${f}`);
});
