// Global Ping: ping a domain or IP from 18 locations worldwide, 16 ICMP packets each, every packet visible. Globalping's
// probes run the worldwide view straight from the visitor's browser (each visitor spends their own hourly allowance);
// our own server in Tokyo gives a second view that uses none of it. Strings come from window.L1MS
// (assets/l.<lang>.<hash>.js, built from src/i18n/); the model and the result-link code are shared with the Worker.
import { REGIONS, PACKETS, TOKYO_REGION, countryName, fmtMs, fmtPct, median, stdev, placeResults, makeTokyoRow, verdict, findings, normalizeTarget, familyOf } from "./model.mjs";
import { encodeResult, decodeResult, sharePath, rowToCode, codeToRow } from "./code.mjs";
import { TOKYO_API } from "./config.mjs";

(() => {
const GP = "https://api.globalping.io/v1";
const WITH_TOKYO = !!TOKYO_API;
const L = window.L1MS || {}, D = JSON.parse(document.getElementById("data").textContent);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const t = (k, v) => { let s = L[k] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
const PR = new Intl.PluralRules(D.lang), pk = k => `${k}_${PR.select(1)}` in L ? `${k}_${PR.select(1)}` : k;
const pkOf = (k, n) => { const key = `${k}_${PR.select(n)}`; return key in L ? key : k; };
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const K = { theme: "globalping:theme", lang: "globalping:lang" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// theme and language
const TH = ["system", "light", "dark"], thBtn = $("theme");
const applyTheme = th => {
  if (th === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", th);
  thBtn.dataset.th = th; thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
};
applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set(K.theme, n); applyTheme(n); };
$("lang").onchange = e => { const l = e.target.value; store.set(K.lang, l); location.href = D.paths[l] + location.search; };

// Other 1ms.dog tools: their address comes from the shell's <meta name="<id>">; self-hosted there is none, so no link.
// Links keep this page's language folder.
const tool = id => { const m = document.querySelector(`meta[name="${id}"]`); return m && m.content ? m.content.replace(/\/+$/, "") + D.paths[D.lang] : ""; };
const EXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
const toolLink = (id, key) => { const u = tool(id); return u ? `<a class="ext" href="${esc(u)}" target="_blank" rel="noopener">${esc(t(key))}${EXT}</a>` : ""; };
const asnLink = ip => { const u = tool("asn"); return u ? `<a class="dv" href="${esc(u)}ip/${esc(ip)}" target="_blank" rel="noopener" title="${esc(t("lk_asn"))}">${esc(ip)}</a>` : esc(ip); };

// the help dialog: one answer at a time; a picker with previous / next on phones
const all = s => [...document.querySelectorAll(s)];
const openDlg = id => { $(id).hidden = false; document.documentElement.style.overflow = "hidden"; $(id).querySelector("[data-close]").focus(); };
const closeDlg = () => { all(".scrim").forEach(s => { s.hidden = true; }); document.documentElement.style.overflow = ""; };
all("[data-close]").forEach(b => { b.onclick = closeDlg; });
all(".scrim").forEach(s => s.addEventListener("click", e => { if (e.target === s) closeDlg(); }));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDlg(); });
let helpIdx = 0;
const helpQs = all("#helpNav [data-hq]");
$("helpSel").innerHTML = helpQs.map((b, i) => `<option value="${i}">${i + 1} / ${helpQs.length} · ${esc(b.textContent)}</option>`).join("");
const showHelp = i => {
  helpIdx = Math.max(0, Math.min(helpQs.length - 1, i));
  helpQs.forEach(b => b.setAttribute("aria-selected", +b.dataset.hq === helpIdx));
  all("#helpC [data-hqb]").forEach(a => { a.hidden = +a.dataset.hqb !== helpIdx; });
  $("helpSel").value = helpIdx;
  all("[data-hstep]").forEach(b => { b.disabled = helpIdx + +b.dataset.hstep < 0 || helpIdx + +b.dataset.hstep >= helpQs.length; });
  $("helpC").scrollTop = 0;
};
$("helpBtn").onclick = () => { showHelp(helpIdx); openDlg("help"); };
helpQs.forEach(b => { b.onclick = () => showHelp(+b.dataset.hq); });
$("helpSel").onchange = e => showHelp(+e.target.value);
all("[data-hstep]").forEach(b => { b.onclick = () => showHelp(helpIdx + +b.dataset.hstep); });

// row names: carriers by name, city probes with their country, the rest by country. Taiwan is the fixed exception.
// Our own Tokyo server is not one of the 18 and is named by its source.
const ours = region => region.key === TOKYO_REGION.key;
const nameOf = region => {
  if (ours(region)) return t("t_label");
  if (region.carrier) return t("c_" + region.carrier);
  if (region.city) return `${countryName(region.cc, D.lang)} · ${t("city_" + region.city)}`;
  return countryName(region.cc, D.lang);
};
const cardName = region => region.carrier ? t("c_" + region.carrier)
  : region.city && REGIONS.filter(r => r.cc === region.cc && !r.carrier).length > 1 ? `${t("city_" + region.city)}, ${region.cc}`
  : countryName(region.cc, D.lang);

// ---------- quota (same wording as the reachability check: raw region checks, not "tests left") ----------
const COST = REGIONS.length;
let quotaLeft = null, quotaReset = 0;
async function loadQuota() {
  $("quota").textContent = t("quota_loading");
  try {
    const j = await (await fetch(GP + "/limits")).json();
    const c = j.rateLimit.measurements.create;
    quotaLeft = c.remaining; quotaReset = c.reset; showQuota();
  } catch { quotaLeft = null; $("quota").textContent = t("quota_unknown"); }
}
function showQuota() {
  if (quotaLeft == null) { $("quota").textContent = t("quota_unknown"); return; }
  $("quota").textContent = quotaLeft >= COST
    ? t(pkOf("quota_ok", quotaLeft), { left: quotaLeft, cost: COST })
    : t("quota_out", { min: Math.ceil((quotaReset || 3600) / 60) });
}
function updateQuota(headers) {
  const left = headers.get("x-ratelimit-remaining"), reset = +headers.get("x-ratelimit-reset");
  if (left != null) { quotaLeft = +left; if (reset) quotaReset = reset; showQuota(); }
}

// ---------- the run ----------
let state = null, run = 0, recv = null, sortBy = "median", filterGroup = "all";
let rowEls = new Map(), detailEls = new Map();

const setGo = (testing) => {
  const b = $("go"); b.disabled = testing;
  b.textContent = testing ? t("running") : t(state && state.verdict && !state.tokyoOnly ? "go_again" : "go");
};
$("f").addEventListener("submit", e => { e.preventDefault(); start(); });

function note(k) {
  const el = $("targetNote");
  if (!k) { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false; el.textContent = t(k);
}
$("target").addEventListener("input", () => {
  const tg = normalizeTarget($("target").value);
  // the IP version only matters for a domain: hide it for an IP literal (an empty field may still become a domain, so
  // the selector stays visible and the form doesn't jump while typing)
  $("ipvWrap").hidden = !!tg.isIp;
  note("");
});

function start() {
  const raw = $("target").value.trim();
  const tg = normalizeTarget(raw);
  if (tg.error) { note(tg.error === "private" ? "bad_private" : "bad_target"); $("target").focus(); return; }
  note("");
  const id = ++run;
  if (recv) { recv.remove(); recv = null; }
  state = { id, tg, ipv: $("ipv").value, rows: REGIONS.map(() => null), tokyo: null, tokyoError: "",
    gpDone: false, gpError: "", gpMsg: "", gpReset: 0, partial: false, ts: Date.now(), verdict: null, findings: [], tokyoOnly: false };
  history.replaceState(null, "", D.paths[D.lang] + (tg.isIp ? "" : "?t=" + encodeURIComponent(tg.host)));
  $("verdict").hidden = false; $("table").hidden = false; $("shareBtn").hidden = true;
  $("tokyoFallback").hidden = true;
  $("regions").hidden = false; $("filters").hidden = false; $("sort").closest(".sel").hidden = false; $("kpis").hidden = false;
  noteShow(""); tokyoNoteShow("");
  if (quotaLeft != null) { quotaLeft = Math.max(0, quotaLeft - COST); showQuota(); }
  buildRows(state);
  renderRows(state);
  setGo(true);
  drawVerdict(state);
  runGlobalping(state);
  if (WITH_TOKYO) runTokyo(state);
}

async function runGlobalping(s) {
  const body = { type: "ping", target: s.tg.host, inProgressUpdates: true,
    locations: REGIONS.map(x => ({ ...x.loc, limit: 1 })),
    measurementOptions: { protocol: "ICMP", packets: PACKETS, ...(s.tg.isIp ? {} : { ipVersion: +s.ipv }) } };
  let r, j;
  try {
    r = await fetch(GP + "/measurements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    j = await r.json().catch(() => ({}));
  } catch { s.gpError = "unreach"; s.gpDone = true; loadQuota(); return settle(s); }
  const reset = +r.headers.get("x-ratelimit-reset"); if (reset) s.gpReset = reset;
  updateQuota(r.headers);
  if (r.status === 429) { s.gpError = "429"; s.gpDone = true; loadQuota(); return settle(s); }
  if (!r.ok || !j.id) { s.gpError = "err"; s.gpMsg = j?.error?.message || String(r.status); s.gpDone = true; loadQuota(); return settle(s); }
  const t0 = Date.now();
  while (s.id === run && Date.now() - t0 < 30000) {
    await sleep(900);
    let m; try { m = await (await fetch(`${GP}/measurements/${j.id}`)).json(); } catch { continue; }
    if (m.results) { s.rows = placeResults(REGIONS, m.results); renderRows(s); }
    if (m.status !== "in-progress") break;
  }
  if (s.id !== run) return;
  if (Date.now() - t0 >= 30000) s.partial = true;
  // a region the API returned nothing for gets a row too: "no probe available", not a forever-pending row
  s.rows = s.rows.map((r, i) => r || { region: REGIONS[i], state: "noprobe", rcv: 0, rtts: [], ttls: [],
    median: null, jitter: null, loss: 0, posUnknown: false, resolved: "", probe: null });
  renderRows(s);
  s.gpDone = true;
  settle(s);
}

async function runTokyo(s) {
  if (!WITH_TOKYO) { renderTokyo(s); return; }
  const q = new URLSearchParams({ host: s.tg.host });
  if (s.tg.isIp) q.set("v", String(s.tg.family)); else if (s.ipv) q.set("v", s.ipv);
  const c = new AbortController(), timer = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(`${TOKYO_API}?${q}`, { signal: c.signal, credentials: "omit", cache: "no-store" });
    const j = await r.json();
    if (j && j.ok === false) { s.tokyoError = j.k || "down"; s.tokyoRetry = j.retry || 0; }
    else { s.tokyo = makeTokyoRow(j); s.tokyoError = ""; }
  } catch { s.tokyoError = "down"; }
  finally { clearTimeout(timer); }
  if (s.id !== run) return;
  renderTokyo(s);
  if (!s.tokyoOnly) settle(s);
}

// Called whenever something arrives. The verdict and findings only appear once the worldwide view is done.
function settle(s) {
  if (!s || s.id !== run) return;
  if (!s.gpDone && !s.gpError) return;
  s.verdict = verdict(s.rows, { error: s.gpError, partial: s.partial });
  s.findings = (s.verdict.k === "err" || s.verdict.k === "partial") ? [] : findings(s.rows, s.tokyo);
  drawVerdict(s); drawKpis(s); drawFindings(s);
  sortRows(s);
  $("gpProgress").textContent = t("prog", { done: s.rows.filter(r => r && r.state !== "pending").length, of: REGIONS.length });
  $("shareBtn").hidden = !canShare(s);
  $("tokyoFallback").hidden = !WITH_TOKYO || s.tokyoError === "down" ||
    !(s.verdict.k === "err" || s.verdict.k === "partial" || (quotaLeft != null && quotaLeft < COST));
  setGo(false);
  $("go").textContent = t("go_again");
}

// ---------- rows ----------
function buildRows(s) {
  rowEls = new Map(); detailEls = new Map();
  for (const host of [$("tokyoRow"), $("regions")]) host.innerHTML = "";
  const showTokyo = WITH_TOKYO || !!(s && s.tokyo);
  const entries = showTokyo ? [{ region: TOKYO_REGION, own: true }, ...REGIONS.map(region => ({ region }))] : REGIONS.map(region => ({ region }));
  const chips = [{ g: "all", label: t("flt_all") }, { g: "cn", label: t("g_cn") }, { g: "apac", label: t("g_apac") }, { g: "emea", label: t("g_emea") }, { g: "am", label: t("g_am") }];
  $("filters").innerHTML = chips.map(c => `<button type="button" class="chip" data-g="${c.g}" aria-pressed="${c.g === filterGroup ? "true" : "false"}">${esc(c.label)}</button>`).join("");
  for (const e of entries) {
    const el = rowElement(e.region, e.own);
    (e.own ? $("tokyoRow") : $("regions")).appendChild(el);
    rowEls.set(e.region.key, el);
  }
  all("#filters .chip").forEach(b => { b.onclick = () => { filterGroup = b.dataset.g; all("#filters .chip").forEach(x => x.setAttribute("aria-pressed", x.dataset.g === filterGroup)); applyFilter(); }; });
  $("sort").onchange = e => { sortBy = e.target.value; sortRows(state); };
  applyFilter();
}

function rowElement(region, own) {
  const el = document.createElement("div");
  el.className = "row" + (own ? " own" : "");
  el.tabIndex = 0; el.setAttribute("role", "button"); el.setAttribute("aria-expanded", "false");
  el.dataset.key = region.key;
  const nm = nameOf(region);
  el.innerHTML = `<span class="rname"><i class="st"></i><span class="nm">${esc(nm)}</span></span>
    <span class="bars" aria-hidden="true"></span>
    <span class="med">—</span><span class="meta"></span>
    <span class="detail" hidden></span>`;
  el.dataset.name = nm;
  const toggle = () => {
    const d = el.querySelector(".detail"), open = d.hidden;
    if (!state) return;
    if (!d.dataset.built) {
      d.innerHTML = detailHtml(region);
      const box = d.querySelector(".d-bars");
      if (box) barsInto(box, rowFor(region));
      d.dataset.built = "1";
    }
    d.hidden = !open; el.setAttribute("aria-expanded", open ? "true" : "false");
  };
  el.addEventListener("click", e => { if (e.target.closest("a, .bar, .detail")) return; toggle(); });
  el.addEventListener("keydown", e => { if (e.target === el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(); } });
  el.addEventListener("mousemove", e => { if (!matchMedia("(pointer:fine)").matches) return; const b = e.target.closest(".bar"); if (b) tipShow(el, b); });
  el.addEventListener("mouseleave", tipHide);
  el.addEventListener("click", e => { const b = e.target.closest(".bar"); if (b && matchMedia("(pointer:coarse)").matches) tipShow(el, b); });
  return el;
}

// Bars are created as elements and their height is set through CSS variables with the CSSOM: an inline style="…"
// attribute would be blocked by the page's CSP (style-src 'self'), and the bars would show flat.
function barsInto(box, row) {
  box.textContent = "";
  const vals = row ? row.rtts.filter(Number.isFinite) : [];
  const top = vals.length ? Math.max.apply(null, vals) : 0;
  const scale = row ? Math.max(top, (row.median || 0) * 1.5, 1) : 1;
  for (let i = 0; i < PACKETS; i++) {
    const b = document.createElement("i");
    const v = row ? row.rtts[i] : null;
    b.className = "bar " + (!row ? "na" : Number.isFinite(v) ? "ok" : "miss");
    b.dataset.i = String(i);
    if (row && Number.isFinite(v)) b.style.setProperty("--h", Math.max(.06, Math.min(1, v / scale)).toFixed(3));
    box.appendChild(b);
  }
}

function rowFor(region) {
  const s = state; if (!s) return null;
  return ours(region) ? s.tokyo : s.rows[REGIONS.findIndex(r => r.key === region.key)];
}

function fillRow(s, region, row) {
  const el = rowEls.get(region.key); if (!el) return;
  const bars = el.querySelector(".bars");
  const st = el.querySelector(".st"), med = el.querySelector(".med"), meta = el.querySelector(".meta");
  if (!row || row.state === "pending") {
    barsInto(bars, null);
    st.className = "st"; med.textContent = "—"; meta.textContent = ours(region) ? t("t_wait") : t("r_pending");
    return;
  }
  if (row.state === "noprobe") { barsInto(bars, null); st.className = "st"; med.textContent = "—"; meta.textContent = t("r_noprobe"); return; }
  if (row.state === "failed" || row.state === "priv") {
    barsInto(bars, null);
    st.className = "st"; med.textContent = "—";
    meta.textContent = row.reason === "priv" ? t("t_private") : t("r_failed");
    el.setAttribute("aria-label", `${el.dataset.name}: ${meta.textContent}`);
    return;
  }
  st.className = "st " + (row.state === "ok" ? "ok" : row.state === "loss" ? "warn" : "bad");
  barsInto(bars, row);
  const ms = fmtMs(row.median, D.lang), j = Number.isFinite(row.jitter) ? "±" + fmtMs(row.jitter, D.lang) : "";
  med.innerHTML = `${ms} <small>ms</small>`;
  meta.innerHTML = `${j ? esc(j) + " · " : ""}${row.rcv}/${PACKETS}${row.posUnknown && row.rcv < PACKETS ? " ?" : ""}`;
  if (row.state === "none") { med.textContent = "—"; meta.innerHTML = `0/${PACKETS}`; }
  const who = el.dataset.name;
  el.setAttribute("aria-label", t("aria_row", { name: who, ms, j: j ? j.slice(1) : "—", rcv: row.rcv }));
}

function renderRows(s) {
  for (let i = 0; i < REGIONS.length; i++) fillRow(s, REGIONS[i], s.rows[i]);
  applyFilter();
}
function renderTokyo(s) {
  const el = rowEls.get(TOKYO_REGION.key); if (!el) return;
  if (s.tokyo) {
    el.hidden = false;
    fillRow(s, TOKYO_REGION, s.tokyo);
    tokyoNoteShow("");
  } else if (s.tokyoError === "down") {
    // before our Tokyo server exists (or while it is down) the row would only say "unavailable": hide it entirely
    // rather than show a broken-looking line; it comes back by itself once the server answers
    el.hidden = true;
    tokyoNoteShow("");
  } else {
    el.hidden = false;
    el.querySelector(".bars").textContent = "";
    el.querySelector(".st").className = "st";
    el.querySelector(".med").textContent = "—";
    el.querySelector(".meta").textContent = "";
    const key = s.tokyoError === "limit" ? "t_limit" : s.tokyoError === "busy" ? "t_busy" : s.tokyoError === "private" ? "t_private" : "t_down";
    tokyoNoteShow(t(key, { s: s.tokyoRetry || (key === "t_busy" ? 5 : 60) }));
  }
  applyFilter();
}

function noteShow(text) {
  const el = $("gpNote");
  el.textContent = text || "";
  el.hidden = !text;
}
function tokyoNoteShow(text) {
  const el = $("tokyoNote");
  el.textContent = text || "";
  el.hidden = !text;
}

function applyFilter() {
  for (const r of REGIONS) {
    const el = rowEls.get(r.key); if (!el) continue;
    const on = filterGroup === "all" || r.g === filterGroup;
    el.style.display = on ? "" : "none";
  }
}

function sortRows(s) {
  if (!s || !s.gpDone && !s.gpError) return;
  const order = [...REGIONS].sort((a, b) => {
    const ra = s.rows[REGIONS.indexOf(a)], rb = s.rows[REGIONS.indexOf(b)];
    const val = (r) => {
      if (!r || r.state === "pending" || r.state === "noprobe" || r.state === "failed" || r.state === "priv") return sortBy === "loss" ? 2 : -1;
      if (sortBy === "median") return Number.isFinite(r.median) ? r.median : Infinity;
      if (sortBy === "jitter") return Number.isFinite(r.jitter) ? -r.jitter : Infinity;
      return -r.loss;
    };
    const x = val(ra), y = val(rb);
    return x === y ? REGIONS.indexOf(a) - REGIONS.indexOf(b) : (x < y ? -1 : 1);
  });
  const host = $("regions");
  for (const r of order) { const el = rowEls.get(r.key); if (el) host.appendChild(el); }
  applyFilter();
}

// tooltip over one bar
let tip = null;
function tipEl() {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "tip m"; tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}
function tipShow(rowEl, bar) {
  const row = state && (rowEl.dataset.key === TOKYO_REGION.key ? state.tokyo : state.rows[REGIONS.findIndex(r => r.key === rowEl.dataset.key)]);
  if (!row || !row.rtts || row.posUnknown || row.state === "pending" || row.state === "noprobe") return;
  const i = +bar.dataset.i, rtt = row.rtts[i];
  const el = tipEl();
  el.textContent = Number.isFinite(rtt) ? t("tip_p", { i: i + 1, ms: fmtMs(rtt, D.lang), ttl: row.ttls[i] ?? "—" }) : t("tip_miss", { i: i + 1 });
  const b = bar.getBoundingClientRect();
  el.hidden = false;
  el.style.left = Math.min(innerWidth - 12, Math.max(8, b.left + b.width / 2)) + "px";
  el.style.top = (b.top - 34) + "px";
  el.style.transform = "translateX(-50%)";
}
function tipHide() { if (tip) tip.hidden = true; }
document.addEventListener("scroll", tipHide, { passive: true });

function detailHtml(region) {
  const s = state; if (!s) return "";
  const row = region.key === TOKYO_REGION.key ? s.tokyo : s.rows[REGIONS.findIndex(r => r.key === region.key)];
  if (!row || row.state === "pending") return `<p class="d-line">${esc(t("r_pending"))}</p>`;
  if (row.state === "noprobe") return `<p class="d-line">${esc(t("r_noprobe"))}</p>`;
  const target = s.tg.host;
  const rows = row.rtts.map((v, i) => `<tr><td>${i + 1}</td><td>${Number.isFinite(v) ? fmtMs(v, D.lang) : "—"}</td><td>${row.ttls[i] ?? "—"}</td><td class="${Number.isFinite(v) ? "" : "miss"}">${esc(Number.isFinite(v) ? t("d_reply") : t("d_no_reply"))}</td></tr>`).join("");
  const probe = row.probe && (row.probe.network || row.probe.city || row.probe.asn)
    ? `<p class="d-line">${esc(t("d_probe"))}: ${esc([row.probe.city, row.probe.network, row.probe.asn ? "AS" + row.probe.asn : ""].filter(Boolean).join(" · "))}</p>` : "";
  const resolved = row.resolved ? `<p class="d-line">${esc(t("d_resolved"))}: ${ours(region) || row.probe ? asnLink(row.resolved) : esc(row.resolved)}</p>` : "";
  const lostAll = row.rcv === 0 ? `<p class="d-line warn">${esc(t("d_all_lost"))}</p>` : "";
  const posUnknown = row.posUnknown && row.rcv < PACKETS ? `<p class="d-line">${esc(t("d_pos_unknown"))}</p>` : "";
  const links = [
    `<a href="${esc(tool("trace"))}?t=${encodeURIComponent(target)}" target="_blank" rel="noopener">${esc(t("lk_trace"))}${EXT}</a>`,
    `<a href="${esc(tool("reach"))}?t=${encodeURIComponent(target)}" target="_blank" rel="noopener">${esc(t("lk_reach"))}${EXT}</a>`,
  ].join("");
  return `<div class="d-bars" aria-hidden="true"></div>
    <table class="d-tab"><thead><tr><th>${esc(t("d_packet"))}</th><th>${esc(t("d_rtt"))}</th><th>${esc(t("d_ttl"))}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    ${probe}${resolved}${lostAll}${posUnknown}<p class="d-links">${links}</p>`;
}

// ---------- verdict, numbers, findings ----------
function drawVerdict(s) {
  const v = s.verdict;
  const dot = $("vDot"), title = $("vTitle"), sub = $("vSub");
  if (!v) { dot.className = "dot"; title.textContent = t("v_wait"); sub.textContent = ""; return; }
  const cls = { ok: "ok", probe: "ok", loss: "warn", some: "warn", none: "bad", dns: "bad", priv: "bad", err: "warn", partial: "warn", tokyo: "warn" }[v.k] || "warn";
  dot.className = "dot " + cls;
  title.textContent = t(v.k === "tokyo" ? "v_tokyo" : "v_" + v.k, { a: v.a, b: v.b });
  sub.textContent = subLine(s);
}
function subLine(s) {
  const replied = s.rows.filter(r => r && r.rcv > 0 && Number.isFinite(r.median));
  const fastest = replied.slice().sort((a, b) => a.median - b.median)[0];
  const slowest = replied.slice().sort((a, b) => b.median - a.median)[0];
  const v = s.verdict;
  if (v.k === "tokyo") return t("vs_tokyo");
  if (s.gpError) {
    const key = s.gpError === "429" ? "gp_429" : s.gpError === "unreach" ? "gp_unreach" : "gp_err";
    return t(key, { min: Math.ceil((s.gpReset || 3600) / 60), msg: s.gpMsg || "" });
  }
  if (v.k === "ok" || v.k === "probe") return t("vs_" + v.k, { n: replied.length, a: v.a, b: v.b,
    fast: fastest ? nameOf(fastest.region) : "", fms: fastest ? fmtMs(fastest.median, D.lang) : "",
    slow: slowest ? nameOf(slowest.region) : "", sms: slowest ? fmtMs(slowest.median, D.lang) : "" });
  if (v.k === "loss") {
    const w = s.rows.filter(r => r && r.rcv > 0 && r.rcv < PACKETS).sort((a, b) => b.loss - a.loss)[0];
    return t("vs_loss", { n: replied.length, lost: PACKETS - w.rcv, region: nameOf(w.region), pct: fmtPct(w.loss, D.lang, 1) });
  }
  if (v.k === "some") return t("vs_some", { a: v.a, b: v.b, fast: fastest ? nameOf(fastest.region) : "", fms: fastest ? fmtMs(fastest.median, D.lang) : "" });
  return t("vs_" + v.k, { a: v.a, b: v.b });
}
function drawKpis(s) {
  const replied = s.tokyoOnly ? (s.tokyo && s.tokyo.rcv > 0 ? [s.tokyo] : []) : s.rows.filter(r => r && r.rcv > 0 && Number.isFinite(r.median));
  if (!replied.length) {
    $("kMedian").textContent = "—"; $("kJitter").textContent = "—"; $("kJitterWho").textContent = ""; $("kLoss").textContent = "—";
    return;
  }
  const gm = median(replied.map(r => r.median));
  const j = replied.filter(r => Number.isFinite(r.jitter)).sort((a, b) => b.jitter - a.jitter)[0];
  const sent = replied.length * PACKETS, got = replied.reduce((n, r) => n + r.rcv, 0);
  $("kMedian").innerHTML = `${fmtMs(gm, D.lang)} <small>ms</small>`;
  $("kJitter").innerHTML = j ? `±${fmtMs(j.jitter, D.lang)} <small>ms</small>` : "—";
  $("kJitterWho").textContent = j && !s.tokyoOnly ? nameOf(j.region) : "";
  $("kLoss").innerHTML = fmtPct((sent - got) / sent, D.lang, sent - got ? 1 : 0);
}
function drawFindings(s) {
  if (!s.verdict || s.verdict.k === "err" || s.verdict.k === "partial") { $("findings").innerHTML = ""; return; }
  const links = { fd_none: ["reach", "lk_reach"], fd_loss: ["trace", "lk_trace"], fd_slow: ["trace", "lk_trace"], fd_jitter: ["lag", "lk_lag"] };
  $("findings").innerHTML = s.findings.map(f => {
    const vars = { ...f };
    if (f.region) vars.region = nameOf(f.region);
    if (f.fast) vars.fast = nameOf(f.fast);
    if (f.regions) vars.regions = f.regions.map(nameOf).join(t("sep"));
    if (Number.isFinite(vars.ms)) vars.ms = fmtMs(vars.ms, D.lang);
    if (Number.isFinite(vars.fms)) vars.fms = fmtMs(vars.fms, D.lang);
    if (Number.isFinite(vars.j)) vars.j = fmtMs(vars.j, D.lang);
    if (f.k === "fd_loss") vars.pct = fmtPct(f.pct / 100, D.lang, 0);
    if (Number.isFinite(vars.ours)) vars.ours = fmtMs(vars.ours, D.lang);
    if (Number.isFinite(vars.theirs)) vars.theirs = fmtMs(vars.theirs, D.lang);
    if (f.k === "fd_cn") { vars.telecom = fmtMs(f.telecom.median, D.lang); vars.unicom = fmtMs(f.unicom.median, D.lang); vars.mobile = fmtMs(f.mobile.median, D.lang); }
    const lk = links[f.k];
    return `<li><span>${esc(t(f.k, vars))}</span>${lk ? toolLink(lk[0], lk[1]) : ""}</li>`;
  }).join("");
}

function canShare(s) {
  if (!s || !s.verdict) return false;
  if (s.verdict.k === "err" || s.verdict.k === "partial") return false;
  return s.rows.some(r => r && r.rcv > 0) || (s.tokyo && s.tokyo.rcv > 0);
}

// ---------- share: the result in a link, and the card ----------
async function resultLink(s) {
  const code = { t: s.tg.host, f: s.tg.family || +s.ipv || 4, ts: s.ts, k: s.verdict.k, a: s.verdict.a, b: s.verdict.b,
    r: s.rows.filter(r => r && r.state !== "pending" && r.state !== "noprobe").map(rowToCode),
    y: s.tokyo ? [s.tokyo.resolved || "", s.tokyo.rtts.map(v => (Number.isFinite(v) ? Math.round(v * 10) : 0)), s.tokyo.ttls.map(v => (Number.isFinite(v) ? v : 0))] : 0 };
  return `${location.origin}${D.paths[D.lang]}r/${await encodeResult(code)}`;
}
$("shareBtn").addEventListener("click", async () => {
  const s = state; if (!s) return;
  const link = await resultLink(s);
  const { share } = await import("/assets/share/share.js?v=9");
  const v = { title: t(s.verdict.k === "tokyo" ? "v_tokyo" : "v_" + s.verdict.k, { a: s.verdict.a, b: s.verdict.b }), k: s.verdict.k };
  const rows = s.rows.filter(r => r && r.rcv > 0);
  share({
    lang: D.lang, name: t("app_name"), file: "global-ping", show: [], never: ["ip"], canShow: false,
    link: () => link, home: location.origin + D.paths[D.lang],
    text: () => `${v.title} · ${s.tg.host}`,
    height: (ctx, kit) => cardLayout(ctx, kit, v, s.tg.host, rows, s.tokyo, s).H,
    ts: s.ts,
    foot: () => ["Globalping + " + location.hostname],
    draw: (ctx, kit) => drawCard(ctx, kit, v, s, rows),
  }).open();
});

const ROWH = 44;
function cardLayout(ctx, kit, v, target, rows, tokyo, s) {
  const { W, P, F, fit, wrap } = kit, w = W - P * 2;
  let ts = fit(ctx, v.title, w, 46, 34), lines = [v.title];
  if (ctx.measureText(v.title).width > w) { ts = 38; ctx.font = `700 ${ts}px ${F}`; lines = wrap(ctx, v.title, w, 2); }
  const tY = kit.top + 14;
  const targetY = tY + (lines.length - 1) * Math.round(ts * 1.2) + 48;
  const numY = targetY + 62;
  const cells = rows.length + (tokyo && tokyo.rcv > 0 ? 1 : 0);
  const gridY = numY + 62;
  const gridRows = Math.ceil(cells / 3);
  return { lines, ts, tY, targetY, numY, gridY, cells, gridRows, H: gridY + gridRows * ROWH + 74 };
}
function drawCard(ctx, kit, v, s, rows) {
  const { P, W, F, M, v: css, fit, clip } = kit, w = W - P * 2;
  const L2 = cardLayout(ctx, kit, v, s.tg.host, rows, s.tokyo, s);
  const cls = v.k === "ok" || v.k === "probe" ? "ok" : v.k === "loss" || v.k === "some" || v.k === "partial" ? "warn" : "bad";
  ctx.fillStyle = css(cls); ctx.font = `700 ${L2.ts}px ${F}`;
  L2.lines.forEach((line, i) => ctx.fillText(line, P, L2.tY + i * Math.round(L2.ts * 1.2)));
  // the target must stay complete: shrink the font, never clip it
  const tsz = fit(ctx, s.tg.host, w - 240, 30, 20, 600);
  ctx.fillStyle = css("fg"); ctx.font = `600 ${tsz}px ${F}`; ctx.fillText(s.tg.host, P, L2.targetY);
  ctx.textAlign = "right"; ctx.fillStyle = css("muted"); ctx.font = `400 22px ${F}`;
  ctx.fillText(rows.length ? `${rows.length} · 16` : location.hostname, W - P, L2.targetY); ctx.textAlign = "left";
  // three big numbers
  const gm = median(rows.filter(r => Number.isFinite(r.median)).map(r => r.median));
  const j = rows.filter(r => Number.isFinite(r.jitter)).sort((a, b) => b.jitter - a.jitter)[0];
  const sent = rows.length * PACKETS, got = rows.reduce((n, r) => n + r.rcv, 0);
  const vals = [[t("k_median"), Number.isFinite(gm) ? fmtMs(gm, D.lang) + " ms" : "—"],
    [t("k_max_jitter"), j ? "±" + fmtMs(j.jitter, D.lang) + " ms" : "—"],
    [t("k_loss"), rows.length ? fmtPct((sent - got) / sent, D.lang, sent - got ? 1 : 0) : "—"]];
  vals.forEach(([label, val], i) => {
    const x = P + i * (w / 3);
    ctx.fillStyle = css("muted"); ctx.font = `500 20px ${F}`; ctx.fillText(label, x, L2.numY - 18);
    ctx.fillStyle = css("fg"); ctx.font = `700 38px ${F}`; ctx.fillText(val, x, L2.numY + 22);
  });
  // the regions: dot + short name + median (or replies). Names shrink to fit; no "…" in a name.
  rows.forEach((row, i) => {
    const col = i % 3, line = Math.floor(i / 3), cw = w / 3;
    const x = P + col * cw, y = L2.gridY + line * ROWH;
    const colr = row.state === "ok" ? "ok" : row.state === "loss" || (row.rcv > 0 && row.rcv < PACKETS) ? "warn" : row.rcv > 0 ? "ok" : "bad";
    ctx.fillStyle = css(colr); ctx.beginPath(); ctx.arc(x + 5, y - 9, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css("fg"); fit(ctx, cardName(row.region), cw - 132, 20, 14, 500);
    ctx.fillText(cardName(row.region), x + 20, y);
    ctx.fillStyle = css("muted"); ctx.font = `500 19px ${M}`; ctx.textAlign = "right";
    ctx.fillText(row.rcv === 0 ? "—" : row.rcv < PACKETS ? `${row.rcv}/16` : fmtMs(row.median, D.lang) + " ms", x + cw - 26, y);
    ctx.textAlign = "left";
  });
  if (s.tokyo && s.tokyo.rcv > 0) {
    const i = rows.length, col = i % 3, line = Math.floor(i / 3), cw = w / 3;
    const x = P + col * cw, y = L2.gridY + line * ROWH;
    ctx.fillStyle = css("ink"); ctx.beginPath(); ctx.arc(x + 5, y - 9, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css("fg"); ctx.font = `500 20px ${F}`; ctx.fillText(t("t_label"), x + 20, y);
    ctx.fillStyle = css("muted"); ctx.font = `500 19px ${M}`; ctx.textAlign = "right";
    ctx.fillText(fmtMs(s.tokyo.median, D.lang) + " ms", x + cw - 26, y); ctx.textAlign = "left";
  }
}

// ---------- someone else's shared result, and ?t= prefills ----------
function decodeRows(o) {
  const rows = (o.r || []).map(arr => {
    const row = codeToRow(arr, REGIONS); if (!row) return null;
    const got = row.rtts.filter(Number.isFinite);
    row.median = median(got); row.jitter = stdev(got);
    return row;
  }).filter(Boolean);
  let tokyo = null;
  if (Array.isArray(o.y)) {
    const rtts = (o.y[1] || []).map(v => (v > 0 ? v / 10 : null)), ttls = (o.y[2] || []).map(v => (v > 0 ? v : null));
    while (rtts.length < PACKETS) rtts.push(null); while (ttls.length < PACKETS) ttls.push(null);
    tokyo = { region: TOKYO_REGION, own: true, resolved: o.y[0] || "", probe: { city: "Tokyo", country: "JP", asn: 0, network: "" },
      rtts, ttls, rcv: rtts.filter(Number.isFinite).length, median: median(rtts), jitter: stdev(rtts), loss: 0, state: "ok", posUnknown: false };
    tokyo.loss = (PACKETS - tokyo.rcv) / PACKETS; tokyo.state = tokyo.rcv === 0 ? "none" : tokyo.rcv < PACKETS ? "loss" : "ok";
  }
  return { rows, tokyo };
}
const sp = sharePath(location.pathname);
if (sp) {
  decodeResult(sp.code).then(async o => {
    if (!o) return;
    const { rows, tokyo } = decodeRows(o);
    state = { id: ++run, tg: { host: o.t, family: o.f || 4, isIp: familyOf(o.t) != null }, ts: o.ts || Date.now(),
      rows: REGIONS.map(r => rows.find(x => x.region.key === r.key) || { region: r, state: "noprobe" }),
      tokyo, gpDone: true, gpError: "", partial: false, verdict: { k: o.k, a: o.a ?? 0, b: o.b ?? 0 }, findings: [],
      tokyoOnly: !rows.length };
    $("target").value = o.t; $("ipvWrap").hidden = false; $("ipv").value = String(o.f || 4);
    $("verdict").hidden = $("table").hidden = false; $("shareBtn").hidden = false;
    if (state.tokyoOnly) { $("regions").hidden = true; $("filters").hidden = true; $("sort").closest(".sel").hidden = true; }
    buildRows(state); renderRows(state); renderTokyo(state); drawVerdict(state); drawKpis(state);
    state.findings = findings(state.rows, state.tokyo); drawFindings(state);
    $("gpProgress").textContent = t("prog", { done: state.rows.filter(r => r && r.state !== "pending").length, of: REGIONS.length });
    $("tokyoFallback").hidden = true;
    const { received } = await import("/assets/share/share.js?v=9");
    recv = received({ lang: D.lang, ts: state.ts, at: $("verdict"), test: () => start() });
  }).catch(() => {
    $("verdict").hidden = false;
    $("vDot").className = "dot warn"; $("vTitle").textContent = t("v_oldbrowser"); $("vSub").textContent = t("v_oldbrowser_sub");
  });
} else {
  const q = new URLSearchParams(location.search);
  if (q.get("t")) { $("target").value = q.get("t"); $("target").dispatchEvent(new Event("input")); }
}

$("tokyoBtn").addEventListener("click", async () => {
  if (!WITH_TOKYO) return;
  const raw = $("target").value.trim(), tg = normalizeTarget(raw);
  if (tg.error) return;
  const id = ++run;
  state = { id, tg, ipv: $("ipv").value, rows: REGIONS.map(() => null), tokyo: null, tokyoError: "", gpDone: true, gpError: "", partial: false,
    ts: Date.now(), verdict: { k: "tokyo", a: 0, b: 0 }, findings: [], tokyoOnly: true };
  $("verdict").hidden = false; $("table").hidden = false; $("shareBtn").hidden = true; $("tokyoFallback").hidden = true;
  $("regions").hidden = true; $("filters").hidden = true; $("sort").closest(".sel").hidden = true;
  buildRows(state); renderRows(state); renderTokyo(state); drawVerdict(state);
  $("kpis").hidden = true;
  await runTokyo(state);
  if (state.id !== id) return;
  if (!state.tokyo) {
    $("kpis").hidden = true;
    $("vDot").className = "dot warn";
    $("vTitle").textContent = t("t_down");
    $("vSub").textContent = "";
    $("gpProgress").textContent = "";
    setGo(false);
    return;
  }
  drawKpis(state); $("kpis").hidden = false;
  $("gpProgress").textContent = "";
  $("shareBtn").hidden = !canShare(state);
  setGo(false);
});

window.msReport = () => state && state.verdict ? {
  summary: `${t(state.verdict.k === "tokyo" ? "v_tokyo" : "v_" + state.verdict.k, { a: state.verdict.a, b: state.verdict.b })} · ${state.tg.host}`,
  data: { target: state.tg.host, family: state.tg.family, verdict: state.verdict,
    rows: state.rows.filter(r => r && r.state !== "pending" && r.state !== "noprobe").map(r => ({ region: r.region.key, resolved: r.resolved, rcv: r.rcv, median: r.median, jitter: r.jitter, loss: r.loss })),
    tokyo: state.tokyo ? { resolved: state.tokyo.resolved, rcv: state.tokyo.rcv, median: state.tokyo.median } : null },
  picks: state.rows.filter(r => r && r.rcv < PACKETS).slice(0, 8).map(r => `${nameOf(r.region)}: ${r.rcv}/16`),
} : null;

// under "from here": the visitor's target, and the allowance they have this hour
loadQuota();
})();
