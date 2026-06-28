import { browser } from 'wxt/browser'
import type {
  Grant,
  LocalStore,
  PendingOp,
  PrinterRecord,
  Settings,
} from './types'

export const SCHEMA_VERSION = 1

const DEFAULT_LOCAL: LocalStore = {
  schemaVersion: SCHEMA_VERSION,
  printers: [],
  grants: {},
  settings: { pauseAll: false },
}

// ── local store (durable; secrets live here) ────────────────────────────────

export async function readLocal(): Promise<LocalStore> {
  const raw = (await browser.storage.local.get(null)) as Partial<LocalStore>
  return {
    schemaVersion: raw.schemaVersion ?? SCHEMA_VERSION,
    printers: raw.printers ?? [],
    grants: raw.grants ?? {},
    settings: { ...DEFAULT_LOCAL.settings, ...(raw.settings ?? {}) },
  }
}

export async function getPrinters(): Promise<PrinterRecord[]> {
  return (await readLocal()).printers
}

export async function getPrinter(id: string): Promise<PrinterRecord | undefined> {
  return (await getPrinters()).find((p) => p.id === id)
}

export async function setPrinters(printers: PrinterRecord[]): Promise<void> {
  await browser.storage.local.set({ printers })
}

/** Insert or replace a printer by id. */
export async function upsertPrinter(rec: PrinterRecord): Promise<void> {
  const printers = await getPrinters()
  const idx = printers.findIndex((p) => p.id === rec.id)
  if (idx >= 0) printers[idx] = rec
  else printers.push(rec)
  await setPrinters(printers)
}

export async function deletePrinter(id: string): Promise<void> {
  const local = await readLocal()
  const printers = local.printers.filter((p) => p.id !== id)
  // Drop the now-dangling printer id from every grant.
  const grants: Record<string, Grant> = {}
  for (const [origin, g] of Object.entries(local.grants)) {
    const ids = g.printerIds.filter((pid) => pid !== id)
    if (ids.length) grants[origin] = { ...g, printerIds: ids }
  }
  await browser.storage.local.set({ printers, grants })
}

/** Persist updated cache metadata (model/storage) for a printer. */
export async function updatePrinterCache(
  id: string,
  cache: Partial<NonNullable<PrinterRecord['cache']>>,
): Promise<void> {
  const printers = await getPrinters()
  const idx = printers.findIndex((p) => p.id === id)
  if (idx < 0) return
  const existing = printers[idx]!
  printers[idx] = { ...existing, cache: { ...existing.cache, ...cache } }
  await setPrinters(printers)
}

// ── grants ──────────────────────────────────────────────────────────────────

export async function getGrants(): Promise<Record<string, Grant>> {
  return (await readLocal()).grants
}

export async function getGrant(origin: string): Promise<Grant | undefined> {
  return (await getGrants())[origin]
}

export async function setGrant(origin: string, grant: Grant): Promise<void> {
  const grants = await getGrants()
  grants[origin] = grant
  await browser.storage.local.set({ grants })
}

export async function updateGrant(
  origin: string,
  patch: Partial<Grant>,
): Promise<void> {
  const grants = await getGrants()
  const existing = grants[origin]
  if (!existing) return
  grants[origin] = { ...existing, ...patch }
  await browser.storage.local.set({ grants })
}

export async function revokeGrant(origin: string): Promise<void> {
  const grants = await getGrants()
  delete grants[origin]
  await browser.storage.local.set({ grants })
}

// ── settings ──────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  return (await readLocal()).settings
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const settings = { ...(await getSettings()), ...patch }
  await browser.storage.local.set({ settings })
}

// ── session store (pending interactive ops; cleared on browser restart) ─────

async function readPending(): Promise<Record<string, PendingOp>> {
  const raw = (await browser.storage.session.get('pending')) as {
    pending?: Record<string, PendingOp>
  }
  return raw.pending ?? {}
}

/** All pending interactive ops, keyed by reqId (insertion order preserved). */
export async function getAllPending(): Promise<Record<string, PendingOp>> {
  return readPending()
}

export async function putPending(reqId: string, op: PendingOp): Promise<void> {
  const pending = await readPending()
  pending[reqId] = op
  await browser.storage.session.set({ pending })
}

export async function getPending(reqId: string): Promise<PendingOp | undefined> {
  return (await readPending())[reqId]
}

export async function takePending(
  reqId: string,
): Promise<PendingOp | undefined> {
  const pending = await readPending()
  const op = pending[reqId]
  if (op) {
    delete pending[reqId]
    await browser.storage.session.set({ pending })
  }
  return op
}

