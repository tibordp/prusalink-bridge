// Generates the extension PNG icons: an orange rounded square with a white
// filament dot, antialiased against transparency. Matches site/icon.svg.
// Zero dependencies — hand-rolled PNG encoder.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../public/icon')
mkdirSync(outDir, { recursive: true })

const ORANGE = [234, 108, 45]
const WHITE = [255, 255, 255]

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function png(size) {
  const c = size / 2
  const radius = size * 0.22 // rounded corners
  const dotR = size * 0.18 // center dot
  const SS = 4 // supersample grid (SS×SS samples/pixel) for antialiasing
  const N = SS * SS
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      // Coverage via supersampling: nIn = inside the rounded square (→ alpha),
      // nDot = inside the dot (→ white vs orange). Antialiases both the outer
      // corners (against transparency) and the dot edge (against orange).
      let nIn = 0
      let nDot = 0
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const px = x + (i + 0.5) / SS
          const py = y + (j + 0.5) / SS
          const dx = Math.max(radius - px, px - (size - radius), 0)
          const dy = Math.max(radius - py, py - (size - radius), 0)
          if (Math.hypot(dx, dy) > radius) continue
          nIn++
          if (Math.hypot(px - c, py - c) <= dotR) nDot++
        }
      }
      let r = 0
      let g = 0
      let b = 0
      if (nIn > 0) {
        const dotFrac = nDot / nIn
        r = Math.round(ORANGE[0] * (1 - dotFrac) + WHITE[0] * dotFrac)
        g = Math.round(ORANGE[1] * (1 - dotFrac) + WHITE[1] * dotFrac)
        b = Math.round(ORANGE[2] * (1 - dotFrac) + WHITE[2] * dotFrac)
      }
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = Math.round((nIn / N) * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [16, 32, 48, 96, 128]) {
  writeFileSync(resolve(outDir, `${size}.png`), png(size))
}
console.log('icons written to', outDir)
