import '@/src/ui/style.css'
import { browser } from 'wxt/browser'
import { admin } from '@/src/lib/admin-client'
import type { AdminState, PrinterAdminInfo } from '@/src/lib/ipc'
import {
  getPrompts,
  openPromptPort,
  sendConfirmDecision,
  sendConsentDecision,
} from '@/src/lib/prompt-client'
import type { PrinterState, PrinterStatus } from '@/src/lib/types'
import { renderConsent } from '@/src/ui/consent-view'
import { renderConfirm } from '@/src/ui/confirm-view'
import { clear, el } from '@/src/ui/dom'

let state: AdminState | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let inPrompt = false
let promptPort: { disconnect: () => void } | null = null

const promptEl = () => document.getElementById('prompt')!
const normalEl = () => document.getElementById('normal')!

const STATE_PILL: Record<PrinterState, string> = {
  idle: 'ok',
  printing: 'ok',
  paused: 'warn',
  busy: 'warn',
  attention: 'warn',
  error: 'err',
  offline: 'err',
}

// ── prompt mode (consent / per-print confirm, shown in this popup) ──────────
/** Render the oldest pending prompt, or fall back to the normal popup. Returns
 *  true if a prompt is being shown. */
async function showPrompts(): Promise<boolean> {
  // Disconnecting an already-decided prompt's port is a no-op on the background.
  if (promptPort) {
    promptPort.disconnect()
    promptPort = null
  }
  const prompts = await getPrompts()
  if (prompts.length === 0) {
    inPrompt = false
    promptEl().style.display = 'none'
    normalEl().style.display = ''
    return false
  }

  inPrompt = true
  normalEl().style.display = 'none'
  const host = promptEl()
  host.style.display = ''
  clear(host)
  if (prompts.length > 1) {
    host.append(
      <div class="small muted" style={{ marginBottom: '6px' }}>
        {`${prompts.length} pending requests — reviewing 1 of ${prompts.length}`}
      </div>,
    )
  }

  const prompt = prompts[0]!
  // Hold a port for the whole time this prompt is shown; if the popup closes
  // before a decision, the background resolves it as denied/cancelled.
  promptPort = openPromptPort(prompt.reqId)

  if (prompt.kind === 'consent') {
    host.append(
      renderConsent(prompt, async (choice) => {
        await sendConsentDecision({ reqId: prompt.reqId, ...choice })
        await afterDecision()
      }),
    )
  } else {
    host.append(
      renderConfirm(prompt, async (choice) => {
        await sendConfirmDecision({ reqId: prompt.reqId, ...choice })
        await afterDecision()
      }),
    )
  }
  return true
}

/** After a decision: show the next pending prompt, or close the popup once the
 *  queue is empty (it was opened to answer a request). */
async function afterDecision(): Promise<void> {
  if (await showPrompts()) return
  window.close()
}

async function refresh(): Promise<void> {
  if (await showPrompts()) return // a consent/confirm prompt takes over
  state = await admin.getState()
  const pause = document.getElementById('pause-all') as HTMLInputElement
  pause.checked = state.settings.pauseAll
  renderPrinters()
  renderGrants()
  void pollStatuses()
}

function renderPrinters(): void {
  const root = document.getElementById('printers')!
  clear(root)
  if (!state || state.printers.length === 0) {
    root.append(<div class="card muted small">No printers configured.</div>)
    return
  }
  for (const p of state.printers) root.append(printerCard(p))
}

function printerCard(p: PrinterAdminInfo) {
  return (
    <div class="card" dataset={{ printer: p.id }}>
      <div class="row between">
        <div class="strong truncate grow">{p.name}</div>
        <span class="pill" dataset={{ state: p.id }}>
          {p.hasPermission ? '—' : 'no perm'}
        </span>
      </div>
      <div class="small muted" dataset={{ detail: p.id }}>
        {p.baseUrl}
      </div>
    </div>
  )
}

async function pollStatuses(): Promise<void> {
  if (!state) return
  await Promise.all(
    state.printers.map(async (p) => {
      if (!p.hasPermission) return
      try {
        const st = await admin.getStatus(p.id)
        paintStatus(p.id, st)
      } catch (err) {
        paintError(p.id, err)
      }
    }),
  )
}

function paintStatus(id: string, st: PrinterStatus): void {
  const pill = document.querySelector(`.pill[data-state="${CSS.escape(id)}"]`)
  const detail = document.querySelector(`[data-detail="${CSS.escape(id)}"]`)
  if (pill) {
    pill.textContent = st.state
    pill.className = `pill ${STATE_PILL[st.state] ?? ''}`
  }
  if (detail) {
    const bits: string[] = []
    if (st.tempNozzle != null) bits.push(`nozzle ${Math.round(st.tempNozzle)}°`)
    if (st.tempBed != null) bits.push(`bed ${Math.round(st.tempBed)}°`)
    if (st.job?.progress != null)
      bits.push(`${Math.round(st.job.progress * 100)}%`)
    if (st.job?.name) bits.push(st.job.name)
    detail.textContent = bits.join(' · ') || '—'
  }
}

function paintError(id: string, err: unknown): void {
  const pill = document.querySelector(`.pill[data-state="${CSS.escape(id)}"]`)
  const detail = document.querySelector(`[data-detail="${CSS.escape(id)}"]`)
  const e = err as { code?: string }
  if (pill) {
    pill.textContent = e.code === 'NO_HOST_PERMISSION' ? 'no perm' : 'offline'
    pill.className = 'pill err'
  }
  if (detail) detail.textContent = 'Could not reach printer'
}

function renderGrants(): void {
  const root = document.getElementById('grants')!
  clear(root)
  const entries = Object.entries(state?.grants ?? {})
  if (entries.length === 0) {
    root.append(<div class="card muted small">No sites granted.</div>)
    return
  }
  for (const [origin, g] of entries) {
    root.append(
      <div class="card row between">
        <div class="grow">
          <div class="mono small truncate">{origin}</div>
          <div class="small muted">{`${g.printerIds.length} printer(s)`}</div>
        </div>
        <button
          class="danger small"
          on={{
            click: async () => {
              await admin.revokeGrant(origin)
              await refresh()
            },
          }}
        >
          Revoke
        </button>
      </div>,
    )
  }
}

document.getElementById('open-options')!.addEventListener('click', (e) => {
  e.preventDefault()
  void browser.runtime.openOptionsPage()
})
document.getElementById('pause-all')!.addEventListener('change', async (e) => {
  await admin.setPauseAll((e.target as HTMLInputElement).checked)
})

void refresh()

// While idle, poll printer status; if a new prompt arrives, switch into it.
// In prompt mode we leave the rendered prompt untouched (no flicker).
pollTimer = setInterval(() => {
  void (async () => {
    if (inPrompt) return
    if ((await getPrompts()).length > 0) {
      await showPrompts()
    } else {
      await pollStatuses()
    }
  })()
}, 3000)
window.addEventListener('unload', () => {
  if (pollTimer) clearInterval(pollTimer)
})
