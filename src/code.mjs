// A shared result in a link: /<lang>/r/<code>. The code is "<version>~<body>"; a new format gets a new version, and old
// links keep opening. Used by the page (bundled into app.js) and by the Worker, which titles the link's preview.
// The body is made by 1ms.dog's shared codec (public/assets/share/codec.js, copied byte for byte from 1ms-shell):
//   "z" + base64url(deflate-raw(JSON)), or "u" + base64url(JSON) when the browser can't compress.
// The result holds what the page showed: the target, the verdict (frozen, so a later threshold change doesn't rewrite
// old links), and per region 16 latency slots (0.1 ms units, 0 = no reply) and 16 TTLs (0 = no reply). Never the
// visitor's own IP.
import { pack, unpack, CodecError } from "../public/assets/share/codec.js";

export const CODE_VERSION = "1";

export async function encodeResult(obj) {
  return CODE_VERSION + "~" + await pack(JSON.stringify(obj));
}

// The result, or null when the code can't be read (garbled, cut short, a version this code doesn't know). Throws
// CodecError("inflate") when the code is fine but this browser can't decompress it (the Worker always can).
export async function decodeResult(code) {
  const m = /^1~([A-Za-z0-9_-]{8,16000})$/.exec(code || "");
  if (!m) return null;
  let text;
  try { text = await unpack(m[1]); }
  catch (e) { if (e instanceof CodecError && e.reason === "inflate") throw e; return null; }
  try {
    const r = JSON.parse(text);
    if (!r || typeof r.t !== "string" || typeof r.k !== "string" || !Array.isArray(r.r) || r.r.length > 18) return null;
    return r;
  } catch (e) { return null; }
}

// "/r/<code>" or "/<lang folder>/r/<code>" → { slug, code }
export function sharePath(path) {
  const m = /^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?r\/([^/]+)$/.exec(path);
  return m ? { slug: m[1] || "", code: m[2] } : null;
}

// The encoded form of one row; the page and the tests share it.
export const rowToCode = row => [
  row.region.key,
  row.resolved || "",
  row.probe?.asn || 0,
  row.probe?.network || "",
  row.probe?.city || "",
  row.rtts.map(v => (Number.isFinite(v) ? Math.round(v * 10) : 0)),
  row.ttls.map(v => (Number.isFinite(v) ? v : 0)),
];

export const codeToRow = (arr, regions) => {
  const region = regions.find(r => r.key === arr[0]);
  if (!region) return null;
  const rtts = (arr[5] || []).slice(0, 16).map(v => (v > 0 ? v / 10 : null));
  const ttls = (arr[6] || []).slice(0, 16).map(v => (v > 0 ? v : null));
  while (rtts.length < 16) rtts.push(null);
  while (ttls.length < 16) ttls.push(null);
  const got = rtts.filter(Number.isFinite);
  return { region, resolved: arr[1] || "", probe: { asn: arr[2] || 0, network: arr[3] || "", city: arr[4] || "", country: region.cc },
    rtts, ttls, rcv: got.length, median: null, jitter: null, loss: (16 - got.length) / 16,
    state: got.length === 0 ? "none" : got.length < 16 ? "loss" : "ok", posUnknown: false, reason: "" };
};
