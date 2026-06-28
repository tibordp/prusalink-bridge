import '@/src/ui/style.css'
import { admin } from '@/src/lib/admin-client'
import type { AdminState, PrinterAdminInfo, PrinterDraft } from '@/src/lib/ipc'
import { requestHostPermission } from '@/src/lib/permissions'
import { clear, el } from '@/src/ui/dom'
import { normalizeBaseUrl } from '@/src/lib/util'

let state: AdminState | null = null
let editing: { id?: string } | null = null

async function refresh(): Promise<void> {
  state = await admin.getState()
  renderPrinters()
  renderGrants()
  const pause = document.getElementById('pause-all') as HTMLInputElement | null
  if (pause) pause.checked = state.settings.pauseAll
}

// ── printers ──────────────────────────────────────────────────────────────
function renderPrinters(): void {
  const root = document.getElementById('printers')!
  clear(root)
  if (!state || state.printers.length === 0) {
    root.append(
      <div class="card muted small">No printers yet. Add one below.</div>,
    )
    return
  }
  for (const p of state.printers) root.append(printerCard(p))
}

function printerCard(p: PrinterAdminInfo) {
  const authLabel =
    p.auth.mode === 'digest'
      ? `Digest (${p.auth.username})`
      : p.auth.mode === 'none'
        ? 'No auth'
        : 'API key'

  return (
    <div class="card">
      <div class="row between">
        <div class="grow">
          <div class="strong">{p.name}</div>
          <div class="small mono muted">{p.baseUrl}</div>
          <div class="small muted">
            {`${authLabel}${p.model ? ' · ' + p.model : ''}`}
          </div>
        </div>
        {p.hasPermission ? (
          <span class="pill ok">reachable</span>
        ) : (
          <span class="pill warn">permission needed</span>
        )}
      </div>
      <div class="actions">
        <button on={{ click: () => testPrinter(p) }}>Test connection</button>
        <button on={{ click: () => openEditor(p) }}>Edit</button>
        <button class="danger" on={{ click: () => deletePrinter(p) }}>
          Delete
        </button>
      </div>
      <div class="toast" dataset={{ for: p.id }} />
    </div>
  )
}

function setCardToast(id: string, msg: string, kind: 'ok' | 'err'): void {
  const node = document.querySelector(`.toast[data-for="${CSS.escape(id)}"]`)
  if (node) {
    node.textContent = msg
    node.className = `toast ${kind}`
  }
}

async function testPrinter(p: PrinterAdminInfo): Promise<void> {
  setCardToast(p.id, 'Testing…', 'ok')
  try {
    // Ensure we hold the host permission (gesture-driven request).
    const granted = await requestHostPermission(p.baseUrl)
    if (!granted) {
      setCardToast(
        p.id,
        'Permission to reach this host was not granted.',
        'err',
      )
      return
    }
    const res = await admin.probe(p.id)
    const bits = [
      res.model ? `model ${res.model}` : null,
      res.status ? `state ${res.status.state}` : null,
    ].filter(Boolean)
    setCardToast(p.id, `OK — ${bits.join(', ') || 'connected'}`, 'ok')
    await refresh()
  } catch (err) {
    setCardToast(p.id, describeError(err), 'err')
  }
}

async function deletePrinter(p: PrinterAdminInfo): Promise<void> {
  if (
    !confirm(`Delete printer "${p.name}"? Sites granted to it will lose it.`)
  ) {
    return
  }
  await admin.deletePrinter(p.id)
  await refresh()
}

// ── editor ────────────────────────────────────────────────────────────────
function openEditor(p?: PrinterAdminInfo): void {
  editing = p ? { id: p.id } : {}
  const root = document.getElementById('editor')!
  clear(root)

  const name = (
    <input type="text" value={p?.name ?? ''} placeholder="Prusa MK4 (studio)" />
  ) as HTMLInputElement
  const baseUrl = (
    <input
      type="url"
      value={p?.baseUrl ?? ''}
      placeholder="http://192.168.1.50"
    />
  ) as HTMLInputElement
  const mode = (
    <select>
      <option value="apikey">API key (recommended)</option>
      <option value="digest">HTTP Digest</option>
      <option value="none">None (behind a trusted proxy)</option>
    </select>
  ) as HTMLSelectElement
  mode.value = p?.auth.mode ?? 'apikey'

  const username = (
    <input
      type="text"
      value={p && p.auth.mode === 'digest' ? p.auth.username : 'maker'}
      placeholder="maker"
    />
  ) as HTMLInputElement
  const usernameWrap = (
    <div>
      <label>Digest username</label>
      {username}
    </div>
  ) as HTMLElement

  const secret = (
    <input
      type="password"
      placeholder={p?.hasSecret ? '•••••• (leave blank to keep)' : ''}
      autocomplete="off"
    />
  ) as HTMLInputElement
  const secretWrap = (
    <div>
      <label>Secret</label>
      {secret}
      <div class="small muted">
        API key is shown in your printer’s PrusaLink settings. For Digest, the
        MK4 uses username “maker”.
      </div>
    </div>
  ) as HTMLElement

  const toast = (<div class="toast" />) as HTMLElement

  function syncMode(): void {
    usernameWrap.style.display = mode.value === 'digest' ? 'block' : 'none'
    secretWrap.style.display = mode.value === 'none' ? 'none' : 'block'
  }
  mode.addEventListener('change', syncMode)
  syncMode()

  function readForm(): PrinterDraft {
    let auth: PrinterDraft['auth']
    if (mode.value === 'none') {
      auth = { mode: 'none' }
    } else if (mode.value === 'digest') {
      auth = {
        mode: 'digest',
        username: username.value,
        ...(secret.value ? { secret: secret.value } : {}),
      }
    } else {
      auth = {
        mode: 'apikey',
        ...(secret.value ? { secret: secret.value } : {}),
      }
    }
    return {
      ...(editing?.id ? { id: editing.id } : {}),
      name: name.value,
      baseUrl: baseUrl.value,
      auth,
    }
  }

  function validate(draft: PrinterDraft): string | null {
    if (!draft.name.trim()) return 'Name is required.'
    try {
      normalizeBaseUrl(draft.baseUrl)
    } catch {
      return 'Base URL must look like http://192.168.1.50'
    }
    if (draft.auth.mode === 'none') return null
    const needsSecret = !editing?.id || !p?.hasSecret
    if (needsSecret && !secret.value)
      return 'A secret (API key / password) is required.'
    return null
  }

  const onTest = async (): Promise<void> => {
    const draft = readForm()
    const err = validate(draft)
    if (err) return void setToast(toast, err, 'err')
    setToast(toast, 'Testing…', 'ok')
    try {
      const granted = await requestHostPermission(
        normalizeBaseUrl(draft.baseUrl),
      )
      if (!granted)
        return void setToast(toast, 'Host permission not granted.', 'err')
      const res = await admin.probeDraft(draft)
      const bits = [
        res.model ? `model ${res.model}` : null,
        res.status ? `state ${res.status.state}` : null,
      ].filter(Boolean)
      setToast(toast, `Connected — ${bits.join(', ') || 'ok'}`, 'ok')
    } catch (e) {
      setToast(toast, describeError(e), 'err')
    }
  }

  const onSave = async (): Promise<void> => {
    const draft = readForm()
    const err = validate(draft)
    if (err) return void setToast(toast, err, 'err')
    try {
      // Request the host permission first, while the click gesture is live.
      const granted = await requestHostPermission(
        normalizeBaseUrl(draft.baseUrl),
      )
      await admin.savePrinter(draft)
      closeEditor()
      await refresh()
      if (!granted) {
        // Surface the missing permission on the saved card.
        const saved = state?.printers.find((x) => x.baseUrl === draft.baseUrl)
        if (saved) {
          setCardToast(
            saved.id,
            'Saved, but host permission is needed before it can be reached.',
            'err',
          )
        }
      }
    } catch (e) {
      setToast(toast, describeError(e), 'err')
    }
  }

  root.append(
    <div class="card">
      <div class="strong">{p ? 'Edit printer' : 'Add printer'}</div>
      <label>Name</label>
      {name}
      <label>Base URL</label>
      {baseUrl}
      <label>Authentication</label>
      {mode}
      {usernameWrap}
      {secretWrap}
      <div class="actions">
        <button on={{ click: onTest }}>Test connection</button>
        <button class="primary" on={{ click: onSave }}>
          Save
        </button>
        <button on={{ click: closeEditor }}>Cancel</button>
      </div>
      {toast}
    </div>,
  )
  name.focus()
}

function closeEditor(): void {
  editing = null
  clear(document.getElementById('editor')!)
}

// ── grants ────────────────────────────────────────────────────────────────
function renderGrants(): void {
  const root = document.getElementById('grants')!
  clear(root)
  const entries = Object.entries(state?.grants ?? {})
  if (entries.length === 0) {
    root.append(
      <div class="card muted small">No sites have been granted access.</div>,
    )
    return
  }
  for (const [origin, g] of entries) {
    root.append(
      <div class="card row between">
        <div class="grow">
          <div class="mono strong truncate">{origin}</div>
          <div class="small muted">
            {`${g.printerIds.length} printer(s) · ${
              g.confirmEachPrint
                ? 'confirms each print'
                : 'prints without confirm'
            }`}
          </div>
        </div>
        <button
          class="danger"
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

// ── misc ──────────────────────────────────────────────────────────────────
function setToast(node: HTMLElement, msg: string, kind: 'ok' | 'err'): void {
  node.textContent = msg
  node.className = `toast ${kind}`
}

function describeError(err: unknown): string {
  const e = err as { code?: string; message?: string }
  const code = e?.code ? `${e.code}: ` : ''
  return `${code}${e?.message ?? 'Something went wrong'}`
}

document
  .getElementById('add-printer')!
  .addEventListener('click', () => openEditor())
document.getElementById('pause-all')!.addEventListener('change', async (e) => {
  await admin.setPauseAll((e.target as HTMLInputElement).checked)
})

void refresh()
