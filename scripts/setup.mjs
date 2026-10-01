#!/usr/bin/env node
// JARVIS preflight — advisory only. It changes nothing and installs nothing.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, totalmem } from 'node:os'
import { join } from 'node:path'
import { AUTOPILOT_PLAN, MODEL_URL, PIPELINE } from '../bridge/local-llm.mjs'
import { planSummary, whisperFileReady } from '../bridge/autopilot.mjs'

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

// --- OpenAI-compatible model server --------------------------------------
const MODEL_ENDPOINT = MODEL_URL.replace(/\/+$/, '')
let reachable = false
let loaded = []
try {
  const response = await fetch(`${MODEL_ENDPOINT}/models`, { signal: AbortSignal.timeout(4000) })
  if (response.ok) {
    reachable = true
    loaded = ((await response.json())?.data ?? []).map((model) => model?.id).filter(Boolean)
  }
} catch { /* a server may not be running yet */ }

if (!reachable) {
  line(warn, `No OpenAI-compatible model server is reachable at ${MODEL_ENDPOINT}.`)
  line(info, 'The browser HUD and local bridge can still start, but local model inference will not answer until a server is available.')
  line(info, 'This standalone preflight never installs software or models. The root build.ps1/build.sh scripts can install Ollama when the detected fitting local plan needs it.')
  line(info, 'The build scripts install only this machine’s selected, fitting model tier; use MODEL STACK for a manual review or retry.')
} else {
  line(tick, `Model server reachable at ${MODEL_ENDPOINT}${loaded.length ? ` — ${loaded.length} model${loaded.length === 1 ? '' : 's'} listed` : ''}.`)
  for (const [slot, config] of Object.entries(PIPELINE)) {
    if (!config.model) {
      line(warn, `${slot.padEnd(7)} unavailable within the current RAM plan; no local model is selected.`)
      continue
    }
    const have = loaded.length === 0 || loaded.some((id) => id === config.model || id.endsWith(`/${config.model}`))
    if (have) {
      line(tick, `${slot.padEnd(7)} ${config.model}${config.fits === false ? ' (best-effort RAM override)' : ''}`)
    } else if (config.fits === false) {
      line(warn, `${slot.padEnd(7)} ${config.model} is not loaded and is outside the reserved-memory fit; it is not auto-downloaded.`)
    } else {
      line(warn, `${slot.padEnd(7)} ${config.model} is not loaded.`)
      line(info, 'Review the current plan in MODEL STACK before explicitly installing selected models.')
    }
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
