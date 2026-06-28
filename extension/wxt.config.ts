import { defineConfig } from 'wxt'

// WXT auto-derives most of the manifest from the entrypoints/ directory:
//   - entrypoints/background.ts        → background (SW on Chrome, scripts on FF)
//   - entrypoints/relay.content.ts     → content_scripts (matches set in the file)
//   - entrypoints/popup/index.html     → action.default_popup
//   - entrypoints/options/index.html   → options_ui
//
// We only declare what WXT can't infer: permissions and the optional host
// patterns. There are no static host_permissions; concrete hosts are requested
// per printer at add-time.
export default defineConfig({
  srcDir: '.',
  manifest: ({ browser }) => ({
    name: 'PrusaLink Bridge',
    // Keep this honest about affiliation — it shows in the store and the
    // extensions list. (Manifest descriptions are capped at 132 chars.)
    description:
      'Send jobs to your own PrusaLink printers from web apps you trust. Unofficial — not affiliated with Prusa Research.',
    permissions: ['storage', 'tabs'],
    // On Firefox, host patterns live under optional_permissions instead.
    ...(browser === 'firefox'
      ? { optional_permissions: ['http://*/*', 'https://*/*'] }
      : { optional_host_permissions: ['http://*/*', 'https://*/*'] }),
    action: { default_title: 'PrusaLink Bridge' },
    // Firefox needs an explicit add-on id for stable storage / permissions.
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: { id: 'prusalink-bridge@ojdip.net' },
          },
        }
      : {}),
  }),
})
