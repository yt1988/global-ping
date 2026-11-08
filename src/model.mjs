// The measurement model, shared by the page, the Worker and the tests. Pure: no DOM, no fetch.
//
// It holds the 18 regions (the same set Reach Check uses, so the two tools' numbers line up), turns one Globalping
// ping result into one row (16 slots, median, jitter, loss, and — when the probe's raw output lets us — where the
// missing packets were), and turns the rows into a verdict plus at most four findings. The page and a shared result
// link run the same code, so a link shows what the page showed.

export const PACKETS = 16;

// g groups the filters. carrier: a mainland China ASN, named per language. city: the probe's city, named per language.
export const REGIONS = [
  { key: "cn:4134", g: "cn", cc: "CN", carrier: 4134, loc: { country: "CN", asn: 4134 } },
  { key: "cn:4837", g: "cn", cc: "CN", carrier: 4837, loc: { country: "CN", asn: 4837 } },
  { key: "cn:9808", g: "cn", cc: "CN", carrier: 9808, loc: { country: "CN", asn: 9808 } },
  { key: "hk", g: "apac", cc: "HK", loc: { country: "HK" } },
  { key: "tw", g: "apac", cc: "TW", loc: { country: "TW" } },
  { key: "jp:tokyo", g: "apac", cc: "JP", city: "Tokyo", loc: { city: "Tokyo" } },
  { key: "kr", g: "apac", cc: "KR", loc: { country: "KR" } },
  { key: "sg", g: "apac", cc: "SG", loc: { country: "SG" } },
  { key: "in", g: "apac", cc: "IN", loc: { country: "IN" } },
  { key: "au", g: "apac", cc: "AU", loc: { country: "AU" } },
  { key: "gb:london", g: "emea", cc: "GB", city: "London", loc: { city: "London" } },
  { key: "de:frankfurt", g: "emea", cc: "DE", city: "Frankfurt", loc: { city: "Frankfurt" } },
  { key: "ru", g: "emea", cc: "RU", loc: { country: "RU" } },
  { key: "ae", g: "emea", cc: "AE", loc: { country: "AE" } },
  { key: "za", g: "emea", cc: "ZA", loc: { country: "ZA" } },
  { key: "us:losangeles", g: "am", cc: "US", city: "LosAngeles", loc: { city: "Los Angeles" } },
  { key: "us:newyork", g: "am", cc: "US", city: "NewYork", loc: { city: "New York" } },
  { key: "br:saopaulo", g: "am", cc: "BR", city: "SaoPaulo", loc: { city: "Sao Paulo" } },
];

// Our own server in Tokyo: the second view. It is not one of the 18, and its numbers never enter the global verdict.
export const TOKYO_REGION = { key: "tokyo:ours", g: "tokyo", cc: "JP", city: "Tokyo" };

// Taiwan's name is written out per language (the tool contract's rule), never taken from Intl.
export const TW = { "zh-CN": "中国台湾", "zh-TW": "中國台灣", en: "Taiwan, China", ja: "中国台湾", ko: "중국 대만",
  es: "Taiwán, China", fr: "Taïwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "Тайвань, Китай" };
export const twName = lang => TW[lang] || TW.en;
export const flagCode = cc => (cc === "TW" ? "cn" : String(cc).toLowerCase());

// A country's name in the visitor's language; Taiwan is the exception above. (The page shows short names.)
export function countryName(cc, lang) {
  if (cc === "TW") return twName(lang);
  try { return new Intl.DisplayNames([lang], { type: "region", style: "short" }).of(cc); } catch { return cc; }
}

export const median = nums => {
  const a = nums.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
export const stdev = nums => {
  const a = nums.filter(Number.isFinite);
  if (a.length < 2) return null;
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
};

// The seq → reply map from a probe's raw `ping` output. Linux prints `icmp_seq=N ... ttl=N ... time=N ms`; some
// probes' ping prints `seq=N`. Null when nothing could be read, so the caller never invents a loss position.
export function parseRaw(raw) {
  if (typeof raw !== "string" || !raw) return null;
  const out = new Map();
  const re = /(?:icmp_)?seq=(\d+)[^\n]*?\bttl=(\d+)[^\n]*?\btime=([\d.]+)/g;
  let m;
  while ((m = re.exec(raw))) out.set(+m[1], { rtt: +m[3], ttl: +m[2] });
  return out.size ? out : null;
}

// Places replies into slots 1..16. With the raw output the positions are real; without it they are reply order and
// `posUnknown` is true (the page then says the loss position is unknown instead of drawing a made-up one).
export function slots(timings, raw) {
  const T = (timings || []).filter(t => t && Number.isFinite(t.rtt));
  const rtts = Array(PACKETS).fill(null), ttls = Array(PACKETS).fill(null);
  const p = parseRaw(raw);
  let placed = false;
  if (p && p.size === T.length && p.size > 0) {
    let bad = false;
    for (const [seq, v] of p) {
      if (seq < 1 || seq > PACKETS) { bad = true; break; }
      rtts[seq - 1] = v.rtt; ttls[seq - 1] = v.ttl;
    }
    placed = !bad && rtts.filter(Number.isFinite).length === T.length;
  }
  if (!placed) T.forEach((t, i) => { rtts[i] = t.rtt; ttls[i] = Number.isFinite(t.ttl) ? t.ttl : null; });
  return { rtts, ttls, placed };
}

const blank = region => ({ region, resolved: "", probe: null, rtts: Array(PACKETS).fill(null), ttls: Array(PACKETS).fill(null),
  rcv: 0, median: null, jitter: null, loss: 0, state: "pending", posUnknown: false, reason: "" });

const settle = row => {
  const got = row.rtts.filter(Number.isFinite);
  row.rcv = got.length;
  row.median = median(got);
  row.jitter = stdev(got);
  row.loss = (PACKETS - row.rcv) / PACKETS;
  row.state = row.rcv === 0 ? "none" : row.rcv < PACKETS ? "loss" : "ok";
  return row;
};

// One region's row from one Globalping result ({probe, result}); null result means the API returned no probe for it.
export function makeRow(region, res) {
  const row = blank(region);
  if (!res) { row.state = "noprobe"; return row; }
  const pr = res.probe || {}, r = res.result || {};
  row.probe = { city: pr.city || "", country: pr.country || "", asn: pr.asn || 0, network: pr.network || "" };
  row.resolved = r.resolvedAddress || "";
  if (r.status === "failed") {
    const raw = r.rawOutput || "";
    row.reason = /Private IP ranges are not allowed/i.test(raw) ? "priv"
      : /ENOTFOUND|NXDOMAIN|EAI_AGAIN|ENODATA|SERVFAIL|NODATA|Name or service not known|Temporary failure in name resolution|Could not resolve/i.test(raw) ? "dns" : "fail";
    row.state = row.reason === "priv" ? "priv" : "failed";
    return row;
  }
  if (r.status !== "finished" || !r.timings) return row;
  const s = slots(r.timings, r.rawOutput);
  row.rtts = s.rtts; row.ttls = s.ttls; row.posUnknown = !s.placed;
  return settle(row);
}

// Match the results to the regions that were asked for (order is not guaranteed), then build the rows.
export function placeResults(regions, results) {
  const rows = regions.map(() => null), used = new Set();
  const fits = (loc, p) => Object.entries(loc).every(([k, v]) => (k === "city" ? p.city === v : k === "asn" ? p.asn === v : p[k] === v));
  (results || []).forEach((res, i) => {
    let k = regions.findIndex((x, n) => !used.has(n) && n === i && fits(x.loc, res.probe || {}));
    if (k < 0) k = regions.findIndex((x, n) => !used.has(n) && fits(x.loc, res.probe || {}));
    if (k >= 0) { used.add(k); rows[k] = makeRow(regions[k], res); }
  });
  return rows;
}

// Our server in Tokyo's answer ({host, ip, family, timings:[{i,rtt,ttl}]}); positions are always real here.
export function makeTokyoRow(v) {
  const row = blank(TOKYO_REGION);
  row.own = true;
  row.resolved = v.ip || "";
  row.probe = { city: "Tokyo", country: "JP", asn: 0, network: "" };
  (v.timings || []).forEach((t, i) => {
    const idx = t && Number.isInteger(t.i) ? t.i - 1 : i;
    if (idx >= 0 && idx < PACKETS && t && Number.isFinite(t.rtt)) {
      row.rtts[idx] = t.rtt; row.ttls[idx] = Number.isFinite(t.ttl) ? t.ttl : null;
    }
  });
  return settle(row);
}

// The one-sentence verdict. Keys match the i18n v_* strings; a and b are the only two numbers those strings take, so
// the Worker can fill a shared link's title without knowing anything else. `partial`: the 30 s deadline arrived.
export function verdict(rows, { error = "", partial = false } = {}) {
  const n = rows.length;
  if (error) return { k: "err", a: 0, b: n };
  const fin = rows.filter(r => r && r.state !== "pending");
  if (!fin.length) return { k: "err", a: 0, b: n };
  if (partial) return { k: "partial", a: fin.length, b: n };
  const priv = fin.filter(r => r.state === "priv").length;
  const dns = fin.filter(r => r.state === "failed" && r.reason === "dns").length;
  const failed = fin.filter(r => r.state === "failed" || r.state === "priv").length;
  const replied = fin.filter(r => r.rcv > 0);
  if (failed === fin.length) {
    if (priv === fin.length) return { k: "priv", a: priv, b: n };
    if (dns === fin.length) return { k: "dns", a: dns, b: n };
    return { k: "err", a: fin.length, b: n };
  }
  if (!replied.length) return { k: "none", a: 0, b: n };
  if (replied.length < fin.length) return { k: "some", a: fin.length - replied.length, b: n };
  const loss = fin.filter(r => r.rcv > 0 && r.rcv < PACKETS).length;
  if (loss) return { k: "loss", a: loss, b: n };
  const noprobe = rows.filter(r => r && r.state === "noprobe").length;
  if (noprobe) return { k: "probe", a: fin.length, b: noprobe };
  return { k: "ok", a: fin.length, b: n };
}

// At most four findings, most important first; each is a descriptor the page turns into one sentence. Region values
// are REGION objects so the page can name them in the visitor's language.
export function findings(rows, tokyo) {
  const out = [];
  const fin = rows.filter(r => r && r.state !== "pending" && r.state !== "noprobe");
  const none = fin.filter(r => r.rcv === 0);
  if (none.length) out.push({ k: "fd_none", regions: none.slice(0, 3).map(r => r.region), n: none.length });
  const loss = fin.filter(r => r.rcv > 0 && r.rcv < PACKETS);
  if (loss.length) {
    const w = loss.slice().sort((a, b) => b.loss - a.loss)[0];
    out.push({ k: "fd_loss", regions: loss.slice(0, 2).map(r => r.region), n: loss.length, region: w.region,
      lost: PACKETS - w.rcv, pct: Math.round(w.loss * 100) });
  }
  const byKey = Object.fromEntries(fin.map(r => [r.region.key, r]));
  const cn = [4134, 4837, 9808].map(a => byKey["cn:" + a]);
  if (cn.every(Boolean)) {
    const vals = cn.map(r => r.median);
    if (vals.every(Number.isFinite) && Math.max(...vals) - Math.min(...vals) >= 30) {
      out.push({ k: "fd_cn", telecom: cn[0], unicom: cn[1], mobile: cn[2] });
    }
  }
  const replied = fin.filter(r => r.rcv > 0 && Number.isFinite(r.median));
  if (replied.length) {
    const gm = median(replied.map(r => r.median));
    const slow = replied.slice().sort((a, b) => b.median - a.median)[0];
    const fast = replied.slice().sort((a, b) => a.median - b.median)[0];
    if (gm && slow.median >= 2 * gm && slow.median >= 100) {
      out.push({ k: "fd_slow", region: slow.region, ms: slow.median, fast: fast.region, fms: slow.median - fast.median });
    }
    const js = replied.filter(r => Number.isFinite(r.jitter));
    if (js.length >= 2) {
      const maxj = js.slice().sort((a, b) => b.jitter - a.jitter)[0];
      const med = median(js.filter(r => r !== maxj).map(r => r.jitter));
      if (maxj.jitter >= 5 && med > 0 && maxj.jitter >= 3 * med) {
        out.push({ k: "fd_jitter", region: maxj.region, j: maxj.jitter, ratio: Math.round(maxj.jitter / med) });
      }
    }
    const gpTokyo = byKey["jp:tokyo"];
    if (tokyo && tokyo.rcv > 0 && Number.isFinite(tokyo.median) && gpTokyo && gpTokyo.rcv > 0 && Number.isFinite(gpTokyo.median)) {
      const lo = Math.min(tokyo.median, gpTokyo.median);
      if (Math.abs(tokyo.median - gpTokyo.median) >= 20 && Math.abs(tokyo.median - gpTokyo.median) >= 0.5 * lo) {
        out.push({ k: "fd_tokyo", ours: tokyo.median, theirs: gpTokyo.median });
      }
    }
    const ips = new Set(replied.map(r => r.resolved).filter(Boolean));
    if (ips.size >= 2) out.push({ k: "fd_dns_multi", n: replied.length, m: ips.size });
    const stable = fin.length > 0 && fin.every(r => r.state === "ok") && Math.max(...fin.map(r => r.jitter || 0)) < 2;
    if (stable) out.push({ k: "fd_stable", n: fin.length });
  }
  return out.slice(0, 4);
}

// ---------- target input ----------

const v4 = s => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every(x => +x <= 255);
export const familyOf = s => (v4(s) ? 4 : /:/.test(s) && isV6(s) ? 6 : null);
function isV6(s) {
  try { new URL("http://[" + s + "]/"); return true; } catch { return false; }
}

// Private, loopback, link-local, multicast, documentation and this machine's own kinds of address: no probe connects.
export function isPrivateIp(ip) {
  const fam = familyOf(ip);
  if (fam === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0)
      || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (fam === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s)) return true;
    if (/^2001:db8:/.test(s)) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true;
}

// What the visitor typed → {host, family, isIp} or {error: "bad"|"private"}. URLs and ports are stripped: ICMP has
// no port. The same rules are applied again by our Tokyo server.
export function normalizeTarget(raw) {
  let s = String(raw || "").trim();
  if (!s || /\s/.test(s)) return { error: "bad" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try { s = new URL(s).hostname; } catch { return { error: "bad" }; }
  } else {
    s = s.split(/[/?#]/)[0];
    if (s.startsWith("[")) {
      const m = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
      if (!m) return { error: "bad" };
      s = m[1];
    } else if ((s.match(/:/g) || []).length === 1) s = s.replace(/:\d+$/, "");
  }
  s = s.replace(/\.$/, "").toLowerCase();
  if (!s || s.length > 253) return { error: "bad" };
  if (s === "localhost" || s.endsWith(".localhost")) return { error: "bad" };
  const fam = familyOf(s);
  if (fam) return isPrivateIp(s) ? { error: "private" } : { host: s, family: fam, isIp: true };
  if (/[^\x00-\x7f]/.test(s)) { try { s = new URL("https://" + s).hostname; } catch { return { error: "bad" }; } }
  if (!s.includes(".")) return { error: "bad" };
  const labels = s.split(".");
  if (labels.length < 2 || labels.some(l => !l || l.length > 63 || !/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i.test(l))) return { error: "bad" };
  return { host: s, family: null, isIp: false };
}

// Display helpers: 10 ms and below keep one decimal, above it whole milliseconds (187, not 187.4).
export function fmtMs(v, lang) {
  if (!Number.isFinite(v)) return "—";
  const digits = v < 100 ? 1 : 0;
  try { return new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v); }
  catch { return v.toFixed(digits); }
}

// Percentages the local way: comma or point, the space before % where the locale wants one (fr, de, ru), no space in
// en/pt. v is a fraction (0.0067), not a number out of 100.
export function fmtPct(v, lang, digits = 1) {
  if (!Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat(lang, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  } catch { return (v * 100).toFixed(digits) + "%"; }
}
