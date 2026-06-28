import type { ConsentPrompt } from '@/src/lib/ipc'
import { el } from './dom'

export interface ConsentChoice {
  allow: boolean
  printerIds: string[]
  confirmEachPrint: boolean
}

/**
 * Render the consent prompt as a DOM subtree (used inside the action popup).
 * Plain text only — origin/appName/reason are page-supplied and must never be
 * treated as markup. `onDecide` is called once with the user's choice.
 */
export function renderConsent(
  ctx: ConsentPrompt,
  onDecide: (choice: ConsentChoice) => void,
): HTMLElement {
  // On a first request, pre-check everything (one-click "grant all"). On a
  // re-prompt to expand an existing grant, pre-check only what's already granted.
  const isExpansion = ctx.grantedIds.length > 0
  const granted = new Set(ctx.grantedIds)
  const preChecked = (id: string) => (isExpansion ? granted.has(id) : true)

  const checks = new Map<string, HTMLInputElement>()
  const printerList = el('div', {})
  if (ctx.printers.length === 0) {
    printerList.append(
      el(
        'div',
        { class: 'note' },
        'You have no printers configured. Add one in the extension options first.',
      ),
    )
  }
  for (const p of ctx.printers) {
    const cb = el('input', {
      type: 'checkbox',
      id: `pk_${p.id}`,
    }) as HTMLInputElement
    cb.checked = preChecked(p.id)
    checks.set(p.id, cb)
    printerList.append(
      el(
        'div',
        { class: 'checkbox' },
        cb,
        el(
          'label',
          { htmlFor: `pk_${p.id}` },
          el('span', { class: 'strong' }, p.name),
          p.model ? el('span', { class: 'muted small' }, `  ${p.model}`) : null,
          el('br', {}),
          p.hasPermission
            ? el('span', { class: 'pill ok' }, 'reachable')
            : el('span', { class: 'pill warn' }, 'permission needed'),
        ),
      ),
    )
  }

  const confirmEach = el('input', {
    type: 'checkbox',
    id: 'confirm-each',
  }) as HTMLInputElement
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

  const allowBtn = el(
    'button',
    { class: 'primary', on: { click: () => decide(true) } },
    'Allow',
  ) as HTMLButtonElement
  const anyChecked = () => [...checks.values()].some((c) => c.checked)
  const updateAllow = () => {
    allowBtn.disabled = ctx.printers.length === 0 || !anyChecked()
  }
  for (const cb of checks.values()) cb.addEventListener('change', updateAllow)
  updateAllow()

  return el(
    'div',
    {},
    el(
      'h1',
      {},
      isExpansion ? 'Update printer access?' : 'Allow printer access?',
    ),
    el(
      'div',
      { class: 'card' },
      el(
        'div',
        { class: 'small muted' },
        isExpansion
          ? 'This site is asking to update which printers it can use:'
          : 'This site is asking to use your printers:',
      ),
      el(
        'div',
        { class: 'mono strong', style: { fontSize: '15px', margin: '4px 0' } },
        ctx.origin,
      ),
      ctx.appName
        ? el(
            'div',
            { class: 'small muted' },
            `claims to be “${ctx.appName}” (self-reported)`,
          )
        : null,
      ctx.reason
        ? el(
            'div',
            { class: 'small', style: { marginTop: '6px' } },
            `Reason: ${ctx.reason}`,
          )
        : null,
    ),
    el('h2', {}, 'Printers to share'),
    printerList,
    el(
      'div',
      { class: 'card' },
      el(
        'div',
        { class: 'checkbox' },
        confirmEach,
        el(
          'label',
          { htmlFor: 'confirm-each' },
          'Ask me to confirm each print from this site',
        ),
      ),
    ),
    el(
      'div',
      { class: 'actions' },
      allowBtn,
      el('button', { on: { click: () => decide(false) } }, 'Deny'),
    ),
    el(
      'p',
      { class: 'small muted', style: { marginTop: '10px' } },
      'The site never sees your printer’s address or credentials — only the name, model, and status.',
    ),
  )
}
