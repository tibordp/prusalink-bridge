import { browser } from 'wxt/browser'
import type {
  AdminMessage,
  AdminResponse,
  AdminState,
  PrinterDraft,
  ProbeAdminResult,
  SavePrinterResult,
} from './ipc'
import type { PrinterStatus } from './types'

/**
 * Thin wrapper used by the options/popup pages to talk to the background's
 * admin channel. Surfaces the background's WireError as a thrown Error.
 */
async function call<T>(msg: AdminMessage): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as
    AdminResponse<T> | undefined
  if (!res) throw new Error('No response from background')
  if (!res.ok) {
    const err = new Error(res.error?.message ?? 'Request failed') as Error & {
      code?: string
      httpStatus?: number
    }
    err.code = res.error?.code
    err.httpStatus = res.error?.httpStatus
    throw err
  }
  return res.result as T
}

export const admin = {
  getState: () => call<AdminState>({ kind: 'admin', op: 'getState' }),
  savePrinter: (draft: PrinterDraft) =>
    call<SavePrinterResult>({ kind: 'admin', op: 'savePrinter', draft }),
  deletePrinter: (id: string) =>
    call<void>({ kind: 'admin', op: 'deletePrinter', id }),
  probe: (printerId: string) =>
    call<ProbeAdminResult>({ kind: 'admin', op: 'probe', printerId }),
  probeDraft: (draft: PrinterDraft) =>
    call<ProbeAdminResult>({ kind: 'admin', op: 'probeDraft', draft }),
  getStatus: (printerId: string) =>
    call<PrinterStatus>({ kind: 'admin', op: 'getStatus', printerId }),
  revokeGrant: (origin: string) =>
    call<void>({ kind: 'admin', op: 'revokeGrant', origin }),
  setPauseAll: (value: boolean) =>
    call<void>({ kind: 'admin', op: 'setPauseAll', value }),
}
