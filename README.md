# Global Ping

Ping a domain or IP from 18 locations worldwide, 16 ICMP packets per location, and see **every packet**: its latency,
the jitter, and where packets went missing. A second view comes from our own server in Tokyo.

- **Worldwide view**: [Globalping](https://globalping.io)'s volunteer probes in 18 regions (China Telecom, China Unicom
  and China Mobile; Hong Kong; Taiwan, China; Tokyo; Korea; Singapore; India; Australia; London; Frankfurt; Russia; the
  UAE; South Africa; Los Angeles; New York; São Paulo) each send 16 ICMP echo requests to the target. The browser calls
  Globalping's API directly, so each visitor spends their own free allowance (250 region checks an hour per IP; one
  region sending 16 packets is one region check, and one test here uses 18).
- **Tokyo view**: our own server sends the same 16 packets. It uses none of that allowance (so it is the fallback when
  it runs out), it is the view that always knows the real loss positions, and comparing it with Globalping's Tokyo probe
  shows whether the two networks see the same path.

Nothing is stored: the page keeps no results, and the Tokyo server keeps no log and never probes private or reserved
addresses. Results worth keeping live in a result link that carries the result itself.

## Run it locally

```bash
npm ci
npm run build      # src/ → public/; commit public/ with your change
npm run dev        # http://localhost:8787, static files with the production headers
npx wrangler dev   # the same with the Worker, to open /r/ result links
npm test           # i18n keys, the measurement model, the result code, public/ up to date
```

The page calls Globalping and the Tokyo server at the addresses in `src/app.js` (`GP`, `API`). Self-hosted, change both
to your own; the CSP (`connect-src 'self' https:`) already allows them.

## Deploy

Pushing `main` deploys the Worker (Cloudflare Workers Builds runs `npm ci && npm test`, then `npx wrangler deploy`).
To host it yourself: `npx wrangler deploy`, then bind a domain to the Worker in the Cloudflare dashboard. The Worker
serves `public/` as static files and only runs for `/r/<code>` (a shared result's preview title) and 404s.

## The server

`server/` (Go) is the Tokyo view: `1ms-ping`, one program on one machine, developed next. The page's measurements work
without it (the Tokyo row says it is unavailable); see [AGENTS.md](AGENTS.md) once it lands.

## Data and privacy

The address you enter goes to Globalping (which runs the worldwide check) and to the Tokyo server. The browser makes
those requests directly, so those two see the connection's source address; we do not collect or store results, and the
Tokyo server only counts requests in memory. A result link holds the address and the result, never your own IP.
Private, loopback, link-local and multicast addresses are never probed.

MIT licensed. 1ms.dog's own operations notes live in the private repository 1ms-shell.
