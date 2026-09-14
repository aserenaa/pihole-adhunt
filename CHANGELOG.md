# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Scan a page in headless Chrome, Edge or Chromium (with the browser sandbox on), accept cookie
  banners, scroll for lazy-loaded ads and optionally click to reveal pop-unders; desktop or iPhone
  emulation.
- Classify requests with Ghostery's adblocker engine (EasyList, EasyPrivacy, uBlock Origin lists)
  and label owners with TrackerDB; follow ad chains through initiators and frames.
- Check what Pi-hole already blocks through its own DNS, for every blocking mode.
- Block with review through the Pi-hole v6 API, as wildcard or exact entries tagged `adhunt`, with
  `undo`, `list`, `remove` and `--group`.
- Arrow-key menu to choose what to block (space to mark, enter to confirm), with typed selection
  through `--no-menu`, `TERM=dumb` or `adhunt block`.
- `PIHOLE_DNS` accepts a port, for Pi-hole containers that publish DNS on another port.
- Device mode (`adhunt device`, `adhunt clients`) and HAR mode (`--har`).
- `adhunt setup` and `adhunt logout`, with the password in the macOS Keychain, Windows Credential
  Manager or Secret Service.
- Warnings for plain-HTTP Pi-hole URLs outside the local network and for Pi-hole versions older
  than v6.

[Unreleased]: https://github.com/aserenaa/pihole-adhunt/commits/main
