// Global Ping: ping a domain or IP from 16 locations worldwide, 16 ICMP packets each, every packet visible. Globalping's
// probes run the worldwide view straight from the visitor's browser (each visitor spends their own hourly allowance);
// our own server in Tokyo gives a second view that uses none of it. Strings come from window.L1MS
// (assets/l.<lang>.<hash>.js, built from src/i18n/); the model and the result-link code are shared with the Worker.
import { REGIONS as HOME_REGIONS, PACKETS, SERVER_REGIONS, countryName, flagCode, fmtMs, fmtPct, latencyBand, median, stdev, placeResults, makeServerRow, verdict, findings, normalizeTarget, familyOf } from "./model.mjs";
import { encodeResult, decodeResult, sharePath, rowToCode, codeToRow } from "./code.mjs";
import { SERVERS as SERVER_CONFIG } from "./config.mjs";
import { updateReportEntry } from "./report-entry.mjs";
import { authedFetch } from "./auth.mjs";

(() => {
const GP = "https://api.globalping.io/v1";
const L = window.L1MS || {}, D = JSON.parse(document.getElementById("data").textContent);
// A country or continent page tests only its own places (one probe, or 4–5 countries in one request); the home page
// tests the fixed 18 regions. Everything else — the input, the rows, the numbers — is the same code.
const TOPIC = D.kind === "country" || D.kind === "continent";
const REGIONS = TOPIC ? D.ranges : HOME_REGIONS;
// our own servers, one row each; a configured address that does not answer simply is not shown
const SERVERS = !TOPIC ? SERVER_CONFIG.filter(s => s && s.api && SERVER_REGIONS[s.key]) : [];
const WITH_SERVERS = SERVERS.length > 0;
// Deadlines: a page shows whatever came back in time, and marks the rest, instead of waiting on every probe.
// A server's own answer takes 16 packets at half-second intervals, about 8 s, and its handler gives up at 12 s
// (server/main.go); a deadline under that cuts the answer off for no reason, so ours is a little above 12.
const LIMITS = { country: 12000, continent: 18000, home: 20000, server: 14000, create: 8000 };
const TOTAL_MS = TOPIC ? (D.kind === "country" ? LIMITS.country : LIMITS.continent) : LIMITS.home;
const POLL_MS = 700;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Chinese copy: keep a space between Han and Latin/digits (16 个地区, Globalping 的), no space between two Han words
// or before Chinese punctuation. Templates put spaces around placeholders for other languages, so tidy what is shown.
const tidy = s => {
  s = String(s).replace(/[ \t]{2,}/g, " ");
  s = s.replace(/([\u4e00-\u9fff]) +(?=[\u4e00-\u9fff])/g, "$1");
  s = s.replace(/([\u4e00-\u9fff]) +(?=[，。：；！？、）】」])/g, "$1");
  s = s.replace(/([（【「]) +(?=[\u4e00-\u9fff])/g, "$1");
  s = s.replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2");
  s = s.replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2");
  return s.trim();
};
const t = (k, v) => {
  let s = L[k] ?? k;
  if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]);
  return /^(zh-CN|zh-TW)$/.test(D.lang) ? tidy(s) : s;
};
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
const tool = id => { const m = document.querySelector(`meta[name="${id}"]`); return m && m.content ? m.content.replace(/\/+$/, "") + (D.langPath || "/") : ""; };
// xmlns is not an attribute outerHTML re-adds: Dark Reader re-loads each <svg> as a standalone data: URI, which needs it
const EXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
const toolLink = (id, key) => { const u = tool(id); return u ? `<a class="ext" href="${esc(u)}" target="_blank" rel="noopener">${esc(t(key))}${EXT}</a>` : ""; };
const asnLink = ip => { const u = tool("asn"); return u ? `<a class="dv" href="${esc(u)}ip/${esc(ip)}" target="_blank" rel="noopener" title="${esc(t("lk_asn"))}">${esc(ip)}</a>` : esc(ip); };
// The addresses a run resolved, in first-seen order and without repeats: one per probe when a CDN answers differently
// in different places. Our servers' rows carry theirs too.
const addrsOf = v => [...new Set(String(v || "").split(/[\s,]+/).filter(Boolean))];
// The ASN tool's own origin, for its JSON API (never the language folder: api/ip answers outside it).
const asnBase = () => { const m = document.querySelector('meta[name="asn"]'); return m && m.content ? m.content.replace(/\/+$/, "") : ""; };
const asnCache = new Map();
const ipInfo = ip => {
  const base = asnBase();
  if (!base) return Promise.resolve(null);
  if (!asnCache.has(ip)) asnCache.set(ip, fetch(`${base}/api/ip/${encodeURIComponent(ip)}`)
    .then(r => (r.ok ? r.json() : null)).catch(() => null));
  return asnCache.get(ip);
};
// A country or continent page links to the same place in the reachability check. The address comes from the shell's
// meta (self-hosted has none, then the block is removed), and the path is the same on both tools.
for (const el of document.querySelectorAll("[data-tool]")) {
  const u = tool(el.dataset.tool);
  if (!u) { el.remove(); continue; }   // self-hosted: no link to another site
  if (el.dataset.kind === "country") {
    // the link and its words are in the page's HTML (crawlers read them); only the address is rewritten here
    const a = el.querySelector("a");
    if (a) a.href = u + (el.dataset.x || "");
    el.hidden = false;
    continue;
  }
  el.innerHTML = `<a class="ext" href="${esc(u + (el.dataset.x || ""))}" target="_blank" rel="noopener">${esc(t("x_reach", { where: el.dataset.where || "" }))}${EXT}</a>`;
  el.hidden = false;
}

// Country filters: the bottom navigation's 86 countries, and on a continent page that continent's list. Matching is
// pure front-end (names here, English names, two-letter codes; spaces and case ignored) and nothing is requested.
const qnorm = v => String(v).toLowerCase().replace(/\s+/g, "");
const qwords = v => String(v).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// A row matches when its code is the query, or a word of its name here or in English starts with it; text without
// spaces (Chinese, Japanese) matches anywhere. "US" then finds the United States, not every name with "us" inside.
const qhit = (raw, s) => {
  const q = String(raw).trim().toLowerCase();
  if (!q) return true;
  const [loc, en, code] = s.split("|").map(x => x || "");
  const squeezed = q.replace(/\s+/g, "");
  if (code.toLowerCase() === squeezed) return true;
  if (/[^\x00-\x7f]/.test(squeezed)) return qnorm(loc).includes(squeezed) || qnorm(en).includes(squeezed);
  // every word the visitor typed must start a word of one of the names: "united states" finds the United States,
  // "states" does too, and "US" is the code, not the "us" inside other names
  const want = qwords(q), pool = [...qwords(loc), ...qwords(en)];
  return want.length > 0 && want.every(w => pool.some(x => x.startsWith(w)));
};
function wireFilter(box) {
  const input = box.querySelector(".rg-q"), count = box.querySelector(".rg-count"), none = box.querySelector(".rg-none"), clear = box.querySelector(".rg-clear");
  if (!input) return;
  const scope = box.closest(".region-nav") || box.closest("section") || box.parentElement;
  const items = [...scope.querySelectorAll("[data-s]")].map(a => ({ li: a.closest("li"), s: a.dataset.s }));
  const total = items.length, conts = [...scope.querySelectorAll(".rg-cont")];
  const update = () => {
    const q = input.value;
    let n = 0;
    for (const it of items) { const hit = qhit(q, it.s); it.li.hidden = !hit; if (hit) n++; }
    for (const d of conts) {
      const hit = [...d.querySelectorAll("[data-s]")].some(a => !a.closest("li").hidden);
      d.hidden = !!q && !hit;
    }
    count.textContent = `${n} / ${total}`;
    none.hidden = n > 0;
    clear.hidden = !input.value;
  };
  input.addEventListener("input", update);
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); input.value = ""; update(); input.blur(); }
    if (e.key === "Enter") e.preventDefault();
  });
  clear.addEventListener("click", () => { input.value = ""; update(); input.focus(); });
  update();
}
document.querySelectorAll(".rg-filter").forEach(wireFilter);
// "/" jumps to the filter: the continent's own list first, otherwise the navigation's.
document.addEventListener("keydown", e => {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.target;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
  if (document.querySelector(".scrim:not([hidden])")) return;
  const f = document.querySelector(".rg-filter-cards .rg-q") || document.querySelector(".rg-filter-explore .rg-q") || document.querySelector(".rg-filter-nav .rg-q");
  if (f) { e.preventDefault(); f.focus(); }
});

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

// row names: city probes with their country, the rest by country. Taiwan is the fixed exception.
// Our own servers are not among the 16 and are named by their source.
const ours = region => !!region.server;
// A topic page names a row by the probe itself: city, network and ASN, as soon as the API has told us who it is (the
// first poll after creating the measurement, while the result is still running). No "probe 1/2/3": two probes in the
// same city and network get the probe's own user tag when it has one.
const probeLabel = p => [p.city, p.network, p.asn ? "AS" + p.asn : ""].filter(Boolean).join(" · ");
const rowName = row => {
  if (!row) return "";
  if (TOPIC && !row.region?.server && row.probe && probeLabel(row.probe)) return probeLabel(row.probe) + (row.probe._tag ? " · " + row.probe._tag : "");
  return row.region ? nameOf(row.region) : "";
};
// Identical-looking probes in one test (same city, network and ASN) are kept apart by their user tag, when they have one.
function labelDuplicates(rows) {
  if (!TOPIC) return;
  const by = new Map();
  for (const r of rows) if (r && r.probe) { const k = probeLabel(r.probe); (by.get(k) || by.set(k, []).get(k)).push(r); }
  for (const list of by.values()) if (list.length > 1) list.forEach((r, i) => {
    const tag = (r.probe.tags || []).find(x => /^u-/.test(x));
    r.probe._tag = tag || String.fromCharCode(65 + i);   // A, B, C … never "probe 2"
  });
}
const nameOf = region => {
  if (region.server) return t("srv_" + region.server);
  if (region.city) return `${countryName(region.cc, D.lang)} · ${t("city_" + region.city)}`;
  if (region.label) return region.label;   // a country page's "Probe 1" until the city is known
  return countryName(region.cc, D.lang);
};
// The card uses the same names as the page: country for a single point, "country · city" when the city is the point
// (contract, share card: short names that fit; never cut words). The card falls back to two columns for long languages.

// ---------- quota (same wording as the reachability check: raw region checks, not "tests left") ----------
const COST = REGIONS.length;
let quotaLeft = null, quotaReset = 0, quotaBlocked = false, testing = false;
// Read the allowance on load and after every test. When it cannot pay for this page's test, Test still runs: only our
// own servers are asked (src/model: the worldwide block is hidden), because those answers cost nothing.
async function loadQuota(quiet = false) {
  if (!quiet) $("quota").textContent = t("quota_loading");
  try {
    const j = await (await fetch(GP + "/limits")).json();
    const c = j.rateLimit.measurements.create;
    quotaLeft = c.remaining; quotaReset = c.reset; showQuota();
  } catch { quotaLeft = null; showQuota(); }
}
// Three states, one wording across the three pages: enough, not enough but some left, and none left.
function quotaText() {
  const min = Math.ceil((quotaReset || 3600) / 60);
  if (quotaLeft == null) return t("quota_unknown");
  if (quotaLeft <= 0) return t("quota_out", { min });
  if (quotaLeft < COST) return t("quota_short", { cost: COST, left: quotaLeft, min });
  return t(pkOf("quota_ok", quotaLeft), { left: quotaLeft, cost: COST });
}
function showQuota() {
  $("quota").textContent = quotaText();
  quotaBlocked = quotaLeft != null && quotaLeft < COST;
}
function flashQuota() {
  const el = $("quota");
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  const live = $("quotaLive");
  if (live) { live.textContent = ""; requestAnimationFrame(() => { live.textContent = el.textContent; }); }
  clearTimeout(flashQuota.t);
  flashQuota.t = setTimeout(() => el.classList.remove("flash"), 1400);
}
function updateQuota(headers) {
  const left = headers.get("x-ratelimit-remaining"), reset = +headers.get("x-ratelimit-reset");
  if (left != null) { quotaLeft = +left; if (reset) quotaReset = reset; showQuota(); }
}

// ---------- the run ----------
let state = null, run = 0, recv = null;
let rowEls = new Map(), detailEls = new Map();

const setGo = (busy) => {
  testing = busy;
  const b = $("go");
  b.disabled = busy;
  if (!busy) { b.classList.remove("is-off"); b.removeAttribute("aria-disabled"); }
  b.textContent = busy ? t("running") : t(state && state.verdict && !state.tokyoOnly ? "go_again" : "go");
};
$("f").addEventListener("submit", e => { e.preventDefault(); start(); });

// A country page has one probe: "0 / 1 regions finished" says nothing. It shows "Testing…" while it runs and nothing
// once the answer is in; a continent page counts countries like the home page counts regions.
function showProgress(done) {
  const key = TOPIC ? (D.kind === "country" ? "" : "prog_c") : "prog";
  $("gpProgress").textContent = TOPIC && D.kind === "country" ? (done ? "" : t("running")) : t(key, { done, of: REGIONS.length });
}

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
// Rewrite the field to the bare host a test will use — after a paste, when it loses focus, and right before a run
// (Enter or Test). Not on every keystroke: rewriting while typing would make "https://" impossible to finish. Text
// that cannot be resolved is left exactly as typed, and the existing error line explains it.
function normalizeField() {
  const el = $("target");
  const tg = normalizeTarget(el.value);
  if (!tg.error && el.value.trim() !== tg.host) {
    el.value = tg.host;
    el.dispatchEvent(new Event("input", { bubbles: true }));   // the same listener updates the IP version and the note
  }
  return tg;
}
$("target").addEventListener("paste", () => setTimeout(normalizeField, 0));
$("target").addEventListener("blur", normalizeField);

function start() {
  // The allowance cannot pay for the worldwide view: ask our own servers only (no request is sent to Globalping) and
  // say so in the result. With no server rows to fall back to, the click explains itself instead.
  if (quotaBlocked) {
    if (WITH_SERVERS) runOursOnly(true);
    else { flashQuota(); loadQuota(true); }
    return;
  }
  const tg = normalizeField();
  if (tg.error) { note(tg.error === "private" ? "bad_private" : "bad_target"); $("target").focus(); return; }
  note("");
  const id = ++run;
  if (recv) { recv.remove(); recv = null; }
  state = { id, tg, ipv: $("ipv").value, rows: REGIONS.map(() => null),
    servers: SERVERS.map(s => ({ key: s.key, api: s.api, row: null, error: "", retry: 0 })),
    gpDone: false, gpError: "", gpMsg: "", gpReset: 0, partial: false, ts: Date.now(), verdict: null, findings: [], tokyoOnly: false, rowsBuilt: false };
  // The address bar stays as it is for a normal test (1ms.dog convention, 2026-11-08): no ?t= is written.
  // The one exception is a shared result's /r/ page: once the visitor runs their own test, go back to the language home.
  if (sharePath(location.pathname)) history.replaceState(null, "", D.paths[D.lang]);
  $("verdict").hidden = false; $("table").hidden = false; $("shareBtn").hidden = true;
  $("tokyoFallback").hidden = true;
  $("regions").hidden = false; $("kpis").hidden = false;   // a previous server-only run hid the worldwide block
  noteShow("");
  if (TOPIC) {
    // no rows until the API has told us which probes run: "probe 1/2/3" is not a name
    rowEls = new Map(); detailEls = new Map();
    $("regions").innerHTML = `<p class="note m" role="status">${esc(t("allocating"))}</p>`;
    $("tokyoRow").innerHTML = "";
  } else {
    buildRows(state);
    renderRows(state);
  }
  setGo(true);
  drawVerdict(state);
  drawKpis(state);
  drawFindings(state);
  showProgress(0);
  drawTargetInfo(state);   // an IP target is known at once; a domain's addresses arrive with the probes
  runGlobalping(state);
  if (WITH_SERVERS) runServers(state);
}

async function runGlobalping(s) {
  const locations = Array.isArray(D.locations) ? D.locations : REGIONS.map(x => ({ ...x.loc, limit: 1 }));
  const body = { type: "ping", target: s.tg.host, inProgressUpdates: true, locations,
    measurementOptions: { protocol: "ICMP", packets: PACKETS, ...(s.tg.isIp ? {} : { ipVersion: +s.ipv }) } };
  let r, j;
  const pc = new AbortController(), ptimer = setTimeout(() => pc.abort(), LIMITS.create);
  try {
    r = await fetch(GP + "/measurements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: pc.signal });
    j = await r.json().catch(() => ({}));
  } catch { s.gpError = "unreach"; s.gpDone = true; loadQuota(); return settle(s); }
  finally { clearTimeout(ptimer); }
  const reset = +r.headers.get("x-ratelimit-reset"); if (reset) s.gpReset = reset;
  updateQuota(r.headers);
  if (r.status === 429) { s.gpError = "429"; s.gpDone = true; loadQuota(); return settle(s); }
  if (!r.ok || !j.id) { s.gpError = "err"; s.gpMsg = j?.error?.message || String(r.status); s.gpDone = true; loadQuota(); return settle(s); }
  // Ask for the measurement at once: the first answer already names the probes (probe.city, network, asn) while the
  // result is still running, so the rows show who is testing from the first moment.
  const t0 = Date.now();
  // one controller for every poll, aborted at the deadline: the page stops on time even if a request hangs
  const ctl = new AbortController(), deadline = setTimeout(() => ctl.abort(), TOTAL_MS);
  const once = async () => { try { return await (await fetch(`${GP}/measurements/${j.id}`, { signal: ctl.signal })).json(); } catch { return null; } };
  const apply = m => {
    if (!m || !Array.isArray(m.results)) return;
    const rows = placeResults(REGIONS, m.results);
    labelDuplicates(rows);
    if (TOPIC && !s.rowsBuilt && rows.some(r => r && r.probe)) { s.rowsBuilt = true; buildRows(s); }
    s.rows = rows;
    if (!TOPIC || s.rowsBuilt) renderRows(s);
  };
  let m = await once();
  if (s.id !== run) return;
  apply(m);
  while (s.id === run && (!m || m.status === "in-progress") && Date.now() - t0 < TOTAL_MS) {
    const left = TOTAL_MS - (Date.now() - t0);
    if (left <= 0) break;
    await sleep(Math.min(POLL_MS, left));
    if (s.id !== run) return;
    m = await once();
    apply(m);
  }
  clearTimeout(deadline);
  if (s.id !== run) return;
  if (Date.now() - t0 >= TOTAL_MS) s.partial = true;
  if (TOPIC && !s.rowsBuilt) { s.rowsBuilt = true; buildRows(s); }
  // a region the API returned nothing for gets a row too: "no probe available", not a forever-pending row
  s.rows = s.rows.map((r, i) => {
    if (r && r.state !== "pending") return r;
    // a probe still running at the deadline keeps its name; the row says it did not answer in time
    return { region: REGIONS[i], state: s.partial ? "timeout" : "noprobe", rcv: 0, rtts: [], ttls: [],
      median: null, jitter: null, loss: 0, posUnknown: false, resolved: r ? r.resolved : "", probe: r ? r.probe : null };
  });
  renderRows(s);
  s.gpDone = true;
  settle(s);
}

async function runServers(s) {
  if (!WITH_SERVERS) return;
  const q = new URLSearchParams({ host: s.tg.host });
  if (s.tg.isIp) q.set("v", String(s.tg.family)); else if (s.ipv) q.set("v", s.ipv);
  await Promise.all(s.servers.map(async srv => {
    const c = new AbortController(), timer = setTimeout(() => c.abort(), LIMITS.server);
    try {
      const r = await authedFetch(`${srv.api}?${q}`, { signal: c.signal, credentials: "omit", cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 401 ? "auth" : "http");
      const j = await r.json();
      if (j && j.ok === false) { srv.error = j.k || "down"; srv.retry = j.retry || 0; }
      else { srv.row = makeServerRow(j, SERVER_REGIONS[srv.key]); srv.error = ""; }
    } catch (e) { srv.error = e && e.message === "auth" ? "auth" : "down"; }
    finally { clearTimeout(timer); }
    if (s.id === run) { renderServers(s); if (!s.tokyoOnly) settle(s); }
  }));
}

// Called whenever something arrives. The verdict and findings only appear once the worldwide view is done.
function settle(s) {
  if (!s || s.id !== run) return;
  if (!s.gpDone && !s.gpError) return;
  s.verdict = verdict(s.rows, { error: s.gpError, partial: s.partial });
  // Findings compare places with each other; a country page has one probe, so it gets the verdict and numbers only.
  s.findings = (s.verdict.k === "err" || s.verdict.k === "partial" || (TOPIC && D.kind === "country")) ? [] : findings(s.rows, (s.servers || []).find(x => x.key === "tokyo")?.row || null);
  if (s.gpError) {
    rowEls = new Map(); detailEls = new Map();
    $("regions").innerHTML = "";
    $("table").hidden = true;
  }
  drawVerdict(s); drawKpis(s); drawFindings(s);
  showProgress(s.rows.filter(r => r && r.state !== "pending").length);
  // What did not come back, said in the result: the deadline's probes and, on a country or continent page, a short sample.
  const notes = [];
  if (s.partial) {
    const late = s.rows.filter(r => r && r.state === "timeout").length;
    if (late) notes.push(t("slow_missing", { n: late }));
  }
  if (TOPIC && !s.gpError) {
    const answered = s.rows.filter(r => r && r.rcv > 0).length;
    if (answered > 0 && answered < REGIONS.length) notes.push(t("samples_low", { n: answered }));
  }
  noteShow(notes.join(" · "));
  $("shareBtn").hidden = !canShare(s);
  if (s.gpDone && !s.quotaRefreshed) { s.quotaRefreshed = true; loadQuota(true); }
  $("tokyoFallback").hidden = !WITH_SERVERS ||
    !(s.verdict.k === "err" || s.verdict.k === "partial" || (quotaLeft != null && quotaLeft < COST));
  setGo(false);
  $("go").textContent = t("go_again");
}

// ---------- rows ----------
// The list is grouped like Reach Check: a heading per group, the regions in a fixed order. With headings, a global
// sort would scramble the groups, so there is no sort control (the page is a comparison, the finding lines call out
// the extremes).
const GROUPS = ["apac", "emea", "am"];

function buildRows(s) {
  rowEls = new Map(); detailEls = new Map();
  for (const host of [$("tokyoRow"), $("regions")]) host.innerHTML = "";
  if (TOPIC) {
    // one list, no group headings: a country's probe, or the countries a continent page tests
    for (const region of REGIONS) {
      const el = rowElement(region, false);
      $("regions").appendChild(el);
      rowEls.set(region.key, el);
    }
    return;
  }
  if (WITH_SERVERS && s && s.servers) for (const srv of s.servers) {
    const region = SERVER_REGIONS[srv.key];
    const el = rowElement(region, true);
    $("tokyoRow").appendChild(el);
    rowEls.set(region.key, el);
  }
  for (const g of GROUPS) {
    const sec = document.createElement("section");
    sec.className = "grp";
    const h = document.createElement("h4");
    h.className = "grp-h";
    h.textContent = t("g_" + g);
    sec.appendChild(h);
    for (const region of REGIONS.filter(r => r.g === g)) {
      const el = rowElement(region, false);
      sec.appendChild(el);
      rowEls.set(region.key, el);
    }
    $("regions").appendChild(sec);
  }
}

function rowElement(region, own) {
  const el = document.createElement("div");
  el.className = "row" + (own ? " own" : "");
  el.tabIndex = 0; el.setAttribute("role", "button"); el.setAttribute("aria-expanded", "false");
  el.dataset.key = region.key;
  const nm = nameOf(region);
  el.innerHTML = `<span class="rname"><i class="st"></i><img class="rg-flag row-flag" alt="" width="16" height="12" hidden><span class="nm">${esc(nm)}</span><span class="rip" hidden></span></span>
    <span class="bars" aria-hidden="true"></span>
    <span class="med">—</span><span class="meta"></span>
    <span class="detail" hidden></span>`;
  el.dataset.name = nm;
  setRowFlag(el, region.cc);   // the requested country until the probe itself answers (then probe.country wins)
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
    b.className = "bar " + (!row ? "na" : Number.isFinite(v) ? "b" + latencyBand(v) : "miss");
    b.dataset.i = String(i);
    if (row && Number.isFinite(v)) b.style.setProperty("--h", Math.max(.06, Math.min(1, v / scale)).toFixed(3));
    box.appendChild(b);
  }
}

function rowFor(region) {
  const s = state; if (!s) return null;
  if (region.server) return (s.servers || []).find(x => x.key === region.server)?.row || null;
  return s.rows[REGIONS.findIndex(r => r.key === region.key)];
}

// Every result row carries the flag of the probe's own country (Taiwan's is the contract's cn.svg); a row whose probe
// is not known yet keeps it hidden.
function setRowFlag(el, cc) {
  const img = el.querySelector(".row-flag");
  if (!img) return;
  if (!cc) { img.hidden = true; return; }
  const src = `/flags/${flagCode(cc)}.svg`;
  if (img.getAttribute("src") !== src) img.setAttribute("src", src);
  img.hidden = false;
}

// The address this probe resolved, beside its name: a domain target shows what each probe actually connected to (a
// CDN answers differently in different places); an IP target has nothing to resolve, so the slot stays empty.
function setRowIp(el, s, row) {
  const box = el.querySelector(".rip");
  if (!box) return;
  const ips = s && s.tg && !s.tg.isIp && row ? addrsOf(row.resolved) : [];
  box.innerHTML = ips.map(asnLink).join(", ");
  box.hidden = !ips.length;
}

function fillRow(s, region, row) {
  const el = rowEls.get(region.key); if (!el) return;
  setRowFlag(el, (row && row.probe && row.probe.country) || region.cc);
  setRowIp(el, s, row && row.state !== "pending" ? row : null);
  // the probe's identity is shown as soon as it is known, including while the result is still running
  const nm = rowName(row);
  if (nm && el.dataset.name !== nm) {
    el.dataset.name = nm;
    const slot = el.querySelector(".nm");
    if (slot) slot.textContent = nm;
  }
  const bars = el.querySelector(".bars");
  const st = el.querySelector(".st"), med = el.querySelector(".med"), meta = el.querySelector(".meta");
  if (!row || row.state === "pending") {
    barsInto(bars, null);
    st.className = "st"; med.textContent = "—"; meta.textContent = ours(region) ? t("t_wait") : t("r_pending");
    return;
  }
  if (row.state === "noprobe") { barsInto(bars, null); st.className = "st"; med.textContent = "—"; meta.textContent = t("r_noprobe"); return; }
  if (row.state === "timeout") { barsInto(bars, null); st.className = "st"; med.textContent = "—"; meta.textContent = t("r_timeout"); return; }
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
  drawTargetInfo(s);
}
function renderServers(s) {
  for (const srv of s.servers || []) {
    const region = SERVER_REGIONS[srv.key];
    const el = rowEls.get(region.key); if (!el) continue;
    // every server keeps its line from the start of the run: one that has not answered yet shows as waiting, so the
    // table never grows a row in the middle of a test
    el.hidden = false;
    fillRow(s, region, srv.row || { state: "pending" });
  }
  drawTargetInfo(s);
}

// The target's addresses, once: the IP the visitor typed, or every address the probes resolved. Each gets the ASN
// tool's country, AS number and network; a failed lookup leaves the address alone (no error). Only three are shown
// until "N more" is opened, so a CDN's long list does not push the table down.
let infoKey = "";
function drawTargetInfo(s) {
  const box = $("tinfo"), list = $("tinfoList");
  if (!box || !list) return;
  const ips = !s || !s.tg ? [] : s.tg.isIp ? [s.tg.host]
    : addrsOf([...s.rows.map(r => r && r.resolved), ...(s.servers || []).map(x => x.row && x.row.resolved)].join(" "));
  box.hidden = !ips.length;
  if (!ips.length) { infoKey = ""; list.innerHTML = ""; return; }
  const open = list.dataset.open === "1" && ips.length > 3;
  const shown = open ? ips : ips.slice(0, 3);
  const key = (open ? "1" : "0") + "|" + ips.join(" ");   // the whole list: a fourth address must reveal "N more"
  if (key === infoKey) return;
  infoKey = key;
  list.innerHTML = shown.map(ip => `<li class="ti" data-ip="${esc(ip)}"><span class="ti-who"></span>${asnLink(ip)}</li>`).join("")
    + (ips.length > 3 ? `<li class="ti-more"><button class="btn sm ghost" id="tiMore" type="button">${esc(t(open ? "tinfo_less" : "tinfo_more", { n: ips.length - 3 }))}</button></li>` : "");
  for (const li of list.querySelectorAll("[data-ip]")) {
    ipInfo(li.dataset.ip).then(info => {
      if (!li.isConnected || !info || !info.cc) return;
      const as = [info.asn ? "AS" + info.asn : "", info.name || info.holder || ""].filter(Boolean).join(" ");
      li.querySelector(".ti-who").innerHTML = `<img class="rg-flag" src="/flags/${flagCode(info.cc)}.svg" alt="" width="16" height="12">`
        + `<span class="ti-country">${esc(countryName(info.cc, D.lang))}</span>`
        + (as ? `<span class="ti-as">${esc(as)}</span>` : "");
    });
  }
}
if ($("tinfoList")) $("tinfoList").addEventListener("click", e => {
  if (!e.target.closest("#tiMore")) return;
  const list = $("tinfoList");
  list.dataset.open = list.dataset.open === "1" ? "" : "1";
  infoKey = "";
  drawTargetInfo(state);
});

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
  const region = [...REGIONS, ...Object.values(SERVER_REGIONS)].find(r => r.key === rowEl.dataset.key);
  const row = region ? rowFor(region) : null;
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
  const row = rowFor(region);
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
  updateReportEntry($("reportBtn"), s, window.msOpenReport, t("report_prefill"));
  const v = s.verdict;
  const dot = $("vDot"), title = $("vTitle"), sub = $("vSub");
  if (!v) { dot.className = "dot"; title.textContent = t("v_wait"); sub.textContent = ""; return; }
  if (TOPIC && D.kind === "country") {
    const rows = s.rows.filter(r => r && r.state !== "pending"), answered = rows.filter(r => r && r.rcv > 0).length;
    if (s.partial) {
      dot.className = "dot";
      title.textContent = t("v_partial", { a: answered, b: rows.length });
      sub.textContent = t("vs_partial");
      return;
    }
    if (s.gpError) {
      // the same messages as the home page: no allowance, Globalping unreachable, or its own error
      dot.className = "dot warn";
      title.textContent = t("cr_fail");
      sub.textContent = s.gpError === "429" ? quotaText()
        : t(s.gpError === "unreach" ? "gp_unreach" : "gp_err", { min: Math.ceil((s.gpReset || 3600) / 60), msg: s.gpMsg || "" });
      return;
    }
    const allGone = rows.length > 0 && rows.every(r => r.state === "failed" || r.state === "priv");
    const noProbe = rows.length > 0 && rows.every(r => r.state === "noprobe");
    const key = !rows.length ? "cr_none" : noProbe ? "cr_noprobe" : allGone ? "cr_fail"
      : answered === rows.length ? "cr_ok" : answered ? "cr_some" : "cr_none";
    dot.className = "dot " + (key === "cr_ok" ? "ok" : key === "cr_some" ? "warn" : "bad");
    title.textContent = t(key, { n: rows.length, ok: answered });
    sub.textContent = "";
    return;
  }
  // a partial result is neutral, not a failure: the probes that did not answer are marked, the rest is real
  const cls = { ok: "ok", probe: "ok", loss: "warn", some: "warn", none: "bad", dns: "bad", priv: "bad", err: "warn", partial: "idle", tokyo: "warn" }[v.k] || "warn";
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
    if (s.gpError === "429") return quotaText();
    return t(s.gpError === "unreach" ? "gp_unreach" : "gp_err", { min: Math.ceil((s.gpReset || 3600) / 60), msg: s.gpMsg || "" });
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
  updateReportEntry($("reportBtn"), s, window.msOpenReport, t("report_prefill"));
  const replied = s.tokyoOnly ? (s.servers || []).map(x => x.row).filter(r => r && r.rcv > 0) : s.rows.filter(r => r && r.rcv > 0 && Number.isFinite(r.median));
  if (!replied.length) {
    $("kMedian").textContent = "—"; $("kJitter").textContent = "—"; $("kJitterWho").textContent = ""; $("kLoss").textContent = "—";
    return;
  }
  const gm = median(replied.map(r => r.median));
  const j = replied.filter(r => Number.isFinite(r.jitter)).sort((a, b) => b.jitter - a.jitter)[0];
  const sent = replied.length * PACKETS, got = replied.reduce((n, r) => n + r.rcv, 0);
  $("kMedian").innerHTML = `${fmtMs(gm, D.lang)} <small>ms</small>`;
  $("kJitter").innerHTML = j ? `±${fmtMs(j.jitter, D.lang)} <small>ms</small>` : "—";
  $("kJitterWho").textContent = j && !s.tokyoOnly ? rowName(j) : "";
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
    if (f.k === "fd_loss") vars.pct = fmtPct(f.pct / 100, D.lang, 1);
    if (Number.isFinite(vars.ours)) vars.ours = fmtMs(vars.ours, D.lang);
    if (Number.isFinite(vars.theirs)) vars.theirs = fmtMs(vars.theirs, D.lang);
    const lk = links[f.k];
    return `<li><span>${esc(t(f.k, vars))}</span>${lk ? toolLink(lk[0], lk[1]) : ""}</li>`;
  }).join("");
}

function canShare(s) {
  if (TOPIC) return false;   // a country or continent result is not encoded into a link
  if (!s || !s.verdict) return false;
  if (s.verdict.k === "err" || s.verdict.k === "partial") return false;
  return s.rows.some(r => r && r.rcv > 0) || (s.servers || []).some(x => x.row && x.row.rcv > 0);
}

// ---------- share: the result in a link, and the card ----------
async function resultLink(s) {
  const code = { t: s.tg.host, f: s.tg.family || +s.ipv || 4, ts: s.ts, k: s.verdict.k, a: s.verdict.a, b: s.verdict.b,
    r: s.rows.filter(r => r && r.state !== "pending" && r.state !== "noprobe").map(rowToCode),
    w: (s.servers || []).filter(x => x.row).map(x => [x.key, x.row.resolved || "",
      x.row.rtts.map(v => (Number.isFinite(v) ? Math.round(v * 10) : 0)), x.row.ttls.map(v => (Number.isFinite(v) ? v : 0))]) };
  return `${location.origin}${D.paths[D.lang]}r/${await encodeResult(code)}`;
}
$("shareBtn").addEventListener("click", async () => {
  const s = state; if (!s) return;
  const link = await resultLink(s);
  const mod = await import("/assets/share/share.js?v=11").catch(() => null);
  if (!mod) { window.msShareDown && window.msShareDown(); return; }
  const { share } = mod;
  const v = { title: t(s.verdict.k === "tokyo" ? "v_tokyo" : "v_" + s.verdict.k, { a: s.verdict.a, b: s.verdict.b }), k: s.verdict.k };
  const rows = s.rows.filter(r => r && r.rcv > 0);
  const servers = (s.servers || []).filter(x => x.row && x.row.rcv > 0).map(x => ({ key: x.key, row: x.row }));
  share({
    lang: D.lang, name: t("app_name"), file: "global-ping", show: [], never: ["ip"], canShow: false,
    link: () => link, home: location.origin + D.paths[D.lang],
    text: () => `${v.title} · ${s.tg.host}`,
    height: (ctx, kit) => cardLayout(ctx, kit, v, s.tg.host, rows, servers, s).H,
    ts: s.ts,
    foot: () => [t(s.tokyoOnly ? "card_src_own" : "card_src")],
    draw: (ctx, kit) => drawCard(ctx, kit, v, s, rows, servers),
  }).open();
});

const ROWH = 44;
function cardLayout(ctx, kit, v, target, rows, servers, s) {
  const { W, P, F, fit, wrap } = kit, w = W - P * 2;
  let ts = fit(ctx, v.title, w, 46, 34), lines = [v.title];
  if (ctx.measureText(v.title).width > w) { ts = 38; ctx.font = `700 ${ts}px ${F}`; lines = wrap(ctx, v.title, w, 2); }
  const tY = kit.top + 14;
  const targetY = tY + (lines.length - 1) * Math.round(ts * 1.2) + 48;
  const numY = targetY + 62;
  const cells = rows.length + servers.length;
  // Long languages (German, Russian) have region names too wide for a third of the card. The contract says add rows,
  // not shrink the text or cut names, so measure and drop to two columns when three cannot hold every name at 16px.
  // A server row also carries its "not in the 16" label, so its name needs that much less room than a region's.
  ctx.font = `500 15px ${F}`;
  const ownW = ctx.measureText(t("card_own")).width + 8;
  const fits = cols => {
    const avail = w / cols - 150;
    ctx.font = `500 16px ${F}`;
    return rows.every(r => ctx.measureText(nameOf(r.region)).width <= avail)
      && servers.every(sv => ctx.measureText(t("srv_" + sv.key)).width + ownW <= avail);
  };
  const cols = fits(3) ? 3 : 2;
  const gridY = numY + 78;
  const gridRows = Math.ceil(cells / cols);
  return { lines, ts, tY, targetY, numY, gridY, cells, cols, gridRows, H: gridY + gridRows * ROWH + 74 };
}
function drawCard(ctx, kit, v, s, rows, servers) {
  const { P, W, F, M, v: css, fit } = kit, w = W - P * 2;
  const L2 = cardLayout(ctx, kit, v, s.tg.host, rows, servers, s);
  const cls = v.k === "ok" || v.k === "probe" ? "ok" : v.k === "loss" || v.k === "some" || v.k === "partial" ? "warn" : "bad";
  ctx.fillStyle = css(cls); ctx.font = `700 ${L2.ts}px ${F}`;
  L2.lines.forEach((line, i) => ctx.fillText(line, P, L2.tY + i * Math.round(L2.ts * 1.2)));
  // the target must stay complete: shrink the font, never clip it. The count label shares that line, so reserve its width.
  // A server-only card has no regions, so it prints no count instead of "0 regions"; its numbers come from the four
  // servers that actually ran.
  const meta = rows.length ? t("card_meta", { n: rows.length }) : "";
  ctx.font = `400 22px ${F}`;
  const metaW = meta ? ctx.measureText(meta).width : 0;
  const tsz = fit(ctx, s.tg.host, w - metaW - 40, 30, 20, 600);
  ctx.fillStyle = css("fg"); ctx.font = `600 ${tsz}px ${F}`; ctx.fillText(s.tg.host, P, L2.targetY);
  if (meta) {
    ctx.textAlign = "right"; ctx.fillStyle = css("muted"); ctx.font = `400 22px ${F}`;
    ctx.fillText(meta, W - P, L2.targetY); ctx.textAlign = "left";
  }
  // three big numbers; the jitter one names the region under the value
  const pool = rows.length ? rows : servers.map(x => x.row);
  const gm = median(pool.filter(r => Number.isFinite(r.median)).map(r => r.median));
  const j = pool.filter(r => Number.isFinite(r.jitter)).sort((a, b) => b.jitter - a.jitter)[0];
  const sent = pool.length * PACKETS, got = pool.reduce((n, r) => n + r.rcv, 0);
  const vals = [[t("k_median"), Number.isFinite(gm) ? fmtMs(gm, D.lang) + " ms" : "—", ""],
    [t("k_max_jitter"), j ? "±" + fmtMs(j.jitter, D.lang) + " ms" : "—", j && !s.tokyoOnly ? nameOf(j.region) : ""],
    [t("k_loss"), pool.length ? fmtPct((sent - got) / sent, D.lang, sent - got ? 1 : 0) : "—", ""]];
  vals.forEach(([label, val, who], i) => {
    const x = P + i * (w / 3);
    ctx.fillStyle = css("muted"); ctx.font = `500 20px ${F}`; ctx.fillText(label, x, L2.numY - 18);
    ctx.fillStyle = css("fg"); ctx.font = `700 38px ${F}`; ctx.fillText(val, x, L2.numY + 22);
    if (who) { ctx.fillStyle = css("muted"); ctx.font = `500 15px ${F}`; ctx.fillText(who, x, L2.numY + 54); }
  });
  // The regions: status dot, the page's name, and the median coloured on the page's latency scale (so fast/slow and
  // up/down are two separate dimensions); a lossy region keeps its latency and adds rcv/16 instead of replacing it.
  const latColor = n => Number.isFinite(n) ? (css("lat-" + latencyBand(n)) || css("fg")) : css("muted");
  ctx.font = `500 15px ${F}`;
  const ownW = ctx.measureText(t("card_own")).width + 8;
  const cell = (i, name, row, own) => {
    const cw = w / L2.cols, x = P + (i % L2.cols) * cw, y = L2.gridY + Math.floor(i / L2.cols) * ROWH;
    const colr = !row || row.rcv === 0 ? "bad" : row.rcv < PACKETS || row.state === "loss" ? "warn" : "ok";
    ctx.fillStyle = css(colr); ctx.beginPath(); ctx.arc(x + 5, y - 9, 5, 0, Math.PI * 2); ctx.fill();
    // leave room for the latency and, on a server row, for the label between the name and it
    const room = cw - 132 - (own ? ownW : 0);
    ctx.fillStyle = css("fg"); fit(ctx, name, room, 20, 14, 500);
    ctx.fillText(name, x + 20, y);
    if (own) {
      const nw = ctx.measureText(name).width;
      ctx.fillStyle = css("muted"); ctx.font = `500 15px ${F}`;
      ctx.fillText(t("card_own"), x + 20 + nw + 8, y);
    }
    ctx.textAlign = "right";
    const rx = x + cw - 26;
    if (!row || row.rcv === 0) {
      ctx.fillStyle = css("muted"); ctx.font = `500 19px ${M}`; ctx.fillText("—", rx, y);
    } else if (row.rcv < PACKETS) {
      ctx.font = `500 16px ${M}`; ctx.fillStyle = css("muted");
      const tail = ` · ${row.rcv}/${PACKETS}`; const tw = ctx.measureText(tail).width;
      ctx.fillText(tail, rx, y);
      ctx.font = `500 19px ${M}`; ctx.fillStyle = latColor(row.median);
      ctx.fillText(fmtMs(row.median, D.lang) + " ms", rx - tw, y);
    } else {
      ctx.font = `500 19px ${M}`; ctx.fillStyle = latColor(row.median);
      ctx.fillText(fmtMs(row.median, D.lang) + " ms", rx, y);
    }
    ctx.textAlign = "left";
  };
  rows.forEach((row, i) => cell(i, nameOf(row.region), row, false));
  servers.forEach((srv, i) => cell(rows.length + i, t("srv_" + srv.key), srv.row, true));
}

// ---------- someone else's shared result, and ?t= prefills ----------
function decodeRows(o) {
  const rows = (o.r || []).map(arr => {
    const row = codeToRow(arr, REGIONS); if (!row) return null;
    const got = row.rtts.filter(Number.isFinite);
    row.median = median(got); row.jitter = stdev(got);
    return row;
  }).filter(Boolean);
  const servers = [];
  const addServer = (key, resolved, rawRtts, rawTtls) => {
    const region = SERVER_REGIONS[key]; if (!region) return;
    const rtts = (rawRtts || []).map(v => (v > 0 ? v / 10 : null)), ttls = (rawTtls || []).map(v => (v > 0 ? v : null));
    while (rtts.length < PACKETS) rtts.push(null); while (ttls.length < PACKETS) ttls.push(null);
    const row = { region, own: true, resolved: resolved || "", probe: { city: region.city || "", country: region.cc || "", asn: 0, network: "" },
      rtts, ttls, rcv: rtts.filter(Number.isFinite).length, median: null, jitter: null, loss: 0, state: "ok", posUnknown: false };
    row.median = median(rtts); row.jitter = stdev(rtts);
    row.loss = (PACKETS - row.rcv) / PACKETS; row.state = row.rcv === 0 ? "none" : row.rcv < PACKETS ? "loss" : "ok";
    servers.push({ key, row });
  };
  if (Array.isArray(o.w)) for (const a of o.w) if (Array.isArray(a)) addServer(a[0], a[1], a[2], a[3]);
  else if (Array.isArray(o.y)) addServer("tokyo", o.y[0], o.y[1], o.y[2]);   // links from before the second server
  return { rows, servers };
}
const sp = sharePath(location.pathname);
if (sp) {
  decodeResult(sp.code).then(async o => {
    if (!o) return;
    const { rows, servers } = decodeRows(o);
    state = { id: ++run, tg: { host: o.t, family: o.f || 4, isIp: familyOf(o.t) != null }, ts: o.ts || Date.now(),
      rows: REGIONS.map(r => rows.find(x => x.region.key === r.key) || { region: r, state: "noprobe" }),
      servers: SERVERS.map(s => { const hit = servers.find(x => x.key === s.key); return { key: s.key, api: s.api, row: hit ? hit.row : null, error: hit ? "" : "down", retry: 0 }; }),
      gpDone: true, gpError: "", partial: false, verdict: { k: o.k, a: o.a ?? 0, b: o.b ?? 0 }, findings: [],
      tokyoOnly: !rows.length && servers.length > 0 };
    $("target").value = o.t; $("ipvWrap").hidden = false; $("ipv").value = String(o.f || 4);
    $("verdict").hidden = $("table").hidden = false; $("shareBtn").hidden = false;
    if (state.tokyoOnly) { $("regions").hidden = true; }
    buildRows(state); renderRows(state); renderServers(state); drawVerdict(state); drawKpis(state);
    state.findings = findings(state.rows, state.servers.find(x => x.key === "tokyo")?.row || null); drawFindings(state);
    $("gpProgress").textContent = state.tokyoOnly ? "" : t("prog", { done: state.rows.filter(r => r && r.state !== "pending").length, of: REGIONS.length });
    $("tokyoFallback").hidden = true;
    const { received } = await import("/assets/share/share.js?v=11");
    recv = received({ lang: D.lang, ts: state.ts, at: $("verdict"), test: () => start() });
  }).catch(() => {
    $("verdict").hidden = false;
    $("vDot").className = "dot warn"; $("vTitle").textContent = t("v_oldbrowser"); $("vSub").textContent = t("v_oldbrowser_sub");
  });
} else {
  const q = new URLSearchParams(location.search);
  if (q.get("t")) { $("target").value = q.get("t"); $("target").dispatchEvent(new Event("input")); }
}

// Our four servers, without the worldwide view: the quota gate (Globalping cannot pay for this test) and the fallback
// button after a failed test. Only what ran here reaches the rows, the numbers and the share card.
async function runOursOnly(quotaShort) {
  if (!WITH_SERVERS) return;
  const tg = normalizeField();
  if (tg.error) { note(tg.error === "private" ? "bad_private" : "bad_target"); $("target").focus(); return; }
  note("");
  const id = ++run;
  if (recv) { recv.remove(); recv = null; }
  state = { id, tg, ipv: $("ipv").value, rows: REGIONS.map(() => null),
    servers: SERVERS.map(s => ({ key: s.key, api: s.api, row: null, error: "", retry: 0 })),
    gpDone: true, gpError: "", partial: false,
    ts: Date.now(), verdict: { k: "tokyo", a: 0, b: 0 }, findings: [], tokyoOnly: true };
  if (sharePath(location.pathname)) history.replaceState(null, "", D.paths[D.lang]);
  $("verdict").hidden = false; $("table").hidden = false; $("shareBtn").hidden = true; $("tokyoFallback").hidden = true;
  // no worldwide rows and no progress line; the quota line stands in for the block that did not run
  $("regions").hidden = true;
  $("gpProgress").textContent = "";
  tokyoNoteShow("");
  noteShow(quotaShort ? t("quota_servers", { min: Math.ceil((quotaReset || 3600) / 60) }) : "");
  $("kpis").hidden = true;
  buildRows(state); renderRows(state); drawVerdict(state);
  await runServers(state);
  if (state.id !== id) return;
  if (!state.servers.some(x => x.row)) {
    $("vDot").className = "dot warn";
    $("vTitle").textContent = t("t_down");
    $("vSub").textContent = "";
    $("gpProgress").textContent = "";
    setGo(false);
    return;
  }
  drawKpis(state); $("kpis").hidden = false;
  $("shareBtn").hidden = !canShare(state);
  setGo(false);
}
$("tokyoBtn").addEventListener("click", () => runOursOnly(false));

window.msReport = () => state && state.verdict ? {
  summary: `${t(state.verdict.k === "tokyo" ? "v_tokyo" : "v_" + state.verdict.k, { a: state.verdict.a, b: state.verdict.b })} · ${state.tg.host}`,
  data: { target: state.tg.host, family: state.tg.family, verdict: state.verdict,
    rows: state.rows.filter(r => r && r.state !== "pending" && r.state !== "noprobe").map(r => ({ region: r.region.key, resolved: r.resolved, rcv: r.rcv, median: r.median, jitter: r.jitter, loss: r.loss })),
    servers: (state.servers || []).filter(x => x.row).map(x => ({ key: x.key, resolved: x.row.resolved, rcv: x.row.rcv, median: x.row.median })) },
  picks: state.rows.filter(r => r && r.rcv < PACKETS).slice(0, 8).map(r => `${nameOf(r.region)}: ${r.rcv}/16`),
} : null;

// under "from here": the visitor's target, and the allowance they have this hour. Read it again when the page comes
// back from the back/forward cache or the tab becomes visible, so a page does not act on an hour-old number.
loadQuota();
addEventListener("pageshow", e => { if (e.persisted) loadQuota(true); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadQuota(true); });
})();
