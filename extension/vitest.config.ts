import { defineConfig } from 'vitest/config'

// Tests cover the pure modules only (md5, digest, normalize) — no browser APIs,
// so the default node environment is enough.
export default defineConfig({
  // Match the JSX factory used by the extension build (tests don't use JSX, but
  // keep it consistent in case a test ever imports a UI module).
  esbuild: { jsxFactory: 'el', jsxFragment: 'Fragment' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
