# Build instructions (for Firefox / AMO source review)

This is the source for the **Bridge for PrusaLink** extension. It's a pnpm monorepo:
the extension (`extension/`) imports a workspace package (`packages/client/`), so
both are included here and built together.

## Toolchain

- **Node.js** ≥ 20 (built and verified with Node 22)
- **pnpm** 11 — pinned via the root `package.json` `packageManager` field; if you
  use Corepack, `corepack enable` will select the right version automatically.

No network access beyond the npm registry (for `pnpm install`) is required.

## Build

From the root of this archive:

```bash
pnpm install --frozen-lockfile   # installs all workspace deps from pnpm-lock.yaml
pnpm build:firefox               # builds the client shim, then the extension
```

The unpacked, reviewable Firefox build is written to:

```
extension/.output/firefox-mv2/
```

That directory's contents are exactly what the published add-on zip contains.

## What builds what

- `pnpm build:firefox` runs `wxt build -b firefox` in `extension/`, which first
  builds the workspace dependency `@tibordp/prusalink-bridge` (`packages/client/`,
  via `tsup`) and then bundles the extension with Vite/esbuild.
- The extension's source lives in `extension/entrypoints/` (background, content
  script, popup, options) and `extension/src/`. JSX is compiled to a tiny local
  DOM factory (`extension/src/ui/dom.ts`) — no UI framework.
- The minified output is produced by Vite/esbuild's default minifier. There is no
  obfuscation.

## Optional checks

```bash
pnpm -r typecheck
pnpm -r test
```
