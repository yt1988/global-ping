# AGENTS.md

For anyone working in this repository, people and AI agents alike. What the tool does is in [README.md](README.md);
the technical reasons behind it, and what was tried and dropped, are in [docs/decisions.md](docs/decisions.md).
1ms.dog's operations notes are in the private repository 1ms-shell.

## What this is

Global Ping answers "how does this domain or IP answer ICMP from around the world, and how does every single packet
look?". Three parts:

- **The page** (`src/`, built into `public/`): runs in the visitor's browser. Calls Globalping's API for the 18-region
  view, and our own server in Tokyo for the second view. The measurement model (`src/model.mjs`) is shared with the
  Worker and the tests.
- **The Worker** (`src/worker.js`): only runs for shared result links (`/r/<code>`), to give their preview a title.
  Everything else is a static file.
- **The server** (`server/`, Go): `1ms-ping`, the Tokyo view. When it isn't configured or isn't running, the page's
  Tokyo row is hidden or says it is unavailable, and the worldwide view is unaffected.

## Run it locally

```bash
npm ci
npm run build      # src/ → public/; commit public/ with your change
npm run dev        # http://localhost:8787, static files with the production headers
npx wrangler dev   # the same with the Worker, to open /r/ links
```

The page calls Globalping (`GP` in `src/app.js`) and the Tokyo server (`TOKYO_API` in `src/config.mjs`). `TOKYO_API` is
the only deployment-specific address in the page: self-hosted, point it at your own server or set it to `""`; then the
page shows no Tokyo row at all and the worldwide view keeps working.

The Tokyo server needs a Linux machine and `CAP_NET_RAW`; building, running and verifying it is
[server/README.md](server/README.md). To run it locally:

```bash
cd server
go vet ./... && go test ./...
go run . -plain -addr 127.0.0.1:12097
curl "http://127.0.0.1:12097/v1/ping?host=example.com&v=4"
```

## Test by what you changed

| You changed | Run |
|---|---|
| strings (`src/i18n/*.mjs`) | `npm test` (every language has every key, with the same placeholders and marks). Read the sentence in Chinese and Russian at 375 px wide |
| the page (`src/app.js`, `page.html`, `style.css`, `config.mjs`) | `npm run build && npm test` (the built script must parse), then test a domain, an IP, an IPv6 target and a target that doesn't answer ICMP; check the phone width |
| the model (`src/model.mjs`) | `npm test` (parsing, verdicts, findings, the target input) |
| result links (`src/code.mjs`, `src/worker.js`) | `npm test`, then open a `/r/` link under `npx wrangler dev` and check its title; a garbled code must be a 404 |
| the server (`server/`) | `go vet ./... && go test ./...` in `server/`; after deploying, the checks in `server/README` |
| the build (`scripts/build.mjs`) | `npm test` (`public/ is up to date`) |

`npm test` is what the deploy runs; it must pass.

## Deploy

- **The site**: pushing `main` deploys it (Cloudflare Workers Builds runs `npm ci && npm test`, then
  `npx wrangler deploy`). To host it yourself: `npx wrangler deploy`, then bind a domain to the Worker in the
  Cloudflare dashboard.
- **The server**: installed by hand with systemd; a push doesn't reach any machine. When `server/` changes on `main`,
  the `server` workflow tests it, builds `1ms-ping` for linux/amd64 (static) and publishes it as a GitHub Release
  tagged `server-<short commit>`, marked latest, with `SHA256SUMS`.

## Rules of the road

- Pushing `main` deploys the site: push only what is ready to go live.
- `public/` is built output, committed with the source change that made it (`npm run build`).
- No secrets and no personal email in this public repository. Where a particular deployment runs (domains, directories,
  ports, accounts) belongs with that deployment's own notes, not here; use placeholders.
- Commit messages in English. User-facing strings exist in 10 languages; English (`src/i18n/en.mjs`) is the reference.
  Every language file must have every key, with the same `{placeholders}` (the test enforces it).
- When something is decided, or tried and dropped, write it in [docs/decisions.md](docs/decisions.md) the same day.
