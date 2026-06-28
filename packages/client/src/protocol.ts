/**
 * Shared wire protocol between the page (client shim), the content-script relay,
 * and the background service worker. This module is dependency-free and is the
 * single source of truth for message shapes and constants. The extension imports
 * these types/constants too (via the workspace dependency).
 */

/** Protocol version (semver) reported by `pong`. Bump on breaking wire changes. */
export const PROTOCOL_VERSION = '0.1.0'

/** `source` tag on messages the page sends toward the relay. */
export const SOURCE_PAGE = 'prusalink-page' as const
/** `source` tag on messages the relay sends back to the page. */
export const SOURCE_CS = 'prusalink-cs' as const

export type Method =
  'ping' | 'requestAccess' | 'printers' | 'print' | 'status' | 'cancel'

// ── Public types ──────────────────────────────────────────────────

export interface PrinterInfo {
  /** opaque, stable per printer; safe to expose */
  id: string
  /** user label, e.g. "Prusa MK4 (studio)" */
  name: string
  type: 'prusalink'
  /** best-effort from the printer, e.g. "MK4" */
  model?: string
}

export type PrinterState =
  'idle' | 'printing' | 'paused' | 'error' | 'busy' | 'attention' | 'offline'

export interface PrinterStatus {
  state: PrinterState
  tempNozzle?: number
  tempBed?: number
  job?: { name?: string; progress?: number; timeRemainingS?: number } | null
  /** passthrough of the normalized provider payload (debugging) */
  raw?: unknown
}

export interface PrintArgs {
  /** filename to store on the printer, e.g. "kg-2026-06-28.gcode" */
  name: string
  gcode: string | Blob | ArrayBuffer
  /** default true: start immediately after upload */
  start?: boolean
  /** Abort the upload (and reject with CANCELLED). Useful for big files over a
   *  slow link. */
  signal?: AbortSignal
  /** Upload timeout in ms. Default: none — Prusa firmware can be slow to ingest
   *  a file, and the link may be slow, so we don't impose one. */
  timeoutMs?: number
}

export type BridgeErrorCode =
  | 'NOT_INSTALLED'
  | 'DENIED'
  | 'NOT_GRANTED'
  | 'NO_HOST_PERMISSION'
  | 'PRINTER_UNREACHABLE'
  | 'AUTH_FAILED'
  | 'PRINTER_BUSY'
  | 'CANCELLED'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'BAD_REQUEST'
  | 'INTERNAL'

export interface WireError {
  code: BridgeErrorCode
  message: string
  httpStatus?: number
}

// ── Wire envelopes ────────────────────────────────────────────────

/** page → relay */
export interface RequestEnvelope {
  source: typeof SOURCE_PAGE
  reqId: string
  method: Method
  args?: unknown
}

/** page → relay control message: abort the in-flight request `reqId`. */
export interface AbortEnvelope {
  source: typeof SOURCE_PAGE
  reqId: string
  abort: true
}

/** relay → page */
export interface ResponseEnvelope {
  source: typeof SOURCE_CS
  reqId: string
  ok: boolean
  result?: unknown
  error?: WireError
}

/** Method-specific argument payloads carried in `RequestEnvelope.args`. */
export interface RequestAccessArgs {
  /** Always show the consent prompt even if a grant exists (to add printers). */
  force?: boolean
}
export interface PrintWireArgs {
  printerId: string
  name: string
  gcode: string | Blob | ArrayBuffer
  start?: boolean
  timeoutMs?: number
}
export interface PrinterIdArgs {
  printerId: string
}

/** `ping` result. */
export interface PongResult {
  pong: true
  version: string
}
