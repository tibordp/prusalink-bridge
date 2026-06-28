import type { PrinterState, PrinterStatus } from './types'

/**
 * Normalize PrusaLink firmware payloads into the page-facing PrinterStatus
 *. Kept pure and side-effect-free for unit testing.
 */

export function normalizeState(raw: unknown): PrinterState {
  if (typeof raw !== 'string') return 'busy'
  switch (raw.toUpperCase()) {
    case 'PRINTING':
      return 'printing'
    case 'PAUSED':
    case 'PAUSING':
      return 'paused'
    case 'IDLE':
    case 'READY':
    case 'FINISHED':
    case 'STOPPED':
    case 'CANCELLED':
    case 'OPERATIONAL':
      return 'idle'
    case 'ATTENTION':
      return 'attention'
    case 'ERROR':
      return 'error'
    case 'OFFLINE':
      return 'offline'
    case 'BUSY':
    default:
      return 'busy'
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** PrusaLink reports progress as a 0–100 percentage; expose a 0–1 fraction. */
function toFraction(progress: unknown): number | undefined {
  const p = num(progress)
  if (p == null) return undefined
  return p > 1 ? p / 100 : p
}

interface RawV1Status {
  printer?: {
    state?: string
    temp_nozzle?: number
    temp_bed?: number
  }
  job?: {
    id?: number | string
    progress?: number
    time_remaining?: number
  } | null
}

interface RawV1Job {
  progress?: number
  time_remaining?: number
  file?: { name?: string; display_name?: string }
}

/** Normalize `GET /api/v1/status`, optionally enriched with `GET /api/v1/job`. */
export function normalizeV1Status(
  status: RawV1Status,
  job?: RawV1Job | null,
): PrinterStatus {
  const printer = status.printer ?? {}
  const state = normalizeState(printer.state)

  let jobOut: PrinterStatus['job'] = null
  const sJob = status.job
  if (sJob || job) {
    const name = job?.file?.display_name ?? job?.file?.name
    const progress = toFraction(sJob?.progress ?? job?.progress)
    const timeRemainingS = num(sJob?.time_remaining ?? job?.time_remaining)
    jobOut = {
      ...(name ? { name } : {}),
      ...(progress != null ? { progress } : {}),
      ...(timeRemainingS != null ? { timeRemainingS } : {}),
    }
    if (Object.keys(jobOut).length === 0) jobOut = state === 'printing' ? {} : null
  }

  return {
    state,
    ...(num(printer.temp_nozzle) != null ? { tempNozzle: printer.temp_nozzle } : {}),
    ...(num(printer.temp_bed) != null ? { tempBed: printer.temp_bed } : {}),
    job: jobOut,
    raw: status,
  }
}

interface RawLegacyPrinter {
  state?: { text?: string; flags?: Record<string, boolean> }
  temperature?: { tool0?: { actual?: number }; bed?: { actual?: number } }
}
interface RawLegacyJob {
  progress?: { completion?: number; printTimeLeft?: number }
  job?: { file?: { name?: string; display?: string } }
}

/** Normalize the legacy OctoPrint-style `GET /api/printer` + `GET /api/job`. */
export function normalizeLegacyStatus(
  printer: RawLegacyPrinter,
  job?: RawLegacyJob | null,
): PrinterStatus {
  const state = normalizeState(printer.state?.text)
  let jobOut: PrinterStatus['job'] = null
  if (job) {
    const name = job.job?.file?.display ?? job.job?.file?.name
    // legacy completion is a 0–100 percentage
    const progress = toFraction(job.progress?.completion)
    const timeRemainingS = num(job.progress?.printTimeLeft)
    jobOut = {
      ...(name ? { name } : {}),
      ...(progress != null ? { progress } : {}),
      ...(timeRemainingS != null ? { timeRemainingS } : {}),
    }
    if (Object.keys(jobOut).length === 0) jobOut = state === 'printing' ? {} : null
  }
  return {
    state,
    ...(num(printer.temperature?.tool0?.actual) != null
      ? { tempNozzle: printer.temperature!.tool0!.actual }
      : {}),
    ...(num(printer.temperature?.bed?.actual) != null
      ? { tempBed: printer.temperature!.bed!.actual }
      : {}),
    job: jobOut,
    raw: { printer, job },
  }
}
