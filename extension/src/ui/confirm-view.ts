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
): HTMLElement {
  const dontAsk = el('input', {
    type: 'checkbox',
    id: 'dont-ask',
  }) as HTMLInputElement

  let decided = false
  const decide = (proceed: boolean): void => {
    if (decided) return
    decided = true
    onDecide({ proceed, dontAskAgain: proceed && dontAsk.checked })
  }

  const kv = (label: string, value: Node | string): HTMLElement =>
    el(
      'div',
      { class: 'row', style: { margin: '4px 0' } },
      el('div', { class: 'muted small', style: { width: '56px' } }, label),
      el('div', { class: 'grow truncate' }, value),
    )

  return el(
    'div',
    {},
    el('h1', {}, 'Send this print?'),
    el(
      'div',
      { class: 'card' },
      kv('Site', el('span', { class: 'mono' }, ctx.origin)),
      kv('Printer', el('span', { class: 'strong' }, ctx.printerName)),
      kv('File', el('span', { class: 'mono' }, ctx.fileName)),
      kv('Size', formatBytes(ctx.fileSize)),
    ),
    el(
      'div',
      { class: 'card' },
      el(
        'div',
        { class: 'checkbox' },
        dontAsk,
        el('label', { htmlFor: 'dont-ask' }, 'Don’t ask again for this site'),
      ),
    ),
    el(
      'div',
      { class: 'actions' },
      el(
        'button',
        { class: 'primary', on: { click: () => decide(true) } },
        'Print',
      ),
      el('button', { on: { click: () => decide(false) } }, 'Cancel'),
    ),
  )
}
