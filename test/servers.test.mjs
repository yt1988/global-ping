// Our server rows come from the shell's injected meta; without it there are none (the self-hosted path).
import { test } from "node:test";
import assert from "node:assert/strict";

test("no injected meta: no server rows", async () => {
  delete globalThis.document;
  const { SERVERS } = await import("../src/config.mjs?none=" + Date.now());
  assert.deepEqual(SERVERS, []);
});

test("the meta supplies Tokyo then Shanghai", async () => {
  globalThis.document = { querySelector: sel => sel.includes("ms-servers")
    ? { getAttribute: () => "reach=https://r.example:2096;ping=https://t.example:2097,https://s.example:2097/;dns=https://d.example:2053" }
    : null };
  const { SERVERS } = await import("../src/config.mjs?two=" + Date.now());
  assert.deepEqual(SERVERS, [
    { key: "tokyo", api: "https://t.example:2097/v1/ping" },
    { key: "shanghai", api: "https://s.example:2097/v1/ping" },
  ]);
  delete globalThis.document;
});

test("one injected endpoint: one row", async () => {
  globalThis.document = { querySelector: sel => sel.includes("ms-servers")
    ? { getAttribute: () => "ping=https://only.example:2097/v1/ping" } : null };
  const { SERVERS } = await import("../src/config.mjs?one=" + Date.now());
  assert.deepEqual(SERVERS, [{ key: "tokyo", api: "https://only.example:2097/v1/ping" }]);
  delete globalThis.document;
});
