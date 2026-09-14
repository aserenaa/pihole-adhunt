# Third-party notices

adhunt is licensed under the [MIT License](LICENSE). It depends on the projects below, which keep
their own licenses. None of them are modified or bundled in this repository: npm packages are
installed by your package manager, and filter lists are downloaded when adhunt runs.

## npm dependencies

| Package | License | Source |
|---|---|---|
| `@ghostery/adblocker` | MPL-2.0 | https://github.com/ghostery/adblocker |
| `@ghostery/trackerdb` | CC BY-NC-SA 4.0 | https://github.com/ghostery/trackerdb |
| `playwright-core` | Apache-2.0 | https://github.com/microsoft/playwright |
| `tldts` | MIT (includes Public Suffix List data, MPL-2.0) | https://github.com/remusao/tldts |
| `@napi-rs/keyring` | MIT | https://github.com/Brooooooklyn/keyring-node |
| `@biomejs/biome` (development only) | MIT OR Apache-2.0 | https://github.com/biomejs/biome |

### Ghostery TrackerDB

TrackerDB is licensed under
[Creative Commons Attribution-NonCommercial-ShareAlike 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
adhunt uses it at runtime to name the company and category behind a domain. It is installed as a
dependency, not redistributed with adhunt. **Its non-commercial clause applies to the TrackerDB data
itself: review it before using adhunt commercially.**

## Filter lists (downloaded at runtime)

`@ghostery/adblocker` downloads these lists from the
[ghostery/adblocker](https://github.com/ghostery/adblocker) repository and adhunt caches the
compiled engine in its local cache directory for three days.

| List | License | Source |
|---|---|---|
| EasyList, EasyPrivacy | GPLv3 or CC BY-SA 3.0 | https://easylist.to |
| uBlock Origin filter lists | GPLv3 | https://github.com/uBlockOrigin/uAssets |
| Peter Lowe's ad and tracking server list | See the list's terms of use | https://pgl.yoyo.org/adservers/ |

adhunt is not affiliated with or endorsed by Pi-hole, Ghostery, EasyList, uBlock Origin or
Microsoft.
