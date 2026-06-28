// Copies the built client ESM into the demo site as a single importable file.
// Run after `pnpm build:client`. The sourceMappingURL comment is stripped so the
// deployed site doesn't 404 on a missing .map.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const src = 'packages/client/dist/index.js'
const dest = 'site/lib/prusalink-bridge.js'

let js = readFileSync(src, 'utf8').replace(
  /\n\/\/# sourceMappingURL=.*\s*$/,
  '\n',
)
mkdirSync('site/lib', { recursive: true })
writeFileSync(dest, js)
console.log(`${dest} written (${js.length} bytes)`)
