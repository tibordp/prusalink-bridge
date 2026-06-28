/**
 * Tiny JSX runtime (classic, no framework). `el` is the configured JSX factory
 * and `Fragment` the fragment factory, so `<div class="x">{kids}</div>` compiles
 * to `el('div', { class: 'x' }, kids)` and builds real DOM nodes — no vdom, no
 * diffing. Text goes through textContent, never innerHTML, so the
 * consent/confirm/options surfaces can't be tricked into rendering markup.
 */

export const Fragment = Symbol('jsx.Fragment')

type Child = Node | string | number | boolean | null | undefined | Child[]

interface Props {
  class?: string
  style?: Partial<CSSStyleDeclaration>
  dataset?: Record<string, string>
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>
  [attr: string]: unknown
}

function appendChild(parent: Node, child: Child): void {
  if (child == null || typeof child === 'boolean') return
  if (Array.isArray(child)) {
    for (const c of child) appendChild(parent, c)
    return
  }
  parent.appendChild(
    child instanceof Node ? child : document.createTextNode(String(child)),
  )
}

export function el(
  tag: string | typeof Fragment,
  props: Props | null,
  ...children: Child[]
): HTMLElement | DocumentFragment {
  if (tag === Fragment) {
    const frag = document.createDocumentFragment()
    appendChild(frag, children)
    return frag
  }
  const node = document.createElement(tag)
  if (props) {
    const { class: className, style, dataset, on, ...rest } = props
    if (className) node.className = className
    if (style) Object.assign(node.style, style)
    if (dataset)
      for (const [k, v] of Object.entries(dataset)) node.dataset[k] = v
    if (on)
      for (const [k, v] of Object.entries(on))
        if (v) node.addEventListener(k, v as EventListener)
    Object.assign(node, rest)
  }
  appendChild(node, children)
  return node
}

export function clear(node: HTMLElement): void {
  node.replaceChildren()
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = HTMLElement | DocumentFragment
    interface IntrinsicElements {
      // One permissive prop bag per tag: typed `class`/`style`/`dataset`/`on`,
      // plus any DOM attribute/property (value, type, disabled, …).
      [tag: string]: Props
    }
  }
}
