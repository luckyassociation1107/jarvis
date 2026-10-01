#!/usr/bin/env node
/**
 * First-run local model setup for build.ps1 / build.sh.
 *
 * Checks the live RAM plan, starts Ollama temporarily if needed, and installs
 * only selected models whose estimated resident use fits the fixed 40% JARVIS
 * allowance. Other RAM tiers are catalogue entries, never bulk downloads.
 */
import { spawn, spawnSync } from 'node:child_process'
import { install, plan, planSummary } from '../bridge/autopilot.mjs'

const GB = 1024 ** 3
const OLLAMA_URL = (process.env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, '')
const args = new Set(process.argv.slice(2))
const currentPlan = plan()
const fittedOllamaSlots = ['chat', 'vision', 'reason'].filter((cap) => {
  const choice = currentPlan.choices[cap]
  return Boolean(choice?.fits && choice.model)
})
const fittedDownloadSlots = Object.entries(currentPlan.choices).filter(([cap, choice]) =>
  choice.fits && cap !== 'tts' && Boolean(choice.model || choice.file),
)

function isLoopback(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.')
}

function ollamaEndpoint() {
  try { return new URL(OLLAMA_URL) } catch { return null }
}

function usesOllamaByDefault() {
  try {
    const modelUrl = new URL(process.env.JARVIS_MODEL_BASE_URL ?? 'http://localhost:11434/v1')
    const ollamaUrl = ollamaEndpoint()
    return Boolean(
      ollamaUrl && isLoopback(modelUrl.hostname) && isLoopback(ollamaUrl.hostname)
      && modelUrl.hostname === ollamaUrl.hostname
      && modelUrl.port === ollamaUrl.port
      && /\/v1\/?$/.test(modelUrl.pathname),
    )
  } catch {
    return false
  }
}

function hasOllamaCli() {
  const binary = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
  const result = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  return !result.error && result.status === 0
}

async function ollamaReady() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1800) })
    return response.ok
  } catch {
    return false
  }
}

function activeOllamaNames() {
  return fittedOllamaSlots.map((cap) => `${cap}: ${currentPlan.choices[cap].model}`).join('\n')
}

if (args.has('--needs-local-ollama-install')) {
  const endpoint = ollamaEndpoint()
  const shouldPull = fittedOllamaSlots.length > 0 && usesOllamaByDefault()
  const shouldInstall = shouldPull && endpoint && isLoopback(endpoint.hostname)
    && !hasOllamaCli() && !(await ollamaReady())
  process.stdout.write(shouldInstall ? 'yes' : 'no')
  process.exit(0)
}

if (args.has('--plan-json')) {
  const slots = Object.fromEntries(Object.entries(currentPlan.choices).map(([cap, choice]) => [
    cap,
    {
      model: choice.model ?? choice.file ?? null,
      fits: Boolean(choice.fits),
      mode: choice.mode ?? null,
      downloadGb: +(choice.bytes / GB).toFixed(2),
      residentGb: +(choice.residentBytes / GB).toFixed(2),
    },
  ]))
  console.log(JSON.stringify({
    summary: planSummary(currentPlan),
    ramGb: +currentPlan.budget.gb.toFixed(2),
    capGb: +(currentPlan.effectiveModelBytes / GB).toFixed(2),
    totalDownloadGb: +(currentPlan.totalDownloadBytes / GB).toFixed(2),
    fittedOllamaSlots,
    slots,
  }, null, 2))
  process.exit(0)
}

if (!args.has('--install')) {
  console.error('Usage: node scripts/model-bootstrap.mjs --install | --plan-json | --needs-local-ollama-install')
  process.exit(2)
}

console.log('\nJARVIS automatic local model setup')
console.log('----------------------------------')
console.log(planSummary(currentPlan))
console.log(`Selected Ollama slots that fit: ${fittedOllamaSlots.length ? fittedOllamaSlots.join(', ') : 'none'}`)
if (fittedOllamaSlots.length) console.log(activeOllamaNames())
console.log(`Fitting local model assets: ${fittedDownloadSlots.length ? fittedDownloadSlots.map(([cap]) => cap).join(', ') : 'none'}`)
console.log(`Estimated selected asset size: ${(currentPlan.totalDownloadBytes / GB).toFixed(2)} GB maximum (already installed files are reused; neural TTS is cached by the browser on first use).`)
console.log('Only this detected RAM plan is eligible for installation. Non-fitting and other-tier models are not downloaded.')

if (!fittedDownloadSlots.length) {
  console.log('No local model assets fit this RAM/free-memory plan. JARVIS will use the supported browser/OS or configured remote fallbacks.')
  process.exit(0)
}

let daemon = null
let daemonExit = null
let daemonError = null
const endpoint = ollamaEndpoint()
const wantsOllama = fittedOllamaSlots.length > 0 && usesOllamaByDefault()
const localOllama = Boolean(endpoint && isLoopback(endpoint.hostname))

async function startTemporaryOllama() {
  if (!wantsOllama) {
    if (fittedOllamaSlots.length && !usesOllamaByDefault()) {
      console.log('A custom model endpoint is configured; the setup will not install or start a separate Ollama server.')
    }
    return false
  }
  if (await ollamaReady()) {
    console.log(`Ollama API is already available at ${OLLAMA_URL}.`)
    return true
  }
  if (!localOllama) {
    console.warn(`Ollama API at ${OLLAMA_URL} is not reachable; model pulls will be skipped. Configured remote fallbacks are left unchanged.`)
    return false
  }
  if (!hasOllamaCli()) {
    console.warn('Ollama CLI is not installed or not on PATH; selected Ollama model pulls will be skipped. Whisper can still install if it fits.')
    return false
  }

  const binary = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
  const env = { ...process.env }
  if (endpoint?.port) {
    const host = endpoint.hostname.includes(':') ? `[${endpoint.hostname}]` : endpoint.hostname
    env.OLLAMA_HOST = `${host}:${endpoint.port}`
  }
  daemon = spawn(binary, ['serve'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  daemon.stdout.on('data', (chunk) => process.stdout.write(`[ollama] ${chunk}`))
  daemon.stderr.on('data', (chunk) => process.stderr.write(`[ollama] ${chunk}`))
  daemon.once('error', (error) => { daemonError = error })
  daemon.once('exit', (code) => { daemonExit = code })

  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (await ollamaReady()) {
      console.log(`Started a temporary Ollama server at ${OLLAMA_URL} for model setup.`)
      return true
    }
    if (daemonError || daemonExit !== null) break
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  console.warn(`Could not start Ollama${daemonError ? `: ${daemonError.message}` : daemonExit !== null ? ` (exit ${daemonExit})` : ' before the startup timeout'}. Selected Ollama pulls will be skipped.`)
  return false
}

function stopTemporaryOllama() {
  if (daemon && daemon.exitCode === null && !daemon.killed) {
    try { daemon.kill('SIGTERM') } catch { /* already stopped */ }
  }
}

process.once('SIGINT', () => {
  stopTemporaryOllama()
  process.exit(130)
})
process.once('SIGTERM', () => {
  stopTemporaryOllama()
  process.exit(143)
})

try {
  await startTemporaryOllama()
  const result = await install({
    planned: currentPlan,
    dir: 'models',
    skipOllamaModels: !usesOllamaByDefault(),
    onStep: (step) => {
      if (step.phase === 'plan') return
      const slot = step.cap ? `[${String(step.cap).toUpperCase()}] ` : ''
      const title = step.model ?? step.file ?? step.phase ?? 'setup'
      const amount = step.total && step.completed != null
        ? ` ${(step.completed / 1024 ** 2).toFixed(0)} / ${(step.total / 1024 ** 2).toFixed(0)} MB`
        : ''
      const status = step.status ? ` — ${step.status}` : ''
      console.log(`${slot}${title}${amount}${status}`)
    },
  })
  const failed = result.log.filter((entry) => !entry.ok && !entry.skipped)
  const skippedFit = result.log.filter((entry) => entry.fits !== false && entry.skipped && entry.note && /Ollama is offline/i.test(entry.note))
  const installed = result.log.filter((entry) => entry.ok && !entry.skipped)
  console.log(`\nModel setup finished: ${installed.length} new asset(s), ${result.log.filter((entry) => entry.skipped).length} reused/fallback item(s), ${failed.length} failed item(s).`)
  if (skippedFit.length) console.warn('Some selected local chat/vision/coding models remain unavailable because the configured Ollama API could not be reached.')
  if (failed.length) {
    for (const entry of failed) console.error(`  FAILED ${entry.cap ?? entry.id}: ${entry.error ?? 'unknown error'}`)
    process.exitCode = 1
  } else if (skippedFit.length) {
    process.exitCode = 1
  }
} catch (error) {
  console.error(`Model setup failed: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  stopTemporaryOllama()
}
