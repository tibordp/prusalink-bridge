// Generates simple placeholder PNG icons (orange rounded square with a white
// filament dot) for the extension. Zero dependencies — hand-rolled PNG encoder.
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
  const r = size / 2
  const radius = size * 0.22 // rounded corners
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      // rounded square mask
      const dx = Math.max(radius - x, x - (size - radius), 0)
      const dy = Math.max(radius - y, y - (size - radius), 0)
      const inside = Math.hypot(dx, dy) <= radius
      // center dot
      const dot = Math.hypot(x - r, y - r) <= size * 0.18
      let px
      if (!inside) px = [0, 0, 0, 0]
      else if (dot) px = [...WHITE, 255]
      else px = [...ORANGE, 255]
      raw[o++] = px[0]
      raw[o++] = px[1]
      raw[o++] = px[2]
      raw[o++] = px[3]
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
