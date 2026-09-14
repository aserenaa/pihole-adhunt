# Contributing

Thanks for helping make adhunt better!

## Setup

adhunt uses [pnpm](https://pnpm.io) (not npm or yarn) and Node.js 20.12 or newer.

```bash
pnpm install
pnpm test          # node:test; the capture test needs Chrome, Edge or Chromium and is skipped without one
pnpm lint          # Biome: formatting and lint rules
pnpm format        # apply Biome's fixes
```

Tests must not need a Pi-hole or external websites: use local `node:http` servers, synthetic
fixtures and pure functions. The only network access allowed is the one-time download of
Ghostery's prebuilt filter engine.

## Pull requests

- Keep each pull request focused, with tests for new behavior.
- Run `pnpm lint` and `pnpm test` before pushing; CI runs both on macOS, Linux and Windows.
- Commit messages are a single capitalized, imperative summary of 50 characters or less
  (for example `Add --group to choose the Pi-hole group`).
- Update `README.md` when a command, option or behavior changes.

### Changes to the safe list

[`src/safe.js`](src/safe.js) decides what adhunt never proposes to block. A pull request that adds
a domain must explain **what breaks** when it is blocked (a site, an app, a login flow…). A pull
request that removes one must explain why blocking it is harmless.

### Changes to the Pi-hole integration

Mention the Pi-hole (FTL) version you tested against. adhunt supports Pi-hole v6 and newer.

## Privacy

Never attach HAR files, Pi-hole query logs, passwords, IP addresses or hostnames from your network
to issues or pull requests. Use `example.com`-style domains and
[documentation IP ranges](https://www.rfc-editor.org/rfc/rfc5737) (`192.0.2.x`) in fixtures and
examples.

Security issues go through [SECURITY.md](SECURITY.md), not public issues.
