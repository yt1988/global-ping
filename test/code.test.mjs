// The result link: an object round-trips, old or broken codes are null, and the path forms are recognised.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeResult, decodeResult, sharePath, rowToCode, codeToRow } from "../src/code.mjs";
import { REGIONS, makeRow } from "../src/model.mjs";

const RAW = ["PING example.com (172.66.147.243) 56(84) bytes of data.",
  ...Array.from({ length: 16 }, (_, i) => `64 bytes from example.com: icmp_seq=${i + 1} ttl=54 time=${5 + i / 10} ms`)].join("\n");
const RES = { probe: { country: "JP", city: "Tokyo", asn: 1, network: "Example" },
  result: { status: "finished", resolvedAddress: "172.66.147.243", timings: Array.from({ length: 16 }, (_, i) => ({ ttl: 54, rtt: 5 + i / 10 })), rawOutput: RAW } };

test("rowToCode keeps 16 positions and the probe", () => {
  const row = makeRow(REGIONS[5], RES);
  const a = rowToCode(row);
  assert.equal(a[0], "jp:tokyo");
  assert.equal(a[5].length, 16);
  assert.equal(a[5][0], 50);
  const back = codeToRow(a, REGIONS);
  assert.equal(back.region.key, "jp:tokyo");
  assert.equal(back.rcv, 16);
});

test("a result round-trips through the shared codec", async () => {
  const row = makeRow(REGIONS[5], RES);
  const code = await encodeResult({ t: "example.com", f: 4, ts: 1730000000000, k: "ok", a: 18, b: 18,
    r: [rowToCode(row)], y: ["172.66.147.243", Array(16).fill(50), Array(16).fill(54)] });
  assert.match(code, /^1~/);
  const back = await decodeResult(code);
  assert.equal(back.t, "example.com");
  assert.equal(back.k, "ok");
  assert.equal(back.a, 18);
  assert.equal(back.r.length, 1);
  assert.equal(back.y[1][0], 50);
});

test("a tokyo-only result (no regions) round-trips", async () => {
  const code = await encodeResult({ t: "example.com", f: 4, ts: 1, k: "tokyo", a: 0, b: 0, r: [],
    y: ["172.66.147.243", Array(16).fill(0), Array(16).fill(0)] });
  const back = await decodeResult(code);
  assert.equal(back.k, "tokyo");
  assert.equal(back.r.length, 0);
});

test("unreadable codes are null, not an exception", async () => {
  assert.equal(await decodeResult("zz"), null);
  assert.equal(await decodeResult("1~aaaaaaaa"), null);
  assert.equal(await decodeResult("2~aaaaaaaaaaaaaaaa"), null);
  assert.equal(await decodeResult("1~" + "A".repeat(20)), null);
});

test("share links are recognised in every language folder", () => {
  assert.deepEqual(sharePath("/r/1~abc"), { slug: "", code: "1~abc" });
  assert.deepEqual(sharePath("/zh-cn/r/1~abc"), { slug: "zh-cn", code: "1~abc" });
  assert.deepEqual(sharePath("/ru/r/1~abc"), { slug: "ru", code: "1~abc" });
  assert.equal(sharePath("/zh-cn/foo"), null);
  assert.equal(sharePath("/r/x/y"), null);
});
