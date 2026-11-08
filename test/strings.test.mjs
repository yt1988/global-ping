// Every language has every English key and no others (but the plural forms its numbers need: key_few, key_many), with
// the same {placeholders} and the same advice markup, and public/ is what the build makes from src/. The Worker's
// shared-link titles use the same languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build, loadI18n, LANGS } from "../scripts/build.mjs";
import { STR } from "../src/worker.js";

const I = await loadI18n(), en = I.en;
const holes = s => (typeof s === "string" ? s.match(/\{\w+\}/g) || [] : []).sort().join();
const marks = s => (typeof s === "string" ? [(s.match(/\*\*/g) || []).length, (s.match(/`/g) || []).length] : []).join();

test("every language is there", () => assert.deepEqual(Object.keys(I).sort(), LANGS.map(([l]) => l).sort()));

test("the Worker has the strings for every language folder", () => {
  const folders = LANGS.map(([l, slug]) => slug);
  assert.deepEqual(Object.keys(STR).sort(), folders.sort());
  for (const [l, slug] of LANGS) assert.deepEqual(STR[slug], I[l], `worker ${slug} is ${l}`);
});

test("every verdict has a title in every language", () => {
  const keys = ["ok", "loss", "some", "none", "dns", "priv", "partial", "err", "probe", "tokyo"];
  for (const slug of Object.keys(STR)) for (const k of keys) {
    const s = STR[slug][k === "tokyo" ? "v_tokyo" : "v_" + k];
    assert.ok(typeof s === "string" && s.length, `${slug || "en"}: no title for ${k}`);
  }
});

test("the brand name is written exactly in h1 and title", () => {
  for (const [l] of LANGS) {
    assert.ok(I[l].h1.includes(I[l].app_name), `${l}: h1 does not contain the brand name`);
    assert.ok(I[l].seo_title.includes(I[l].app_name), `${l}: title does not contain the brand name`);
  }
});

test("verdict and finding lines have no full stop; full sentences do", () => {
  for (const [l] of LANGS) {
    const d = I[l];
    for (const k of Object.keys(d)) {
      if (typeof d[k] !== "string" || k === "docs") continue;
      if (/^(v_|vs_|fd_)/.test(k) && k !== "v_oldbrowser_sub") {
        assert.ok(!/[.。]$/.test(d[k]), `${l}/${k}: verdict/finding line should not end with a full stop`);
      }
      if (/^(gp_unreach|gp_429|bad_target|bad_private|v_oldbrowser_sub)$/.test(k)) {
        assert.ok(/([.。！？!?]|…)$/.test(d[k]), `${l}/${k}: a full sentence needs its final mark`);
      }
    }
    for (const [q, a] of d.docs) {
      for (const line of String(a).split("\n")) {
        if (line.trim()) assert.ok(/([.。！？!?]|…)$/.test(line.trim()), `${l}: FAQ answer line has no final mark (${q})`);
      }
    }
  }
});

test("typography: percent, French spacing, Chinese spacing, ms unit", () => {
  for (const [l] of LANGS) {
    const d = I[l];
    for (const k of Object.keys(d)) {
      if (typeof d[k] !== "string") continue;
      assert.ok(!d[k].includes("%"), `${l}/${k}: % belongs to Intl's output, not the string`);
      if (l === "fr") {
        assert.ok(!/ [;:?!]/.test(d[k]), `${l}/${k}: use a non-breaking space before : ; ? !`);
        assert.ok(!/« | »/.test(d[k]), `${l}/${k}: use non-breaking spaces inside « »`);
      }
      if (l === "zh-CN" || l === "zh-TW") {
        assert.ok(!/[\u4e00-\u9fff][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fff]/.test(d[k]), `${l}/${k}: a space is needed between Han and Latin/digits`);
        assert.ok(!/[,:;]/.test(d[k].replace(/\{\w+\}/g, "")), `${l}/${k}: half-width , : ; in Chinese`);
      }
      if (l === "ru") assert.ok(!d[k].includes("мс"), `${l}/${k}: keep the unit as ms`);
    }
  }
});

for (const [lang] of LANGS.slice(1).filter(([l]) => I[l])) test(`${lang} matches en`, () => {
  const d = I[lang];
  const plural = k => /_(few|many)$/.test(k) && k.replace(/_(few|many)$/, "_one") in en;
  assert.deepEqual(Object.keys(d).filter(k => !(k in en) && !plural(k)), [], "keys en doesn't have");
  for (const k of Object.keys(d).filter(plural)) assert.equal(holes(d[k]), holes(en[k.replace(/_(few|many)$/, "")]), `placeholders of ${k}`);
  for (const k of Object.keys(en)) {
    assert.ok(k in d, `missing ${k}`);
    assert.ok(String(d[k]).trim(), `empty ${k}`);
    assert.equal(holes(d[k]), holes(en[k]), `placeholders of ${k}`);
    assert.equal(marks(d[k]), marks(en[k]), `**bold** and \`code\` marks of ${k}`);
  }
});

test("public/ is up to date", async () => assert.deepEqual(await build({ check: true }), []));
