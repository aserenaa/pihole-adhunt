# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/aserenaa/pihole-adhunt/security/advisories/new)
(**Security → Report a vulnerability**). Do not open a public issue.

Include the adhunt commit, your OS, Node.js and Pi-hole versions, and the steps to reproduce.
**Never include your Pi-hole password, HAR files, query logs, IP addresses or hostnames from your
network.** Reports are acknowledged as soon as possible; fixes land on `main`, which is the only
supported version.

## What adhunt stores

| What | Where |
|---|---|
| Pi-hole app password | Your OS keychain (service `adhunt-pihole`, account `pihole`), or only in memory when `PIHOLE_PASSWORD` is set. Never written to a file, never passed on the command line, and typed without echo. |
| Pi-hole URL and DNS server | `config.json` in the config directory |
| Last scan (domains a page or device contacted, device IP in device mode) | `state/last-scan.json` |
| Entries added to Pi-hole, for `undo` | `state/history.json` |
| Compiled filter lists | `cache/ghostery-ads-tracking.bin` |

The config directory is `~/.config/adhunt/` on macOS and Linux (or `$XDG_CONFIG_HOME/adhunt`),
`%APPDATA%\adhunt\` on Windows, or `ADHUNT_HOME`. Its `state/` files describe your browsing and your
devices, so on macOS and Linux adhunt writes them readable only by you (`0600`, in `0700` folders).

## Threat model notes

- **Pi-hole API transport.** Over `http://` the app password is sent in clear text. adhunt warns
  when a plain-HTTP URL points outside private, link-local or VPN (`100.64.0.0/10`) addresses.
  Prefer HTTPS: copy `/etc/pihole/tls_ca.crt` from Pi-hole, set `NODE_EXTRA_CA_CERTS` to it, and use
  `https://pi.hole` (the name must resolve on this computer).
- **Scanned pages run their scripts.** adhunt loads the page, including its ads, in headless Chrome,
  Edge or Chromium with the browser sandbox enabled. It only falls back to running without the
  sandbox when the system cannot provide one, and says so. Scan pages you would open anyway.
- **Every Pi-hole change is reviewed and reversible.** Nothing is blocked without confirmation
  (or `--yes`), every entry is tagged `adhunt · …`, and `undo`, `list` and `remove` only touch
  those entries.
- **HAR files contain cookies and session tokens.** adhunt only reads them locally; never share
  them.
- **Third-party data.** Filter lists are downloaded from the
  [ghostery/adblocker](https://github.com/ghostery/adblocker) repository over HTTPS. They decide
  what is proposed, never what is blocked without your review.
