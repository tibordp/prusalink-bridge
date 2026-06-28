# PrusaLink Bridge — extension

MV3 browser extension (Chrome + Firefox via [WXT](https://wxt.dev)). It is the
only place printer credentials ever exist.

Unofficial — not affiliated with or endorsed by Prusa Research.

## Build & load

```bash
pnpm install
pnpm --filter @tibordp/prusalink-bridge build   # the extension uses its types
pnpm --filter prusalink-bridge-extension build  # → .output/chrome-mv3
```

- **Chrome:** `chrome://extensions` → enable Developer mode → *Load unpacked* →
  pick `.output/chrome-mv3`.
- **Firefox:** `pnpm dev:firefox`, or load `.output/firefox-mv2/manifest.json`
  via `about:debugging` → *This Firefox* → *Load Temporary Add-on*.

## Using it

1. Open the **options** page (right-click the toolbar icon → Options, or the
   *Options* link in the popup).
2. **Add printer**: name, base URL (e.g. `http://192.168.1.50`), and auth:
   - **API key** (recommended): paste the key from your printer's PrusaLink
     settings → sent as `X-Api-Key`.
   - **HTTP Digest**: username `maker` on the MK4, plus the password.
3. **Test connection** / **Save** prompts for a least-privilege host permission
   for exactly that host (`http://192.168.1.50/*`). Without it the extension
   literally cannot reach the printer.
4. A web app calls `requestAccess()` (see `@tibordp/prusalink-bridge`). The
   extension's toolbar popup opens with a consent prompt showing the **real
   origin**; pick which printers to share and whether to confirm each print.

The **popup** shows live printer status, the sites you've granted (with one-click
revoke), and a **Pause all** kill switch that cancels every print request.

### Consent / confirm prompts (toolbar popup)

Consent and per-print confirmation render **inside the toolbar action popup**
(anchored to the extension icon), not in a separate window. When a site needs
your approval the extension tries to open the popup automatically
(`action.openPopup()`) and always shows a **badge** on the toolbar icon as the
dependable nudge — click the icon to review. Closing the popup without choosing
resolves the request as `DENIED` / `CANCELLED` (detected via a `runtime` port,
so it's reliable). Multiple pending requests queue and are reviewed one at a time.

## Architecture

| File | Role |
|---|---|
| `entrypoints/relay.content.ts` | Origin-pinning relay between page `postMessage` and the background. Answers `ping` locally. Top frame only. |
| `entrypoints/background.ts` | Consent gate, registry access, PrusaLink orchestration, prompt queue. Replies to the page by `reqId` → tab so it survives service-worker recycling. |
| `entrypoints/options/` | Printer CRUD, host-permission requests, Connection Test, grant management. |
| `entrypoints/popup/` | Status + grants + pause-all **and** the consent / per-print confirm prompts (see below). |
| `src/ui/consent-view.ts`, `src/ui/confirm-view.ts` | The prompt UIs, rendered inside the popup. |
| `src/lib/prusalink.ts` | PrusaLink v1 client (+ legacy fallback): probe, status, cancel, upload-and-print. |
| `src/lib/digest.ts`, `src/lib/md5.ts` | RFC 2617 Digest auth (WebCrypto has no MD5, so a tiny one is bundled). |
| `src/lib/normalize.ts` | Firmware status → the page-facing `PrinterStatus` enum. |

## Security notes

- **Origin is authoritative.** Grants key on the browser-reported `sender.origin`.
  The page-supplied `appName` is decorative and rendered as *"claims to be …"*.
- **Credential confinement.** Secrets are written only by the options page and
  read only by the background's PrusaLink client. They never appear in any
  message that can reach a page, nor in error messages.
- **Least privilege.** No static `host_permissions`; the extension requests an
  optional permission per printer host at add-time and tolerates out-of-band
  revocation (`NO_HOST_PERMISSION`).
- **Storage at rest is NOT encrypted.** `chrome.storage.local` holds your printer
  secrets in the clear. This is acceptable for a self-hosted LAN tool — don't
  reuse a sensitive password. (Stated on the options page too.)

## Networking to the printer

The background fetches the printer over plain LAN HTTP, using the per-printer
host permission. If a future Chrome version restricts Private Network Access for
extension requests, that's the first place to look when LAN fetches break.

## Tests

```bash
pnpm --filter prusalink-bridge-extension test   # vitest: md5, digest, normalize
```
