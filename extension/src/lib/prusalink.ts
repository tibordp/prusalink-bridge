import { AppError, networkError } from './errors'
import { buildDigestHeader, parseWwwAuthenticate } from './digest'
import {
  normalizeLegacyStatus,
  normalizeV1Status,
} from './normalize'
import { assertHostPermission } from './permissions'
import { updatePrinterCache } from './storage'
import type { PrinterRecord, PrinterStatus } from './types'

/**
 * PrusaLink client. Normalizes provider calls behind
 * probe / status / cancel / uploadAndPrint. Implements the v1 API first with a
 * legacy (OctoPrint-style) fallback. All auth-header construction stays here;
 * secrets never leave the background.
 */

const CONNECT_TIMEOUT_MS = 10_000
const UPLOAD_TIMEOUT_MS = 60_000

interface FetchOpts {
  method: string
  /** request path, e.g. "/api/v1/status" (already percent-encoded). */
  path: string
  headers?: Record<string, string>
  body?: BodyInit | null
  timeoutMs?: number
}

/** Perform an authenticated fetch, handling API-Key directly and Digest via the
 *  401-challenge/retry dance. Returns the raw Response (status mapping is
 *  the caller's job via {@link assertOk}). */
async function authFetch(
  printer: PrinterRecord,
  opts: FetchOpts,
): Promise<Response> {
  await assertHostPermission(printer.baseUrl)
  const url = printer.baseUrl + opts.path
  const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT_MS

  const doFetch = (extraHeaders: Record<string, string>): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    return fetch(url, {
      method: opts.method,
      headers: { ...opts.headers, ...extraHeaders },
      body: opts.body ?? null,
      signal: controller.signal,
      // never attach the user's cookies/credentials to a LAN printer
      credentials: 'omit',
      cache: 'no-store',
    }).finally(() => clearTimeout(timer))
  }

  try {
    if (printer.auth.mode === 'apikey') {
      return await doFetch({ 'X-Api-Key': printer.auth.secret })
    }

    // Digest: unauthenticated probe → parse challenge → authenticated retry.
    const first = await doFetch({})
    if (first.status !== 401) return first
    const wwwAuth = first.headers.get('WWW-Authenticate')
    const challenge = wwwAuth ? parseWwwAuthenticate(wwwAuth) : null
    if (!challenge) return first // can't authenticate; let caller map 401
    // Drain the first response so the connection can be reused.
    await first.arrayBuffer().catch(() => undefined)
    const authorization = buildDigestHeader({
      username: printer.auth.username,
      password: printer.auth.secret,
      method: opts.method,
      uri: opts.path,
      challenge,
    })
    return await doFetch({ Authorization: authorization })
  } catch (err) {
    throw networkError(err)
  }
}

/** Map a Response to success or a typed AppError. */
function assertOk(res: Response): Response {
  if (res.ok) return res
  if (res.status === 401 || res.status === 403) {
    throw new AppError('AUTH_FAILED', 'Printer rejected the credentials')
  }
  if (res.status === 409) {
    throw new AppError('PRINTER_BUSY', 'Printer is busy', 409)
  }
  throw new AppError('HTTP_ERROR', `Printer returned HTTP ${res.status}`, res.status)
}

async function jsonOrNull(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

// ── probe (Connection Test) ───────────────────────────────────────────

export interface ProbeResult {
  model?: string
  firmware?: string
  raw: unknown
}

export async function probe(printer: PrinterRecord): Promise<ProbeResult> {
  // Prefer v1 info; fall back to the legacy version endpoint.
  let res = await authFetch(printer, { method: 'GET', path: '/api/v1/info' })
  if (res.status === 404) {
    res = await authFetch(printer, { method: 'GET', path: '/api/version' })
  }
  assertOk(res)
  const info = asObj(await jsonOrNull(res))
  const model = pickModel(info)
  const firmware =
    typeof info.text === 'string'
      ? info.text
      : typeof info.firmware === 'string'
        ? info.firmware
        : undefined
  if (model) await updatePrinterCache(printer.id, { model })
  return { ...(model ? { model } : {}), ...(firmware ? { firmware } : {}), raw: info }
}

function pickModel(info: Record<string, unknown>): string | undefined {
  for (const key of ['printer_model', 'model', 'name', 'hostname']) {
    const v = info[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

// ── storage discovery ────────────────────────────────────────────────

export async function discoverStorage(printer: PrinterRecord): Promise<string> {
  if (printer.cache?.storage) return printer.cache.storage
  try {
    const res = await authFetch(printer, { method: 'GET', path: '/api/v1/storage' })
    if (res.ok) {
      const data = asObj(await jsonOrNull(res))
      const list = Array.isArray(data.storage_list)
        ? (data.storage_list as Array<Record<string, unknown>>)
        : []
      const writable = list.find(
        (s) => s.available !== false && s.read_only !== true,
      )
      const name =
        (typeof writable?.name === 'string' && writable.name) ||
        (typeof writable?.path === 'string' && writable.path) ||
        undefined
      if (name) {
        const clean = name.replace(/^\/+|\/+$/g, '')
        await updatePrinterCache(printer.id, { storage: clean })
        return clean
      }
    }
  } catch {
    /* fall through to default */
  }
  return 'usb'
}

// ── status ────────────────────────────────────────────────────────────

export async function getStatus(printer: PrinterRecord): Promise<PrinterStatus> {
  const res = await authFetch(printer, { method: 'GET', path: '/api/v1/status' })
  if (res.status === 404) return getStatusLegacy(printer)
  assertOk(res)
  const status = asObj(await jsonOrNull(res))

  // Enrich with the job (for the filename) only when a job is present.
  let job: Record<string, unknown> | null = null
  if (status.job) {
    try {
      const jres = await authFetch(printer, { method: 'GET', path: '/api/v1/job' })
      if (jres.ok && jres.status !== 204) job = asObj(await jsonOrNull(jres))
    } catch {
      /* job enrichment is best-effort */
    }
  }
  return normalizeV1Status(status, job)
}

async function getStatusLegacy(printer: PrinterRecord): Promise<PrinterStatus> {
  const pres = await authFetch(printer, { method: 'GET', path: '/api/printer' })
  assertOk(pres)
  const printerObj = asObj(await jsonOrNull(pres))
  let job: Record<string, unknown> | null = null
  try {
    const jres = await authFetch(printer, { method: 'GET', path: '/api/job' })
    if (jres.ok && jres.status !== 204) job = asObj(await jsonOrNull(jres))
  } catch {
    /* best-effort */
  }
  return normalizeLegacyStatus(printerObj, job)
}

// ── cancel ─────────────────────────────────────────────────────────────

export async function cancelJob(printer: PrinterRecord): Promise<void> {
  // Find the active job id from v1 status/job.
  const jobId = await currentJobId(printer)
  if (jobId != null) {
    const res = await authFetch(printer, {
      method: 'DELETE',
      path: `/api/v1/job/${encodeURIComponent(String(jobId))}`,
    })
    if (res.status !== 404) {
      assertOk(res)
      return
    }
  }
  // Legacy fallback: POST /api/job { command: 'cancel' }
  const res = await authFetch(printer, {
    method: 'POST',
    path: '/api/job',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'cancel' }),
  })
  assertOk(res)
}

async function currentJobId(
  printer: PrinterRecord,
): Promise<number | string | undefined> {
  try {
    const res = await authFetch(printer, { method: 'GET', path: '/api/v1/job' })
    if (res.ok && res.status !== 204) {
      const job = asObj(await jsonOrNull(res))
      const id = job.id
      if (typeof id === 'number' || typeof id === 'string') return id
    }
  } catch {
    /* ignore */
  }
  try {
    const res = await authFetch(printer, { method: 'GET', path: '/api/v1/status' })
    if (res.ok) {
      const status = asObj(await jsonOrNull(res))
      const job = asObj(status.job)
      const id = job.id
      if (typeof id === 'number' || typeof id === 'string') return id
    }
  } catch {
    /* ignore */
  }
  return undefined
}

// ── upload + print ─────────────────────────────────────────────────────

export interface UploadResult {
  jobId?: string
}

export async function uploadAndPrint(
  printer: PrinterRecord,
  name: string,
  bytes: Uint8Array,
  start: boolean,
): Promise<UploadResult> {
  const storage = await discoverStorage(printer)
  const path = `/api/v1/files/${encodeURIComponent(storage)}/${encodeURIComponent(name)}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    Overwrite: '?1',
  }
  if (start) headers['Print-After-Upload'] = '?1'

  const res = await authFetch(printer, {
    method: 'PUT',
    path,
    headers,
    body: toArrayBuffer(bytes),
    timeoutMs: UPLOAD_TIMEOUT_MS,
  })

  if (res.status === 404) {
    return uploadAndPrintLegacy(printer, name, bytes, start)
  }
  assertOk(res)
  const data = asObj(await jsonOrNull(res))
  const jobId = data.id != null ? String(data.id) : undefined
  return jobId ? { jobId } : {}
}

async function uploadAndPrintLegacy(
  printer: PrinterRecord,
  name: string,
  bytes: Uint8Array,
  start: boolean,
): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', new Blob([toArrayBuffer(bytes)]), name)
  if (start) form.append('print', 'true')
  const res = await authFetch(printer, {
    method: 'POST',
    path: '/api/files/local',
    body: form,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  })
  assertOk(res)
  return {}
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Return a tight ArrayBuffer copy (handles subarray/offset views).
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}
