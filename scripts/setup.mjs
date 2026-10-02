#!/usr/bin/env node
// JARVIS preflight — advisory only. It changes nothing and installs nothing.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, totalmem } from 'node:os'
import { join } from 'node:path'
import { AUTOPILOT_PLAN, PIPELINE } from '../bridge/local-llm.mjs'
import { planSummary, whisperFileReady } from '../bridge/autopilot.mjs'
import { displayEndpoint } from './ollama-endpoints.mjs'

const require = createRequire(import.meta.url)
const GB = 1024 ** 3
const tick = '  ok  '
const warn = ' note '
const info = '  ·   '

function line(tag, message) {
  console.log(`[${tag}] ${message}`)
}

console.log('')
console.log('JARVIS preflight — checking prerequisites (nothing is changed)')
console.log('-------------------------------------------------------------')

// --- Node version --------------------------------------------------------
const major = Number(process.versions.node.split('.')[0])
if (Number.isFinite(major) && major >= 20) {
  line(tick, `Node.js ${process.versions.node} (20+ required).`)
} else {
  line(warn, `Node.js ${process.versions.node} is below 20. The bridge needs Node 20 or newer.`)
}

// --- RAM plan ------------------------------------------------------------
const plan = AUTOPILOT_PLAN
line(tick, `RAM planner: ${planSummary(plan)}`)
line(info, 'Estimates only. The fixed split is 35% OS, 25% other apps and at most 40% JARVIS.')

// --- OpenAI-compatible model servers -------------------------------------
async function inspectModelEndpoint(endpoint) {
  try {
    const response = await fetch(`${String(endpoint).replace(/\/+$/, '')}/models`, {
      headers: { authorization: `Bearer ${process.env.JARVIS_MODEL_API_KEY ?? 'jarvis-local'}` },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return { reachable: false, status: response.status, inventoryKnown: false, loaded: [] }
    let body = null
    try { body = await response.json() } catch { /* server answered, but inventory is unknown */ }
    const inventoryKnown = Array.isArray(body?.data)
    const loaded = inventoryKnown
      ? body.data.map((model) => model?.id).filter((id) => typeof id === 'string' && id.length > 0)
      : []
    return { reachable: true, inventoryKnown, loaded }
  } catch {
    return { reachable: false, status: null, inventoryKnown: false, loaded: [] }
  }
}

const configuredModelSlots = Object.entries(PIPELINE).filter(([, config]) => Boolean(config.model))
const configuredEndpoints = [...new Set(configuredModelSlots.map(([, config]) => config.url).filter(Boolean))]
const endpointStates = new Map(await Promise.all(configuredEndpoints.map(async (endpoint) => [
  endpoint,
  await inspectModelEndpoint(endpoint),
])))

if (!configuredModelSlots.length) {
  line(warn, 'No local chat, vision or coding model is selected in the current RAM plan or environment.')
} else {
  for (const endpoint of configuredEndpoints) {
    const state = endpointStates.get(endpoint)
    const display = displayEndpoint(endpoint)
    if (state.reachable) {
      const count = state.inventoryKnown ? ` — ${state.loaded.length} model${state.loaded.length === 1 ? '' : 's'} listed` : ''
      line(tick, `Model server reachable at ${display}${count}.`)
    } else {
      const status = state.status ? ` (HTTP ${state.status})` : ''
      line(warn, `No OpenAI-compatible model server is reachable at ${display}${status}.`)
    }
  }

  for (const [slot, config] of Object.entries(PIPELINE)) {
    if (!config.model) {
      line(warn, `${slot.padEnd(7)} unavailable within the current RAM plan; no local model is selected.`)
      continue
    }
    const state = endpointStates.get(config.url)
    if (!state?.reachable) {
      line(info, `${slot.padEnd(7)} ${config.model} cannot be verified until its configured model server is available.`)
      continue
    }
    if (!state.inventoryKnown) {
      line(warn, `${slot.padEnd(7)} ${config.model} is unverified; this server did not return a readable model list.`)
      continue
    }
    const have = state.loaded.some((id) => id === config.model || id.endsWith(`/${config.model}`))
    if (have) {
      line(tick, `${slot.padEnd(7)} ${config.model}${config.fits === false ? ' (best-effort RAM override)' : ''}`)
    } else if (config.fits === false) {
      line(warn, `${slot.padEnd(7)} ${config.model} is not loaded and is outside the reserved-memory fit; it is not auto-downloaded.`)
    } else {
      line(warn, `${slot.padEnd(7)} ${config.model} is not loaded.`)
      line(info, 'Review the current plan in MODEL STACK before explicitly installing selected models.')
    }
  }

  if (configuredEndpoints.some((endpoint) => !endpointStates.get(endpoint)?.reachable)) {
    line(info, 'The browser HUD and local bridge can still start, but an unavailable model route will not answer until its server is running.')
    line(info, 'This standalone preflight never installs software or models. The root build.ps1/build.sh scripts can install Ollama when the selected fitted plan uses a directly startable local Ollama endpoint.')
    line(info, 'The build scripts leave manual model overrides and remote/custom endpoints unchanged; use MODEL STACK to review or retry an explicit install.')
  }
}

// --- Speech planning -----------------------------------------------------
const whisper = plan.choices.speech
if (!whisper?.fits) {
  line(warn, 'Local Whisper STT does not fit this RAM plan; browser speech recognition remains the fallback.')
} else {
  const modelPath = join(process.cwd(), 'models', whisper.file)
  const modelReady = await whisperFileReady(modelPath)
  let runtimeReady = false
  try { require.resolve('@lumen-labs-dev/whisper-node'); runtimeReady = true } catch { /* installed by the explicit installer */ }
  if (modelReady && runtimeReady) {
    line(tick, `Whisper STT ready: ${whisper.file} (multilingual).`)
  } else {
    line(warn, `Whisper plan: ${whisper.file} (multilingual); ${modelReady ? 'runtime missing' : 'model file missing or incomplete'}.`)
    line(info, 'Use MODEL STACK to install the selected local speech runtime/model explicitly.')
  }
}

const tts = plan.choices.tts
line(tick, tts.engine === 'system'
  ? 'TTS uses browser/OS SpeechSynthesis; no neural voice download is needed.'
  : `TTS selects browser-local Kokoro ${tts.dtype}; it is cached by the browser on first use, not installed here.`)

// --- Optional MCP servers ------------------------------------------------
const claudeJsonPath = join(homedir(), '.claude.json')
let mcpCount = 0
try {
  const parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf8'))
  const servers = parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers
    ? parsed.mcpServers
    : {}
  mcpCount = Object.keys(servers).length
} catch { /* optional */ }
if (mcpCount) {
  line(tick, `~/.claude.json has ${mcpCount} optional MCP server${mcpCount === 1 ? '' : 's'}.`)
} else {
  line(info, 'No optional MCP servers configured; JARVIS still has its built-in interface and device tools.')
}

// --- Browser and launch ---------------------------------------------------
line(tick, 'Speech runs in the browser. Use a real Chrome or Edge window for microphone access; embedded previews block it.')
line(info, `Detected host memory: ${(totalmem() / GB).toFixed(1)} GB. Planner figures are estimates, not runtime guarantees.`)
console.log('')
console.log('This preflight installs nothing and downloads no models.')
console.log('To start both local processes:  npm start')
console.log('Or run the root build.ps1 / build.sh to check dependencies, build, and launch JARVIS.')
console.log('')
process.exit(0)
