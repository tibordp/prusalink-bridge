import { describe, expect, it } from 'vitest'
import {
  normalizeLegacyStatus,
  normalizeState,
  normalizeV1Status,
} from './normalize'

describe('normalizeState', () => {
  const cases: Array<[string, string]> = [
    ['PRINTING', 'printing'],
    ['printing', 'printing'],
    ['PAUSED', 'paused'],
    ['IDLE', 'idle'],
    ['READY', 'idle'],
    ['FINISHED', 'idle'],
    ['STOPPED', 'idle'],
    ['ATTENTION', 'attention'],
    ['ERROR', 'error'],
    ['BUSY', 'busy'],
    ['SOMETHING_NEW', 'busy'],
  ]
  for (const [raw, want] of cases) {
    it(`${raw} → ${want}`, () => expect(normalizeState(raw)).toBe(want))
  }
  it('non-strings → busy', () => {
    expect(normalizeState(undefined)).toBe('busy')
    expect(normalizeState(42)).toBe('busy')
  })
})

describe('normalizeV1Status', () => {
  it('maps temps and converts percent progress to a fraction', () => {
    const out = normalizeV1Status(
      {
        printer: { state: 'PRINTING', temp_nozzle: 215.4, temp_bed: 60.1 },
        job: { id: 7, progress: 42, time_remaining: 900 },
      },
      { file: { display_name: 'kg.gcode' }, progress: 42, time_remaining: 900 },
    )
    expect(out.state).toBe('printing')
    expect(out.tempNozzle).toBe(215.4)
    expect(out.tempBed).toBe(60.1)
    expect(out.job).toEqual({
      name: 'kg.gcode',
      progress: 0.42,
      timeRemainingS: 900,
    })
  })

  it('reports null job when idle with no job', () => {
    const out = normalizeV1Status({ printer: { state: 'IDLE' } })
    expect(out.state).toBe('idle')
    expect(out.job).toBeNull()
  })

  it('keeps an already-fractional progress as-is', () => {
    const out = normalizeV1Status({
      printer: { state: 'PRINTING' },
      job: { progress: 0.5 },
    })
    expect(out.job?.progress).toBe(0.5)
  })
})

describe('normalizeLegacyStatus', () => {
  it('maps OctoPrint-style payloads', () => {
    const out = normalizeLegacyStatus(
      {
        state: { text: 'Printing' },
        temperature: { tool0: { actual: 200 }, bed: { actual: 55 } },
      },
      {
        progress: { completion: 33, printTimeLeft: 1200 },
        job: { file: { display: 'part.gcode' } },
      },
    )
    expect(out.state).toBe('printing')
    expect(out.tempNozzle).toBe(200)
    expect(out.tempBed).toBe(55)
    expect(out.job).toEqual({
      name: 'part.gcode',
      progress: 0.33,
      timeRemainingS: 1200,
    })
  })
})
