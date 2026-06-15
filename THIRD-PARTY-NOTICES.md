# Third-Party Notices

Pipeline is distributed with third-party software. Each component is the property
of its respective owners and licensed under its own terms, reproduced or
referenced below. All bundled licenses are permissive (no copyleft).

## Runtime / build dependencies (npm)

Direct dependencies:

| Package            | License | Project                                         |
|--------------------|---------|-------------------------------------------------|
| imapflow           | MIT     | https://github.com/postalsys/imapflow           |
| mailparser         | MIT     | https://github.com/nodemailer/mailparser        |
| electron           | MIT     | https://github.com/electron/electron            |
| electron-builder   | MIT     | https://github.com/electron-userland/electron-builder |

Electron itself bundles Chromium and Node.js, which include additional
third-party components under BSD, MIT, and similar licenses. See Electron's
`LICENSE` and `LICENSES.chromium.html` shipped inside the packaged app.

License distribution across the full installed dependency tree (369 packages):

- MIT — 291
- ISC — 41
- BSD-2-Clause — 11
- Apache-2.0 — 8
- BSD-3-Clause — 6
- BlueOak-1.0.0 — 5
- Other permissive (MIT-0, WTFPL, CC0, dual MIT/EUPL, Python-2.0) — 7

To regenerate the full per-package license texts for a release, run e.g.:

```bash
npx license-checker --production --summary        # quick summary
npx license-checker --production --files licenses/ # copy each LICENSE file
```

## UI icons

The interface icons (pin, search, chevron, graduation cap, etc.) are from / based
on the **Lucide** icon set — https://lucide.dev — which is licensed under the
**ISC License**:

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors
2022.

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

## Company logos

Company logos shown on cards are fetched at runtime from Google's favicon service
(`https://www.google.com/s2/favicons`) and are the trademarks of their respective
owners. They are not bundled with or redistributed by this project. Set
`SHOW_LOGOS = false` in `index.html` to disable logo fetching entirely.
