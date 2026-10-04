#!/usr/bin/env node
/**
 * First-run local model setup for build.ps1.
 *
 * Checks the live RAM plan, starts Ollama temporarily if needed, and installs
 * only selected models whose estimated resident use fits the user's share of
 * currently free RAM. Other RAM tiers are catalogue entries, never bulk
 * downloads.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { install, plan, planSummary } from '../bridge/autopilot.mjs'
import { findRuntimeBinary, runtimePlan } from '../bridge/portable-runtime.mjs'
import {
  canStartLocalOllama,
  configuredModelBaseUrl,
  configuredModelName,
  displayEndpoint,
  hasExplicitModelOverride,
  isLocalOllamaApi,
  MODEL_SLOTS,
  ollamaListenAddress,
} from './ollama-endpoints.mjs'

const GB = 1024 ** 3
const OLLAMA_URL = (process.env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, '')
const args = new Set(process.argv.slice(2))
const knownArgs = new Set(['--install', '--plan-json', '--needs-local-ollama-install', '--confirm'])
const unknownArgs = [...args].filter((argument) => !knownArgs.has(argument))
if (unknownArgs.length) {
  console.error(`Unknown option${unknownArgs.length === 1 ? '' : 's'}: ${unknownArgs.join(', ')}`)
  process.exit(2)
}

const currentPlan = plan()
const fittedOllamaSlots = MODEL_SLOTS.filter((cap) => {
  const choice = currentPlan.choices[cap]
  return Boolean(choice?.fits && choice.model)
})
// Only install planner-selected tags for slots that actually use this local
// Ollama instance. Explicit model overrides and alternate URLs remain untouched.
const installableOllamaSlots = fittedOllamaSlots.filter((cap) =>
  !hasExplicitModelOverride(cap)
  && isLocalOllamaApi(configuredModelBaseUrl(cap), OLLAMA_URL),
)
const configuredLocalOllamaSlots = MODEL_SLOTS.filter((cap) =>
  Boolean(configuredModelName(cap, currentPlan.choices[cap]))
  && isLocalOllamaApi(configuredModelBaseUrl(cap), OLLAMA_URL),
)
const installableDownloadSlots = Object.entries(currentPlan.choices).filter(([cap, choice]) =>
  choice.fits && (
    (choice.kind === 'whisper' && Boolean(choice.file))
    || installableOllamaSlots.includes(cap) && Boolean(choice.model)
  ),
)
const automaticDownloadBytes = [...new Map(installableDownloadSlots.map(([, choice]) => [
  choice.kind === 'whisper' ? `whisper:${choice.file}` : `ollama:${choice.model}`,
  choice.bytes,
])).values()].reduce((sum, bytes) => sum + bytes, 0)

function hasOllamaCli() {
  // The project's own downloaded runtime is an Ollama CLI too.
  const binary = findRuntimeBinary(runtimePlan(), process.env) ?? 'ollama.exe'
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

function activeOllamaNames(slots = installableOllamaSlots) {
  return slots.map((cap) => `${cap}: ${currentPlan.choices[cap].model}`).join('\n')
}

if (args.has('--needs-local-ollama-install')) {
  const shouldCheck = installableOllamaSlots.length > 0 && canStartLocalOllama(OLLAMA_URL)
  const shouldInstall = shouldCheck && !hasOllamaCli() && !(await ollamaReady())
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
    automaticDownloadGb: +(automaticDownloadBytes / GB).toFixed(2),
    fittedOllamaSlots,
    installableOllamaSlots,
    configuredLocalOllamaSlots,
    slots,
  }, null, 2))
  process.exit(0)
}

if (!args.has('--install')) {
  console.error('Usage: node scripts/model-bootstrap.mjs --install [--confirm] | --plan-json | --needs-local-ollama-install')
  console.error('')
  console.error('  --install          Install models from the current RAM plan (prompts for confirmation)')
  console.error('  --confirm          Skip the confirmation prompt — pull immediately')
  console.error('  --plan-json        Print the current plan as JSON')
  process.exit(2)
}

console.log('\nJARVIS automatic local model setup')
console.log('----------------------------------')
console.log(planSummary(currentPlan))
console.log(`Selected Ollama slots that fit: ${fittedOllamaSlots.length ? fittedOllamaSlots.join(', ') : 'none'}`)
if (installableOllamaSlots.length) {
  console.log(`Planner weights eligible for this local Ollama: ${installableOllamaSlots.join(', ')}`)
  console.log(activeOllamaNames())
} else if (fittedOllamaSlots.length) {
  console.log('Planner Ollama weights will not be pulled: configured model overrides or non-local endpoints are left unchanged.')
}
console.log(`Fitting assets eligible for setup: ${installableDownloadSlots.length ? installableDownloadSlots.map(([cap]) => cap).join(', ') : 'none'}`)
console.log(`Estimated automatic download size: ${(automaticDownloadBytes / GB).toFixed(2)} GB maximum (installed files are reused; neural TTS is cached by the browser on first use).`)
console.log('Only this detected RAM plan is eligible for installation. Non-fitting and other-tier models are not downloaded.')

if (!installableDownloadSlots.length) {
  console.log('No local model assets need automatic installation. JARVIS will use the configured model endpoint and supported browser/OS fallbacks.')
  process.exit(0)
}

let daemon = null
let daemonExit = null
let daemonError = null
let stopDaemonPromise = null

async function startTemporaryOllama() {
  const endpointLabel = displayEndpoint(OLLAMA_URL)
  if (!installableOllamaSlots.length) {
    if (configuredLocalOllamaSlots.length) {
      console.log('A configured local Ollama model is manually selected; its server and weights will not be changed by the planner installer.')
    }
    return false
  }
  if (await ollamaReady()) {
    console.log(`Ollama API is already available at ${endpointLabel}.`)
    return true
  }
  if (!canStartLocalOllama(OLLAMA_URL)) {
    console.warn(`Ollama API at ${endpointLabel} is not reachable and is not a directly startable loopback endpoint; model pulls will be skipped.`)
    return false
  }
  if (!hasOllamaCli()) {
    console.warn('Ollama CLI is not installed or not on PATH; selected Ollama model pulls will be skipped. Whisper can still install if it fits.')
    return false
  }

  const binary = 'ollama.exe'
  const env = { ...process.env, OLLAMA_HOST: ollamaListenAddress(OLLAMA_URL) }
  daemon = spawn(binary, ['serve'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  daemon.stdout.on('data', (chunk) => process.stdout.write(`[ollama] ${chunk}`))
  daemon.stderr.on('data', (chunk) => process.stderr.write(`[ollama] ${chunk}`))
  daemon.once('error', (error) => { daemonError = error })
  daemon.once('exit', (code) => { daemonExit = code })

  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (await ollamaReady()) {
      console.log(`Started a temporary Ollama server at ${endpointLabel} for model setup.`)
      return true
    }
    if (daemonError || daemonExit !== null) break
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  console.warn(`Could not start Ollama${daemonError ? `: ${daemonError.message}` : daemonExit !== null ? ` (exit ${daemonExit})` : ' before the startup timeout'}. Selected Ollama pulls will be skipped.`)
  return false
}

function stopTemporaryOllama() {
  if (stopDaemonPromise) return stopDaemonPromise
  if (!daemon || daemon.exitCode !== null || daemon.signalCode !== null) return Promise.resolve()

  stopDaemonPromise = new Promise((resolve) => {
    const forceStop = setTimeout(() => {
      if (daemon.exitCode === null && daemon.signalCode === null) {
        try { daemon.kill('SIGKILL') } catch { /* already stopped */ }
      }
    }, 3000)
    forceStop.unref()
    daemon.once('close', () => {
      clearTimeout(forceStop)
      resolve()
    })
    try { daemon.kill('SIGTERM') } catch { clearTimeout(forceStop); resolve() }
  })
  return stopDaemonPromise
}

process.once('SIGINT', () => {
  void stopTemporaryOllama().finally(() => process.exit(130))
})
process.once('SIGTERM', () => {
  void stopTemporaryOllama().finally(() => process.exit(143))
})

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// ── User confirmation ──
// Always show what will be pulled and wait for the user to agree.
// --confirm is the explicit flag; the prompt is always shown unless
// JARVIS_AUTO_INSTALL=1 is set (for CI / scripted flows).
const autoInstall = args.has('--confirm') || process.env.JARVIS_AUTO_INSTALL === '1'

if (!autoInstall && installableDownloadSlots.length) {
  console.log('\nThe following models will be downloaded:')
  for (const [cap, choice] of installableDownloadSlots) {
    const name = choice.model ?? choice.file ?? cap
    const size = choice.bytes ? ` (${(choice.bytes / GB).toFixed(1)} GB)` : ''
    console.log(`  [${cap.toUpperCase()}] ${name}${size}`)
  }
  console.log(`\nTotal download: ${(automaticDownloadBytes / GB).toFixed(2)} GB`)
  const answer = await ask('\nProceed with download? [Y/n] ')
  if (answer && answer.toLowerCase() !== 'y' && answer !== '') {
    console.log('Cancelled. No models downloaded.')
    await stopTemporaryOllama()
    process.exit(0)
  }
}

try {
  await startTemporaryOllama()
  const result = await install({
    planned: currentPlan,
    dir: 'models',
    onlyOllamaSlots: installableOllamaSlots,
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
  await stopTemporaryOllama()
}
