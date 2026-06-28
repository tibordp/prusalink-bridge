/** Generate an opaque printer id (not derived from baseUrl, so exposing it
 *  leaks nothing). */
export function genPrinterId(): string {
  const bytes = new Uint8Array(6)
  globalThis.crypto.getRandomValues(bytes)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return `p_${hex}`
}

/** Strip a trailing slash and validate a printer base URL. */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  const u = new URL(trimmed) // throws if invalid
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('baseUrl must be http(s)')
  }
  return trimmed
}
