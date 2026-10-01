import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // GitHub Pages serves this from /<repo>/, not from /. Without an explicit
  // base, every script and stylesheet href is written as /assets/... and
  // resolves to the domain root, which 404s — the symptom is a completely blank
  // page with a populated <title>, which is a miserable thing to debug.
  //
  // Read from the environment so local dev is unaffected: `vite` leaves
  // VITE_BASE_PATH unset and the base stays '/', while the Pages workflow sets
  // it to the repo name.
  base: process.env.VITE_BASE_PATH ?? '/',
  server: {
    // Honour PORT so a second instance can run alongside the first. The bridge
    // only accepts sockets from localhost:5173-5199, so stay inside that range
    // or set JARVIS_ALLOWED_ORIGINS to match.
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // Hosted preview browsers cannot address sandbox services via localhost.
      // Keep client requests same-origin and proxy them from Vite to the local
      // bridge, including WebSocket upgrades on /bridge/ws.
      '/bridge': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/bridge/, '') || '/',
      },
    },
  },
  optimizeDeps: {
    // kokoro-js pulls in `phonemizer`, which carries espeak-ng as inline WASM.
    // Vite's dependency pre-bundler rewrites that initialisation and the
    // language table ends up empty — the symptom is
    // `Invalid language identifier: "en". Should be one of: .` at generate()
    // time, long after the model has loaded successfully. Serving these
    // untouched fixes it.
    exclude: ['kokoro-js', 'phonemizer', '@huggingface/transformers'],
  },
})
