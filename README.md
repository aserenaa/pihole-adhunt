<h1 align="center">adhunt</h1>

<p align="center">
  <strong>Point it at a page full of ads. Get the domains serving them. Block them in Pi-hole — with review and undo.</strong>
</p>

<p align="center">
  <a href="https://github.com/aserenaa/pihole-adhunt/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/aserenaa/pihole-adhunt/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A520.12-339933?logo=node.js&logoColor=white">
  <img alt="Pi-hole" src="https://img.shields.io/badge/Pi--hole-v6-96060C?logo=pi-hole&logoColor=white">
  <img alt="Platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

---

Pi-hole blocklists are great, but every site has a few ad and tracking domains that slip through.
Finding them by hand means digging through DevTools and guessing which domains are safe to block.

**adhunt** does it for you. It loads the page in a real (headless) browser, records every request,
classifies each one with the same filter lists uBlock Origin uses, and shows exactly what is still
getting past your Pi-hole. You pick what to block; adhunt adds it through the Pi-hole API, tagged so
you can list or undo it later.

```text
$ adhunt https://news.example.com
  · loading EasyList/EasyPrivacy + TrackerDB…
  · opening the page…
  · cookie banner accepted
  · scrolling for 20s to load ads…
  · classifying and querying Pi-hole's DNS…

adhunt · https://news.example.com/
  Example News · Chrome 140.0.7339.81 · 412 requests · 87 domains

🔴 BLOCK — ads/trackers with a full-domain EasyList rule
  [x]  1  amazon-adsystem.com (+subdomains)  Amazon Advertising · advertising · 14 req
           hosts: aax.amazon-adsystem.com, c.amazon-adsystem.com
           rule ||amazon-adsystem.com^
  [x]  2  adnxs.com (+subdomains)  AppNexus · advertising · 6 req
           hosts: ib.adnxs.com
           rule ||adnxs.com^

🟠 REVIEW — likely ads, but blocking may break something
  [ ]  3  googletagmanager.com (+subdomains)  Google Tag · advertising · 2 req
           hosts: www.googletagmanager.com
           rule ||googletagmanager.com^$3p · ⚠ may break site features
  [ ]  4  rtb.bidder.example  5 req
           loaded by ib.adnxs.com (ad)

✅ Already blocked by Pi-hole (3): cdn.taboola.com, securepubads.g.doubleclick.net, trc.taboola.com
⚪ Ignored: 9 first-party · 12 safe infrastructure (ajax.googleapis.com, cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com … +8)

Block which? [r = recommended (1 2) · numbers: 1 3 5-7 · r 9 · Enter = nothing] r

  ＋ amazon-adsystem.com (+subdomains)
  ＋ adnxs.com (+subdomains)

Blocked 2 in Pi-hole · verified via DNS: 2/2
Undo with: adhunt undo · Devices may keep cached DNS answers until they expire.
```

## Features

- 🔍 **Real browser capture** — headless Chrome or Edge via Playwright; accepts cookie banners, scrolls for lazy-loaded ads, optionally clicks to reveal pop-unders, desktop or iPhone emulation.
- 🧠 **Battle-tested classification** — [Ghostery's adblocker engine](https://github.com/ghostery/adblocker) with EasyList, EasyPrivacy and uBlock Origin lists, plus [TrackerDB](https://github.com/ghostery/trackerdb) to name the company behind each domain.
- 🧭 **Follows ad chains** — flags unknown domains that were loaded *by* an ad script or ad iframe.
- ✅ **Knows what Pi-hole already blocks** — asks Pi-hole's own DNS, no matter which DNS your computer uses, and reads the answer according to your blocking mode (`NULL`, `IP`, `IP_NODATA_AAAA`, `NX` or `NODATA`).
- 🛡️ **Safe by default** — never blocks without confirmation, never proposes critical infrastructure (Google, CDNs, Apple, Microsoft…), and flags rules that tend to break sites.
- ↩️ **Reversible** — every entry is tagged `adhunt · site · date`; `undo`, `list` and `remove` are built in.
- 📱 **Device mode** — no browser needed: analyze what a phone, TV or app asked your Pi-hole for in the last few minutes.
- 📦 **HAR mode** — analyze a `.har` exported from any browser's DevTools.
- 🔐 **Credentials in your OS keychain** — macOS Keychain, Windows Credential Manager or Linux Secret Service (or the `PIHOLE_PASSWORD` environment variable).

## Requirements

- **Pi-hole v6** or newer and its **app password**
- **Node.js 20.12+** and **[pnpm](https://pnpm.io/installation)**
- **Google Chrome** or **Microsoft Edge** (or let Playwright download Chromium)

## Installation

```bash
git clone https://github.com/aserenaa/pihole-adhunt.git
cd pihole-adhunt
pnpm install
pnpm link --global      # makes the `adhunt` command available
adhunt setup            # Pi-hole URL + app password (stored in your OS keychain)
```

`adhunt setup` asks for the password without echoing it, checks that it works, and only then
stores it. Without a keychain (for example on a headless Linux server), set `PIHOLE_PASSWORD` instead.

<details>
<summary><strong>Windows (PowerShell)</strong></summary>

```powershell
winget install OpenJS.NodeJS.LTS
winget install pnpm.pnpm
git clone https://github.com/aserenaa/pihole-adhunt.git
cd pihole-adhunt
pnpm install
pnpm setup               # adds pnpm's global bin folder to PATH, then restart the terminal
pnpm link --global
adhunt setup
```

Microsoft Edge is used automatically when Chrome isn't installed. Windows Terminal is recommended for colors and emoji; in Git Bash (mintty), run `winpty adhunt setup` so the password prompt works.
</details>

<details>
<summary><strong>No Chrome or Edge?</strong></summary>

```bash
pnpm exec playwright-core install chromium
```
</details>

### Getting the Pi-hole app password

Pi-hole web UI → **Settings → Web interface / API → Advanced settings → Configure app password**.

> [!WARNING]
> Pi-hole v6 has a **single** app password. If another integration (a dashboard, Home Assistant…) already uses it, **reuse it** — generating a new one breaks the others.

## Usage

```bash
adhunt https://site-with-ads.example        # scan, review, block
adhunt site.example --mobile                # as an iPhone (mobile ads differ)
adhunt site.example --click                 # click the page to reveal pop-ups / pop-unders
adhunt site.example --headed --wait 40      # visible browser, longer wait (sites that detect bots)
adhunt --har capture.har                    # analyze a DevTools HAR export instead
```

| Command | What it does |
|---|---|
| `adhunt <url>` | Scan a page and choose what to block |
| `adhunt block r` · `adhunt block 1 4 7-9` | Block from the last scan (recommended, or by number) |
| `adhunt undo` | Remove the last batch you blocked |
| `adhunt list` | Show everything adhunt added to Pi-hole |
| `adhunt remove <domain>` | Remove one entry added by adhunt |
| `adhunt clients` | Top Pi-hole clients (to find a device's IP) |
| `adhunt device <ip> --minutes 10` | Analyze a device's recent DNS queries |
| `adhunt setup` · `adhunt logout` | Configure the Pi-hole URL and password, or forget the stored password |

| Option | Description |
|---|---|
| `-m, --mobile` | Emulate an iPhone |
| `-w, --wait <s>` | Seconds to scroll while waiting for ads (default `20`, max `300`) |
| `--click` | Click the page to trigger pop-ups |
| `--headed` | Show the browser window |
| `--har <file>` | Analyze a HAR file instead of opening a browser (works without a Pi-hole) |
| `-y, --yes` | Block the recommended entries without asking |
| `-g, --group <g>` | Add blocked domains to this Pi-hole group, by name or id (default: `Default`) |
| `--json` | Print the analysis as JSON |
| `--minutes <n>` | Device mode: minutes of query log to analyze (default `15`, max `1440`) |

> [!TIP]
> **Device mode:** use the app or site on the device for a minute, then run `adhunt device <ip> --minutes 5`.

## How it decides

| Group | Criteria | Preselected |
|---|---|---|
| 🔴 **Block** | An EasyList / EasyPrivacy / uBlock Origin rule blocks the **whole domain** (`\|\|example.com^`) and it isn't known to break sites | ✅ |
| 🟠 **Review** | The rule exists but often breaks features (Tag Manager, Facebook SDK…), every request matched path-level rules, it opened a pop-up, or it was loaded by an ad | — |
| 🟡 **Unknown** | Third-party domain with no matching rule | — |
| ✅ ⚪ ℹ️ | Already blocked · first-party or safe infrastructure · ads on a path of a required domain | hidden |

- Full-domain rules become Pi-hole **wildcard** entries (`(\.|^)example\.com$`, the same format as `pihole --wild`); everything else is added as an exact domain.
- Only rules without a path translate to DNS. `||youtube.com/pagead/` can't be blocked by Pi-hole without blocking YouTube — adhunt tells you instead of breaking things.

## Limitations

- **DNS blocking can't stop first-party ads.** YouTube, Twitch, Facebook and Instagram serve ads from the same domains as their content.
- Some sites detect automation and serve fewer ads — try `--headed`, `--mobile`, or a HAR export from your everyday browser.
- Devices may keep cached DNS answers for a while after you block something.
- With Pi-hole's `NX` blocking mode, a blocked domain and a nonexistent one get the same answer, so adhunt lists them together as "already blocked (or nonexistent)".

## Privacy & security

- adhunt talks to your Pi-hole, to the page you scan (and whatever that page loads), and to GitHub to refresh the filter lists every few days. Nothing else.
- The app password lives in your **OS keychain** (macOS Keychain, Windows Credential Manager or Secret Service) or the `PIHOLE_PASSWORD` environment variable; adhunt never writes it to a file.
- Local state (config, last scan, undo history, filter cache) lives in `~/.config/adhunt/` on macOS and Linux (or `$XDG_CONFIG_HOME/adhunt`), `%APPDATA%\adhunt\` on Windows, or `ADHUNT_HOME` if set.
- **Use HTTPS or a trusted network.** Over `http://` the password travels in clear text — fine on your LAN or through a VPN such as WireGuard or Tailscale, not across the internet. adhunt warns when a plain-HTTP URL points outside private, link-local or VPN (`100.64.0.0/10`) addresses and local names such as `pi.hole` or `*.local`. For HTTPS with Pi-hole's self-signed certificate, copy `/etc/pihole/tls_ca.crt` from your Pi-hole, set `NODE_EXTRA_CA_CERTS=/path/to/tls_ca.crt`, and use `https://pi.hole`.
- **HAR files contain cookies and session tokens.** Never share them or attach them to issues.

See [SECURITY.md](SECURITY.md) for what adhunt stores and how to report a vulnerability.

## Configuration

| Variable | Purpose |
|---|---|
| `PIHOLE_URL` | Pi-hole base URL (overrides `adhunt setup`) |
| `PIHOLE_PASSWORD` | App password (overrides the keychain) |
| `PIHOLE_DNS` | DNS server used for "already blocked" checks, with an optional port (`192.0.2.53:1053`); defaults to the Pi-hole host |
| `ADHUNT_HOME` | Custom directory for config, state and cache |
| `NO_COLOR` | Disable colored output |

## Troubleshooting

<details>
<summary><code>adhunt: command not found</code></summary>

Run `pnpm setup`, restart the terminal, then `pnpm link --global` again — or run it directly with `node path/to/pihole-adhunt/src/cli.js`.
</details>

<details>
<summary><code>Cannot find module …corepack…pnpm.cjs</code></summary>

Your corepack-managed pnpm is broken. Run `corepack disable pnpm` and install pnpm another way (`brew install pnpm`, `winget install pnpm.pnpm`, or the standalone installer).
</details>

<details>
<summary><code>No browser found</code></summary>

Install Google Chrome, or run `pnpm exec playwright-core install chromium`.
</details>

<details>
<summary>macOS asks whether <code>node</code> may use "adhunt-pihole"</summary>

The password was stored by another program (for example the `security` command) or by an older Node.js binary. Choose **Always Allow**, or run `adhunt setup` again to store it from the current one.
</details>

<details>
<summary><code>Could not store the password in the system keyring</code></summary>

Linux needs a running Secret Service provider such as GNOME Keyring or KWallet. On servers and containers without one, set `PIHOLE_PASSWORD` instead.
</details>

<details>
<summary><code>Pi-hole v6 or newer is required</code></summary>

adhunt uses the REST API introduced in Pi-hole v6. Check that `PIHOLE_URL` (or the URL from `adhunt setup`) points at your Pi-hole, or upgrade with `pihole -up`.
</details>

## Development

```bash
pnpm install
pnpm test          # node:test; the capture test is skipped when no Chrome, Edge or Chromium is installed
pnpm lint          # Biome
```

The safe list lives in [`src/safe.js`](src/safe.js). Pull requests that add domains should explain what breaks when they're blocked. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

Built on [Ghostery adblocker](https://github.com/ghostery/adblocker), [Ghostery TrackerDB](https://github.com/ghostery/trackerdb), [EasyList](https://easylist.to), [uBlock Origin](https://github.com/gorhill/uBlock) filter lists, [Playwright](https://playwright.dev) and [Pi-hole](https://pi-hole.net). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

> [!NOTE]
> TrackerDB is licensed CC BY-NC-SA 4.0 (non-commercial). adhunt installs it as a dependency — review its license before any commercial use.

## License

[MIT](LICENSE)

<sub>Not affiliated with Pi-hole, Ghostery, EasyList or uBlock Origin.</sub>
