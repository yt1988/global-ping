# 1ms-ping — Global Ping's server (the Tokyo view)

One static Go program on one Linux machine. It sends 16 ICMP echo requests to the address a visitor asks about,
0.5 s apart, and reports each packet's round-trip time and TTL. It is the page's second view: it uses none of
Globalping's allowance, always knows the real loss positions, and can be compared with Globalping's Tokyo probe.

It never probes private, reserved, link-local, multicast or its own addresses; it keeps no log and no stored results.
The counts that stop abuse live in memory and are cleared on restart.

## Endpoints

| Request | Answer |
|---|---|
| `GET /healthz` | `ok` |
| `GET /v1/ping?host=<domain or IP>&v=4\|6` | JSON: `{ok, host, ip, family, sent, rcv, timings:[{i, rtt, ttl}]}`; `rtt`/`ttl` are `null` for a packet with no reply |

A refusal is `{ok:false, k}` with `k` one of `bad` (HTTP 400), `private`, `dns`, `fail` (HTTP 200), or `limit` /
`busy` (HTTP 429, with `retry` seconds). `v` is ignored for an IP literal. CORS is only returned to the page's
origin(s) — `-origin`, comma separated; `localhost` is always allowed, for local work.

## Build and run it

Needs Go 1.24 or newer, and a Linux machine for real ICMP (raw sockets).

```bash
cd server
go vet ./... && go test ./...          # the handler and limits; ICMP is injected in the tests, so no privileges needed
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o 1ms-ping .
```

Running it needs permission to open raw ICMP sockets: either root, or a systemd unit with `CAP_NET_RAW` (the unit in
this directory). For a quick local test, root or this capability is still needed; `-plain` only drops TLS:

```bash
sudo ./1ms-ping -plain -addr 127.0.0.1:12097
curl "http://127.0.0.1:12097/v1/ping?host=example.com&v=4"
```

With TLS, point `-cert` / `-key` at the certificate (or use the systemd `LoadCredential=` in the unit):

```bash
./1ms-ping -addr :2097 -cert /path/fullchain.pem -key /path/privkey.pem -origin https://<page-domain>
```

### The systemd unit

[1ms-ping.service](1ms-ping.service) is a hardened unit to copy to `/etc/systemd/system/`; change the placeholders
(`<user>`, `<app>`, `<public-ip>`, `<api-domain>`, `<page-domain>`) and the certificate paths, then:

```bash
systemctl daemon-reload
systemctl enable --now 1ms-ping
```

The unit gives the program only `CAP_NET_RAW` and nothing else, and the certificate is read through `LoadCredential=`.
Renewing the certificate must restart the service (a certbot deploy hook).

## Limits (all in memory, per hour unless noted)

| Limit | Value |
|---|---|
| tests per visitor IP | 20 |
| tests to one target address (whoever asks) | 60 |
| tests the whole site starts per minute / hour | 120 / 2000 |
| tests at the same time / per visitor | 32 / 2 |
| one test | up to 12 s (16 packets, 0.5 s apart, last reply up to 2 s late) |

There is no result cache on purpose: a ping is a snapshot of *now*; a cached answer would report an old network.

## Verify it

```bash
systemctl is-active 1ms-ping
ss -tlnp | grep ':2097'
systemctl show 1ms-ping -p MemoryCurrent -p AmbientCapabilities
journalctl -u 1ms-ping -n 20        # normally empty: no access log
```

From another machine, over IPv4 and IPv6 (`U=https://<api-domain>:2097`):

```bash
curl -4 "$U/healthz"; curl -6 "$U/healthz"                     # ok, ok, with a valid certificate
curl -4 -H 'Origin: https://<page-domain>' -D - "$U/v1/ping?host=example.com&v=4"
                                                               # CORS header, ok:true, 16 timings
curl -4 "$U/v1/ping?host=127.0.0.1&v=4"                        # k:"private", no packets sent
curl -4 "$U/v1/ping?host=169.254.169.254&v=4"                  # k:"private" (cloud metadata: must never work)
```

The 6th different target in an hour, and the 61st test to one address, answer 429 with `"k":"limit"`.
