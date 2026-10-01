/**
 * One command to run JARVIS: the bridge (brain) and the Vite dev server (face)
 * together, so a student types `npm start` and nothing else.
 *
 * Two long-running processes normally mean two terminals. This start script spawns
 * both as children, tags their output so you can tell them apart, and shuts
 * them down together on Ctrl-C — no extra dependency, just Node.
 *
 * Pass --writes to allow JARVIS to take real actions (drive the phone, the
 * browser, send things): `npm start -- --writes`.
 */

import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'
import { plan as planRam } from '../bridge/autopilot.mjs'
import { vendorWasm } from './vendor-mediapipe.mjs'

const writes = process.argv.includes('--writes')

// A dim label per process, so the interleaved logs stay readable.
const paint = (tag, colour) => (line) =>
  line
    .toString()
    .split('\n')
    .filter((l) => l.length)
    .map((l) => `\x1b[${colour}m${tag}\x1b[0m ${l}`)
    .join('\n')

const children = []

function run(name, command, args, colour, env) {
  const label = paint(name, colour)
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    shell: false,
  })
  child.stdout.on('data', (d) => process.stdout.write(label(d) + '\n'))
  child.stderr.on('data', (d) => process.stderr.write(label(d) + '\n'))
  child.on('exit', (code) => {
    // If either half dies the other is useless, so take the whole thing down
    // rather than leave a half-running app that looks alive but cannot answer.
    console.log(`\x1b[${colour}m${name}\x1b[0m exited (${code}); stopping the rest.`)
    shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

let stopping = false
function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const c of children) {
    try {
      c.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const OLLAMA_URL = (process.env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, '')
const runtimePlan = planRam()
const needsLocalModels = ['chat', 'vision', 'reason'].some((cap) => {
  const choice = runtimePlan.choices[cap]
  return Boolean(choice?.fits && choice.model)
})

function loopback(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.')
}

function sameLocalModelEndpoint() {
  try {
    const model = new URL(process.env.JARVIS_MODEL_BASE_URL ?? 'http://localhost:11434/v1')
    const ollama = new URL(OLLAMA_URL)
    return loopback(model.hostname) && loopback(ollama.hostname)
      && model.hostname === ollama.hostname
      && model.port === ollama.port
      && /\/v1\/?$/.test(model.pathname)
  } catch {
    return false
  }
}

async function startOllamaIfNeeded() {
  if (!needsLocalModels || !sameLocalModelEndpoint()) return
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (response.ok) {
      console.log(`Ollama is already responding at ${OLLAMA_URL}.`)
      return
    }
  } catch { /* start the installed daemon below */ }

  const binary = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
  const check = spawnSync(binary, ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 5000 })
  if (check.error || check.status !== 0) {
    console.warn('Ollama is not reachable and its CLI was not found. The web UI will still start; local model replies need Ollama.')
    return
  }

  const env = { ...process.env }
  try {
    const endpoint = new URL(OLLAMA_URL)
    if (endpoint.port) {
      const host = endpoint.hostname.includes(':') ? `[${endpoint.hostname}]` : endpoint.hostname
      env.OLLAMA_HOST = `${host}:${endpoint.port}`
    }
  } catch { /* the bridge will report an invalid configured endpoint */ }

  const daemon = spawn(binary, ['serve'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  daemon.stdout.on('data', (chunk) => process.stdout.write(`[ollama] ${chunk}`))
  daemon.stderr.on('data', (chunk) => process.stderr.write(`[ollama] ${chunk}`))
  daemon.once('error', (error) => console.warn(`[ollama] could not start: ${error.message}`))
  daemon.once('exit', (code) => {
    if (!stopping) console.warn(`[ollama] server exited (${code}); local inference may be unavailable.`)
  })
  children.push(daemon)
  console.log(`Starting the local Ollama server at ${OLLAMA_URL}…`)
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && daemon.exitCode === null) {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(900) })
      if (response.ok) {
        console.log('Ollama is ready for local model requests.')
        return
      }
    } catch { /* wait for the daemon to bind its local port */ }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  console.warn('Ollama did not become ready before the startup wait ended. The UI will still start.')
}

/**
 * Tell the bridge which port the face will actually be on.
 *
 * The bridge only trusts WebSocket origins on localhost:5173-5199 and
 * 4173-4199, which is the right default — a socket that any local page can open
 * is a socket that drives every MCP server on the machine. But a start script that
 * assigns a port outside that range produces the single most confusing failure
 * this project has: the interface loads, the reactor spins, the microphone
 * hears you, and the brain answers nothing, because the handshake is being 403'd
 * somewhere neither half reports. Passing the port through closes that gap
 * without widening what the bridge trusts by default.
 */
const port = process.env.PORT
const bridgeEnv = writes ? { JARVIS_ALLOW_WRITES: '1' } : {}
if (port) {
  bridgeEnv.JARVIS_ALLOWED_ORIGINS = `http://localhost:${port},http://127.0.0.1:${port}`
  console.log(`  serving the face on port ${port}; the bridge will accept it.\n`)
}

vendorWasm()
await startOllamaIfNeeded()

console.log('\nJ.A.R.V.I.S. starting — the brain and the face.\n')
run('bridge', 'node', ['bridge/server.mjs'], '36', bridgeEnv)
// npm is a shell script on most systems; call the vite binary directly so we do
// not need shell:true (which would break the argument handling above).
run('face', process.execPath, ['node_modules/vite/bin/vite.js'], '35', {})

console.log(
  '\nWhen it says the dev server is ready, open the URL it prints in Chrome,\n' +
    'click INITIALISE, and say "Hey Jarvis". Ctrl-C stops everything.\n',
)
