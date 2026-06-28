# PrusaLink Bridge

A browser extension that lets **any web app** drive **your own** PrusaLink
printers over the LAN — gated by an explicit, per-origin consent prompt. Printer
URLs and credentials live only in the extension; the calling web app never sees
them.

> **Unofficial.** This is a community project, not affiliated with or endorsed by
> Prusa Research. PrusaLink and Prusa are trademarks of Prusa Research a.s.; they
> are used here only to describe what the extension talks to.

## Why

PrusaLink runs on plain HTTP on your LAN. A web app served over HTTPS can't talk
to it directly (mixed content + no credentials to share safely). This extension
is the trusted middle: the page asks the extension (via a tiny postMessage
client), the user consents once per site, and the extension makes the actual
printer calls with credentials it never reveals to the page.

```
web app ──@tibordp/prusalink-bridge──▶ content-script relay ──▶ background SW ──▶ PrusaLink
          (postMessage)                (origin-pinned)          (creds, consent)   (LAN HTTP)
```

The page **cannot** lie about its origin — every grant keys on the
browser-reported `sender.origin`, never on anything the page sends.

## Layout (pnpm monorepo)

| Path               | What                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| `extension/`       | The MV3 extension, built with [WXT](https://wxt.dev) (Chrome + Firefox).              |
| `packages/client/` | `@tibordp/prusalink-bridge` — the zero-dependency page-facing shim, published to npm. |
| `manual-test/`     | A plain HTML page that exercises the client end-to-end against a real printer.        |

## Develop

```bash
pnpm install
pnpm build:client            # build the shim (extension depends on its types)

pnpm dev                     # WXT dev server, Chrome (loads an unpacked profile)
pnpm dev:firefox             # WXT dev server, Firefox

pnpm build:extension         # production build → extension/.output/chrome-mv3
pnpm build:firefox           # → extension/.output/firefox-mv2
pnpm zip                     # packaged zip for the store

pnpm -r test                 # unit tests (md5 / digest / status normalization)
pnpm -r typecheck
```

Load the unpacked build from `extension/.output/chrome-mv3` via
`chrome://extensions` → _Load unpacked_. See [`extension/README.md`](./extension/README.md)
for the install + security details, and [`packages/client/README.md`](./packages/client/README.md)
for the page API.

## Manual end-to-end test

```bash
pnpm build:client
npx serve .                  # or: python3 -m http.server
# open http://localhost:3000/manual-test/  (with the extension loaded)
```
