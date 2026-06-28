import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'extension/.output/**',
      'extension/.wxt/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        // WXT auto-imports these into entrypoints (typed via .wxt/types).
        defineBackground: 'readonly',
        defineContentScript: 'readonly',
        defineUnlistedScript: 'readonly',
      },
    },
    rules: {
      // The extension fetches LAN printers and bridges untyped browser APIs;
      // allow the occasional escape hatch, but flag unused code.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Node scripts and config files run outside the browser.
  {
    files: ['**/*.config.{js,ts}', 'extension/scripts/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  // JSX compiles to the `el`/`Fragment` factory; tell the parser so it counts
  // those imports as used (no React, no eslint-plugin-react needed).
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parserOptions: { jsxPragma: 'el', jsxFragmentName: 'Fragment' },
    },
  },
  prettier,
)
