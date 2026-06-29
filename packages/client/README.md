# @tibordp/prusalink-bridge

The page-facing client for the
[Bridge for PrusaLink](https://tibordp.github.io/prusalink-bridge/) browser
extension. Pure `window.postMessage` — **zero runtime dependencies**, contains no
extension code. Your web app depends on this; the user installs the extension.

Unofficial — not affiliated with or endorsed by Prusa Research. PrusaLink and
Prusa are trademarks of Prusa Research a.s.

```bash
npm install @tibordp/prusalink-bridge
```

## Usage

```ts
import { createBridge, BridgeError } from '@tibordp/prusalink-bridge'

const bridge = createBridge()

if (!(await bridge.available())) {
  // No extension answered the ping — fall back (e.g. download the g-code).
  return showDownloadFallback()
}

// requestAccess() opens a consent prompt, so call it from a user gesture (click):
button.addEventListener('click', async () => {
  try {
    const printers = await bridge.requestAccess()
    const target = printers[0]
    await bridge.print(target.id, { name: 'plot.gcode', gcode })
  } catch (e) {
    if (e instanceof BridgeError && e.code === 'DENIED') {
      // user said no
    }
  }
})
```

The extension only ever exposes `{ id, name, type, model? }` and a normalized
status. It never reveals the printer's URL or credentials.

## API

```ts
createBridge(): PrusaLinkBridge

interface PrusaLinkBridge {
  available(timeoutMs?: number): Promise<boolean>       // ping/pong, never throws
  version(): Promise<string | null>                     // extension protocol version
  requestAccess(opts?: { force? }): Promise<PrinterInfo[]>
  printers(): Promise<PrinterInfo[]>                     // already-granted printers, no prompt
  print(printerId, { name, gcode, start?, signal?, timeoutMs? }): Promise<{ jobId? }>
  status(printerId): Promise<PrinterStatus>
  cancel(printerId): Promise<void>
}
```

`gcode` may be a `string`, `Blob`, or `ArrayBuffer` — pass a `Blob`/`ArrayBuffer`
for binary `.bgcode`; the bytes are uploaded verbatim. `print()` extras:

- `signal?: AbortSignal` — abort the upload; the promise rejects with `CANCELLED`.
- `timeoutMs?: number` — upload timeout. **Default: none** (Prusa firmware can be
  slow to ingest a file, and the link may be slow).

```ts
const ac = new AbortController()
cancelButton.onclick = () => ac.abort()
await bridge.print(id, { name: 'part.bgcode', gcode: file, signal: ac.signal })
```

Errors are thrown as `BridgeError` with a `code`:

`NOT_INSTALLED · DENIED · NOT_GRANTED · NO_HOST_PERMISSION · PRINTER_UNREACHABLE ·
AUTH_FAILED · PRINTER_BUSY · CANCELLED · HTTP_ERROR · TIMEOUT · BAD_REQUEST ·
INTERNAL`

Map these to friendly UI (`DENIED` → "Permission needed", `PRINTER_UNREACHABLE` →
"Couldn't reach the printer", …). `print()` has no client-side timeout (the
upload can be long); use `signal`/`timeoutMs` to bound it.

## Notes

- `requestAccess()` must run inside a user gesture so the consent prompt is
  allowed to open.
- `requestAccess()` returns the already-granted printers **without** prompting if
  a grant exists. To let the user grant **additional** printers (e.g. they added
  a new one), call `requestAccess({ force: true })` — the prompt reopens with the
  current selection pre-checked.
- The shim filters incoming messages to `event.source === window`,
  `event.origin === location.origin`, and the relay's `source` tag, then resolves
  by `reqId`.
- The full wire protocol is exported from `@tibordp/prusalink-bridge/protocol` for
  anyone implementing a compatible bridge.
