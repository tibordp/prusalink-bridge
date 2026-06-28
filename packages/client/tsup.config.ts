import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/protocol.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2020',
  // Self-contained entry files (no shared chunk) — keeps the published package
  // simple and lets the demo site import a single `index.js`.
  splitting: false,
})
