import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { updateReportEntry } from "../src/report-entry.mjs";
import { LANGS, loadI18n } from "../scripts/build.mjs";

const button = () => ({ hidden: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
const ready = () => ({ verdict: { k: "loss" }, rows: [{ state: "loss", rcv: 15 }] });
const shell = () => {};

test("report entry requires both the shell and a result", () => {
  for (const state of [null, { rows: [] }, { verdict: { k: "err" }, rows: [] },
    { verdict: { k: "partial" }, rows: [{ state: "pending" }, { state: "noprobe" }] }]) {
    const b = button(); updateReportEntry(b, state, shell, "检测结果不对："); assert.equal(b.hidden, true);
  }
  for (const opener of [undefined, null, true, "function"]) {
    const b = button(); updateReportEntry(b, ready(), opener, "检测结果不对："); assert.equal(b.hidden, true);
  }
  const b = button(); updateReportEntry(b, ready(), shell, "检测结果不对：");
  assert.equal(b.hidden, false); assert.equal(b.attrs["data-ms-report"], "检测结果不对：");
  updateReportEntry(b, { verdict: null, rows: [] }, shell, "检测结果不对：");
  assert.equal(b.hidden, true, "a new test hides the previous result's entry");
});

test("shared, no-reply and Tokyo-only results retain the report entry", () => {
  for (const state of [ready(), { verdict: { k: "none" }, rows: [{ state: "none", rcv: 0 }] },
    { verdict: { k: "tokyo" }, tokyoOnly: true, rows: [], tokyo: { rcv: 16 } }]) {
    const b = button(); updateReportEntry(b, state, shell, "Wrong result:"); assert.equal(b.hidden, false);
  }
  const b = button();
  updateReportEntry(b, { verdict: { k: "tokyo" }, rows: [], tokyo: null }, shell, "Wrong result:");
  assert.equal(b.hidden, true);
});

test("each generated language page has a hidden, localized prefilled entry beside the result", async () => {
  const I = await loadI18n();
  for (const [lang, slug] of LANGS) {
    const html = await readFile(new URL(`../public/${slug ? slug + "/" : ""}index.html`, import.meta.url), "utf8");
    const tag = html.match(/<button\b[^>]*id="reportBtn"[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.ok(tag, lang); assert.match(tag, /\bhidden\b/);
    assert.ok(tag.includes(`data-ms-report="${I[lang].report_prefill}"`), lang);
    assert.ok(tag.includes(`>${I[lang].report_result}</button>`), lang);
    assert.ok(html.indexOf('id="reportBtn"') > html.indexOf('id="vTitle"'));
    assert.ok(I[lang].report_prefill.trim().length > 4);
  }
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /function drawVerdict\(s\)\s*\{\s*updateReportEntry/);
  assert.match(app, /function drawKpis\(s\)\s*\{\s*updateReportEntry/);
});
