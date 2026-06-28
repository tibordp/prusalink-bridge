import type { PrinterInfo } from '@tibordp/prusalink-bridge/protocol'
import { browser } from 'wxt/browser'
import { wireToBytes } from '@/src/lib/bytes'
import { AppError, toWireError } from '@/src/lib/errors'
import {
  PROMPT_PORT_PREFIX,
  REPLY_SOURCE,
  type AdminMessage,
  type AdminResponse,
  type AdminState,
  type ConfirmDecision,
  type ConsentDecision,
  type PrinterAdminInfo,
  type PrinterDraft,
  type PrintRpcArgs,
  type Prompt,
  type ProbeAdminResult,
  type ReplyMessage,
  type RpcMessage,
} from '@/src/lib/ipc'
import { hasHostPermission, removeHostPermission } from '@/src/lib/permissions'
import {
  cancelJob,
  getStatus,
  probe,
  uploadAndPrint,
} from '@/src/lib/prusalink'
import {
  deletePrinter,
  getAllPending,
  getGrant,
  getPrinter,
  getPrinters,
  putPending,
  readLocal,
  revokeGrant,
  setGrant,
  setSettings,
  takePending,
  updateGrant,
  upsertPrinter,
} from '@/src/lib/storage'
import type { PrinterRecord } from '@/src/lib/types'
import { toPrinterInfo } from '@/src/lib/types'
import { genPrinterId, normalizeBaseUrl } from '@/src/lib/util'

export default defineBackground(() => {
  // ── reply routing (background → relay → page, addressed by reqId) ────
  async function replyToTab(
    tabId: number,
    reqId: string,
    ok: boolean,
    result?: unknown,
    error?: ReplyMessage['error'],
  ): Promise<void> {
    const msg: ReplyMessage = {
      kind: 'reply',
      source: REPLY_SOURCE,
      reqId,
      ok,
      ...(ok ? { result } : { error }),
    }
    try {
      await browser.tabs.sendMessage(tabId, msg)
    } catch {
      // Tab closed/navigated away — nothing to deliver to.
    }
  }

  async function replyError(tabId: number, reqId: string, err: unknown) {
    await replyToTab(tabId, reqId, false, undefined, toWireError(err))
  }

  // ── grant checks ───────────────────────────────────────────────────────────
  async function requireGrantedPrinter(
    origin: string,
    printerId: unknown,
  ): Promise<PrinterRecord> {
    if (typeof printerId !== 'string' || !printerId) {
      throw new AppError('BAD_REQUEST', 'printerId required')
    }
    const grant = await getGrant(origin)
    if (!grant || !grant.printerIds.includes(printerId)) {
      throw new AppError('NOT_GRANTED', 'Origin is not granted this printer')
    }
    const printer = await getPrinter(printerId)
    if (!printer) throw new AppError('NOT_GRANTED', 'Printer no longer exists')
    return printer
  }

  /** Printers granted to origin, intersected with the still-configured set. */
  async function grantedPrinterInfos(origin: string): Promise<PrinterInfo[]> {
    const grant = await getGrant(origin)
    if (!grant) return []
    const printers = await getPrinters()
    return printers
      .filter((p) => grant.printerIds.includes(p.id))
      .map(toPrinterInfo)
  }

  // ── page RPC dispatch (relay → background) ─────────────────────────────────
  async function handleRpc(
    msg: RpcMessage,
    origin: string,
    tabId: number,
  ): Promise<void> {
    const { reqId, method, args } = msg
    try {
      switch (method) {
        case 'requestAccess':
          await handleRequestAccess(origin, tabId, reqId, args)
          return
        case 'printers':
          await replyToTab(tabId, reqId, true, await grantedPrinterInfos(origin))
          return
        case 'status': {
          const printer = await requireGrantedPrinter(
            origin,
            (args as { printerId?: string })?.printerId,
          )
          await replyToTab(tabId, reqId, true, await getStatus(printer))
          return
        }
        case 'cancel': {
          const printer = await requireGrantedPrinter(
            origin,
            (args as { printerId?: string })?.printerId,
          )
          await cancelJob(printer)
          await replyToTab(tabId, reqId, true, undefined)
          return
        }
        case 'print':
          await handlePrint(origin, tabId, reqId, args as PrintRpcArgs)
          return
        default:
          await replyError(
            tabId,
            reqId,
            new AppError('BAD_REQUEST', 'Unknown method'),
          )
      }
    } catch (err) {
      await replyError(tabId, reqId, err)
    }
  }

  // ── requestAccess (consent gate) ───────────────────────────────────────
  async function handleRequestAccess(
    origin: string,
    tabId: number,
    reqId: string,
    args: unknown,
  ): Promise<void> {
    const existing = await getGrant(origin)
    if (existing) {
      // Already granted — no prompt.
      await replyToTab(tabId, reqId, true, await grantedPrinterInfos(origin))
      return
    }
    const { appName, reason } = (args ?? {}) as {
      appName?: string
      reason?: string
    }
    await openDecisionPrompt('consent', {
      reqId,
      origin,
      tabId,
      payload: { appName, reason },
    })
    // The reply is sent when the popup reports a decision (or is dismissed).
  }

  // ── print ────────────────────────────────────────────────────────────
  async function handlePrint(
    origin: string,
    tabId: number,
    reqId: string,
    args: PrintRpcArgs,
  ): Promise<void> {
    const { settings } = await readLocal()
    if (settings.pauseAll) {
      throw new AppError('CANCELLED', 'Printing is paused (global kill switch)')
    }
    if (!args || !args.gcode || !args.name) {
      throw new AppError('BAD_REQUEST', 'print requires name and gcode')
    }
    const printer = await requireGrantedPrinter(origin, args.printerId)
    const grant = await getGrant(origin)

    if (grant?.confirmEachPrint) {
      await openDecisionPrompt('confirm', {
        reqId,
        origin,
        tabId,
        payload: {
          printerId: printer.id,
          printerName: printer.name,
          name: args.name,
          start: args.start,
          gcode: args.gcode,
          size: args.gcode.size,
        },
      })
      return
    }
    await doUpload(tabId, reqId, printer.id, args.name, args.gcode, args.start)
  }

  async function doUpload(
    tabId: number,
    reqId: string,
    printerId: string,
    name: string,
    gcode: PrintRpcArgs['gcode'],
    start: boolean | undefined,
  ): Promise<void> {
    try {
      const printer = await getPrinter(printerId)
      if (!printer) throw new AppError('NOT_GRANTED', 'Printer no longer exists')
      const bytes = wireToBytes(gcode)
      const result = await uploadAndPrint(printer, name, bytes, start !== false)
      await replyToTab(tabId, reqId, true, result)
    } catch (err) {
      await replyError(tabId, reqId, err)
    }
  }

  // ── decision prompts (rendered in the action popup) ────────────────────────
  // reqIds currently being decided — guards the popup-close (port disconnect)
  // path from racing a spurious dismissal against an in-flight decision.
  const deciding = new Set<string>()

  // The toolbar action API: `action` on Chrome MV3, `browserAction` on FF MV2.
  interface ActionApi {
    setBadgeText?: (d: { text: string }) => Promise<void>
    setBadgeBackgroundColor?: (d: { color: string }) => Promise<void>
    setTitle?: (d: { title: string }) => Promise<void>
    openPopup?: () => Promise<void>
  }
  function actionApi(): ActionApi | undefined {
    const b = browser as unknown as {
      action?: ActionApi
      browserAction?: ActionApi
    }
    return b.action ?? b.browserAction
  }

  async function openDecisionPrompt(
    kind: 'consent' | 'confirm',
    op: { reqId: string; origin: string; tabId: number; payload: unknown },
  ): Promise<void> {
    // Persist the pending op so the popup can fetch it and so it survives SW
    // recycling.
    await putPending(op.reqId, {
      kind: kind === 'consent' ? 'access' : 'print',
      origin: op.origin,
      tabId: op.tabId,
      reqId: op.reqId,
      payload: op.payload,
    })
    await refreshBadge()
    // Best-effort: pop the action popup open, anchored to the toolbar icon. Not
    // every Chrome state allows this from a background event; the badge is the
    // dependable nudge when it doesn't open.
    await openActionPopup()
  }

  async function openActionPopup(): Promise<void> {
    try {
      await actionApi()?.openPopup?.()
    } catch {
      /* fall back to the badge nudge */
    }
  }

  /** Reflect the number of pending prompts on the toolbar badge. */
  async function refreshBadge(): Promise<void> {
    const n = Object.keys(await getAllPending()).length
    const action = actionApi()
    if (!action) return
    try {
      await action.setBadgeText?.({ text: n ? String(n) : '' })
      await action.setBadgeBackgroundColor?.({ color: '#ea6c2d' })
      await action.setTitle?.({
        title: n
          ? `PrusaLink Bridge — ${n} request${n > 1 ? 's' : ''} need your approval`
          : 'PrusaLink Bridge',
      })
    } catch {
      /* badge is cosmetic */
    }
  }

  /** Sanitized prompt queue the popup renders (no secrets / URLs). */
  async function getPrompts(): Promise<Prompt[]> {
    const all = await getAllPending()
    let printers: PrinterAdminInfo[] | null = null
    const out: Prompt[] = []
    for (const [reqId, op] of Object.entries(all)) {
      if (op.kind === 'access') {
        if (!printers) printers = await adminPrinterInfos()
        const p = op.payload as { appName?: string; reason?: string }
        out.push({
          kind: 'consent',
          reqId,
          origin: op.origin,
          ...(p?.appName ? { appName: p.appName } : {}),
          ...(p?.reason ? { reason: p.reason } : {}),
          printers,
        })
      } else {
        const p = op.payload as { printerName: string; name: string; size: number }
        out.push({
          kind: 'confirm',
          reqId,
          origin: op.origin,
          printerName: p.printerName,
          fileName: p.name,
          fileSize: p.size,
        })
      }
    }
    return out
  }

  async function handleConsentDecision(msg: ConsentDecision): Promise<void> {
    deciding.add(msg.reqId)
    try {
      const op = await takePending(msg.reqId)
      if (!op || op.kind !== 'access') return
      if (!msg.allow) {
        await replyError(op.tabId, op.reqId, new AppError('DENIED', 'User denied access'))
        return
      }
      // Only grant printers that are actually configured.
      const configured = new Set((await getPrinters()).map((p) => p.id))
      const printerIds = msg.printerIds.filter((id) => configured.has(id))
      if (printerIds.length === 0) {
        await replyError(
          op.tabId,
          op.reqId,
          new AppError('DENIED', 'No printers were granted'),
        )
        return
      }
      await setGrant(op.origin, {
        printerIds,
        confirmEachPrint: msg.confirmEachPrint,
        createdAt: Date.now(),
      })
      await replyToTab(op.tabId, op.reqId, true, await grantedPrinterInfos(op.origin))
    } finally {
      deciding.delete(msg.reqId)
      await refreshBadge()
    }
  }

  async function handleConfirmDecision(msg: ConfirmDecision): Promise<void> {
    deciding.add(msg.reqId)
    try {
      const op = await takePending(msg.reqId)
      if (!op || op.kind !== 'print') return
      const payload = op.payload as {
        printerId: string
        name: string
        start?: boolean
        gcode: PrintRpcArgs['gcode']
      }
      if (!msg.proceed) {
        await replyError(
          op.tabId,
          op.reqId,
          new AppError('CANCELLED', 'User cancelled the print'),
        )
        return
      }
      if (msg.dontAskAgain) {
        await updateGrant(op.origin, { confirmEachPrint: false })
      }
      await doUpload(
        op.tabId,
        op.reqId,
        payload.printerId,
        payload.name,
        payload.gcode,
        payload.start,
      )
    } finally {
      deciding.delete(msg.reqId)
      await refreshBadge()
    }
  }

  // ── popup-close detection → resolve undecided prompts ──────────────────────
  // While the popup shows a prompt it holds a `prompt:<reqId>` port. If the
  // popup closes (clicked away / dismissed) without a decision, the port
  // disconnects and we resolve that request as DENIED/CANCELLED.
  browser.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith(PROMPT_PORT_PREFIX)) return
    const reqId = port.name.slice(PROMPT_PORT_PREFIX.length)
    port.onDisconnect.addListener(() => {
      void (async () => {
        if (deciding.has(reqId)) return // a decision is in flight
        const op = await takePending(reqId)
        if (!op) return // already decided
        if (op.kind === 'access') {
          await replyError(op.tabId, reqId, new AppError('DENIED', 'Consent dismissed'))
        } else {
          await replyError(op.tabId, reqId, new AppError('CANCELLED', 'Print dismissed'))
        }
        await refreshBadge()
      })()
    })
  })

  // ── admin (options/popup) ──────────────────────────────────────────────────
  async function adminPrinterInfos(): Promise<PrinterAdminInfo[]> {
    const printers = await getPrinters()
    const out: PrinterAdminInfo[] = []
    for (const p of printers) {
      out.push({
        id: p.id,
        name: p.name,
        type: 'prusalink',
        baseUrl: p.baseUrl,
        auth:
          p.auth.mode === 'digest'
            ? { mode: 'digest', username: p.auth.username }
            : { mode: 'apikey' },
        hasSecret: Boolean(p.auth.secret),
        ...(p.cache?.model ? { model: p.cache.model } : {}),
        ...(p.cache?.storage ? { storage: p.cache.storage } : {}),
        hasPermission: await hasHostPermission(p.baseUrl),
      })
    }
    return out
  }

  async function buildRecordFromDraft(
    draft: PrinterDraft,
  ): Promise<PrinterRecord> {
    const baseUrl = normalizeBaseUrl(draft.baseUrl)
    const name = draft.name.trim()
    if (!name) throw new AppError('BAD_REQUEST', 'name required')
    const existing = draft.id ? await getPrinter(draft.id) : undefined

    let auth: PrinterRecord['auth']
    if (draft.auth.mode === 'digest') {
      const username = draft.auth.username.trim()
      if (!username) throw new AppError('BAD_REQUEST', 'username required')
      const secret =
        draft.auth.secret && draft.auth.secret.length
          ? draft.auth.secret
          : existing?.auth.mode === 'digest'
            ? existing.auth.secret
            : ''
      auth = { mode: 'digest', username, secret }
    } else {
      const secret =
        draft.auth.secret && draft.auth.secret.length
          ? draft.auth.secret
          : existing?.auth.mode === 'apikey'
            ? existing.auth.secret
            : ''
      auth = { mode: 'apikey', secret }
    }

    return {
      id: existing?.id ?? draft.id ?? genPrinterId(),
      name,
      type: 'prusalink',
      baseUrl,
      auth,
      // Reset cache if the baseUrl changed.
      ...(existing && existing.baseUrl === baseUrl && existing.cache
        ? { cache: existing.cache }
        : {}),
    }
  }

  async function handleAdmin(msg: AdminMessage): Promise<AdminResponse> {
    try {
      switch (msg.op) {
        case 'getState': {
          const local = await readLocal()
          const state: AdminState = {
            printers: await adminPrinterInfos(),
            grants: local.grants,
            settings: local.settings,
          }
          return { ok: true, result: state }
        }
        case 'savePrinter': {
          const rec = await buildRecordFromDraft(msg.draft)
          await upsertPrinter(rec)
          return { ok: true, result: { id: rec.id } }
        }
        case 'deletePrinter': {
          const printer = await getPrinter(msg.id)
          await deletePrinter(msg.id)
          if (printer) {
            const others = await getPrinters()
            const sameHost = others.some(
              (p) => p.baseUrl === printer.baseUrl,
            )
            if (!sameHost) await removeHostPermission(printer.baseUrl)
          }
          return { ok: true }
        }
        case 'probe': {
          const printer = await getPrinter(msg.printerId)
          if (!printer) throw new AppError('BAD_REQUEST', 'No such printer')
          return { ok: true, result: await probeAndStatus(printer) }
        }
        case 'probeDraft': {
          const rec = await buildRecordFromDraft(msg.draft)
          return { ok: true, result: await probeAndStatus(rec) }
        }
        case 'getStatus': {
          const printer = await getPrinter(msg.printerId)
          if (!printer) throw new AppError('BAD_REQUEST', 'No such printer')
          return { ok: true, result: await getStatus(printer) }
        }
        case 'revokeGrant':
          await revokeGrant(msg.origin)
          return { ok: true }
        case 'setPauseAll':
          await setSettings({ pauseAll: msg.value })
          return { ok: true }
        default:
          return { ok: false, error: toWireError(new AppError('BAD_REQUEST', 'bad op')) }
      }
    } catch (err) {
      return { ok: false, error: toWireError(err) }
    }
  }

  async function probeAndStatus(
    printer: PrinterRecord,
  ): Promise<ProbeAdminResult> {
    const info = await probe(printer)
    let status
    try {
      status = await getStatus(printer)
    } catch {
      status = undefined
    }
    return {
      ...(info.model ? { model: info.model } : {}),
      ...(info.firmware ? { firmware: info.firmware } : {}),
      ...(status ? { status } : {}),
    }
  }

  // ── message router ─────────────────────────────────────────────────────────
  // Extension origin (chrome-extension://<id>/) — derive from a known page so we
  // can recognize messages from our own pages vs the content-script relay.
  const extBase = new URL(browser.runtime.getURL('/popup.html')).origin + '/'
  type Sender = { url?: string; origin?: string; tab?: { id?: number } }
  function isExtensionPage(sender: Sender): boolean {
    return Boolean(sender.url && sender.url.startsWith(extBase))
  }

  // Returns `true` to keep the message channel open for an async sendResponse;
  // anything else means "not handled here". Cast because webextension-polyfill's
  // listener type insists on a `true` return.
  const onMessage = (
    message: unknown,
    rawSender: Sender,
    sendResponse: (response?: unknown) => void,
  ): true | undefined => {
    const sender = rawSender
    const m = message as { kind?: string }
    if (!m || typeof m.kind !== 'string') return undefined

    // Page RPCs MUST come from a content-script relay (web origin, real tab).
    if (m.kind === 'rpc') {
      if (isExtensionPage(sender)) return undefined // not a page relay
      const tabId = sender.tab?.id
      const origin =
        sender.origin ?? (sender.url ? safeOrigin(sender.url) : undefined)
      if (tabId == null || !origin) return undefined
      void handleRpc(message as RpcMessage, origin, tabId)
      return undefined // replies go out-of-band via tabs.sendMessage
    }

    // Everything else must originate from one of our own extension pages.
    if (!isExtensionPage(sender)) return undefined

    if (m.kind === 'admin') {
      handleAdmin(message as AdminMessage).then(sendResponse)
      return true
    }
    if (m.kind === 'get-prompts') {
      getPrompts().then(sendResponse)
      return true
    }
    if (m.kind === 'consent-decision') {
      handleConsentDecision(message as ConsentDecision).then(() =>
        sendResponse({ ok: true }),
      )
      return true
    }
    if (m.kind === 'confirm-decision') {
      handleConfirmDecision(message as ConfirmDecision).then(() =>
        sendResponse({ ok: true }),
      )
      return true
    }
    return undefined
  }

  type OnMessage = Parameters<typeof browser.runtime.onMessage.addListener>[0]
  browser.runtime.onMessage.addListener(onMessage as OnMessage)

  // Restore the badge after a service-worker restart (pending ops persist).
  void refreshBadge()

  function safeOrigin(url: string): string | undefined {
    try {
      return new URL(url).origin
    } catch {
      return undefined
    }
  }
})
