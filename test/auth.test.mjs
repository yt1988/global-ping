// The page token on our own endpoints: sent from the meta, renewed once on 401, and absent when there is no meta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authedFetch, authToken, needsRenewal, tokenExp } from "../src/auth.mjs";

const exp = Math.floor(Date.now() / 1000) + 300;
const T = sc => `v1.${exp}.n0nce.${sc}.sig`;
const docWith = content => ({ querySelector: sel => sel.includes("ms-auth") ? { getAttribute: () => content, setAttribute: (_, v) => { content = v; } } : null });

const resp = status => ({ status, ok: status >= 200 && status < 300, json: async () => ({ ok: true }) });

test("the meta token is sent as a Bearer header", async () => {
  const doc = docWith(T("ping"));
  let seen = null;
  const fetchImpl = async (url, init) => { seen = { url, headers: init.headers }; return resp(200); };
  await authedFetch("https://api.example/v1/ping", {}, { doc, fetchImpl, refresh: async () => "" });
  assert.equal(seen.headers.Authorization, `Bearer ${T("ping")}`);
});

test("no meta: no Authorization header", async () => {
  const doc = { querySelector: () => null };
  let seen = null;
  const fetchImpl = async (url, init) => { seen = init; return resp(200); };
  await authedFetch("https://api.example/v1/ping", {}, { doc, fetchImpl, refresh: async () => "" });
  assert.equal(seen.headers.Authorization, undefined);
  assert.equal(authToken(doc), "");
});

test("a 401 renews once and retries once", async () => {
  const doc = docWith(T("ping"));
  const calls = [];
  let refreshed = 0;
  const fetchImpl = async (url, init) => {
    calls.push(init.headers.Authorization || "");
    return calls.length === 1 ? resp(401) : resp(200);
  };
  const res = await authedFetch("https://api.example/v1/ping", {}, { doc, fetchImpl, refresh: async () => { refreshed++; return `v1.${exp + 1}.other.ping.sig`; } });
  assert.equal(res.status, 200);
  assert.equal(refreshed, 1);
  assert.equal(calls.length, 2);
});

test("a second 401 is not retried again", async () => {
  const doc = docWith(T("ping"));
  const calls = [];
  let refreshed = 0;
  const fetchImpl = async (url, init) => { calls.push(1); return resp(401); };
  const res = await authedFetch("https://api.example/v1/ping", {}, { doc, fetchImpl, refresh: async () => { refreshed++; return T("ping") + "x"; } });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 2);
  assert.equal(refreshed, 1);
});

test("a token close to expiry is renewed before the request", async () => {
  const soon = `v1.${Math.floor(Date.now() / 1000) + 10}.n0nce.ping.sig`;
  const doc = docWith(soon);
  let refreshed = 0, firstHeader = null;
  const fetchImpl = async (url, init) => { firstHeader = init.headers.Authorization; return resp(200); };
  await authedFetch("https://api.example/v1/ping", {}, { doc, fetchImpl, refresh: async () => { refreshed++; return `v1.${exp + 2}.fresh.ping.sig`; } });
  assert.equal(refreshed, 1);
  assert.equal(firstHeader, `Bearer v1.${exp + 2}.fresh.ping.sig`);
});

test("expiry helpers", () => {
  assert.equal(tokenExp(T("ping")), exp);
  assert.equal(needsRenewal(""), false);
  assert.equal(needsRenewal(T("ping")), false);
  assert.equal(needsRenewal(`v1.${Math.floor(Date.now() / 1000) + 10}.n.scope.sig`), true);
});
