/**
 * Tiny DOM helper. All text goes through textContent, never innerHTML — the
 * consent/confirm/options surfaces render plain-text origin/appName/reason/
 * filename and must be impossible to confuse with markup.
 */

type Child = Node | string | null | undefined | false

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & {
    class?: string
    style?: Partial<CSSStyleDeclaration>
    dataset?: Record<string, string>
    on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  const { class: className, style, dataset, on, ...rest } = props
  if (className) node.className = className
  if (style) Object.assign(node.style, style)
  if (dataset) for (const [k, v] of Object.entries(dataset)) node.dataset[k] = v
  if (on)
    for (const [k, v] of Object.entries(on)) {
      if (v) node.addEventListener(k, v as EventListener)
    }
  Object.assign(node, rest)
  for (const c of children) {
    if (c == null || c === false) continue
    node.append(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

export function clear(node: HTMLElement): void {
  node.replaceChildren()
}

export function mount(rootId: string, ...nodes: Node[]): void {
  const root = document.getElementById(rootId)
  if (root) {
    clear(root)
    root.append(...nodes)
  }
}
