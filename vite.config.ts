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
  build: {
    // Keep the interactive shell lean and split heavyweight vendors into
    // bounded chunks. The WebGL scene and neural TTS are already lazy-loaded;
    // their dependencies should not turn the initial UI request into a single
    // multi-megabyte transfer.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'graphics',
              test: (id) => {
                const path = id.replaceAll('\\', '/')
                return ['/node_modules/three/', '/node_modules/@react-three/', '/node_modules/postprocessing/']
                  .some((needle) => path.includes(needle))
              },
              priority: 10,
              maxSize: 420 * 1024,
              minModuleSize: 8 * 1024,
            },
            {
              name: 'react-runtime',
              test: (id) => {
                const path = id.replaceAll('\\', '/')
                return ['/node_modules/react/', '/node_modules/react-dom/', '/node_modules/scheduler/']
                  .some((needle) => path.includes(needle))
              },
              priority: 9,
              maxSize: 320 * 1024,
              minModuleSize: 8 * 1024,
            },
            {
              name: 'motion',
              test: (id) => {
                const path = id.replaceAll('\\', '/')
                return ['/node_modules/framer-motion/', '/node_modules/motion-dom/', '/node_modules/motion-utils/']
                  .some((needle) => path.includes(needle))
              },
              priority: 8,
              maxSize: 360 * 1024,
              minModuleSize: 8 * 1024,
            },
            {
              // Kokoro and its phonemizer/ONNX runtime are only needed when
              // neural speech is actually selected. Keep them out of the
              // initial shell instead of letting a shared vendor chunk pull
              // the 1.3 MB espeak table into every page load.
              name: 'neural-tts',
              test: (id) => {
                const path = id.replaceAll('\\', '/')
                return [
                  '/node_modules/kokoro-js/',
                  '/node_modules/phonemizer/',
                  '/node_modules/@huggingface/transformers/',
                  '/node_modules/onnxruntime-web/',
                  '/node_modules/onnxruntime-common/',
                ].some((needle) => path.includes(needle))
              },
              priority: 12,
              maxSize: 420 * 1024,
              minModuleSize: 8 * 1024,
            },
            {
              name: 'vendor',
              test: (id) => id.includes('node_modules'),
              priority: 1,
              maxSize: 420 * 1024,
              minModuleSize: 8 * 1024,
            },
          ],
        },
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
