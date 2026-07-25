import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// Run `vite --mode tunnel` (npm run dev:tunnel) when serving the iPad through
// an HTTPS tunnel; plain `vite` stays tuned for localhost on the Mac.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the worker ourselves in src/pwa.ts (with update polling),
      // so tell the plugin not to inject its own registration script.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Notetaker Canvas',
        short_name: 'Notetaker',
        description: 'Infinite-canvas whiteboard for iPad with AI collaboration.',
        theme_color: '#101011',
        background_color: '#101011',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // tldraw ships large assets; raise the precache size ceiling.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Durable updates: a new worker activates and claims open clients
        // immediately, and stale precaches from prior builds are purged — so
        // the app can't get wedged on an old bundle.
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Never let the SW serve cached responses for the LLM/agent proxies —
        // those must always hit the network.
        navigateFallbackDenylist: [/^\/llm/, /^\/agent/],
      },
    }),
  ],
  server: {
    host: true, // listen on all interfaces (LAN + tunnel)
    port: 5173,
    strictPort: true, // fail loudly instead of silently moving to 5174
    // Relay LLM traffic through this dev server so LAN-only clients (the iPad)
    // can reach a vLLM box that lives on Tailscale. The browser calls the
    // same-origin path `/llm/...`; Vite forwards it to LLM_TARGET (which this
    // Mac *can* route to). Same-origin means no CORS, no mixed content, and no
    // service-worker cross-origin issues. Point the app's base URL at `/llm/v1`.
    // Set the target when starting: `LLM_TARGET=http://100.x.x.x:8000 npm run dev`.
    proxy: {
      '/llm': {
        target: process.env.LLM_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llm/, ''),
      },
      // The Claude Code bridge (claude-bridge/server.mjs) runs on this Mac and
      // answers general/agent questions. Same relay trick so the iPad can use it.
      '/agent': {
        target: process.env.CLAUDE_BRIDGE_TARGET || 'http://127.0.0.1:8790',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agent/, ''),
      },
    },
    // Vite rejects requests whose Host header it doesn't recognise. Tunnel
    // hostnames (trycloudflare.com, ngrok, tailscale) are random per session,
    // so allow them explicitly. Dev-only; never used by `vite build`.
    allowedHosts: [
      '.trycloudflare.com',
      '.ngrok-free.app',
      '.ngrok.io',
      '.ts.net',
    ],
    // Through an HTTPS tunnel the browser connects on 443 over wss, not on the
    // local port. Applied only in tunnel mode, since forcing it would break
    // plain localhost dev on the Mac.
    hmr: mode === 'tunnel' ? { clientPort: 443, protocol: 'wss' } : undefined,
  },
  optimizeDeps: {
    // tldraw is a very large dependency graph. Without forcing esbuild to
    // pre-bundle it, Vite serves it as thousands of individual ESM modules in
    // dev and the first page load hangs indefinitely.
    //
    // Only tldraw belongs here. @vitejs/plugin-react already pre-bundles react,
    // react-dom and react/jsx-runtime; listing them again creates a second,
    // conflicting bundle that breaks the Fast Refresh runtime with
    // "importing binding name 'injectIntoGlobalHook' is not found".
    include: ['tldraw'],
  },
}))
