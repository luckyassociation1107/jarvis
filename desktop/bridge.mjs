/**
 * The installed app's brain process.
 *
 * In a source checkout, `npm start` runs the bridge with the system's Node:
 * `node bridge/server.mjs`. An installed .exe cannot assume any of that — the
 * machine that double-clicked the installer very likely has no Node on it, and
 * asking for one would make the installer a lie. So this file is started
 * instead, by the Electron main process, as a *utility process*: Electron's own
 * Node runtime, with no window and no browser session attached.
 *
 * It does three things before the bridge takes over, and all three are things
 * that must happen before the bridge reads its configuration:
 *
 *   1. Moves the working directory into the app's data folder. The bridge and
 *      the modules under `bridge/` resolve their state as `models/…` relative
 *      to the working directory — memory.db, screenshots, sandbox files, the
 *      model weights themselves — and when the app is installed, `models/`
 *      next to a read-only Program Files install is not a place anything can
 *      write. One folder holds the whole install's data instead.
 *   2. Starts the local model runtime if nothing is answering yet, using the
 *      same shared helper `npm start` uses, so a fresh install has a brain
 *      without a second download step.
 *   3. Hands the bridge the origin of the window that will talk to it. The
 *      bridge refuses a WebSocket from an origin it was not told about, on
 *      purpose; the installed app is the one caller that needs telling.
 *
 * Nothing here is a second implementation of the app. `bridge/server.mjs` is
 * imported directly and runs exactly as it does under `node`.
 */

import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startOllamaIfNeeded } from '../scripts/ollama-start.mjs'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = process.env.JARVIS_DATA_DIR ? resolve(process.env.JARVIS_DATA_DIR) : join(APP_ROOT, 'data')

const stamp = () => new Date().toISOString().slice(11, 19)
const log = (line) => console.log(`[${stamp()}] ${line}`)

log(`jarvis bridge: node ${process.version} on ${process.platform}-${process.arch}`)
log(`jarvis bridge: app root ${APP_ROOT}`)
log(`jarvis bridge: data dir ${DATA_DIR}`)

try {
  mkdirSync(join(DATA_DIR, 'models'), { recursive: true })
  process.chdir(DATA_DIR)
} catch (error) {
  // A data folder that cannot be written means nothing else will work, so say
  // so in one line the user can act on rather than failing later in six places.
  console.error(`[jarvis] data folder ${DATA_DIR} is not writable: ${error?.message ?? error}`)
  process.exit(1)
}

// The window's origin, so the bridge's own origin check can allow it. Extra
// origins a user has configured stay allowed; this only adds.
const hudOrigins = (process.env.JARVIS_HUD_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0)
if (hudOrigins.length) {
  process.env.JARVIS_ALLOWED_ORIGINS = [process.env.JARVIS_ALLOWED_ORIGINS, ...hudOrigins]
    .filter(Boolean)
    .join(',')
}

// An installed app has no console to print a setup URL into; the window it
// already shows is the surface for that. This keeps every "open the setup page
// in your browser" path in the bridge quiet rather than half-working.
process.env.JARVIS_NO_BROWSER ??= '1'

const runtime = await startOllamaIfNeeded({ log, warn: (line) => console.warn(`[${stamp()}] ${line}`) })
const stopRuntime = () => {
  try {
    runtime.child?.kill()
  } catch { /* already gone */ }
}

// The model server is this process's child, so it should not outlive it. The
// launcher kills the whole process tree on quit as well; this is the polite
// path, and the tree kill is the one that catches a hard stop.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    stopRuntime()
    process.exit(0)
  })
}
process.on('exit', stopRuntime)

log('jarvis bridge: starting the bridge')
await import('../bridge/server.mjs')
