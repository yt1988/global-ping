// The model: parsing a probe's raw output, the 16 slots, the verdicts and findings, and the target input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGIONS, PACKETS, parseRaw, slots, makeRow, makeTokyoRow, placeResults, verdict, findings, normalizeTarget, isPrivateIp, fmtMs, median, stdev } from "../src/model.mjs";

const RAW = ["PING example.com (172.66.147.243) 56(84) bytes of data.",
  ...[1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16].map(i =>
    `64 bytes from example.com (172.66.147.243): icmp_seq=${i} ttl=54 time=${(5 + i / 100).toFixed(2)} ms`),
  "", "--- example.com ping statistics ---", "16 packets transmitted, 15 received, 6% packet loss, time 7518ms"].join("\n");
const TIMINGS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16].map(i => ({ ttl: 54, rtt: 5 + i / 100 }));
const RES = { probe: { country: "DE", city: "Falkenstein", asn: 24940, network: "Hetzner Online" },
  result: { status: "finished", resolvedAddress: "172.66.147.243", timings: TIMINGS, rawOutput: RAW,
    stats: { min: 5, max: 6, avg: 5.5, total: 16, rcv: 15, drop: 1, loss: 6 } } };

test("parseRaw reads icmp_seq and the missing seq is known", () => {
  const p = parseRaw(RAW);
  assert.equal(p.size, 15);
  assert.equal(p.has(8), false);
  assert.ok(Math.abs(p.get(3).rtt - 5.03) < 1e-9);
  assert.equal(p.get(3).ttl, 54);
});

test("slots put the missing packet in its real position", () => {
  const s = slots(TIMINGS, RAW);
  assert.equal(s.placed, true);
  assert.equal(s.rtts.length, PACKETS);
  assert.equal(s.rtts[7], null);
  assert.equal(s.rtts.filter(Number.isFinite).length, 15);
});

test("slots fall back to reply order when the raw output can't be read", () => {
  const s = slots(TIMINGS, "not a ping output");
  assert.equal(s.placed, false);
  assert.equal(s.rtts[0], TIMINGS[0].rtt);
  assert.equal(s.rtts[14], TIMINGS[14].rtt);
  assert.equal(s.rtts[15], null);
});

test("makeRow: a lossy row", () => {
  const row = makeRow(REGIONS[11], RES);
  assert.equal(row.state, "loss");
  assert.equal(row.rcv, 15);
  assert.equal(row.loss.toFixed(4), "0.0625");
  assert.ok(row.median > 5 && row.median < 7);
  assert.ok(row.jitter >= 0);
  assert.equal(row.resolved, "172.66.147.243");
  assert.equal(row.probe.asn, 24940);
});

test("makeRow: DNS failure and private addresses are named", () => {
  const dns = makeRow(REGIONS[0], { probe: {}, result: { status: "failed", rawOutput: "ping: bad.invalid: Name or service not known" } });
  assert.equal(dns.state, "failed");
  assert.equal(dns.reason, "dns");
  const priv = makeRow(REGIONS[0], { probe: {}, result: { status: "failed", rawOutput: "Private IP ranges are not allowed" } });
  assert.equal(priv.state, "priv");
});

test("makeTokyoRow keeps the server's packet positions", () => {
  const v = { ip: "1.2.3.4", timings: Array.from({ length: 16 }, (_, i) => ({ i: i + 1, rtt: i === 4 ? null : 10 + i, ttl: 50 })) };
  const row = makeTokyoRow(v);
  assert.equal(row.rcv, 15);
  assert.equal(row.rtts[4], null);
  assert.equal(row.state, "loss");
});

test("placeResults matches probes to the regions asked for", () => {
  const de = { ...RES, probe: { country: "DE", city: "Frankfurt", asn: 24940, network: "Hetzner Online" } };
  const rows = placeResults(REGIONS, [de, { probe: { country: "JP", city: "Tokyo", asn: 1 }, result: { status: "in-progress" } }]);
  assert.equal(rows[11].probe.city, "Frankfurt");
  assert.equal(rows[5].state, "pending");
});

const rowOf = (i, state, extra = {}) => ({ region: REGIONS[i], state, rcv: state === "ok" ? 16 : state === "loss" ? 15 : 0,
  median: 100 + i, jitter: 1, loss: state === "ok" ? 0 : 0.0625, resolved: "1.1.1." + i, rtts: [], ttls: [], ...extra });
const rowsOf = fn => REGIONS.map((r, i) => fn(i, r));

test("verdicts", () => {
  assert.equal(verdict(rowsOf(() => rowOf(0, "ok"))).k, "ok");
  assert.equal(verdict(rowsOf(i => rowOf(i, i === 3 ? "loss" : "ok"))).k, "loss");
  const some = verdict(rowsOf(i => rowOf(i, i === 2 ? "none" : "ok")));
  assert.equal(some.k, "some"); assert.equal(some.a, 1); assert.equal(some.b, 18);
  assert.equal(verdict(rowsOf(() => rowOf(0, "none"))).k, "none");
  assert.equal(verdict(rowsOf(() => rowOf(0, "ok")), { error: "429" }).k, "err");
  assert.equal(verdict(rowsOf(i => rowOf(i, i < 9 ? "ok" : "pending")), { partial: true }).k, "partial");
  assert.equal(verdict(rowsOf(() => ({ ...rowOf(0, "priv"), state: "priv" }))).k, "priv");
  assert.equal(verdict(rowsOf(() => ({ ...rowOf(0, "failed"), state: "failed", reason: "dns" }))).k, "dns");
});

test("findings: none, loss, China spread, jitter, stable", () => {
  const none = findings(rowsOf(i => rowOf(i, i === 0 || i === 1 ? "none" : "ok")), null);
  assert.equal(none[0].k, "fd_none");
  const loss = findings(rowsOf(i => rowOf(i, i === 17 ? "loss" : "ok")), null);
  assert.ok(loss.some(f => f.k === "fd_loss"));
  const cn = findings(rowsOf((i) => rowOf(i, "ok", { median: [4134, 4837, 9808].includes(REGIONS[i].carrier) ? 20 + 200 * [4134, 4837, 9808].indexOf(REGIONS[i].carrier) : 100 })), null);
  assert.ok(cn.some(f => f.k === "fd_cn"));
  const stable = findings(rowsOf(() => rowOf(0, "ok", { jitter: 0.5 })), null);
  assert.deepEqual(stable.map(f => f.k), ["fd_stable"]);
  const slow = findings(rowsOf(i => rowOf(i, "ok", { median: i === 17 ? 300 : 50 })), null);
  const fd = slow.find(f => f.k === "fd_slow");
  assert.ok(fd, "slow region should be a finding");
  assert.equal(fd.fms, 250, "the sentence's number is the difference, not the fastest value");
});

test("the target input: URLs, ports and private addresses", () => {
  assert.equal(normalizeTarget("https://Example.com/a?b=1").host, "example.com");
  assert.equal(normalizeTarget("example.com:8443").host, "example.com");
  assert.equal(normalizeTarget("example.com.").host, "example.com");
  assert.equal(normalizeTarget("10.0.0.1").error, "private");
  assert.equal(normalizeTarget("127.0.0.1").error, "private");
  assert.equal(normalizeTarget("localhost").error, "bad");
  assert.equal(normalizeTarget("2606:4700::1111").family, 6);
  assert.equal(normalizeTarget("[2606:4700::1111]:443").family, 6);
  assert.equal(normalizeTarget("例子.测试").host.startsWith("xn--"), true);
  assert.equal(isPrivateIp("169.254.169.254"), true);
  assert.equal(isPrivateIp("fd00:ec2::254"), true);
  assert.equal(isPrivateIp("1.1.1.1"), false);
});

test("median, stdev and display", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(stdev([2, 2, 2]), 0);
  assert.equal(fmtMs(5.74, "en"), "5.7");
  assert.equal(fmtMs(187.4, "en"), "187");
});
