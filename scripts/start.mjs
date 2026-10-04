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
import { openBrowser } from './open-browser.mjs'
import { plan as planRam } from '../bridge/autopilot.mjs'
import { findRuntimeBinary, runtimeModelsDir, runtimePlan as portableRuntimePlan } from '../bridge/portable-runtime.mjs'
import { vendorWasm } from './vendor-mediapipe.mjs'
import {
  canStartLocalOllama,
  configuredModelBaseUrl,
  configuredModelName,
  displayEndpoint,
  isLocalOllamaApi,
  MODEL_SLOTS,
  ollamaListenAddress,
} from './ollama-endpoints.mjs'

const writes = process.argv.includes('--writes')
const noOpen = process.argv.includes('--no-open')
// --auto is what the double-click launchers use: no page, no second press.
// The stack is chosen the same way the setup page chooses its default — the
// largest rung this machine's RAM can hold — and installed here, in the open.
const autoInstall = process.argv.includes('--auto')

// A dim label per process, so the interleaved logs stay readable.
const paint = (tag, colour) => (line) =>
  line
    .toString()
    .split('\n')
    .filter((l) => l.length)
    .map((l) => `\x1b[${colour}m${tag}\x1b[0m ${l}`)
    .join('\n')

const children = []
let stopping = false
let shutdownPromise = null

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null || child.spawnFailed === true
}

function waitForChild(child) {
  if (childHasExited(child)) return Promise.resolve()
  return new Promise((resolve) => child.once('close', resolve))
}

function shutdown(code) {
  if (shutdownPromise) return shutdownPromise
  stopping = true
  const pending = children.map(waitForChild)
  const forceStop = setTimeout(() => {
    for (const child of children) {
      if (childHasExited(child)) continue
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }
  }, 5000)
  forceStop.unref()

  for (const child of children) {
    if (childHasExited(child)) continue
    try { child.kill('SIGTERM') } catch { /* already gone */ }
  }

  shutdownPromise = Promise.all(pending).then(() => {
    clearTimeout(forceStop)
    process.exit(code)
  })
  return shutdownPromise
}

function run(name, command, args, colour, env) {
  const label = paint(name, colour)
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    shell: false,
  })
  child.stdout.on('data', (d) => process.stdout.write(label(d) + '\n'))
  child.stderr.on('data', (d) => process.stderr.write(label(d) + '\n'))
  child.once('error', (error) => {
    child.spawnFailed = true
    console.error(`\x1b[${colour}m${name}\x1b[0m could not start: ${error.message}`)
    if (!stopping) void shutdown(1)
  })
  child.once('exit', (code, signal) => {
    if (stopping) return
    // If either half dies the other is useless, so take the whole thing down
    // rather than leave a half-running app that looks alive but cannot answer.
    console.log(`\x1b[${colour}m${name}\x1b[0m exited (${code ?? signal ?? 'unknown'}); stopping the rest.`)
    void shutdown(code === 0 && signal === null ? 0 : 1)
  })
  children.push(child)
  return child
}

process.on('SIGINT', () => { void shutdown(0) })
process.on('SIGTERM', () => { void shutdown(0) })

const OLLAMA_URL = (process.env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, '')
const runtimePlan = planRam()
const localModelSlots = MODEL_SLOTS.filter((slot) => {
  const model = configuredModelName(slot, runtimePlan.choices[slot])
  return Boolean(model) && isLocalOllamaApi(configuredModelBaseUrl(slot), OLLAMA_URL)
})

async function startOllamaIfNeeded() {
  const endpointLabel = displayEndpoint(OLLAMA_URL)
  if (!localModelSlots.length) return
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (response.ok) {
      console.log(`Ollama is already responding at ${endpointLabel}.`)
      return
    }
  } catch { /* start the installed daemon below */ }

  if (!canStartLocalOllama(OLLAMA_URL)) {
    console.warn(`Ollama at ${endpointLabel} is unavailable and cannot be started directly. The web UI will still start; local model replies need the configured server.`)
    return
  }

  // The runtime this project downloaded for itself counts as installed: it is
  // the same binary, and a machine that used the setup page's one click should
  // not be told it has nothing until the user adds Ollama to PATH.
  const portables = portableRuntimePlan()
  const binary = findRuntimeBinary(portables, process.env) ?? (process.platform === 'win32' ? 'ollama.exe' : 'ollama')
  const check = spawnSync(binary, ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 5000 })
  if (check.error || check.status !== 0) {
    console.warn('Ollama is not reachable and no runtime was found. The web UI will still start; local model replies need a model server — `npm run setup` can download one into this project.')
    return
  }

  const env = {
    ...process.env,
    OLLAMA_HOST: ollamaListenAddress(OLLAMA_URL),
    // Models pulled by the setup page go to this project's own folder, so a
    // portable install keeps everything together and easy to remove.
    ...(binary === portables.path ? { OLLAMA_MODELS: runtimeModelsDir(process.env) } : {}),
  }
  const daemon = spawn(binary, ['serve'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let daemonError = null
  daemon.stdout.on('data', (chunk) => process.stdout.write(`[ollama] ${chunk}`))
  daemon.stderr.on('data', (chunk) => process.stderr.write(`[ollama] ${chunk}`))
  daemon.once('error', (error) => {
    daemonError = error
    console.warn(`[ollama] could not start: ${error.message}`)
  })
  daemon.once('exit', (code) => {
    if (!stopping) console.warn(`[ollama] server exited (${code}); local inference may be unavailable.`)
  })
  children.push(daemon)
  console.log(`Starting the local Ollama server at ${endpointLabel}…`)
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && daemon.exitCode === null && !daemonError) {
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

/**
 * Installation is a page now, not a flag.
 *
 * When the bridge comes up without a complete stack — Ollama not running, or a
 * model the plan chose not on disk — open the setup page so the choice and the
 * one click are in front of the user rather than something they have to know
 * about. Silent when the stack is already there, and skippable with --no-open.
 */
async function offerSetup() {
  if (noOpen && !autoInstall) return
  const bridgePort = Number(process.env.JARVIS_BRIDGE_PORT ?? 8787)
  const hud = `http://localhost:${process.env.PORT ?? 5173}`
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(`http://localhost:${bridgePort}/autopilot`, { signal: AbortSignal.timeout(1200) })
      if (response.ok) {
        const plan = await response.json()
        const wanted = (plan.modelSlots ?? []).filter((slot) => slot.model)
        const incomplete = wanted.some((slot) => slot.state !== 'ready')
        if (!plan.ollama || incomplete) {
          if (autoInstall) return installEverything(plan, bridgePort, hud)
          const url = `http://localhost:${bridgePort}/install?hud=${encodeURIComponent(hud)}`
          console.log(`\n  No complete model stack yet. Choose one in the setup page:\n    ${url}\n`)
          openBrowser(url)
        }
        return
      }
    } catch { /* the bridge is still binding its port */ }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

/**
 * `--auto`: press the button for the user.
 *
 * This is the double-click path, so it has to be honest about everything it
 * does: the chosen size and the model names are printed before anything is
 * downloaded, each step is reported as it happens, and a failure names itself
 * instead of leaving a half-installed stack and a cheerful message.
 */
async function installEverything(plan, bridgePort, hud) {
  // The same rung the setup page preselects: the largest tier this machine's
  // RAM can hold, which is what the planner's own catalogue would offer.
  const totalRamGb = Number(plan.runtime?.totalRamGb ?? plan.ram?.totalGb ?? 0)
  const tiers = (plan.tiers ?? []).filter((tier) => Number(tier.ramGb) > 0)
  const fitting = tiers.filter((tier) => tier.ramGb <= totalRamGb).sort((a, b) => b.ramGb - a.ramGb)[0]
  const ramGb = fitting?.ramGb ?? tiers[0]?.ramGb ?? 0.5
  console.log(`\n  Installing the model stack this machine fits: ${ramGb < 1 ? '500 MB' : `${ramGb} GB`} · ${gb(fitting?.totalDownloadGb ?? 0)} of models`)
  console.log('  Runtime first, then the chat/vision/coding weights. Ctrl-C stops it all.\n')

  let job
  try {
    const response = await fetch(`http://localhost:${bridgePort}/autopilot/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ramGb, runtime: true, runtimeVariant: 'auto' }),
    })
    job = await response.json()
  } catch (error) {
    console.error(`  Could not start the installer: ${error.message}`)
    console.error(`  Open the setup page instead: http://localhost:${bridgePort}/install?hud=${encodeURIComponent(hud)}`)
    return
  }
  if (job?.error) {
    console.error(`  Installer refused: ${job.error}`)
    return
  }

  const seen = new Set()
  const deadline = Date.now() + 60 * 60 * 1000
  while (Date.now() < deadline && !stopping) {
    let status
    try {
      const response = await fetch(`http://localhost:${bridgePort}/autopilot/install/status?id=${encodeURIComponent(job.jobId)}`)
      status = await response.json()
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      continue
    }
    for (const step of status.steps ?? []) {
      const line = stepLine(step)
      if (line && !seen.has(line)) {
        seen.add(line)
        console.log(`  ${line}`)
      }
    }
    if (status.state !== 'running') {
      if (status.state === 'failed') console.error(`\n  Installation failed: ${status.error ?? 'see the steps above'}`)
      else if (status.state === 'partial') console.log('\n  Partly installed — the skipped steps are listed above.')
      else console.log('\n  Everything is installed. Ask away.')
      // The HUD URL is the one Vite printed a line or two above, which is not
      // always 5173: a second copy of the app moves it along.
      console.log(`  Open the Vite URL above in Chrome and say “Hey Jarvis”, or type at it with \`npm run cli\`.`)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
}

/** One terminal line per installer step, deduplicated by the caller. */
function stepLine(step) {
  const pct = step.total ? ` · ${Math.round((step.completed / step.total) * 100)}%` : ''
  switch (step.phase) {
    case 'runtime-download': return step.completed && step.total && step.completed < step.total
      ? `↓ ${step.status ?? 'runtime'}${pct}`
      : `↓ ${step.status ?? 'runtime'}`
    case 'runtime-verify': return `· ${step.status ?? 'verifying'}`
    case 'runtime-unpack': return `· ${step.status ?? 'unpacking'}`
    case 'runtime-ready': return `✓ ${step.status ?? 'runtime ready'}`
    case 'runtime': return step.ok === false ? `✗ ${step.status}` : `· ${step.status}`
    case 'plan': return `· ${step.summary ?? 'planned'}`
    case 'pull': return `↓ ${step.model}${pct}`
    case 'whisper': return `↓ ${step.file}${pct}`
    case 'browser-voice': return `· voice · ${step.status ?? ''}`
    case 'skip': return `· skipped ${step.model ?? ''}${step.status ? ` · ${step.status}` : ''}`
    case 'done': return `✓ installed ${step.installed ?? 0}, skipped ${step.skipped ?? 0}, failed ${step.failed ?? 0}`
    default: return null
  }
}

const gb = (value) => `${Number(value).toFixed(2)} GB`

void offerSetup()
// npm is a shell script on most systems; call the vite binary directly so we do
// not need shell:true (which would break the argument handling above).
run('face', process.execPath, ['node_modules/vite/bin/vite.js'], '35', {})

console.log(
  '\nWhen it says the dev server is ready, open the URL it prints in Chrome,\n' +
    'click INITIALISE, and say "Hey Jarvis". Ctrl-C stops everything.\n',
)
