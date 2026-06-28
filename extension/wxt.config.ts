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
  // Compile JSX to our tiny `el`/`Fragment` DOM factory (see src/ui/dom.ts).
  vite: () => ({
    esbuild: { jsxFactory: 'el', jsxFragment: 'Fragment' },
  }),
  manifest: ({ browser }) => ({
    name: 'PrusaLink Bridge',
    // Keep this honest about affiliation — it shows in the store and the
    // extensions list. (Manifest descriptions are capped at 132 chars.)
    description:
      'Send jobs to your own PrusaLink printers from web apps you trust. Unofficial — not affiliated with Prusa Research.',
    // Only `storage`. We reply to pages with tabs.sendMessage(sender.tab.id, …),
    // which needs neither the `tabs` permission (we never read url/title) nor a
    // host permission (it targets our own declared content script).
    permissions: ['storage'],
    // On Firefox, host patterns live under optional_permissions instead.
    ...(browser === 'firefox'
      ? { optional_permissions: ['http://*/*', 'https://*/*'] }
      : { optional_host_permissions: ['http://*/*', 'https://*/*'] }),
    action: { default_title: 'PrusaLink Bridge' },
    // Firefox needs an explicit add-on id for stable storage / permissions.
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: { id: 'prusalink-bridge@tibordp.github.io' },
          },
        }
      : {}),
  }),
})
