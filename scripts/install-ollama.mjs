#!/usr/bin/env node
/**
 * Auto-install Ollama via CLI — no browser needed.
 *
 * Supports Linux (x86_64, arm64) and macOS (arm64, x86_64).
 * Downloads the official binary, installs it, starts the server,
 * then shows the RAM-based model ladder and lets YOU pick which
 * model to pull. Nothing is downloaded without your say-so.
 *
 * Usage:
 *   node scripts/install-ollama.mjs            # install + pick model + pull
 *   node scripts/install-ollama.mjs --check    # check only, do not install
 *   node scripts/install-ollama.mjs --start    # start if installed, install if not
 *   node scripts/install-ollama.mjs --pull     # skip install, just pick & pull a model
 *   node scripts/install-ollama.mjs --auto     # auto-select largest fitting tier (no prompt)
 *
 * This is what `npm run install:ollama` runs.
 */

import { execSync, spawn } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createInterface } from 'node:readline'
import { homedir, platform, arch, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import process from 'node:process'

/* ────────────────────────────── constants ────────────────────────────── */

const GB = 1024 ** 3
const MB = 1024 ** 2
const OLLAMA_DEFAULT_URL = process.env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434'
const INSTALL_DIR_LINUX = '/usr/local/bin'
const OLLAMA_MODELS_DIR = resolve('models/ollama')

/* ────────────────────────────── helpers ──────────────────────────────── */

const tick = '  ✓  '
const warn = '  ⚠  '
const info = '  ·  '
const fail = '  ✗  '

function line(tag, msg) {
  console.log(`${tag} ${msg}`)
}

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 30_000, ...opts }).trim()
  } catch {
    return null
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

const plat = platform()
const cpu = arch()

/* ──────────────────────────── detection ──────────────────────────────── */

function isOllamaInstalled() {
  const pathBin = sh('which ollama')
  if (pathBin && existsSync(pathBin)) return { installed: true, path: pathBin }

  const locations = [
    '/usr/local/bin/ollama',
    join(homedir(), '.local/bin/ollama'),
    '/usr/bin/ollama',
  ]
  for (const loc of locations) {
    if (existsSync(loc)) return { installed: true, path: loc }
  }
  return { installed: false, path: null }
}

async function isOllamaRunning(url = OLLAMA_DEFAULT_URL) {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

function detectGpu() {
  if (plat === 'darwin') return 'metal'
  if (sh('nvidia-smi')) return 'nvidia'
  if (sh('rocm-smi') || existsSync('/dev/kfd')) return 'rocm'
  return 'cpu'
}

/** How much free RAM, in bytes. */
function availableRam() {
  try {
    const meminfo = require('node:fs').readFileSync('/proc/meminfo', 'utf8')
    const match = meminfo.match(/^MemAvailable:\s+(\d+)\s*kB/m)
    if (match) return Number(match[1]) * 1024
  } catch { /* macOS / no /proc */ }
  // os.freemem() is the fallback
  const { freemem } = require('node:os')
  return freemem()
}

/* ──────────────────────── model ladder ───────────────────────────────── */

/**
 * The same model catalogue the web setup page uses, from the autopilot plan.
 * We import it so the CLI and the page always agree on what is available.
 */
async function getModelTiers() {
  try {
    const { plan, ladder } = await import('../bridge/autopilot.mjs')
    const p = plan()
    const ladders = ladder()
    return { tiers: [], plan: p, ladders, ok: true }
  } catch {
    return { tiers: [], plan: null, ladders: null, ok: false }
  }
}

/* ──────────────── model picker with quantization filter ───────────────── */

/**
 * Interactive model picker.
 *
 * Flow:
 *   1. Show machine info (RAM, budget)
 *   2. Show available quantization levels → user picks one
 *   3. Show parameter sizes for that quant → user picks one
 *   4. Confirm & pull
 */
async function promptModelChoice() {
  const { plan: p, ladders, ok } = await getModelTiers()
  const freeRam = availableRam()

  // Build the full catalogue from the ladder
  const catalogue = buildCatalogue(ladders)

  if (!catalogue.length) {
    line(warn, 'No models available.')
    return promptFromHardcoded()
  }

  console.log('')
  console.log('  Choose a model to pull')
  console.log('  ═══════════════════════')

  // Machine info
  const totalRamGb = (totalmem() / GB).toFixed(1)
  const freeRamGb = (freeRam / GB).toFixed(1)
  const budgetGb = p ? (p.effectiveModelBytes / GB).toFixed(1) : '?'
  line(info, `RAM: ${totalRamGb} GB total · ${freeRamGb} GB free · ${budgetGb} GB AI ceiling`)
  line(info, `GPU: ${detectGpu()}`)
  if (p?.budget) {
    line(info, `Plan: ${(p.budget.share * 100).toFixed(0)}% of free RAM${p.budget.capGb ? ` · hard cap ${p.budget.capGb} GB` : ''}`)
  }
  console.log('')

  // ── Step 1: Pick quantization level ──
  const quantLevels = getAvailableQuants(catalogue)
  const quantChoice = await pickQuantization(quantLevels, catalogue, freeRam)
  if (!quantChoice) return null

  // ── Step 2: Pick parameter size ──
  const filtered = catalogue.filter((m) => m.quant === quantChoice)
  const model = await pickParameterSize(filtered, freeRam)
  if (!model) return null

  // ── Step 3: Confirm ──
  console.log('')
  line(info, `Model: ${model.model}`)
  line(info, `Quant: ${model.quant} · ${model.params}B · ${model.sizeGb.toFixed(1)} GB download`)
  line(info, `Fits:  ${model.sizeGb * 1.3 <= freeRam / GB ? 'yes' : '⚠ tight — may need swap'}`)

  const confirm = await ask(`\n  Pull ${model.model}? [Y/n] `)
  if (confirm && confirm.toLowerCase() !== 'y' && confirm !== '') {
    line(info, 'Cancelled. No model pulled.')
    return null
  }

  return model.model
}

/**
 * Build a flat catalogue from the autopilot ladder.
 * Deduplicates by model name, keeps the best metadata.
 */
function buildCatalogue(ladders) {
  if (!ladders?.chat?.rungs) return []

  const seen = new Set()
  const models = []

  for (const rung of ladders.chat.rungs) {
    if (!rung.model || seen.has(rung.model)) continue
    seen.add(rung.model)
    models.push({
      model: rung.model,
      quant: rung.quant ?? '?',
      params: rung.parametersB ?? 0,
      sizeGb: rung.downloadGb ?? 0,
      residentGb: rung.residentGb ?? 0,
      quality: rung.quality ?? 0,
      multimodal: rung.multimodal ?? false,
      note: rung.note ?? '',
    })
  }

  return models.sort((a, b) => b.sizeGb - a.sizeGb)
}

/**
 * Get unique quantization levels from the catalogue, ordered by quality.
 */
function getAvailableQuants(catalogue) {
  const QUANT_ORDER = ['F16', 'Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M', 'Q3_K_M', 'Q2_K']
  const present = new Set(catalogue.map((m) => m.quant))
  const ordered = QUANT_ORDER.filter((q) => present.has(q))
  // Add any quants not in our order list at the end
  for (const q of present) {
    if (!ordered.includes(q)) ordered.push(q)
  }
  return ordered
}

/**
 * Step 1: Let the user pick a quantization level.
 *
 * Shows each level with quality description, model count, and size range.
 */
async function pickQuantization(quants, catalogue, freeRam) {
  const QUANT_INFO = {
    'F16':    { label: 'Full precision (F16)',     quality: '★★★★★ largest, best quality' },
    'Q8_0':   { label: 'High quality (Q8_0)',      quality: '★★★★☆ near-lossless, large' },
    'Q6_K':   { label: 'Good quality (Q6_K)',      quality: '★★★★ good balance' },
    'Q5_K_M': { label: 'Balanced (Q5_K_M)',        quality: '★★★☆ solid middle ground' },
    'Q4_K_M': { label: 'Compact (Q4_K_M)',         quality: '★★★ most popular, smaller' },
    'Q3_K_M': { label: 'Small (Q3_K_M)',           quality: '★★☆ fast, some quality loss' },
    'Q2_K':   { label: 'Smallest (Q2_K)',          quality: '★★ fastest, noticeable loss' },
  }

  // Find recommended quant based on free RAM
  const freeGb = freeRam / GB
  let recIdx = quants.length - 1 // default: smallest
  for (let i = 0; i < quants.length; i++) {
    const smallestInQuant = catalogue.filter((m) => m.quant === quants[i]).sort((a, b) => a.sizeGb - b.sizeGb)[0]
    if (smallestInQuant && smallestInQuant.sizeGb * 1.3 <= freeGb) {
      recIdx = i
      break
    }
  }

  console.log('  Step 1: Quantization level')
  console.log('  ───────────────────────────')
  console.log('')

  quants.forEach((q, i) => {
    const num = String(i + 1).padStart(3)
    const info = QUANT_INFO[q] ?? { label: q, quality: '' }
    const modelsInQuant = catalogue.filter((m) => m.quant === q)
    const sizeRange = modelsInQuant.length
      ? `${modelsInQuant[modelsInQuant.length - 1].sizeGb.toFixed(1)}–${modelsInQuant[0].sizeGb.toFixed(1)} GB`
      : ''
    const rec = i === recIdx ? '  ← recommended' : ''
    console.log(`  ${num}  ${info.label.padEnd(32)} ${info.quality.padEnd(30)} ${sizeRange.padStart(14)}  (${modelsInQuant.length} models)${rec}`)
  })

  console.log('')
  const answer = await ask(`  Pick quantization (1–${quants.length}) [${recIdx + 1}]: `)

  let chosen = recIdx
  if (answer) {
    const num = Number(answer)
    if (Number.isInteger(num) && num >= 1 && num <= quants.length) {
      chosen = num - 1
    } else {
      line(warn, `Invalid. Using recommended (${recIdx + 1}).`)
    }
  }

  return quants[chosen]
}

/**
 * Step 2: Let the user pick a parameter size for the chosen quantization.
 *
 * Shows models sorted by parameter count (smallest to largest).
 */
async function pickParameterSize(models, freeRam) {
  if (!models.length) {
    line(warn, 'No models for this quantization.')
    return null
  }

  // Sort by parameter size ascending
  const sorted = [...models].sort((a, b) => a.params - b.params)

  // Find recommended: largest model that fits
  const freeGb = freeRam / GB
  let recIdx = 0
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].sizeGb * 1.3 <= freeGb) { recIdx = i; break }
  }

  console.log('')
  console.log(`  Step 2: Parameter size (${sorted[0].quant})`)
  console.log('  ──────────────────────────────────────')
  console.log('')
  console.log('  #   Params     Model                                          Download    Resident    Fits?')
  console.log('  ─── ────────── ────────────────────────────────────────────── ─────────── ─────────── ────')

  sorted.forEach((m, i) => {
    const num = String(i + 1).padStart(3)
    const params = `${m.params.toFixed(1)}B`.padEnd(10)
    const name = m.model.length > 48 ? m.model.slice(0, 45) + '…' : m.model.padEnd(48)
    const size = `${m.sizeGb.toFixed(1)} GB`.padStart(11)
    const resident = `${m.residentGb.toFixed(1)} GB`.padStart(11)
    const fits = m.sizeGb * 1.3 <= freeGb ? ' ✓' : ' ✗'
    const rec = i === recIdx ? '  ← recommended' : ''
    console.log(`  ${num}  ${params} ${name} ${size}     ${resident} ${fits}${rec}`)
  })

  console.log('')
  const answer = await ask(`  Pick model (1–${sorted.length}) [${recIdx + 1}]: `)

  let chosen = recIdx
  if (answer) {
    const num = Number(answer)
    if (Number.isInteger(num) && num >= 1 && num <= sorted.length) {
      chosen = num - 1
    } else {
      line(warn, `Invalid. Using recommended (${recIdx + 1}).`)
    }
  }

  return sorted[chosen]
}

/** Fallback when the autopilot ladder cannot be loaded. */
async function promptFromHardcoded() {
  const catalogue = [
    { model: 'huihui_ai/qwen3.5-abliterated:9b-q8_0',   quant: 'Q8_0',   params: 9.65,  sizeGb: 11.0, residentGb: 12.3 },
    { model: 'huihui_ai/qwen3.5-abliterated:9b',         quant: 'Q4_K_M', params: 9.65,  sizeGb: 6.6,  residentGb: 7.8 },
    { model: 'huihui_ai/qwen3.5-abliterated:4B-q8_0',    quant: 'Q8_0',   params: 4.54,  sizeGb: 5.2,  residentGb: 6.1 },
    { model: 'huihui_ai/qwen3.5-abliterated:4b',         quant: 'Q4_K_M', params: 4.54,  sizeGb: 3.3,  residentGb: 4.1 },
    { model: 'huihui_ai/qwen3.5-abliterated:2B-q8_0',    quant: 'Q8_0',   params: 2.27,  sizeGb: 2.7,  residentGb: 3.15 },
    { model: 'huihui_ai/qwen3.5-abliterated:2b',         quant: 'Q4_K_M', params: 2.27,  sizeGb: 1.9,  residentGb: 2.35 },
    { model: 'huihui_ai/qwen3.5-abliterated:0.8b',       quant: 'Q8_0',   params: 0.873, sizeGb: 1.0,  residentGb: 1.3 },
  ]

  const freeRam = availableRam()
  const freeGb = freeRam / GB

  console.log('')
  console.log('  Choose a model to pull')
  console.log('  ═══════════════════════')
  line(info, `Free RAM: ${freeGb.toFixed(1)} GB`)
  console.log('')

  // Step 1: quant
  const quants = ['Q8_0', 'Q4_K_M']
  console.log('  Step 1: Quantization level')
  console.log('  ───────────────────────────')
  console.log('')
  console.log('    1  High quality (Q8_0)              ★★★★☆ near-lossless, larger')
  console.log('    2  Compact (Q4_K_M)                 ★★★   most popular, smaller   ← recommended')
  console.log('')
  const qAnswer = await ask('  Pick quantization (1–2) [2]: ')
  const qIdx = qAnswer === '1' ? 0 : 1
  const chosenQuant = quants[qIdx]

  // Step 2: parameter size
  const filtered = catalogue.filter((m) => m.quant === chosenQuant)
  let recIdx = 0
  for (let i = filtered.length - 1; i >= 0; i--) {
    if (filtered[i].sizeGb * 1.3 <= freeGb) { recIdx = i; break }
  }

  console.log('')
  console.log(`  Step 2: Parameter size (${chosenQuant})`)
  console.log('  ──────────────────────────────────────')
  console.log('')

  filtered.forEach((m, i) => {
    const num = String(i + 1).padStart(3)
    const params = `${m.params.toFixed(1)}B`.padEnd(10)
    const name = m.model.padEnd(48)
    const size = `${m.sizeGb.toFixed(1)} GB`.padStart(10)
    const fits = m.sizeGb * 1.3 <= freeGb ? ' ✓' : ' ✗'
    const rec = i === recIdx ? '  ← recommended' : ''
    console.log(`  ${num}  ${params} ${name} ${size}  ${fits}${rec}`)
  })

  console.log('')
  const mAnswer = await ask(`  Pick model (1–${filtered.length}) [${recIdx + 1}]: `)
  let mIdx = recIdx
  if (mAnswer) {
    const n = Number(mAnswer)
    if (Number.isInteger(n) && n >= 1 && n <= filtered.length) mIdx = n - 1
  }

  const selected = filtered[mIdx]
  console.log('')
  line(info, `Selected: ${selected.model} (${selected.quant}, ${selected.params}B, ${selected.sizeGb} GB)`)

  const confirm = await ask(`\n  Pull ${selected.model}? [Y/n] `)
  if (confirm && confirm.toLowerCase() !== 'y' && confirm !== '') {
    line(info, 'Cancelled. No model pulled.')
    return null
  }

  return selected.model
}

/* ──────────────────────── version & info ─────────────────────────────── */

function ollamaVersion() {
  const out = sh('ollama --version')
  if (!out) return null
  const match = out.match(/ollama version is (\S+)/i) || out.match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : out
}

async function printStatus() {
  const version = ollamaVersion()
  const running = await isOllamaRunning()
  const gpu = detectGpu()

  console.log('')
  console.log('  Ollama status')
  console.log('  ─────────────')
  line(info, `Installed: ${version ? `yes (v${version})` : 'no'}`)
  line(info, `Running:   ${running ? 'yes' : 'no'}`)
  line(info, `Endpoint:  ${OLLAMA_DEFAULT_URL}`)
  line(info, `Platform:  ${plat}/${cpu}`)
  line(info, `GPU:       ${gpu}`)
  line(info, `Models:    ${OLLAMA_MODELS_DIR}`)

  if (running) {
    try {
      const res = await fetch(`${OLLAMA_DEFAULT_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
      const data = await res.json()
      const models = data.models ?? []
      line(info, `Loaded:    ${models.length} model${models.length === 1 ? '' : 's'}`)
      for (const m of models.slice(0, 8)) {
        line(info, `           ${m.name} (${((m.size ?? 0) / GB).toFixed(1)} GB)`)
      }
      if (models.length > 8) line(info, `           …and ${models.length - 8} more`)
    } catch { /* fine */ }
  }
  console.log('')
}

/* ──────────────────────────── main ───────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2)
  const checkOnly = args.includes('--check')
  const startOnly = args.includes('--start')
  const pullOnly = args.includes('--pull')
  const autoMode = args.includes('--auto')
  const quiet = args.includes('--quiet')

  if (!quiet) {
    console.log('')
    console.log('  J.A.R.V.I.S — Ollama installer')
    console.log('  ═══════════════════════════════')
  }

  if (plat === 'win32') {
    line(fail, 'This script is for Linux and macOS. On Windows, use `npm run setup` instead.')
    process.exit(1)
  }

  const { installed, path: binPath } = isOllamaInstalled()
  const running = await isOllamaRunning()

  // ── check only ──
  if (checkOnly) {
    await printStatus()
    process.exit(installed && running ? 0 : 1)
  }

  // ── pull only (Ollama must be running) ──
  if (pullOnly) {
    if (!running) {
      line(fail, 'Ollama is not running. Start it first: ollama serve')
      process.exit(1)
    }
    await printStatus()
    const model = autoMode ? null : await promptModelChoice()
    if (model) {
      const ok = await pullModel(model)
      process.exit(ok ? 0 : 1)
    }
    process.exit(0)
  }

  // ── installed and running ──
  if (installed && running) {
    if (!quiet) {
      line(tick, `Ollama is already installed (${binPath}) and running at ${OLLAMA_DEFAULT_URL}`)
      await printStatus()
    }

    // Always ask to pull a model, even when already installed
    if (!quiet) {
      const model = autoMode ? null : await promptModelChoice()
      if (model) {
        await pullModel(model)
      }
    }
    process.exit(0)
  }

  // ── installed but not running ──
  if (installed && !running) {
    line(info, `Ollama is installed (${binPath}) but not running.`)
    if (startOnly || !checkOnly) {
      const result = await startOllamaDaemon()
      if (!result.ok) {
        line(fail, `Could not start Ollama: ${result.error}`)
        process.exit(1)
      }
      await printStatus()

      // Always ask to pull a model
      const model = autoMode ? null : await promptModelChoice()
      if (model) {
        await pullModel(model)
      }
      process.exit(0)
    }
    process.exit(1)
  }

  // ── not installed — install first ──
  if (!installed) {
    line(info, 'Ollama is not installed. Installing now…')
    line(info, 'This may ask for your password (sudo) on Linux.')
    console.log('')

    const result = await installOllama()
    if (!result.ok) {
      console.log('')
      line(fail, `Installation failed: ${result.error}`)
      line(info, 'Try manually: curl -fsSL https://ollama.com/install.sh | sh')
      process.exit(1)
    }

    console.log('')
    line(tick, `Ollama installed (method: ${result.method}).`)
  }

  // Start it
  line(info, 'Starting Ollama…')
  const startResult = await startOllamaDaemon()

  if (!startResult.ok) {
    console.log('')
    line(warn, `Ollama installed but could not auto-start: ${startResult.error}`)
    line(info, 'Start it manually:  ollama serve')
    line(info, 'Then run:           npm run install:ollama -- --pull')
    process.exit(1)
  }

  console.log('')
  line(tick, 'Ollama is ready!')
  await printStatus()

  // Always let the user choose which model to pull
  const model = autoMode ? null : await promptModelChoice()
  if (model) {
    const ok = await pullModel(model)
    if (ok) {
      console.log('')
      line(tick, 'Setup complete!')
      console.log('')
      console.log('  Next step:')
      console.log('    npm start              # launch JARVIS')
      console.log('')
    }
    process.exit(ok ? 0 : 1)
  }

  console.log('  You can pull a model later:')
  console.log('    npm run install:ollama -- --pull')
  console.log('    ollama pull <model-name>')
  console.log('')
  process.exit(0)
}

main().catch((err) => {
  line(fail, err.message)
  process.exit(1)
})