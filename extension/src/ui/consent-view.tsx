import type { ConsentPrompt } from '@/src/lib/ipc'
import { el } from './dom'

export interface ConsentChoice {
  allow: boolean
  printerIds: string[]
  confirmEachPrint: boolean
}

/**
 * Render the consent prompt as a DOM subtree (used inside the action popup).
 * Text only (never markup); the origin shown is the browser-verified one.
 * `onDecide` is called once with the user's choice.
 */
export function renderConsent(
  ctx: ConsentPrompt,
  onDecide: (choice: ConsentChoice) => void,
) {
  // On a first request, pre-check everything (one-click "grant all"). On a
  // re-prompt to expand an existing grant, pre-check only what's already granted.
  const isExpansion = ctx.grantedIds.length > 0
  const granted = new Set(ctx.grantedIds)
  const preChecked = (id: string) => (isExpansion ? granted.has(id) : true)

  const checks = new Map<string, HTMLInputElement>()

  const printerRows =
    ctx.printers.length === 0 ? (
      <div class="note">
        You have no printers configured. Add one in the extension options first.
      </div>
    ) : (
      ctx.printers.map((p) => {
        const cb = (
          <input type="checkbox" id={`pk_${p.id}`} />
        ) as HTMLInputElement
        cb.checked = preChecked(p.id)
        checks.set(p.id, cb)
        return (
          <div class="checkbox">
            {cb}
            <label htmlFor={`pk_${p.id}`}>
              <span class="strong">{p.name}</span>
              {p.model ? (
                <span class="muted small">{`  ${p.model}`}</span>
              ) : null}
              <br />
              {p.hasPermission ? (
                <span class="pill ok">reachable</span>
              ) : (
                <span class="pill warn">permission needed</span>
              )}
            </label>
          </div>
        )
      })
    )

  const confirmEach = (
    <input type="checkbox" id="confirm-each" />
  ) as HTMLInputElement
  confirmEach.checked = ctx.confirmEachPrint

  let decided = false
  const decide = (allow: boolean): void => {
    if (decided) return
    decided = true
    const printerIds = allow
      ? [...checks.entries()].filter(([, cb]) => cb.checked).map(([id]) => id)
      : []
    onDecide({ allow, printerIds, confirmEachPrint: confirmEach.checked })
  }

  const allowBtn = (
    <button class="primary" on={{ click: () => decide(true) }}>
      Allow
    </button>
  ) as HTMLButtonElement
  const anyChecked = () => [...checks.values()].some((c) => c.checked)
  const updateAllow = () => {
    allowBtn.disabled = ctx.printers.length === 0 || !anyChecked()
  }
  for (const cb of checks.values()) cb.addEventListener('change', updateAllow)
  updateAllow()

  return (
    <div>
      <h1>
        {isExpansion ? 'Update printer access?' : 'Allow printer access?'}
      </h1>
      <div class="card">
        <div class="small muted">
          {isExpansion
            ? 'This site is asking to update which printers it can use:'
            : 'This site is asking to use your printers:'}
        </div>
        <div class="mono strong" style={{ fontSize: '15px', margin: '4px 0' }}>
          {ctx.origin}
        </div>
      </div>
      <h2>Printers to share</h2>
      <div>{printerRows}</div>
      <div class="card">
        <div class="checkbox">
          {confirmEach}
          <label htmlFor="confirm-each">
            Ask me to confirm each print from this site
          </label>
        </div>
      </div>
      <div class="actions">
        {allowBtn}
        <button on={{ click: () => decide(false) }}>Deny</button>
      </div>
      <p class="small muted" style={{ marginTop: '10px' }}>
        The site never sees your printer’s address or credentials — only the
        name, model, and status.
      </p>
    </div>
  )
}
