// The page token for our own endpoints (1ms.dog docs/tool-contract.md, "端点鉴权"). The shell puts a short-lived
// token in <meta name="ms-auth">; this module attaches it, renews it from /_ms/token when it is close to expiry or a
// request comes back 401, and retries once. With no meta (self-hosted, or auth not switched on) nothing is sent.
// Pure enough to test: the document, fetch and clock can be passed in.

export const authToken = (doc = globalThis.document) =>
  (doc && doc.querySelector ? (doc.querySelector('meta[name="ms-auth"]')?.getAttribute("content") || "") : "");

export const tokenExp = t => {
  const p = String(t || "").split(".");
  return p.length === 5 && p[0] === "v1" ? +p[1] || 0 : 0;
};

// The contract's renewal margin: less than a minute left means fetch a new one before measuring.
export const needsRenewal = (t, now = Date.now() / 1000) => !!t && tokenExp(t) - now < 60;

export async function refreshToken(fetchImpl = globalThis.fetch, doc = globalThis.document) {
  try {
    const r = await fetchImpl("/_ms/token", { cache: "no-store", headers: { accept: "application/json" } });
    const j = await r.json().catch(() => null);
    const token = j && typeof j.token === "string" ? j.token : "";
    if (!token) return "";
    const el = doc && doc.querySelector ? doc.querySelector('meta[name="ms-auth"]') : null;
    if (el) el.setAttribute("content", token);
    return token;
  } catch { return ""; }
}

// One request with the page's token. A 401 gets a fresh token and exactly one retry; if renewal is unavailable the
// original 401 stands and the caller hides that server row.
export async function authedFetch(url, init = {}, {
  doc = globalThis.document, fetchImpl = globalThis.fetch, now = () => Date.now() / 1000,
  refresh = () => refreshToken(fetchImpl, doc),
} = {}) {
  let token = authToken(doc);
  if (needsRenewal(token, now())) token = (await refresh()) || token;
  const call = tok => fetchImpl(url, { ...init, headers: { ...(init.headers || {}), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } });
  let res = await call(token);
  if (res.status === 401 && token) {
    const next = await refresh();
    if (next && next !== token) res = await call(next);
  }
  return res;
}
