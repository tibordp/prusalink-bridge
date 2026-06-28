/**
 * @tibordp/prusalink-bridge — the page-facing API.
 *
 * Pure `window.postMessage` transport to the extension's content-script relay;
 * contains no extension code and has zero runtime dependencies.
 */

import {
  SOURCE_CS,
  SOURCE_PAGE,
  type BridgeErrorCode,
  type Method,
  type PongResult,
  type PrintArgs,
  type PrinterInfo,
  type PrinterStatus,
  type RequestEnvelope,
  type ResponseEnvelope,
} from './protocol'

export type {
  BridgeErrorCode,
  PrinterInfo,
  PrinterState,
  PrinterStatus,
  PrintArgs,
} from './protocol'
export { PROTOCOL_VERSION } from './protocol'

export class BridgeError extends Error {
  readonly code: BridgeErrorCode
  readonly httpStatus?: number
  constructor(code: BridgeErrorCode, message: string, httpStatus?: number) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
    this.httpStatus = httpStatus
    // Restore prototype chain for transpiled-to-ES5 consumers.
    Object.setPrototypeOf(this, BridgeError.prototype)
  }
}

export interface PrusaLinkBridge {
  /** True if an extension is present (ping/pong, ~300ms timeout). Never throws. */
  available(timeoutMs?: number): Promise<boolean>
  /** Extension's API protocol version (semver), or null if not installed. */
  version(): Promise<string | null>
  /**
   * Trigger the consent prompt (must be called from a user gesture). Resolves
   * with the printers the user granted to this origin, or throws DENIED. Returns
   * immediately (no prompt) if a grant already exists — unless `force` is set,
   * which always reopens the prompt (with current picks pre-checked) so the user
   * can add or remove printers.
   */
  requestAccess(opts?: {
    /** Always show the consent prompt, even if a grant already exists. Use this
     *  to let the user grant access to additional printers. */
    force?: boolean
  }): Promise<PrinterInfo[]>
  /** Printers already granted to this origin; [] if none. No prompt. */
  printers(): Promise<PrinterInfo[]>
  print(printerId: string, args: PrintArgs): Promise<{ jobId?: string }>
  status(printerId: string): Promise<PrinterStatus>
  cancel(printerId: string): Promise<void>
}

/** Per-method response timeouts (ms). `print` has no timeout: it includes an
 *  upload plus a possible interactive confirm prompt. */
const TIMEOUTS: Partial<Record<Method, number>> = {
  ping: 300,
  printers: 5_000,
  status: 15_000,
  cancel: 15_000,
  // requestAccess + print are interactive → no client-side timeout.
}

function randomId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Fallback for older/insecure contexts.
  return 'r-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

interface Pending {
  resolve: (result: unknown) => void
  reject: (err: unknown) => void
  timer: ReturnType<typeof setTimeout> | null
}

class Bridge implements PrusaLinkBridge {
  private readonly pending = new Map<string, Pending>()
  private listening = false

  private ensureListener(): void {
    if (this.listening) return
    this.listening = true
    window.addEventListener('message', this.onMessage)
  }

  private readonly onMessage = (event: MessageEvent): void => {
    // Only same-window, same-origin messages from the relay.
    if (event.source !== window) return
    if (event.origin !== window.location.origin) return
    const data = event.data as ResponseEnvelope | undefined
    if (!data || data.source !== SOURCE_CS || typeof data.reqId !== 'string') {
      return
    }
    const entry = this.pending.get(data.reqId)
    if (!entry) return
    this.pending.delete(data.reqId)
    if (entry.timer) clearTimeout(entry.timer)
    if (data.ok) {
      entry.resolve(data.result)
    } else {
      const e = data.error
      entry.reject(
        new BridgeError(
          e?.code ?? 'INTERNAL',
          e?.message ?? 'Bridge request failed',
          e?.httpStatus,
        ),
      )
    }
  }

  private send<T>(
    method: Method,
    args?: unknown,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    this.ensureListener()
    const reqId = randomId()
    const envelope: RequestEnvelope = {
      source: SOURCE_PAGE,
      reqId,
      method,
      args,
    }
    return new Promise<T>((resolve, reject) => {
      const effectiveTimeout = timeoutMs ?? TIMEOUTS[method]
      let timer: ReturnType<typeof setTimeout> | null = null
      if (effectiveTimeout && effectiveTimeout > 0) {
        timer = setTimeout(() => {
          if (!this.pending.has(reqId)) return
          this.pending.delete(reqId)
          reject(new BridgeError('TIMEOUT', `Bridge "${method}" timed out`))
        }, effectiveTimeout)
      }

      const settle = (fn: () => void) => {
        if (!this.pending.has(reqId)) return
        this.pending.delete(reqId)
        if (timer) clearTimeout(timer)
        fn()
      }

      this.pending.set(reqId, {
        resolve: resolve as (r: unknown) => void,
        reject,
        timer,
      })

      // Caller-driven cancel: tell the background to abort, reject locally now.
      if (signal) {
        const onAbort = () =>
          settle(() => {
            this.postAbort(reqId)
            reject(new BridgeError('CANCELLED', 'Request aborted'))
          })
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      try {
        // Same-window, same-origin post; the relay validates and forwards.
        window.postMessage(envelope, window.location.origin)
      } catch (err) {
        settle(() =>
          reject(
            new BridgeError(
              'INTERNAL',
              'Failed to post message: ' + String(err),
            ),
          ),
        )
      }
    })
  }

  private postAbort(reqId: string): void {
    try {
      window.postMessage(
        { source: SOURCE_PAGE, reqId, abort: true },
        window.location.origin,
      )
    } catch {
      // best-effort — the page is going away anyway
    }
  }

  async available(timeoutMs = 300): Promise<boolean> {
    try {
      const res = await this.send<PongResult>('ping', undefined, timeoutMs)
      return res?.pong === true
    } catch {
      return false
    }
  }

  async version(): Promise<string | null> {
    try {
      const res = await this.send<PongResult>('ping', undefined, 300)
      return res?.version ?? null
    } catch {
      return null
    }
  }

  requestAccess(opts?: { force?: boolean }): Promise<PrinterInfo[]> {
    return this.send<PrinterInfo[]>('requestAccess', { force: opts?.force })
  }

  printers(): Promise<PrinterInfo[]> {
    return this.send<PrinterInfo[]>('printers')
  }

  print(printerId: string, args: PrintArgs): Promise<{ jobId?: string }> {
    if (!printerId || !args || !args.name || args.gcode == null) {
      return Promise.reject(
        new BridgeError('BAD_REQUEST', 'print requires printerId, name, gcode'),
      )
    }
    return this.send<{ jobId?: string }>(
      'print',
      {
        printerId,
        name: args.name,
        gcode: args.gcode,
        start: args.start,
        timeoutMs: args.timeoutMs,
      },
      undefined,
      args.signal,
    )
  }

  status(printerId: string): Promise<PrinterStatus> {
    return this.send<PrinterStatus>('status', { printerId })
  }

  async cancel(printerId: string): Promise<void> {
    await this.send<void>('cancel', { printerId })
  }
}

export function createBridge(): PrusaLinkBridge {
  return new Bridge()
}
