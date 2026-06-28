/**
 * Byte/base64 helpers shared by the relay (content script) and the background.
 *
 * Why base64: `chrome.runtime.sendMessage` JSON-serializes its payload, so a
 * Blob/ArrayBuffer would arrive empty. The relay therefore encodes binary gcode
 * to base64 before forwarding; the background decodes it.
 * Text gcode is passed through as-is to avoid the encoding cost.
 */

export type GcodeEncoding = 'text' | 'base64'

export interface WireGcode {
  data: string
  encoding: GcodeEncoding
  /** byte length, for the confirm dialog and inline-size checks. */
  size: number
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Coerce the page's `gcode` (string | Blob | ArrayBuffer) to a wire form that
 *  survives runtime messaging. Runs in the relay (content script). */
export async function gcodeToWire(
  gcode: string | Blob | ArrayBuffer | ArrayBufferView,
): Promise<WireGcode> {
  if (typeof gcode === 'string') {
    return {
      data: gcode,
      encoding: 'text',
      size: new TextEncoder().encode(gcode).length,
    }
  }
  let bytes: Uint8Array
  if (gcode instanceof Blob) {
    bytes = new Uint8Array(await gcode.arrayBuffer())
  } else if (gcode instanceof ArrayBuffer) {
    bytes = new Uint8Array(gcode)
  } else if (ArrayBuffer.isView(gcode)) {
    bytes = new Uint8Array(gcode.buffer, gcode.byteOffset, gcode.byteLength)
  } else {
    throw new Error('Unsupported gcode type')
  }
  return { data: bytesToBase64(bytes), encoding: 'base64', size: bytes.length }
}

/** Decode a WireGcode back to bytes. Runs in the background. */
export function wireToBytes(wire: WireGcode): Uint8Array {
  return wire.encoding === 'base64'
    ? base64ToBytes(wire.data)
    : new TextEncoder().encode(wire.data)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
