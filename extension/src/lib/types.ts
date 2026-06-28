import type {
  PrinterInfo,
  PrinterStatus,
} from '@tibordp/prusalink-bridge/protocol'

export type { PrinterInfo, PrinterStatus, PrinterState } from '@tibordp/prusalink-bridge/protocol'

/** Auth config for a printer. Secrets live ONLY here. */
export type AuthConfig =
  | { mode: 'apikey'; secret: string }
  | { mode: 'digest'; username: string; secret: string }

/** A configured printer. Stored in chrome.storage.local. */
export interface PrinterRecord {
  id: string
  name: string
  type: 'prusalink'
  /** e.g. "http://192.168.1.50" — no trailing slash. */
  baseUrl: string
  auth: AuthConfig
  /** Best-effort cached metadata from the last successful probe. */
  cache?: {
    model?: string
    /** writable storage name on the printer, e.g. "usb". */
    storage?: string
  }
}

/** Per-origin access grant. */
export interface Grant {
  printerIds: string[]
  confirmEachPrint: boolean
  createdAt: number
}

export interface Settings {
  /** Global kill switch — short-circuits every print() with CANCELLED. */
  pauseAll: boolean
}

/** chrome.storage.local shape. */
export interface LocalStore {
  schemaVersion: number
  printers: PrinterRecord[]
  grants: Record<string, Grant>
  settings: Settings
}

/** A pending interactive operation awaiting a consent/confirm decision in the
 *  popup. Persisted in chrome.storage.session so it survives SW recycling. */
export interface PendingOp {
  kind: 'access' | 'print'
  origin: string
  tabId: number
  /** the page reqId to reply to. */
  reqId: string
  /** opaque per-op payload (e.g. print args meta for the confirm UI). */
  payload?: unknown
}

export interface SessionStore {
  pending: Record<string, PendingOp>
}

/** Public projection of a printer record — the ONLY thing pages ever see. */
export function toPrinterInfo(p: PrinterRecord): PrinterInfo {
  return {
    id: p.id,
    name: p.name,
    type: 'prusalink',
    ...(p.cache?.model ? { model: p.cache.model } : {}),
  }
}

export type { PrinterStatus as NormalizedStatus }
