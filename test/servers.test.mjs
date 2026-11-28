// Our server rows come from the shell's injected meta; without it there are none (the self-hosted path).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { LANGS, loadI18n } from "../scripts/build.mjs";
import { servers } from "../src/egress.js";
import { SERVER_REGIONS } from "../src/model.mjs";
import { CITIES } from "../src/config.mjs";

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

// Nuremberg, the fourth city (2026-11-28). Three separate places must agree, or the row vanishes with no error and no
// log: the city code in the injected meta, the mapping from it, and a SERVER_REGIONS entry (SERVERS drops unknown keys).
test("every language names the Nuremberg row, and the build carries it", async () => {
  const I = await loadI18n();
  for (const [lang] of LANGS) assert.ok(I[lang].srv_nuremberg, `${lang}: no srv_nuremberg`);
  const assets = await readdir(new URL("../public/assets/", import.meta.url));
  for (const [lang] of LANGS) {
    const file = assets.find(f => f.startsWith(`l.${lang.toLowerCase()}.`) && f.endsWith(".js"));
    assert.ok(file, `${lang}: no strings bundle`);
    const js = await readFile(new URL("../public/assets/" + file, import.meta.url), "utf8");
    assert.ok(js.includes(I[lang].srv_nuremberg), `${lang}: srv_nuremberg did not reach the build`);
  }
});

test("the four city codes map to four rows in the injected order", () => {
  assert.ok(SERVER_REGIONS.nuremberg, "SERVER_REGIONS has no nuremberg entry");
  assert.equal(CITIES.nue, "nuremberg");
  const meta = servers("lax@https://lax.example/v1/ping,nue@https://nue.example/v1/ping,"
    + "tyo@https://tyo.example/v1/ping,sha@https://sha.example/v1/ping");
  const keys = meta.map(s => CITIES[s.city]).filter(k => k && SERVER_REGIONS[k]);
  assert.deepEqual(keys, ["losangeles", "nuremberg", "tokyo", "shanghai"]);
});

test("a four-city injection gives four rows, in the injected order", async () => {
  globalThis.document = { querySelector: sel => sel.includes("ms-servers")
    ? { getAttribute: () => "ping=lax@https://lax.example/v1/ping,nue@https://nue.example/v1/ping,"
      + "tyo@https://tyo.example/v1/ping,sha@https://sha.example/v1/ping" } : null };
  const { SERVERS } = await import("../src/config.mjs?four=" + Date.now());
  assert.deepEqual(SERVERS, [
    { key: "losangeles", api: "https://lax.example/v1/ping" },
    { key: "nuremberg", api: "https://nue.example/v1/ping" },
    { key: "tokyo", api: "https://tyo.example/v1/ping" },
    { key: "shanghai", api: "https://sha.example/v1/ping" },
  ]);
  delete globalThis.document;
});
