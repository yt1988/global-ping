// The generated site: one page per language, continent and country, each with the skeleton the tools share, a
// canonical address, every language, and a sitemap entry. The build runs before the tests (`npm test` builds first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { LANGS } from "../scripts/build.mjs";
import { CONTINENTS, COUNTRIES, countryDir, countryByCc } from "../src/regions.mjs";

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

test("a country page carries that country's own numbers and cities", async () => {
  const us = countryByCc("US");
  const html = await read("zh-cn/" + countryDir(us) + "/index.html");
  assert.match(html, new RegExp(new Intl.NumberFormat("zh-CN").format(us.probes)));
  assert.match(html, /Los Angeles/);
  assert.match(html, /<h1>[^<]*美国/);
});

test("a continent page tests its five countries in one request", async () => {
  const asia = CONTINENTS.find(c => c.code === "AS");
  const html = await read("zh-cn/" + asia.slug + "/index.html");
  const data = JSON.parse(/<script type="application\/json" id="data">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(data.kind, "continent");
  assert.equal(data.ranges.length, 5);
  assert.deepEqual(data.ranges.map(r => r.cc), asia.countries.slice(0, 5).map(c => c.cc));
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
