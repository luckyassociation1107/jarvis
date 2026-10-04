#!/usr/bin/env node
/**
 * `npm run setup` — host the setup page and open it in the default browser.
 *
 * This is the installation front door now. Nothing is downloaded here and no
 * model is chosen here: the script makes sure the bridge is running, points the
 * user's browser at /install, and gets out of the way. The page itself shows
 * what the machine has, which stack fits, and one button that downloads exactly
 * that stack through the bridge's own installer endpoints.
 *
 * If the bridge is already running (`npm start` is up, or another terminal ran
 * it), this opens the page and exits — the running bridge serves it. If not, it
 * starts one in the foreground so the page has something to talk to, and stops
 * it when you press Ctrl-C.
 *
 * Flags:
 *   --port <n>    bridge port (default JARVIS_BRIDGE_PORT, then 8787)
 *   --hud <url>   the "Open JARVIS" link on the page (default http://localhost:5173)
 *   --no-open     print the URL instead of opening a browser
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { openBrowser } from './open-browser.mjs'

const args = process.argv.slice(2)
const value = (name, fallback) => {
  const at = args.indexOf(name)
  return at === -1 ? fallback : (args[at + 1] ?? fallback)
}
const noOpen = args.includes('--no-open')
const port = Number(value('--port', process.env.JARVIS_BRIDGE_PORT ?? 8787))
const hud = value('--hud', process.env.JARVIS_HUD_URL ?? 'http://localhost:5173')
const setupUrl = `http://localhost:${port}/install?hud=${encodeURIComponent(hud)}`

const bridgeAnswers = async () => {
  try {
    const response = await fetch(`http://localhost:${port}/autopilot`, { signal: AbortSignal.timeout(1200) })
    return response.ok
  } catch {
    return false
  }
}

const announce = (alreadyRunning) => {
  console.log('')
  console.log('  J.A.R.V.I.S. setup')
  console.log('  -----------------')
  console.log(`  ${alreadyRunning ? 'The bridge is already running.' : 'Bridge started for setup only.'}`)
  console.log('  Choose a stack and download it in your browser:')
  console.log('')
  console.log(`    ${setupUrl}`)
  console.log('')
  console.log('  Nothing is installed until you press the button on that page.')
  console.log(`  ${alreadyRunning ? 'Press Ctrl-C here when you are done.' : 'Close this window (Ctrl-C) when the download finishes, then run `npm start`.'}`)
  console.log('')
}

if (await bridgeAnswers()) {
  announce(true)
  if (!noOpen && !openBrowser(setupUrl)) console.log('  (could not open a browser — open the URL above yourself)')
  process.exit(0)
}

const bridge = spawn(process.execPath, [fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))], {
  stdio: 'inherit',
  env: process.env,
})

let opened = false
const deadline = Date.now() + 25_000
while (Date.now() < deadline && bridge.exitCode === null) {
  if (await bridgeAnswers()) {
    announce(false)
    opened = noOpen ? false : openBrowser(setupUrl)
    if (!opened) console.log('  (could not open a browser — open the URL above yourself)')
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 400))
}
if (!opened && bridge.exitCode === null && Date.now() >= deadline) {
  console.warn('\n  The bridge did not answer in time. Start it with `npm run bridge` and open the URL above.')
}

let stopping = false
const stop = (signal) => {
  if (stopping) return
  stopping = true
  try { bridge.kill(signal) } catch { /* already gone */ }
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
bridge.once('exit', (code) => process.exit(code ?? 0))
