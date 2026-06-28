import { formatBytes } from '@/src/lib/bytes'
import type { ConfirmPrompt } from '@/src/lib/ipc'
import { el } from './dom'

export interface ConfirmChoice {
  proceed: boolean
  dontAskAgain: boolean
}

/** Render the per-print confirm prompt as a DOM subtree (action popup). */
export function renderConfirm(
  ctx: ConfirmPrompt,
  onDecide: (choice: ConfirmChoice) => void,
) {
  const dontAsk = (<input type="checkbox" id="dont-ask" />) as HTMLInputElement

  let decided = false
  const decide = (proceed: boolean): void => {
    if (decided) return
    decided = true
    onDecide({ proceed, dontAskAgain: proceed && dontAsk.checked })
  }

  const kv = (label: string, value: Node | string) => (
    <div class="row" style={{ margin: '4px 0' }}>
      <div class="muted small" style={{ width: '56px' }}>
        {label}
      </div>
      <div class="grow truncate">{value}</div>
    </div>
  )

  return (
    <div>
      <h1>Send this print?</h1>
      <div class="card">
        {kv('Site', <span class="mono">{ctx.origin}</span>)}
        {kv('Printer', <span class="strong">{ctx.printerName}</span>)}
        {kv('File', <span class="mono">{ctx.fileName}</span>)}
        {kv('Size', formatBytes(ctx.fileSize))}
      </div>
      <div class="card">
        <div class="checkbox">
          {dontAsk}
          <label htmlFor="dont-ask">Don’t ask again for this site</label>
        </div>
      </div>
      <div class="actions">
        <button class="primary" on={{ click: () => decide(true) }}>
          Print
        </button>
        <button on={{ click: () => decide(false) }}>Cancel</button>
      </div>
    </div>
  )
}
