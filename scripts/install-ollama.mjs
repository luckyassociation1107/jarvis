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
  // Dynamic import so this script works even without the full bridge built
  try {
    const { plan } = await import('../bridge/autopilot.mjs')
    const p = plan()
    const tiers = []
    // Build a flat list from the ladder entries the planner considered
    for (const [cap, choice] of Object.entries(p.choices)) {
      if (!choice.model) continue
      tiers.push({
        cap,
        model: choice.model,
        fits: choice.fits,
        bytes: choice.bytes ?? 0,
        residentBytes: choice.residentBytes ?? 0,
        quality: choice.quality ?? 0,
        note: choice.note ?? '',
      })
    }
    return { tiers, plan: p, ok: true }
  } catch {
    return { tiers: [], plan: null, ok: false }
  }
}

/**
 * Build a user-facing tier table from the autopilot's RAM-profile catalogue.
 *
 * The planner already computed which rungs fit. We present them as a numbered
 * list so the user types one number and that model is pulled — no guessing,
 * no hidden defaults.
 */
function buildTierTable(tiers, freeRam) {
  const models = tiers
    .filter((t) => t.cap === 'chat') // one entry per distinct model; chat covers the shared tag
    .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))

  const seen = new Set()
  return models.filter((m) => {
    if (seen.has(m.model)) return false
    seen.add(m.model)
    return true
  })
}

/* ────────────────────────── download URL ─────────────────────────────── */

function binaryTarballUrl() {
  if (plat === 'linux') {
    if (cpu === 'arm64') return 'https://ollama.com/download/ollama-linux-arm64.tgz'
    return 'https://ollama.com/download/ollama-linux-amd64.tgz'
  }
  if (plat === 'darwin') {
    if (cpu === 'arm64') return 'https://ollama.com/download/ollama-darwin-arm64.tgz'
    return 'https://ollama.com/download/ollama-darwin-amd64.tgz'
  }
  return null
}

/* ──────────────────────── install methods ────────────────────────────── */

async function installViaScript() {
  line(info, 'Downloading the official Ollama install script…')

  let script
  try {
    const res = await fetch('https://ollama.com/install.sh', { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    script = await res.text()
  } catch (err) {
    line(warn, `Could not download the install script: ${err.message}`)
    return { ok: false, error: err.message, method: 'script' }
  }

  const tmpScript = '/tmp/jarvis-ollama-install.sh'
  writeFileSync(tmpScript, script, { mode: 0o755 })

  line(info, 'Running the installer (may ask for your password)…')

  return new Promise((resolve) => {
    const child = spawn('sh', [tmpScript], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    child.stdout.on('data', (d) => {
      for (const l of d.toString().split('\n')) {
        if (l.trim()) line(info, l.trim())
      }
    })
    child.stderr.on('data', (d) => {
      for (const l of d.toString().split('\n')) {
        if (l.trim()) line(info, l.trim())
      }
    })

    child.once('close', (code) => {
      try { unlinkSync(tmpScript) } catch { /* ok */ }
      resolve({ ok: code === 0, error: code !== 0 ? `installer exited with code ${code}` : null, method: 'script' })
    })
    child.once('error', (err) => {
      try { unlinkSync(tmpScript) } catch { /* ok */ }
      resolve({ ok: false, error: err.message, method: 'script' })
    })
  })
}

async function installViaBinary() {
  const url = binaryTarballUrl()
  if (!url) return { ok: false, error: `no binary available for ${plat}/${cpu}`, method: 'binary' }

  line(info, `Downloading Ollama binary from ${url}…`)

  const tmpTgz = '/tmp/ollama-install.tgz'
  const tmpDir = '/tmp/ollama-extract'

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const total = Number(res.headers.get('content-length') ?? 0)
    let downloaded = 0
    let lastPrint = 0

    const counter = new (await import('node:stream')).Transform({
      transform(chunk, _enc, cb) {
        downloaded += chunk.length
        const now = Date.now()
        if (now - lastPrint > 2000 && total) {
          lastPrint = now
          line(info, `  downloading… ${(downloaded / GB).toFixed(1)} / ${(total / GB).toFixed(1)} GB`)
        }
        cb(null, chunk)
      },
    })

    await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(tmpTgz))
    line(tick, 'Download complete.')
  } catch (err) {
    return { ok: false, error: `download failed: ${err.message}`, method: 'binary' }
  }

  line(info, 'Extracting…')
  try {
    sh(`rm -rf ${tmpDir}`)
    mkdirSync(tmpDir, { recursive: true })
    execSync(`tar xzf ${tmpTgz} -C ${tmpDir}`, { timeout: 60_000 })
  } catch (err) {
    return { ok: false, error: `extraction failed: ${err.message}`, method: 'binary' }
  }

  const binCandidates = [join(tmpDir, 'bin/ollama'), join(tmpDir, 'ollama')]
  const binPath = binCandidates.find((p) => existsSync(p))
  if (!binPath) return { ok: false, error: 'ollama binary not found in the archive', method: 'binary' }

  const installDir = process.getuid?.() === 0 ? INSTALL_DIR_LINUX : join(homedir(), '.local/bin')
  const target = join(installDir, 'ollama')

  try {
    mkdirSync(installDir, { recursive: true })
    copyFileSync(binPath, target)
    chmodSync(target, 0o755)
    line(tick, `Installed to ${target}`)
  } catch {
    try {
      execSync(`sudo mkdir -p ${INSTALL_DIR_LINUX}`, { timeout: 10_000 })
      execSync(`sudo cp ${binPath} ${INSTALL_DIR_LINUX}/ollama`, { timeout: 10_000 })
      execSync(`sudo chmod 755 ${INSTALL_DIR_LINUX}/ollama`, { timeout: 10_000 })
      line(tick, `Installed to ${INSTALL_DIR_LINUX}/ollama (via sudo)`)
    } catch (err2) {
      return { ok: false, error: `cannot install binary: ${err2.message}`, method: 'binary' }
    }
  }

  try { unlinkSync(tmpTgz) } catch { /* ok */ }
  try { sh(`rm -rf ${tmpDir}`) } catch { /* ok */ }

  return { ok: true, method: 'binary' }
}

async function installOllama() {
  line(info, `Platform: ${plat} · Arch: ${cpu} · GPU hint: ${detectGpu()}`)

  const scriptResult = await installViaScript()
  if (scriptResult.ok) return scriptResult

  line(warn, `Install script failed (${scriptResult.error}). Trying direct binary download…`)

  const binaryResult = await installViaBinary()
  return binaryResult
}

/* ──────────────────────── start & verify ─────────────────────────────── */

async function startOllamaDaemon() {
  const running = await isOllamaRunning()
  if (running) {
    line(tick, `Ollama is already running at ${OLLAMA_DEFAULT_URL}`)
    return { ok: true, alreadyRunning: true }
  }

  line(info, 'Starting Ollama…')

  if (plat === 'linux') {
    const systemd = sh('systemctl is-active ollama 2>/dev/null')
    if (systemd === 'active') {
      line(tick, 'Ollama is already running as a systemd service.')
      return { ok: true, alreadyRunning: true }
    }

    const started = sh('sudo systemctl start ollama 2>&1')
    if (started !== null) {
      for (let i = 0; i < 15; i++) {
        await sleep(1000)
        if (await isOllamaRunning()) {
          line(tick, 'Ollama started via systemd.')
          return { ok: true, method: 'systemd' }
        }
      }
    }
  }

  const env = {
    ...process.env,
    OLLAMA_HOST: OLLAMA_DEFAULT_URL.replace(/^https?:\/\//, ''),
    ...(existsSync(OLLAMA_MODELS_DIR) ? { OLLAMA_MODELS: OLLAMA_MODELS_DIR } : {}),
  }

  const child = spawn('ollama', ['serve'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  child.stdout?.on('data', (d) => {
    for (const l of d.toString().split('\n')) {
      if (l.trim()) line(info, `[ollama] ${l.trim()}`)
    }
  })
  child.stderr?.on('data', (d) => {
    for (const l of d.toString().split('\n')) {
      if (l.trim()) line(info, `[ollama] ${l.trim()}`)
    }
  })
  child.unref()

  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    if (await isOllamaRunning()) {
      line(tick, `Ollama started at ${OLLAMA_DEFAULT_URL}`)
      return { ok: true, method: 'direct', pid: child.pid }
    }
  }

  return { ok: false, error: 'Ollama did not respond within 20 seconds' }
}

/* ────────────────────── model pull (user-driven) ─────────────────────── */

async function pullModel(model) {
  line(info, `Pulling ${model}…`)

  const res = await fetch(`${OLLAMA_DEFAULT_URL}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
    signal: AbortSignal.timeout(60 * 60 * 1000),
  })

  if (!res.ok) {
    line(fail, `Pull failed: HTTP ${res.status}`)
    return false
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastStatus = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const l of lines) {
      if (!l.trim()) continue
      try {
        const evt = JSON.parse(l)
        if (evt.error) {
          line(fail, `Pull error: ${evt.error}`)
          return false
        }
        const status = evt.status ?? ''
        const pct = evt.total ? ` ${Math.round((evt.completed / evt.total) * 100)}%` : ''
        const msg = `${status}${pct}`
        if (msg !== lastStatus) {
          lastStatus = msg
          process.stdout.write(`\r  ↓  ${msg.padEnd(60)}`)
        }
      } catch { /* partial line */ }
    }
  }
  console.log('') // newline after progress
  line(tick, `${model} pulled successfully.`)
  return true
}

async function promptModelChoice() {
  console.log('')
  console.log('  Choose a model to pull')
  console.log('  ═══════════════════════')

  // Get the RAM plan
  const { tiers, plan: p, ok } = await getModelTiers()
  const freeRam = availableRam()

  if (!ok || !tiers.length) {
    // Fallback: show the known abliterated catalogue directly
    line(warn, 'Could not load the RAM plan. Showing the default model catalogue.')
    console.log('')
    return promptFromCatalogue()
  }

  // Show machine info
  const totalRamGb = (totalmem() / GB).toFixed(1)
  const freeRamGb = (freeRam / GB).toFixed(1)
  const budgetGb = p ? (p.effectiveModelBytes / GB).toFixed(1) : '?'
  line(info, `RAM: ${totalRamGb} GB total · ${freeRamGb} GB free · ${budgetGb} GB AI ceiling`)
  line(info, `Plan: ${p ? `${(p.budget.share * 100).toFixed(0)}% of free RAM` : 'default'}`)
  if (p?.budget.capGb) line(info, `Hard cap: ${p.budget.capGb} GB`)
  console.log('')

  // Build the table — unique models sorted by size, largest first
  const uniqueModels = new Map()
  for (const t of tiers) {
    if (t.model && !uniqueModels.has(t.model)) {
      uniqueModels.set(t.model, t)
    }
  }

  const sorted = [...uniqueModels.values()].sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))

  if (!sorted.length) {
    line(warn, 'No models found in the plan. Showing the default catalogue.')
    console.log('')
    return promptFromCatalogue()
  }

  // Show numbered list
  console.log('  #   Model                                          Size       Fits')
  console.log('  ─── ────────────────────────────────────────────── ────────── ────')

  const recIdx = sorted.findIndex((m) => m.fits)
  sorted.forEach((m, i) => {
    const num = String(i + 1).padStart(3)
    const name = (m.model ?? '').padEnd(48)
    const size = m.bytes ? `${(m.bytes / GB).toFixed(1)} GB`.padStart(10) : '       ?  '
    const fits = m.fits ? ' ✓' : ' ✗ (too large)'
    const rec = i === recIdx ? '  ← recommended' : ''
    console.log(`  ${num} ${name} ${size}${fits}${rec}`)
  })

  console.log('')
  const rec = recIdx >= 0 ? recIdx + 1 : 1
  const answer = await ask(`  Enter number (1–${sorted.length}) [${rec} = recommended]: `)

  let chosen = rec // default to recommended
  if (answer) {
    const num = Number(answer)
    if (Number.isInteger(num) && num >= 1 && num <= sorted.length) {
      chosen = num
    } else {
      line(warn, `Invalid choice "${answer}". Using recommended (${rec}).`)
    }
  }

  const selected = sorted[chosen - 1]
  console.log('')
  line(info, `Selected: ${selected.model}`)
  line(info, `Size:     ${selected.bytes ? `${(selected.bytes / GB).toFixed(1)} GB` : 'unknown'}`)
  line(info, `Fits:     ${selected.fits ? 'yes' : 'no — may fail on this machine'}`)

  const confirm = await ask(`\n  Pull ${selected.model}? [Y/n] `)
  if (confirm && confirm.toLowerCase() !== 'y' && confirm !== '') {
    line(info, 'Cancelled. No model pulled.')
    return null
  }

  return selected.model
}

/** Fallback catalogue when the autopilot plan cannot be loaded. */
async function promptFromCatalogue() {
  const catalogue = [
    { model: 'huihui_ai/qwen3.5-abliterated:9b-q8_0', size: '11.0 GB', params: '9.65B Q8_0', note: 'best quality, needs ~12 GB RAM' },
    { model: 'huihui_ai/qwen3.5-abliterated:9b',       size: ' 6.6 GB', params: '9.65B Q4_K_M', note: 'good quality, needs ~8 GB RAM' },
    { model: 'huihui_ai/qwen3.5-abliterated:4B-q8_0',  size: ' 5.2 GB', params: '4.54B Q8_0', note: 'needs ~6 GB RAM' },
    { model: 'huihui_ai/qwen3.5-abliterated:4b',       size: ' 3.3 GB', params: '4.54B Q4_K_M', note: 'balanced, needs ~4 GB RAM' },
    { model: 'huihui_ai/qwen3.5-abliterated:2B-q8_0',  size: ' 2.7 GB', params: '2.27B Q8_0', note: 'lightweight, needs ~3 GB RAM' },
    { model: 'huihui_ai/qwen3.5-abliterated:2b',       size: ' 1.9 GB', params: '2.27B Q4_K_M', note: 'small, needs ~2.5 GB RAM' },
    { model: 'huihui_ai/qwen3.5-abliterated:0.8b',     size: ' 1.0 GB', params: '0.87B Q8_0', note: 'tiny, fits almost anywhere' },
  ]

  const freeRamGb = (availableRam() / GB).toFixed(1)
  line(info, `Free RAM: ${freeRamGb} GB`)
  console.log('')

  console.log('  #   Model                                          Size       Note')
  console.log('  ─── ────────────────────────────────────────────── ────────── ────────────────────')

  // Pick recommended based on free RAM
  let rec = catalogue.length // default: smallest
  const freeGb = availableRam() / GB
  for (let i = 0; i < catalogue.length; i++) {
    const sizeGb = parseFloat(catalogue[i].size)
    if (sizeGb <= freeGb * 0.85) { rec = i; break }
  }

  catalogue.forEach((m, i) => {
    const num = String(i + 1).padStart(3)
    const name = m.model.padEnd(48)
    const size = m.size.padStart(10)
    const note = m.note
    const marker = i === rec ? '  ← recommended' : ''
    console.log(`  ${num} ${name} ${size} ${note}${marker}`)
  })

  console.log('')
  const answer = await ask(`  Enter number (1–${catalogue.length}) [${rec + 1} = recommended]: `)

  let chosen = rec
  if (answer) {
    const num = Number(answer)
    if (Number.isInteger(num) && num >= 1 && num <= catalogue.length) {
      chosen = num - 1
    } else {
      line(warn, `Invalid choice "${answer}". Using recommended (${rec + 1}).`)
    }
  }

  const selected = catalogue[chosen]
  console.log('')
  line(info, `Selected: ${selected.model} (${selected.params}, ${selected.size})`)

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