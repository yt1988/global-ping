(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/model.mjs
  var PACKETS = 16;
  var REGIONS = [
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
    { key: "br:saopaulo", g: "am", cc: "BR", city: "SaoPaulo", loc: { city: "Sao Paulo" } }
  ];
  var TOKYO_REGION = { key: "tokyo:ours", g: "tokyo", cc: "JP", city: "Tokyo" };
  var TW = {
    "zh-CN": "\u4E2D\u56FD\u53F0\u6E7E",
    "zh-TW": "\u4E2D\u570B\u53F0\u7063",
    en: "Taiwan, China",
    ja: "\u4E2D\u56FD\u53F0\u6E7E",
    ko: "\uC911\uAD6D \uB300\uB9CC",
    es: "Taiw\xE1n, China",
    fr: "Ta\xEFwan, Chine",
    de: "Taiwan, China",
    pt: "Taiwan, China",
    ru: "\u0422\u0430\u0439\u0432\u0430\u043D\u044C, \u041A\u0438\u0442\u0430\u0439"
  };
  var twName = (lang) => TW[lang] || TW.en;
  function countryName(cc, lang) {
    if (cc === "TW") return twName(lang);
    try {
      return new Intl.DisplayNames([lang], { type: "region", style: "short" }).of(cc);
    } catch {
      return cc;
    }
  }
  var median = (nums) => {
    const a = nums.filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  var stdev = (nums) => {
    const a = nums.filter(Number.isFinite);
    if (a.length < 2) return null;
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    return Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
  };
  function parseRaw(raw) {
    if (typeof raw !== "string" || !raw) return null;
    const out = /* @__PURE__ */ new Map();
    const re = /(?:icmp_)?seq=(\d+)[^\n]*?\bttl=(\d+)[^\n]*?\btime=([\d.]+)/g;
    let m;
    while (m = re.exec(raw)) out.set(+m[1], { rtt: +m[3], ttl: +m[2] });
    return out.size ? out : null;
  }
  function slots(timings, raw) {
    const T = (timings || []).filter((t) => t && Number.isFinite(t.rtt));
    const rtts = Array(PACKETS).fill(null), ttls = Array(PACKETS).fill(null);
    const p = parseRaw(raw);
    let placed = false;
    if (p && p.size === T.length && p.size > 0) {
      let bad = false;
      for (const [seq, v] of p) {
        if (seq < 1 || seq > PACKETS) {
          bad = true;
          break;
        }
        rtts[seq - 1] = v.rtt;
        ttls[seq - 1] = v.ttl;
      }
      placed = !bad && rtts.filter(Number.isFinite).length === T.length;
    }
    if (!placed) T.forEach((t, i) => {
      rtts[i] = t.rtt;
      ttls[i] = Number.isFinite(t.ttl) ? t.ttl : null;
    });
    return { rtts, ttls, placed };
  }
  var blank = (region) => ({
    region,
    resolved: "",
    probe: null,
    rtts: Array(PACKETS).fill(null),
    ttls: Array(PACKETS).fill(null),
    rcv: 0,
    median: null,
    jitter: null,
    loss: 0,
    state: "pending",
    posUnknown: false,
    reason: ""
  });
  var settle = (row) => {
    const got = row.rtts.filter(Number.isFinite);
    row.rcv = got.length;
    row.median = median(got);
    row.jitter = stdev(got);
    row.loss = (PACKETS - row.rcv) / PACKETS;
    row.state = row.rcv === 0 ? "none" : row.rcv < PACKETS ? "loss" : "ok";
    return row;
  };
  function makeRow(region, res) {
    const row = blank(region);
    if (!res) {
      row.state = "noprobe";
      return row;
    }
    const pr = res.probe || {}, r = res.result || {};
    row.probe = { city: pr.city || "", country: pr.country || "", asn: pr.asn || 0, network: pr.network || "" };
    row.resolved = r.resolvedAddress || "";
    if (r.status === "failed") {
      const raw = r.rawOutput || "";
      row.reason = /Private IP ranges are not allowed/i.test(raw) ? "priv" : /ENOTFOUND|NXDOMAIN|EAI_AGAIN|ENODATA|SERVFAIL|NODATA|Name or service not known|Temporary failure in name resolution|Could not resolve/i.test(raw) ? "dns" : "fail";
      row.state = row.reason === "priv" ? "priv" : "failed";
      return row;
    }
    if (r.status !== "finished" || !r.timings) return row;
    const s = slots(r.timings, r.rawOutput);
    row.rtts = s.rtts;
    row.ttls = s.ttls;
    row.posUnknown = !s.placed;
    return settle(row);
  }
  function placeResults(regions, results) {
    const rows = regions.map(() => null), used = /* @__PURE__ */ new Set();
    const fits = (loc, p) => Object.entries(loc).every(([k, v]) => k === "city" ? p.city === v : k === "asn" ? p.asn === v : p[k] === v);
    (results || []).forEach((res, i) => {
      let k = regions.findIndex((x, n) => !used.has(n) && n === i && fits(x.loc, res.probe || {}));
      if (k < 0) k = regions.findIndex((x, n) => !used.has(n) && fits(x.loc, res.probe || {}));
      if (k >= 0) {
        used.add(k);
        rows[k] = makeRow(regions[k], res);
      }
    });
    return rows;
  }
  function makeTokyoRow(v) {
    const row = blank(TOKYO_REGION);
    row.own = true;
    row.resolved = v.ip || "";
    row.probe = { city: "Tokyo", country: "JP", asn: 0, network: "" };
    (v.timings || []).forEach((t, i) => {
      const idx = t && Number.isInteger(t.i) ? t.i - 1 : i;
      if (idx >= 0 && idx < PACKETS && t && Number.isFinite(t.rtt)) {
        row.rtts[idx] = t.rtt;
        row.ttls[idx] = Number.isFinite(t.ttl) ? t.ttl : null;
      }
    });
    return settle(row);
  }
  function verdict(rows, { error = "", partial = false } = {}) {
    const n = rows.length;
    if (error) return { k: "err", a: 0, b: n };
    const fin = rows.filter((r) => r && r.state !== "pending");
    if (!fin.length) return { k: "err", a: 0, b: n };
    if (partial) return { k: "partial", a: fin.length, b: n };
    const priv = fin.filter((r) => r.state === "priv").length;
    const dns = fin.filter((r) => r.state === "failed" && r.reason === "dns").length;
    const failed = fin.filter((r) => r.state === "failed" || r.state === "priv").length;
    const replied = fin.filter((r) => r.rcv > 0);
    if (failed === fin.length) {
      if (priv === fin.length) return { k: "priv", a: priv, b: n };
      if (dns === fin.length) return { k: "dns", a: dns, b: n };
      return { k: "err", a: fin.length, b: n };
    }
    if (!replied.length) return { k: "none", a: 0, b: n };
    if (replied.length < fin.length) return { k: "some", a: fin.length - replied.length, b: n };
    const loss = fin.filter((r) => r.rcv > 0 && r.rcv < PACKETS).length;
    if (loss) return { k: "loss", a: loss, b: n };
    const noprobe = rows.filter((r) => r && r.state === "noprobe").length;
    if (noprobe) return { k: "probe", a: fin.length, b: noprobe };
    return { k: "ok", a: fin.length, b: n };
  }
  function findings(rows, tokyo) {
    const out = [];
    const fin = rows.filter((r) => r && r.state !== "pending" && r.state !== "noprobe");
    const none = fin.filter((r) => r.rcv === 0);
    if (none.length) out.push({ k: "fd_none", regions: none.slice(0, 3).map((r) => r.region), n: none.length });
    const loss = fin.filter((r) => r.rcv > 0 && r.rcv < PACKETS);
    if (loss.length) {
      const w = loss.slice().sort((a, b) => b.loss - a.loss)[0];
      out.push({
        k: "fd_loss",
        regions: loss.slice(0, 2).map((r) => r.region),
        n: loss.length,
        region: w.region,
        lost: PACKETS - w.rcv,
        pct: Math.round(w.loss * 100)
      });
    }
    const byKey = Object.fromEntries(fin.map((r) => [r.region.key, r]));
    const cn = [4134, 4837, 9808].map((a) => byKey["cn:" + a]);
    if (cn.every(Boolean)) {
      const vals = cn.map((r) => r.median);
      if (vals.every(Number.isFinite) && Math.max(...vals) - Math.min(...vals) >= 30) {
        out.push({ k: "fd_cn", telecom: cn[0], unicom: cn[1], mobile: cn[2] });
      }
    }
    const replied = fin.filter((r) => r.rcv > 0 && Number.isFinite(r.median));
    if (replied.length) {
      const gm = median(replied.map((r) => r.median));
      const slow = replied.slice().sort((a, b) => b.median - a.median)[0];
      const fast = replied.slice().sort((a, b) => a.median - b.median)[0];
      if (gm && slow.median >= 2 * gm && slow.median >= 100) {
        out.push({ k: "fd_slow", region: slow.region, ms: slow.median, fast: fast.region, fms: fast.median });
      }
      const js = replied.filter((r) => Number.isFinite(r.jitter));
      if (js.length >= 2) {
        const maxj = js.slice().sort((a, b) => b.jitter - a.jitter)[0];
        const med = median(js.filter((r) => r !== maxj).map((r) => r.jitter));
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
      const ips = new Set(replied.map((r) => r.resolved).filter(Boolean));
      if (ips.size >= 2) out.push({ k: "fd_dns_multi", n: replied.length, m: ips.size });
      const stable = fin.length > 0 && fin.every((r) => r.state === "ok") && Math.max(...fin.map((r) => r.jitter || 0)) < 2;
      if (stable) out.push({ k: "fd_stable", n: fin.length });
    }
    return out.slice(0, 4);
  }
  var v4 = (s) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((x) => +x <= 255);
  var familyOf = (s) => v4(s) ? 4 : /:/.test(s) && isV6(s) ? 6 : null;
  function isV6(s) {
    try {
      new URL("http://[" + s + "]/");
      return true;
    } catch {
      return false;
    }
  }
  function isPrivateIp(ip) {
    const fam = familyOf(ip);
    if (fam === 4) {
      const [a, b, c] = ip.split(".").map(Number);
      return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 192 && b === 0 && c === 0 || a === 198 && (b === 18 || b === 19) || a >= 224;
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
  function normalizeTarget(raw) {
    let s = String(raw || "").trim();
    if (!s || /\s/.test(s)) return { error: "bad" };
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      try {
        s = new URL(s).hostname;
      } catch {
        return { error: "bad" };
      }
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
    if (/[^\x00-\x7f]/.test(s)) {
      try {
        s = new URL("https://" + s).hostname;
      } catch {
        return { error: "bad" };
      }
    }
    if (!s.includes(".")) return { error: "bad" };
    const labels = s.split(".");
    if (labels.length < 2 || labels.some((l) => !l || l.length > 63 || !/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i.test(l))) return { error: "bad" };
    return { host: s, family: null, isIp: false };
  }
  function fmtMs(v, lang) {
    if (!Number.isFinite(v)) return "\u2014";
    const digits = v < 100 ? 1 : 0;
    try {
      return new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    } catch {
      return v.toFixed(digits);
    }
  }

  // public/assets/share/codec.js
  var CodecError = class extends Error {
    constructor(reason) {
      super(`codec: ${reason}`);
      this.name = "CodecError";
      this.reason = reason;
    }
  };
  var hasStream = (name) => typeof globalThis[name] === "function";
  var tryFormat = (Ctor) => {
    try {
      new Ctor("deflate-raw");
      return true;
    } catch (e) {
      return false;
    }
  };
  var deflateOk;
  var inflateOk;
  var canDeflate = () => deflateOk !== void 0 ? deflateOk : deflateOk = hasStream("CompressionStream") && tryFormat(globalThis.CompressionStream);
  var canInflate = () => inflateOk !== void 0 ? inflateOk : inflateOk = hasStream("DecompressionStream") && tryFormat(globalThis.DecompressionStream);
  var utf8 = (s) => new TextEncoder().encode(s);
  var text = (b) => new TextDecoder().decode(b);
  function b64u(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(str) {
    if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new CodecError("base64");
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  async function pipe(bytes, stream) {
    const out = stream.readable;
    const w = stream.writable.getWriter();
    w.write(bytes).catch(() => {
    });
    w.close().catch(() => {
    });
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function pack(str) {
    const raw = utf8(str);
    if (canDeflate()) {
      try {
        return "z" + b64u(await pipe(raw, new CompressionStream("deflate-raw")));
      } catch (e) {
      }
    }
    return "u" + b64u(raw);
  }
  async function unpack(code, opts) {
    const legacy = !!(opts && opts.legacy);
    const s = String(code || "");
    const kind = legacy ? "z" : s.charAt(0);
    const body = legacy ? s : s.slice(1);
    if (kind === "u") return text(unb64u(body));
    if (kind !== "z") throw new CodecError("format");
    if (!canInflate()) throw new CodecError("inflate");
    try {
      return text(await pipe(unb64u(body), new DecompressionStream("deflate-raw")));
    } catch (e) {
      throw e instanceof CodecError ? e : new CodecError("corrupt");
    }
  }

  // src/code.mjs
  var CODE_VERSION = "1";
  async function encodeResult(obj) {
    return CODE_VERSION + "~" + await pack(JSON.stringify(obj));
  }
  async function decodeResult(code) {
    const m = /^1~([A-Za-z0-9_-]{8,16000})$/.exec(code || "");
    if (!m) return null;
    let text2;
    try {
      text2 = await unpack(m[1]);
    } catch (e) {
      if (e instanceof CodecError && e.reason === "inflate") throw e;
      return null;
    }
    try {
      const r = JSON.parse(text2);
      if (!r || typeof r.t !== "string" || typeof r.k !== "string" || !Array.isArray(r.r) || r.r.length > 18) return null;
      return r;
    } catch (e) {
      return null;
    }
  }
  function sharePath(path) {
    const m = /^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?r\/([^/]+)$/.exec(path);
    return m ? { slug: m[1] || "", code: m[2] } : null;
  }
  var rowToCode = (row) => {
    var _a, _b, _c;
    return [
      row.region.key,
      row.resolved || "",
      ((_a = row.probe) == null ? void 0 : _a.asn) || 0,
      ((_b = row.probe) == null ? void 0 : _b.network) || "",
      ((_c = row.probe) == null ? void 0 : _c.city) || "",
      row.rtts.map((v) => Number.isFinite(v) ? Math.round(v * 10) : 0),
      row.ttls.map((v) => Number.isFinite(v) ? v : 0)
    ];
  };
  var codeToRow = (arr, regions) => {
    const region = regions.find((r) => r.key === arr[0]);
    if (!region) return null;
    const rtts = (arr[5] || []).slice(0, 16).map((v) => v > 0 ? v / 10 : null);
    const ttls = (arr[6] || []).slice(0, 16).map((v) => v > 0 ? v : null);
    while (rtts.length < 16) rtts.push(null);
    while (ttls.length < 16) ttls.push(null);
    const got = rtts.filter(Number.isFinite);
    return {
      region,
      resolved: arr[1] || "",
      probe: { asn: arr[2] || 0, network: arr[3] || "", city: arr[4] || "", country: region.cc },
      rtts,
      ttls,
      rcv: got.length,
      median: null,
      jitter: null,
      loss: (16 - got.length) / 16,
      state: got.length === 0 ? "none" : got.length < 16 ? "loss" : "ok",
      posUnknown: false,
      reason: ""
    };
  };

  // src/app.js
  (() => {
    const GP = "https://api.globalping.io/v1";
    const API = "https://ping-api.1ms.dog:2097/v1/ping";
    const L = window.L1MS || {}, D = JSON.parse(document.getElementById("data").textContent);
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s != null ? s : "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const t = (k, v) => {
      var _a;
      let s = (_a = L[k]) != null ? _a : k;
      if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]);
      return s;
    };
    const PR = new Intl.PluralRules(D.lang), pk = (k) => `${k}_${PR.select(1)}` in L ? `${k}_${PR.select(1)}` : k;
    const pkOf = (k, n) => {
      const key = `${k}_${PR.select(n)}`;
      return key in L ? key : k;
    };
    const store = { get(k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    }, set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {
      }
    } };
    const K = { theme: "globalping:theme", lang: "globalping:lang" };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const TH = ["system", "light", "dark"], thBtn = $("theme");
    const applyTheme = (th) => {
      if (th === "system") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", th);
      thBtn.dataset.th = th;
      thBtn.title = t("th_" + th);
      thBtn.setAttribute("aria-label", t("th_" + th));
    };
    applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
    thBtn.onclick = () => {
      const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3];
      store.set(K.theme, n);
      applyTheme(n);
    };
    $("lang").onchange = (e) => {
      const l = e.target.value;
      store.set(K.lang, l);
      location.href = D.paths[l] + location.search;
    };
    const tool = (id) => {
      const m = document.querySelector(`meta[name="${id}"]`);
      return m && m.content ? m.content.replace(/\/+$/, "") + D.paths[D.lang] : "";
    };
    const EXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
    const toolLink = (id, key) => {
      const u = tool(id);
      return u ? `<a class="ext" href="${esc(u)}" target="_blank" rel="noopener">${esc(t(key))}${EXT}</a>` : "";
    };
    const asnLink = (ip) => {
      const u = tool("asn");
      return u ? `<a class="dv" href="${esc(u)}ip/${esc(ip)}" target="_blank" rel="noopener" style="text-decoration:underline dotted;color:inherit" title="${esc(t("lk_asn"))}">${esc(ip)}</a>` : esc(ip);
    };
    const all = (s) => [...document.querySelectorAll(s)];
    const openDlg = (id) => {
      $(id).hidden = false;
      document.documentElement.style.overflow = "hidden";
      $(id).querySelector("[data-close]").focus();
    };
    const closeDlg = () => {
      all(".scrim").forEach((s) => {
        s.hidden = true;
      });
      document.documentElement.style.overflow = "";
    };
    all("[data-close]").forEach((b) => {
      b.onclick = closeDlg;
    });
    all(".scrim").forEach((s) => s.addEventListener("click", (e) => {
      if (e.target === s) closeDlg();
    }));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDlg();
    });
    let helpIdx = 0;
    const helpQs = all("#helpNav [data-hq]");
    $("helpSel").innerHTML = helpQs.map((b, i) => `<option value="${i}">${i + 1} / ${helpQs.length} \xB7 ${esc(b.textContent)}</option>`).join("");
    const showHelp = (i) => {
      helpIdx = Math.max(0, Math.min(helpQs.length - 1, i));
      helpQs.forEach((b) => b.setAttribute("aria-selected", +b.dataset.hq === helpIdx));
      all("#helpC [data-hqb]").forEach((a) => {
        a.hidden = +a.dataset.hqb !== helpIdx;
      });
      $("helpSel").value = helpIdx;
      all("[data-hstep]").forEach((b) => {
        b.disabled = helpIdx + +b.dataset.hstep < 0 || helpIdx + +b.dataset.hstep >= helpQs.length;
      });
      $("helpC").scrollTop = 0;
    };
    $("helpBtn").onclick = () => {
      showHelp(helpIdx);
      openDlg("help");
    };
    helpQs.forEach((b) => {
      b.onclick = () => showHelp(+b.dataset.hq);
    });
    $("helpSel").onchange = (e) => showHelp(+e.target.value);
    all("[data-hstep]").forEach((b) => {
      b.onclick = () => showHelp(helpIdx + +b.dataset.hstep);
    });
    const nameOf = (region) => {
      if (region.own) return t("t_label");
      if (region.carrier) return t("c_" + region.carrier);
      if (region.city) return `${countryName(region.cc, D.lang)} \xB7 ${t("city_" + region.city)}`;
      return countryName(region.cc, D.lang);
    };
    const cardName = (region) => region.carrier ? t("c_" + region.carrier) : region.city && REGIONS.filter((r) => r.cc === region.cc && !r.carrier).length > 1 ? `${t("city_" + region.city)}, ${region.cc}` : countryName(region.cc, D.lang);
    const COST = REGIONS.length;
    let quotaLeft = null, quotaReset = 0;
    async function loadQuota() {
      $("quota").textContent = t("quota_loading");
      try {
        const j = await (await fetch(GP + "/limits")).json();
        const c = j.rateLimit.measurements.create;
        quotaLeft = c.remaining;
        quotaReset = c.reset;
        showQuota();
      } catch {
        quotaLeft = null;
        $("quota").textContent = t("quota_unknown");
      }
    }
    function showQuota() {
      if (quotaLeft == null) {
        $("quota").textContent = t("quota_unknown");
        return;
      }
      $("quota").textContent = quotaLeft >= COST ? t(pkOf("quota_ok", quotaLeft), { left: quotaLeft, cost: COST }) : t("quota_out", { min: Math.ceil((quotaReset || 3600) / 60) });
    }
    function updateQuota(headers) {
      const left = headers.get("x-ratelimit-remaining"), reset = +headers.get("x-ratelimit-reset");
      if (left != null) {
        quotaLeft = +left;
        if (reset) quotaReset = reset;
        showQuota();
      }
    }
    let state = null, run = 0, recv = null, sortBy = "median", filterGroup = "all";
    let rowEls = /* @__PURE__ */ new Map(), detailEls = /* @__PURE__ */ new Map();
    const setGo = (testing) => {
      const b = $("go");
      b.disabled = testing;
      b.textContent = testing ? t("running") : t(state && state.verdict && !state.tokyoOnly ? "go_again" : "go");
    };
    $("f").addEventListener("submit", (e) => {
      e.preventDefault();
      start();
    });
    function note(k) {
      const el = $("targetNote");
      if (!k) {
        el.hidden = true;
        el.textContent = "";
        return;
      }
      el.hidden = false;
      el.textContent = t(k);
    }
    $("target").addEventListener("input", () => {
      const tg = normalizeTarget($("target").value);
      $("ipvWrap").hidden = !!tg.isIp || !!tg.error;
      note("");
    });
    function start() {
      const raw = $("target").value.trim();
      const tg = normalizeTarget(raw);
      if (tg.error) {
        note(tg.error === "private" ? "bad_private" : "bad_target");
        $("target").focus();
        return;
      }
      note("");
      const id = ++run;
      if (recv) {
        recv.remove();
        recv = null;
      }
      state = {
        id,
        tg,
        ipv: $("ipv").value,
        rows: REGIONS.map(() => null),
        tokyo: null,
        tokyoError: "",
        gpDone: false,
        gpError: "",
        gpMsg: "",
        gpReset: 0,
        partial: false,
        ts: Date.now(),
        verdict: null,
        findings: [],
        tokyoOnly: false
      };
      history.replaceState(null, "", D.paths[D.lang] + (tg.isIp ? "" : "?t=" + encodeURIComponent(tg.host)));
      $("verdict").hidden = false;
      $("table").hidden = false;
      $("shareBtn").hidden = true;
      $("tokyoFallback").hidden = true;
      $("regions").hidden = false;
      $("filters").hidden = false;
      $("sort").closest(".sel").hidden = false;
      $("kpis").hidden = false;
      if (quotaLeft != null) {
        quotaLeft = Math.max(0, quotaLeft - COST);
        showQuota();
      }
      buildRows(state);
      renderRows(state);
      setGo(true);
      drawVerdict(state);
      runGlobalping(state);
      runTokyo(state);
    }
    async function runGlobalping(s) {
      var _a;
      const body = {
        type: "ping",
        target: s.tg.host,
        inProgressUpdates: true,
        locations: REGIONS.map((x) => ({ ...x.loc, limit: 1 })),
        measurementOptions: { protocol: "ICMP", packets: PACKETS, ...s.tg.isIp ? {} : { ipVersion: +s.ipv } }
      };
      let r, j;
      try {
        r = await fetch(GP + "/measurements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        j = await r.json().catch(() => ({}));
      } catch {
        s.gpError = "unreach";
        s.gpDone = true;
        loadQuota();
        return settle2(s);
      }
      const reset = +r.headers.get("x-ratelimit-reset");
      if (reset) s.gpReset = reset;
      updateQuota(r.headers);
      if (r.status === 429) {
        s.gpError = "429";
        s.gpDone = true;
        loadQuota();
        return settle2(s);
      }
      if (!r.ok || !j.id) {
        s.gpError = "err";
        s.gpMsg = ((_a = j == null ? void 0 : j.error) == null ? void 0 : _a.message) || String(r.status);
        s.gpDone = true;
        loadQuota();
        return settle2(s);
      }
      const t0 = Date.now();
      while (s.id === run && Date.now() - t0 < 3e4) {
        await sleep(900);
        let m;
        try {
          m = await (await fetch(`${GP}/measurements/${j.id}`)).json();
        } catch {
          continue;
        }
        if (m.results) {
          s.rows = placeResults(REGIONS, m.results);
          renderRows(s);
        }
        if (m.status !== "in-progress") break;
      }
      if (s.id !== run) return;
      if (Date.now() - t0 >= 3e4) s.partial = true;
      s.rows = s.rows.map((r2, i) => r2 || {
        region: REGIONS[i],
        state: "noprobe",
        rcv: 0,
        rtts: [],
        ttls: [],
        median: null,
        jitter: null,
        loss: 0,
        posUnknown: false,
        resolved: "",
        probe: null
      });
      renderRows(s);
      s.gpDone = true;
      settle2(s);
    }
    async function runTokyo(s) {
      const q = new URLSearchParams({ host: s.tg.host });
      if (s.tg.isIp) q.set("v", String(s.tg.family));
      else if (s.ipv) q.set("v", s.ipv);
      const c = new AbortController(), timer = setTimeout(() => c.abort(), 15e3);
      try {
        const r = await fetch(`${API}?${q}`, { signal: c.signal, credentials: "omit", cache: "no-store" });
        const j = await r.json();
        if (j && j.ok === false) {
          s.tokyoError = j.k || "down";
          s.tokyoRetry = j.retry || 0;
        } else {
          s.tokyo = makeTokyoRow(j);
          s.tokyoError = "";
        }
      } catch {
        s.tokyoError = "down";
      } finally {
        clearTimeout(timer);
      }
      if (s.id !== run) return;
      renderTokyo(s);
      if (!s.tokyoOnly) settle2(s);
    }
    function settle2(s) {
      if (!s || s.id !== run) return;
      if (!s.gpDone && !s.gpError) return;
      s.verdict = verdict(s.rows, { error: s.gpError, partial: s.partial });
      s.findings = s.verdict.k === "err" || s.verdict.k === "partial" ? [] : findings(s.rows, s.tokyo);
      drawVerdict(s);
      drawKpis(s);
      drawFindings(s);
      sortRows(s);
      $("gpProgress").textContent = t("prog", { done: s.rows.filter((r) => r && r.state !== "pending").length, of: REGIONS.length });
      $("shareBtn").hidden = !canShare(s);
      $("tokyoFallback").hidden = !(s.verdict.k === "err" || s.verdict.k === "partial" || quotaLeft != null && quotaLeft < COST);
      setGo(false);
      $("go").textContent = t("go_again");
    }
    function buildRows(s) {
      rowEls = /* @__PURE__ */ new Map();
      detailEls = /* @__PURE__ */ new Map();
      for (const host of [$("tokyoRow"), $("regions")]) host.innerHTML = "";
      const entries = [{ region: TOKYO_REGION, own: true }, ...REGIONS.map((region) => ({ region }))];
      const chips = [{ g: "all", label: t("flt_all") }, { g: "cn", label: t("g_cn") }, { g: "apac", label: t("g_apac") }, { g: "emea", label: t("g_emea") }, { g: "am", label: t("g_am") }];
      $("filters").innerHTML = chips.map((c) => `<button type="button" class="chip" data-g="${c.g}" aria-pressed="${c.g === filterGroup ? "true" : "false"}">${esc(c.label)}</button>`).join("");
      for (const e of entries) {
        const el = rowElement(e.region, e.own);
        (e.own ? $("tokyoRow") : $("regions")).appendChild(el);
        rowEls.set(e.region.key, el);
      }
      all("#filters .chip").forEach((b) => {
        b.onclick = () => {
          filterGroup = b.dataset.g;
          all("#filters .chip").forEach((x) => x.setAttribute("aria-pressed", x.dataset.g === filterGroup));
          applyFilter();
        };
      });
      $("sort").onchange = (e) => {
        sortBy = e.target.value;
        sortRows(state);
      };
      applyFilter();
    }
    function rowElement(region, own) {
      const el = document.createElement("div");
      el.className = "row" + (own ? " own" : "");
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-expanded", "false");
      el.dataset.key = region.key;
      const nm = nameOf(region);
      el.innerHTML = `<span class="rname"><i class="st"></i><span class="nm">${esc(nm)}</span></span>
    <span class="bars" aria-hidden="true">${Array.from({ length: PACKETS }, () => '<i class="bar na"></i>').join("")}</span>
    <span class="med">\u2014</span><span class="meta"></span>
    <span class="detail" hidden></span>`;
      el.dataset.name = nm;
      const toggle = () => {
        const d = el.querySelector(".detail"), open = d.hidden;
        if (!state) return;
        if (!d.dataset.built) {
          d.innerHTML = detailHtml(region);
          d.dataset.built = "1";
        }
        d.hidden = !open;
        el.setAttribute("aria-expanded", open ? "true" : "false");
      };
      el.addEventListener("click", (e) => {
        if (e.target.closest("a, .bar, .detail")) return;
        toggle();
      });
      el.addEventListener("keydown", (e) => {
        if (e.target === el && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          toggle();
        }
      });
      el.addEventListener("mousemove", (e) => {
        if (!matchMedia("(pointer:fine)").matches) return;
        const b = e.target.closest(".bar");
        if (b) tipShow(el, b);
      });
      el.addEventListener("mouseleave", tipHide);
      el.addEventListener("click", (e) => {
        const b = e.target.closest(".bar");
        if (b && matchMedia("(pointer:coarse)").matches) tipShow(el, b);
      });
      return el;
    }
    function barRow(row, big = false) {
      if (!row) return "";
      const vals = row.rtts.filter(Number.isFinite);
      const scale = Math.max(...vals, (row.median || 0) * 1.5, 1);
      return row.rtts.map((v, i) => {
        if (!Number.isFinite(v)) return `<i class="bar miss" data-i="${i}"></i>`;
        const h = Math.max(0.06, Math.min(1, v / scale));
        return `<i class="bar" data-i="${i}" style="--h:${h.toFixed(3)}"></i>`;
      }).join("");
    }
    function fillRow(s, region, row) {
      const el = rowEls.get(region.key);
      if (!el) return;
      el.querySelectorAll(".bars .bar").forEach((b) => {
        b.className = "bar na";
        b.removeAttribute("style");
        b.removeAttribute("title");
      });
      const st = el.querySelector(".st"), med = el.querySelector(".med"), meta = el.querySelector(".meta");
      if (!row || row.state === "pending") {
        st.className = "st";
        med.textContent = "\u2014";
        meta.textContent = region.own ? t("t_wait") : t("r_pending");
        return;
      }
      if (row.state === "noprobe") {
        st.className = "st";
        med.textContent = "\u2014";
        meta.textContent = t("r_noprobe");
        return;
      }
      if (row.state === "failed" || row.state === "priv") {
        st.className = "st";
        med.textContent = "\u2014";
        meta.textContent = row.reason === "priv" ? t("t_private") : t("r_failed");
        el.setAttribute("aria-label", `${el.dataset.name}: ${meta.textContent}`);
        return;
      }
      st.className = "st " + (row.state === "ok" ? "ok" : row.state === "loss" ? "warn" : "bad");
      el.querySelector(".bars").innerHTML = barRow(row);
      const ms = fmtMs(row.median, D.lang), j = Number.isFinite(row.jitter) ? "\xB1" + fmtMs(row.jitter, D.lang) : "";
      med.innerHTML = `${ms} <small>ms</small>`;
      meta.innerHTML = `${j ? esc(j) + " \xB7 " : ""}${row.rcv}/${PACKETS}${row.posUnknown && row.rcv < PACKETS ? " ?" : ""}`;
      if (row.state === "none") {
        med.textContent = "\u2014";
        meta.innerHTML = `0/${PACKETS}`;
      }
      const who = el.dataset.name;
      el.setAttribute("aria-label", t("aria_row", { name: who, ms, j: j ? j.slice(1) : "\u2014", rcv: row.rcv }));
    }
    function renderRows(s) {
      for (let i = 0; i < REGIONS.length; i++) fillRow(s, REGIONS[i], s.rows[i]);
      applyFilter();
    }
    function renderTokyo(s) {
      const el = rowEls.get(TOKYO_REGION.key);
      if (!el) return;
      if (s.tokyo) fillRow(s, TOKYO_REGION, s.tokyo);
      else {
        const meta = el.querySelector(".meta");
        meta.textContent = s.tokyoError === "limit" ? t("t_limit", { s: s.tokyoRetry || 60 }) : s.tokyoError === "busy" ? t("t_busy", { s: s.tokyoRetry || 5 }) : t("t_down");
      }
      applyFilter();
    }
    function applyFilter() {
      for (const r of REGIONS) {
        const el = rowEls.get(r.key);
        if (!el) continue;
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
        return x === y ? REGIONS.indexOf(a) - REGIONS.indexOf(b) : x < y ? -1 : 1;
      });
      const host = $("regions");
      for (const r of order) {
        const el = rowEls.get(r.key);
        if (el) host.appendChild(el);
      }
      applyFilter();
    }
    let tip = null;
    function tipEl() {
      if (tip) return tip;
      tip = document.createElement("div");
      tip.className = "tip m";
      tip.hidden = true;
      document.body.appendChild(tip);
      return tip;
    }
    function tipShow(rowEl, bar) {
      var _a;
      const row = state && (rowEl.dataset.key === TOKYO_REGION.key ? state.tokyo : state.rows[REGIONS.findIndex((r) => r.key === rowEl.dataset.key)]);
      if (!row || !row.rtts || row.posUnknown || row.state === "pending" || row.state === "noprobe") return;
      const i = +bar.dataset.i, rtt = row.rtts[i];
      const el = tipEl();
      el.textContent = Number.isFinite(rtt) ? t("tip_p", { i: i + 1, ms: fmtMs(rtt, D.lang), ttl: (_a = row.ttls[i]) != null ? _a : "\u2014" }) : t("tip_miss", { i: i + 1 });
      const b = bar.getBoundingClientRect();
      el.hidden = false;
      el.style.left = Math.min(innerWidth - 12, Math.max(8, b.left + b.width / 2)) + "px";
      el.style.top = b.top - 34 + "px";
      el.style.transform = "translateX(-50%)";
    }
    function tipHide() {
      if (tip) tip.hidden = true;
    }
    document.addEventListener("scroll", tipHide, { passive: true });
    function detailHtml(region) {
      const s = state;
      if (!s) return "";
      const row = region.key === TOKYO_REGION.key ? s.tokyo : s.rows[REGIONS.findIndex((r) => r.key === region.key)];
      if (!row || row.state === "pending") return `<p class="d-line">${esc(t("r_pending"))}</p>`;
      if (row.state === "noprobe") return `<p class="d-line">${esc(t("r_noprobe"))}</p>`;
      const target = s.tg.host;
      const rows = row.rtts.map((v, i) => {
        var _a;
        return `<tr><td>${i + 1}</td><td>${Number.isFinite(v) ? fmtMs(v, D.lang) : "\u2014"}</td><td>${(_a = row.ttls[i]) != null ? _a : "\u2014"}</td><td class="${Number.isFinite(v) ? "" : "miss"}">${esc(Number.isFinite(v) ? t("d_reply") : t("d_no_reply"))}</td></tr>`;
      }).join("");
      const probe = row.probe && (row.probe.network || row.probe.city || row.probe.asn) ? `<p class="d-line">${esc(t("d_probe"))}: ${esc([row.probe.city, row.probe.network, row.probe.asn ? "AS" + row.probe.asn : ""].filter(Boolean).join(" \xB7 "))}</p>` : "";
      const resolved = row.resolved ? `<p class="d-line">${esc(t("d_resolved"))}: ${region.own || row.probe ? asnLink(row.resolved) : esc(row.resolved)}</p>` : "";
      const lostAll = row.rcv === 0 ? `<p class="d-line warn">${esc(t("d_all_lost"))}</p>` : "";
      const posUnknown = row.posUnknown && row.rcv < PACKETS ? `<p class="d-line">${esc(t("d_pos_unknown"))}</p>` : "";
      const links = [
        `<a href="${esc(tool("trace"))}?t=${encodeURIComponent(target)}" target="_blank" rel="noopener">${esc(t("lk_trace"))}${EXT}</a>`,
        `<a href="${esc(tool("reach"))}?t=${encodeURIComponent(target)}" target="_blank" rel="noopener">${esc(t("lk_reach"))}${EXT}</a>`
      ].join("");
      return `<div class="d-bars" aria-hidden="true">${barRow(row, true)}</div>
    <table class="d-tab"><thead><tr><th>${esc(t("d_packet"))}</th><th>${esc(t("d_rtt"))}</th><th>${esc(t("d_ttl"))}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    ${probe}${resolved}${lostAll}${posUnknown}<p class="d-links">${links}</p>`;
    }
    function drawVerdict(s) {
      const v = s.verdict;
      const dot = $("vDot"), title = $("vTitle"), sub = $("vSub");
      if (!v) {
        dot.className = "dot";
        title.textContent = t("v_wait");
        sub.textContent = "";
        return;
      }
      const cls = { ok: "ok", probe: "ok", loss: "warn", some: "warn", none: "bad", dns: "bad", priv: "bad", err: "warn", partial: "warn", tokyo: "warn" }[v.k] || "warn";
      dot.className = "dot " + cls;
      title.textContent = t(v.k === "tokyo" ? "v_tokyo" : "v_" + v.k, { a: v.a, b: v.b });
      sub.textContent = subLine(s);
    }
    function subLine(s) {
      const replied = s.rows.filter((r) => r && r.rcv > 0 && Number.isFinite(r.median));
      const fastest = replied.slice().sort((a, b) => a.median - b.median)[0];
      const slowest = replied.slice().sort((a, b) => b.median - a.median)[0];
      const v = s.verdict;
      if (v.k === "tokyo") return t("vs_tokyo");
      if (s.gpError) {
        const key = s.gpError === "429" ? "gp_429" : s.gpError === "unreach" ? "gp_unreach" : "gp_err";
        return t(key, { min: Math.ceil((s.gpReset || 3600) / 60), msg: s.gpMsg || "" });
      }
      if (v.k === "ok" || v.k === "probe") return t("vs_" + v.k, {
        n: replied.length,
        a: v.a,
        b: v.b,
        fast: fastest ? nameOf(fastest.region) : "",
        fms: fastest ? fmtMs(fastest.median, D.lang) : "",
        slow: slowest ? nameOf(slowest.region) : "",
        sms: slowest ? fmtMs(slowest.median, D.lang) : ""
      });
      if (v.k === "loss") {
        const w = s.rows.filter((r) => r && r.rcv > 0 && r.rcv < PACKETS).sort((a, b) => b.loss - a.loss)[0];
        return t("vs_loss", { n: replied.length, lost: PACKETS - w.rcv, region: nameOf(w.region), pct: Math.round(w.loss * 100) });
      }
      if (v.k === "some") return t("vs_some", { a: v.a, b: v.b, fast: fastest ? nameOf(fastest.region) : "", fms: fastest ? fmtMs(fastest.median, D.lang) : "" });
      return t("vs_" + v.k, { a: v.a, b: v.b });
    }
    function drawKpis(s) {
      const replied = s.tokyoOnly ? s.tokyo && s.tokyo.rcv > 0 ? [s.tokyo] : [] : s.rows.filter((r) => r && r.rcv > 0 && Number.isFinite(r.median));
      if (!replied.length) {
        $("kMedian").textContent = "\u2014";
        $("kJitter").textContent = "\u2014";
        $("kJitterWho").textContent = "";
        $("kLoss").textContent = "\u2014";
        return;
      }
      const gm = median(replied.map((r) => r.median));
      const j = replied.filter((r) => Number.isFinite(r.jitter)).sort((a, b) => b.jitter - a.jitter)[0];
      const sent = replied.length * PACKETS, got = replied.reduce((n, r) => n + r.rcv, 0);
      $("kMedian").innerHTML = `${fmtMs(gm, D.lang)} <small>ms</small>`;
      $("kJitter").innerHTML = j ? `\xB1${fmtMs(j.jitter, D.lang)} <small>ms</small>` : "\u2014";
      $("kJitterWho").textContent = j && !s.tokyoOnly ? nameOf(j.region) : "";
      $("kLoss").innerHTML = `${(100 * (sent - got) / sent).toFixed(sent - got ? 1 : 0)}<small>%</small>`;
    }
    function drawFindings(s) {
      if (!s.verdict || s.verdict.k === "err" || s.verdict.k === "partial") {
        $("findings").innerHTML = "";
        return;
      }
      const links = { fd_none: ["reach", "lk_reach"], fd_loss: ["trace", "lk_trace"], fd_slow: ["trace", "lk_trace"], fd_jitter: ["lag", "lk_lag"] };
      $("findings").innerHTML = s.findings.map((f) => {
        const vars = { ...f };
        if (f.region) vars.region = nameOf(f.region);
        if (f.fast) vars.fast = nameOf(f.fast);
        if (f.regions) vars.regions = f.regions.map(nameOf).join(t("sep"));
        if (Number.isFinite(vars.ms)) vars.ms = fmtMs(vars.ms, D.lang);
        if (Number.isFinite(vars.fms)) vars.fms = fmtMs(vars.fms, D.lang);
        if (Number.isFinite(vars.j)) vars.j = fmtMs(vars.j, D.lang);
        if (Number.isFinite(vars.ours)) vars.ours = fmtMs(vars.ours, D.lang);
        if (Number.isFinite(vars.theirs)) vars.theirs = fmtMs(vars.theirs, D.lang);
        if (f.k === "fd_cn") {
          vars.telecom = fmtMs(f.telecom.median, D.lang);
          vars.unicom = fmtMs(f.unicom.median, D.lang);
          vars.mobile = fmtMs(f.mobile.median, D.lang);
        }
        const lk = links[f.k];
        return `<li><span>${esc(t(f.k, vars))}</span>${lk ? toolLink(lk[0], lk[1]) : ""}</li>`;
      }).join("");
    }
    function canShare(s) {
      if (!s || !s.verdict) return false;
      if (s.verdict.k === "err" || s.verdict.k === "partial") return false;
      return s.rows.some((r) => r && r.rcv > 0) || s.tokyo && s.tokyo.rcv > 0;
    }
    async function resultLink(s) {
      const code = {
        t: s.tg.host,
        f: s.tg.family || +s.ipv || 4,
        ts: s.ts,
        k: s.verdict.k,
        a: s.verdict.a,
        b: s.verdict.b,
        r: s.rows.filter((r) => r && r.state !== "pending" && r.state !== "noprobe").map(rowToCode),
        y: s.tokyo ? [s.tokyo.resolved || "", s.tokyo.rtts.map((v) => Number.isFinite(v) ? Math.round(v * 10) : 0), s.tokyo.ttls.map((v) => Number.isFinite(v) ? v : 0)] : 0
      };
      return `${location.origin}${D.paths[D.lang]}r/${await encodeResult(code)}`;
    }
    $("shareBtn").addEventListener("click", async () => {
      const s = state;
      if (!s) return;
      const link = await resultLink(s);
      const { share } = await import("/assets/share/share.js?v=9");
      const v = { title: t(s.verdict.k, { a: s.verdict.a, b: s.verdict.b }), k: s.verdict.k };
      const rows = s.rows.filter((r) => r && r.rcv > 0);
      share({
        lang: D.lang,
        name: t("app_name"),
        file: "global-ping",
        show: [],
        never: ["ip"],
        canShow: false,
        link: () => link,
        home: location.origin + D.paths[D.lang],
        text: () => `${v.title} \xB7 ${s.tg.host}`,
        height: (ctx, kit) => cardLayout(ctx, kit, v, s.tg.host, rows, s.tokyo, s).H,
        ts: s.ts,
        foot: () => ["Globalping + 1ms.dog"],
        draw: (ctx, kit) => drawCard(ctx, kit, v, s, rows)
      }).open();
    });
    const ROWH = 44;
    function cardLayout(ctx, kit, v, target, rows, tokyo, s) {
      const { W, P, F, fit, wrap } = kit, w = W - P * 2;
      let ts = fit(ctx, v.title, w, 46, 34), lines = [v.title];
      if (ctx.measureText(v.title).width > w) {
        ts = 38;
        ctx.font = `700 ${ts}px ${F}`;
        lines = wrap(ctx, v.title, w, 2);
      }
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
      ctx.fillStyle = css(cls);
      ctx.font = `700 ${L2.ts}px ${F}`;
      L2.lines.forEach((line, i) => ctx.fillText(line, P, L2.tY + i * Math.round(L2.ts * 1.2)));
      const tsz = fit(ctx, s.tg.host, w - 240, 30, 20, 600);
      ctx.fillStyle = css("fg");
      ctx.font = `600 ${tsz}px ${F}`;
      ctx.fillText(s.tg.host, P, L2.targetY);
      ctx.textAlign = "right";
      ctx.fillStyle = css("muted");
      ctx.font = `400 22px ${F}`;
      ctx.fillText(rows.length ? `${rows.length} \xB7 16` : "1ms.dog \xB7 Tokyo", W - P, L2.targetY);
      ctx.textAlign = "left";
      const gm = median(rows.filter((r) => Number.isFinite(r.median)).map((r) => r.median));
      const j = rows.filter((r) => Number.isFinite(r.jitter)).sort((a, b) => b.jitter - a.jitter)[0];
      const sent = rows.length * PACKETS, got = rows.reduce((n, r) => n + r.rcv, 0);
      const vals = [
        [t("k_median"), Number.isFinite(gm) ? fmtMs(gm, D.lang) + " ms" : "\u2014"],
        [t("k_max_jitter"), j ? "\xB1" + fmtMs(j.jitter, D.lang) + " ms" : "\u2014"],
        [t("k_loss"), rows.length ? (100 * (sent - got) / sent).toFixed(sent - got ? 1 : 0) + "%" : "\u2014"]
      ];
      vals.forEach(([label, val], i) => {
        const x = P + i * (w / 3);
        ctx.fillStyle = css("muted");
        ctx.font = `500 20px ${F}`;
        ctx.fillText(label, x, L2.numY - 18);
        ctx.fillStyle = css("fg");
        ctx.font = `700 38px ${F}`;
        ctx.fillText(val, x, L2.numY + 22);
      });
      rows.forEach((row, i) => {
        const col = i % 3, line = Math.floor(i / 3), cw = w / 3;
        const x = P + col * cw, y = L2.gridY + line * ROWH;
        const colr = row.state === "ok" ? "ok" : row.state === "loss" || row.rcv > 0 && row.rcv < PACKETS ? "warn" : row.rcv > 0 ? "ok" : "bad";
        ctx.fillStyle = css(colr);
        ctx.beginPath();
        ctx.arc(x + 5, y - 9, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = css("fg");
        fit(ctx, cardName(row.region), cw - 132, 20, 14, 500);
        ctx.fillText(cardName(row.region), x + 20, y);
        ctx.fillStyle = css("muted");
        ctx.font = `500 19px ${M}`;
        ctx.textAlign = "right";
        ctx.fillText(row.rcv === 0 ? "\u2014" : row.rcv < PACKETS ? `${row.rcv}/16` : fmtMs(row.median, D.lang) + " ms", x + cw - 26, y);
        ctx.textAlign = "left";
      });
      if (s.tokyo && s.tokyo.rcv > 0) {
        const i = rows.length, col = i % 3, line = Math.floor(i / 3), cw = w / 3;
        const x = P + col * cw, y = L2.gridY + line * ROWH;
        ctx.fillStyle = css("ink");
        ctx.beginPath();
        ctx.arc(x + 5, y - 9, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = css("fg");
        ctx.font = `500 20px ${F}`;
        ctx.fillText("1ms.dog \xB7 Tokyo", x + 20, y);
        ctx.fillStyle = css("muted");
        ctx.font = `500 19px ${M}`;
        ctx.textAlign = "right";
        ctx.fillText(fmtMs(s.tokyo.median, D.lang) + " ms", x + cw - 26, y);
        ctx.textAlign = "left";
      }
    }
    function decodeRows(o) {
      const rows = (o.r || []).map((arr) => {
        const row = codeToRow(arr, REGIONS);
        if (!row) return null;
        const got = row.rtts.filter(Number.isFinite);
        row.median = median(got);
        row.jitter = stdev(got);
        return row;
      }).filter(Boolean);
      let tokyo = null;
      if (Array.isArray(o.y)) {
        const rtts = (o.y[1] || []).map((v) => v > 0 ? v / 10 : null), ttls = (o.y[2] || []).map((v) => v > 0 ? v : null);
        while (rtts.length < PACKETS) rtts.push(null);
        while (ttls.length < PACKETS) ttls.push(null);
        tokyo = {
          region: TOKYO_REGION,
          own: true,
          resolved: o.y[0] || "",
          probe: { city: "Tokyo", country: "JP", asn: 0, network: "" },
          rtts,
          ttls,
          rcv: rtts.filter(Number.isFinite).length,
          median: median(rtts),
          jitter: stdev(rtts),
          loss: 0,
          state: "ok",
          posUnknown: false
        };
        tokyo.loss = (PACKETS - tokyo.rcv) / PACKETS;
        tokyo.state = tokyo.rcv === 0 ? "none" : tokyo.rcv < PACKETS ? "loss" : "ok";
      }
      return { rows, tokyo };
    }
    const sp = sharePath(location.pathname);
    if (sp) {
      decodeResult(sp.code).then(async (o) => {
        var _a, _b;
        if (!o) return;
        const { rows, tokyo } = decodeRows(o);
        state = {
          id: ++run,
          tg: { host: o.t, family: o.f || 4, isIp: false },
          ts: o.ts || Date.now(),
          rows: REGIONS.map((r) => rows.find((x) => x.region.key === r.key) || { region: r, state: "noprobe" }),
          tokyo,
          gpDone: true,
          gpError: "",
          partial: false,
          verdict: { k: o.k, a: (_a = o.a) != null ? _a : 0, b: (_b = o.b) != null ? _b : 0 },
          findings: [],
          tokyoOnly: !rows.length
        };
        $("target").value = o.t;
        $("ipvWrap").hidden = false;
        $("ipv").value = String(o.f || 4);
        $("verdict").hidden = $("table").hidden = false;
        $("shareBtn").hidden = false;
        if (state.tokyoOnly) {
          $("regions").hidden = true;
          $("filters").hidden = true;
          $("sort").closest(".sel").hidden = true;
        }
        buildRows(state);
        renderRows(state);
        renderTokyo(state);
        drawVerdict(state);
        drawKpis(state);
        state.findings = findings(state.rows, state.tokyo);
        drawFindings(state);
        $("gpProgress").textContent = t("prog", { done: state.rows.filter((r) => r && r.state !== "pending").length, of: REGIONS.length });
        $("tokyoFallback").hidden = true;
        const { received } = await import("/assets/share/share.js?v=9");
        recv = received({ lang: D.lang, ts: state.ts, at: $("verdict"), test: () => start() });
      }).catch(() => {
        $("verdict").hidden = false;
        $("vDot").className = "dot warn";
        $("vTitle").textContent = t("v_oldbrowser");
        $("vSub").textContent = t("v_oldbrowser_sub");
      });
    } else {
      const q = new URLSearchParams(location.search);
      if (q.get("t")) {
        $("target").value = q.get("t");
        $("target").dispatchEvent(new Event("input"));
      }
    }
    $("tokyoBtn").addEventListener("click", async () => {
      const raw = $("target").value.trim(), tg = normalizeTarget(raw);
      if (tg.error) return;
      const id = ++run;
      state = {
        id,
        tg,
        ipv: $("ipv").value,
        rows: REGIONS.map(() => null),
        tokyo: null,
        tokyoError: "",
        gpDone: true,
        gpError: "",
        partial: false,
        ts: Date.now(),
        verdict: { k: "tokyo", a: 0, b: 0 },
        findings: [],
        tokyoOnly: true
      };
      $("verdict").hidden = false;
      $("table").hidden = false;
      $("shareBtn").hidden = true;
      $("tokyoFallback").hidden = true;
      $("regions").hidden = true;
      $("filters").hidden = true;
      $("sort").closest(".sel").hidden = true;
      buildRows(state);
      renderRows(state);
      renderTokyo(state);
      drawVerdict(state);
      $("kpis").hidden = true;
      await runTokyo(state);
      if (state.id !== id) return;
      drawKpis(state);
      $("kpis").hidden = false;
      $("gpProgress").textContent = "";
      $("shareBtn").hidden = !canShare(state);
      setGo(false);
    });
    window.msReport = () => state && state.verdict ? {
      summary: `${t(state.verdict.k === "tokyo" ? "v_tokyo" : "v_" + state.verdict.k, { a: state.verdict.a, b: state.verdict.b })} \xB7 ${state.tg.host}`,
      data: {
        target: state.tg.host,
        family: state.tg.family,
        verdict: state.verdict,
        rows: state.rows.filter((r) => r && r.state !== "pending" && r.state !== "noprobe").map((r) => ({ region: r.region.key, resolved: r.resolved, rcv: r.rcv, median: r.median, jitter: r.jitter, loss: r.loss })),
        tokyo: state.tokyo ? { resolved: state.tokyo.resolved, rcv: state.tokyo.rcv, median: state.tokyo.median } : null
      },
      picks: state.rows.filter((r) => r && r.rcv < PACKETS).slice(0, 8).map((r) => `${nameOf(r.region)}: ${r.rcv}/16`)
    } : null;
    loadQuota();
  })();
})();
