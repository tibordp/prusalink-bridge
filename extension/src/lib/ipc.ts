import type { WireError } from '@tibordp/prusalink-bridge/protocol'
import type { WireGcode } from './bytes'
import type { Grant, PrinterStatus, Settings } from './types'

/**
 * Extension-internal message contracts. Channels:
 *   relay → background : RpcMessage   (page-originated; sender.origin trusted)
 *   background → relay : ReplyMessage (forwarded to the page by reqId)
 *   ext page ⇄ background : AdminMessage (options/popup; sender is an ext page)
 *   popup ⇄ background : DecisionMessage (prompt queue + consent/confirm decisions)
 *
 * `ping` is answered locally by the relay and never reaches the background.
 */

export const REPLY_SOURCE = 'prusalink-bg' as const

// ── page RPC (relay → background) ────────────────────────────────────────────

export interface RpcMessage {
  kind: 'rpc'
  reqId: string
  method: 'requestAccess' | 'printers' | 'print' | 'status' | 'cancel'
  args?: unknown
}

/** relay → background: abort the in-flight upload for `reqId`. */
export interface AbortMessage {
  kind: 'abort'
  reqId: string
}

export interface PrintRpcArgs {
  printerId: string
  name: string
  gcode: WireGcode
  start?: boolean
  /** caller-supplied upload timeout (ms); undefined = no timeout. */
  timeoutMs?: number
}

export interface ReplyMessage {
  kind: 'reply'
  source: typeof REPLY_SOURCE
  reqId: string
  ok: boolean
  result?: unknown
  error?: WireError
}

// ── prompts (shown inside the action popup) ──────────────────────────────────
//
// Consent and per-print confirm render inside the toolbar action popup (not a
// separate window). The popup fetches the pending prompt queue, renders one at a
// time, and reports decisions by reqId. While a prompt is shown the popup holds
// a `prompt:<reqId>` runtime port, so closing the popup reliably resolves the
// request as denied/cancelled (the port's onDisconnect).

export const PROMPT_PORT_PREFIX = 'prompt:'

export interface ConsentPrompt {
  kind: 'consent'
  reqId: string
  origin: string
  appName?: string
  reason?: string
  printers: PrinterAdminInfo[]
  /** Printer ids already granted to this origin — pre-checked when re-prompting
   *  to expand a grant. Empty for a first-time request. */
  grantedIds: string[]
  /** Current "confirm each print" setting (defaults the toggle on re-prompt). */
  confirmEachPrint: boolean
}

export interface ConfirmPrompt {
  kind: 'confirm'
  reqId: string
  origin: string
  printerName: string
  fileName: string
  fileSize: number
}

export type Prompt = ConsentPrompt | ConfirmPrompt

export interface ConsentDecision {
  kind: 'consent-decision'
  reqId: string
  allow: boolean
  printerIds: string[]
  confirmEachPrint: boolean
}

export interface ConfirmDecision {
  kind: 'confirm-decision'
  reqId: string
  proceed: boolean
  dontAskAgain: boolean
}

/** The popup asks for the current pending prompt queue on open. */
export interface GetPrompts {
  kind: 'get-prompts'
}

export type DecisionMessage = ConsentDecision | ConfirmDecision | GetPrompts

// ── admin (options/popup ⇄ background) ───────────────────────────────────────

/** Secret-free projection of a printer for the options/popup UIs. */
export interface PrinterAdminInfo {
  id: string
  name: string
  type: 'prusalink'
  baseUrl: string
  auth:
    { mode: 'none' } | { mode: 'apikey' } | { mode: 'digest'; username: string }
  hasSecret: boolean
  model?: string
  storage?: string
  hasPermission: boolean
}

export interface PrinterDraft {
  /** present when editing an existing printer. */
  id?: string
  name: string
  baseUrl: string
  auth:
    | { mode: 'none' }
    | { mode: 'apikey'; secret?: string }
    | { mode: 'digest'; username: string; secret?: string }
}

export type AdminMessage =
  | { kind: 'admin'; op: 'getState' }
  | { kind: 'admin'; op: 'savePrinter'; draft: PrinterDraft }
  | { kind: 'admin'; op: 'deletePrinter'; id: string }
  | { kind: 'admin'; op: 'probe'; printerId: string }
  | { kind: 'admin'; op: 'probeDraft'; draft: PrinterDraft }
  | { kind: 'admin'; op: 'getStatus'; printerId: string }
  | { kind: 'admin'; op: 'revokeGrant'; origin: string }
  | { kind: 'admin'; op: 'setPauseAll'; value: boolean }

export interface AdminState {
  printers: PrinterAdminInfo[]
  grants: Record<string, Grant>
  settings: Settings
}

export interface ProbeAdminResult {
  model?: string
  firmware?: string
  status?: PrinterStatus
}

export interface SavePrinterResult {
  id: string
}

/** Uniform admin response envelope (delivered via sendResponse). */
export interface AdminResponse<T = unknown> {
  ok: boolean
  result?: T
  error?: WireError
}

export type AnyMessage = RpcMessage | DecisionMessage | AdminMessage
