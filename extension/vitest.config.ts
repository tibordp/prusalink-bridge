import { defineConfig } from 'vitest/config'

// Tests cover the pure modules only (md5, digest, normalize) — no browser APIs,
// so the default node environment is enough.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
