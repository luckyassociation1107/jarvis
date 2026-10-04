#!/usr/bin/env node
/**
 * Auto-install Ollama via CLI — no browser needed.
 *
 * Supports Linux (x86_64, arm64) and macOS (arm64, x86_64).
 * Downloads the official binary, installs it to the right location,
 * starts the server, and verifies it is reachable.
 *
 * Usage:
 *   node scripts/install-ollama.mjs          # install + start + verify
 *   node scripts/install-ollama.mjs --check   # check only, do not install
 *   node scripts/install-ollama.mjs --start   # start if installed, install if not
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
import { homedir, platform, arch, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import process from 'node:process'

/* ────────────────────────────── constants ────────────────────────────── */

const GB = 1024 ** 3
const OLLAMA_DEFAULT_URL = process.env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434'
const INSTALL_DIR_LINUX = '/usr/local/bin'
const INSTALL_DIR_MACOS = '/usr/local/bin'
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

const plat = platform()
const cpu = arch()

/* ──────────────────────────── detection ──────────────────────────────── */

function isOllamaInstalled() {
  // Check PATH first
  const pathBin = sh('which ollama')
  if (pathBin && existsSync(pathBin)) return { installed: true, path: pathBin }

  // Check common install locations
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
  if (plat === 'darwin') return 'metal' // Apple Silicon / Intel Mac — Metal is built-in

  // NVIDIA
  if (sh('nvidia-smi')) return 'nvidia'

  // AMD ROCm
  if (sh('rocm-smi') || existsSync('/dev/kfd')) return 'rocm'

  return 'cpu'
}

/* ────────────────────────── download URL ─────────────────────────────── */

function installScriptUrl() {
  return 'https://ollama.com/install.sh'
}

function binaryTarballUrl() {
  // Direct binary download as fallback when the install script is unreachable
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

/**
 * Method 1: The official install script (preferred).
 * Works on Linux and macOS, handles everything: binary, systemd/launchd, etc.
 */
async function installViaScript() {
  line(info, 'Downloading the official Ollama install script…')

  // Download the script first so we can inspect it
  let script
  try {
    const res = await fetch(installScriptUrl(), { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    script = await res.text()
  } catch (err) {
    line(warn, `Could not download the install script: ${err.message}`)
    return { ok: false, error: err.message, method: 'script' }
  }

  // Write to temp file and execute
  const tmpScript = '/tmp/jarvis-ollama-install.sh'
  writeFileSync(tmpScript, script, { mode: 0o755 })

  line(info, 'Running the installer (may ask for your password)…')

  return new Promise((resolve) => {
    const child = spawn('sh', [tmpScript], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d) => {
      const text = d.toString()
      stdout += text
      // Print progress lines
      for (const l of text.split('\n')) {
        if (l.trim()) line(info, l.trim())
      }
    })
    child.stderr.on('data', (d) => {
      const text = d.toString()
      stderr += text
      for (const l of text.split('\n')) {
        if (l.trim()) line(info, l.trim())
      }
    })

    child.once('close', (code) => {
      try { unlinkSync(tmpScript) } catch { /* ok */ }
      if (code === 0) {
        resolve({ ok: true, method: 'script' })
      } else {
        resolve({ ok: false, error: `installer exited with code ${code}: ${stderr.slice(0, 200)}`, method: 'script' })
      }
    })

    child.once('error', (err) => {
      try { unlinkSync(tmpScript) } catch { /* ok */ }
      resolve({ ok: false, error: err.message, method: 'script' })
    })
  })
}

/**
 * Method 2: Direct binary download (fallback).
 * Downloads the tarball, extracts ollama binary to /usr/local/bin.
 */
async function installViaBinary() {
  const url = binaryTarballUrl()
  if (!url) return { ok: false, error: `no binary available for ${plat}/${cpu}`, method: 'binary' }

  line(info, `Downloading Ollama binary from ${url}…`)

  const tmpTgz = '/tmp/ollama-install.tgz'
  const tmpDir = '/tmp/ollama-extract'

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    // Stream to file with progress
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

  // Extract
  line(info, 'Extracting…')
  try {
    sh(`rm -rf ${tmpDir}`)
    mkdirSync(tmpDir, { recursive: true })
    execSync(`tar xzf ${tmpTgz} -C ${tmpDir}`, { timeout: 60_000 })
  } catch (err) {
    return { ok: false, error: `extraction failed: ${err.message}`, method: 'binary' }
  }

  // Find the binary in extracted contents
  const binCandidates = [
    join(tmpDir, 'bin/ollama'),
    join(tmpDir, 'ollama'),
  ]
  const binPath = binCandidates.find((p) => existsSync(p))
  if (!binPath) {
    return { ok: false, error: 'ollama binary not found in the archive', method: 'binary' }
  }

  // Install to /usr/local/bin (or ~/.local/bin if no sudo)
  const installDir = process.getuid?.() === 0 ? INSTALL_DIR_LINUX : join(homedir(), '.local/bin')
  const target = join(installDir, 'ollama')

  try {
    mkdirSync(installDir, { recursive: true })
    copyFileSync(binPath, target)
    chmodSync(target, 0o755)
    line(tick, `Installed to ${target}`)
  } catch (err) {
    // Try with sudo
    try {
      execSync(`sudo mkdir -p ${INSTALL_DIR_LINUX}`, { timeout: 10_000 })
      execSync(`sudo cp ${binPath} ${INSTALL_DIR_LINUX}/ollama`, { timeout: 10_000 })
      execSync(`sudo chmod 755 ${INSTALL_DIR_LINUX}/ollama`, { timeout: 10_000 })
      line(tick, `Installed to ${INSTALL_DIR_LINUX}/ollama (via sudo)`)
    } catch (err2) {
      return { ok: false, error: `cannot install binary: ${err2.message}`, method: 'binary' }
    }
  }

  // Cleanup
  try { unlinkSync(tmpTgz) } catch { /* ok */ }
  try { sh(`rm -rf ${tmpDir}`) } catch { /* ok */ }

  return { ok: true, method: 'binary' }
}

/**
 * Install Ollama — tries the official script first, falls back to direct binary.
 */
async function installOllama() {
  line(info, `Platform: ${plat} · Arch: ${cpu} · GPU hint: ${detectGpu()}`)

  // Method 1: official install script
  const scriptResult = await installViaScript()
  if (scriptResult.ok) return scriptResult

  line(warn, `Install script failed (${scriptResult.error}). Trying direct binary download…`)

  // Method 2: direct binary
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

  // Try systemd first (Linux)
  if (plat === 'linux') {
    const systemd = sh('systemctl is-active ollama 2>/dev/null')
    if (systemd === 'active') {
      line(tick, 'Ollama is already running as a systemd service.')
      return { ok: true, alreadyRunning: true }
    }

    // Try starting via systemd
    const started = sh('sudo systemctl start ollama 2>&1')
    if (started !== null) {
      // Wait for it to come up
      for (let i = 0; i < 15; i++) {
        await sleep(1000)
        if (await isOllamaRunning()) {
          line(tick, 'Ollama started via systemd.')
          return { ok: true, method: 'systemd' }
        }
      }
    }
  }

  // Fallback: start directly
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

  // Wait for it to answer
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    if (await isOllamaRunning()) {
      line(tick, `Ollama started at ${OLLAMA_DEFAULT_URL}`)
      return { ok: true, method: 'direct', pid: child.pid }
    }
  }

  return { ok: false, error: 'Ollama did not respond within 20 seconds' }
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
  const quiet = args.includes('--quiet')

  if (!quiet) {
    console.log('')
    console.log('  J.A.R.V.I.S — Ollama installer')
    console.log('  ═══════════════════════════════')
  }

  // Not supported on Windows (that uses the portable-runtime.mjs zip flow)
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

  // ── already good ──
  if (installed && running) {
    if (!quiet) {
      line(tick, `Ollama is already installed (${binPath}) and running at ${OLLAMA_DEFAULT_URL}`)
      await printStatus()
    }
    process.exit(0)
  }

  // ── installed but not running ──
  if (installed && !running) {
    line(info, `Ollama is installed (${binPath}) but not running.`)
    if (startOnly || !checkOnly) {
      const result = await startOllamaDaemon()
      if (result.ok) {
        await printStatus()
        process.exit(0)
      } else {
        line(fail, `Could not start Ollama: ${result.error}`)
        process.exit(1)
      }
    }
    process.exit(1)
  }

  // ── not installed ──
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

  if (startResult.ok) {
    console.log('')
    line(tick, 'Ollama is ready!')
    await printStatus()
    console.log('  Next steps:')
    console.log('    npm run setup          # pick and download a model stack')
    console.log('    npm start              # launch JARVIS')
    console.log('')
    process.exit(0)
  } else {
    console.log('')
    line(warn, `Ollama installed but could not auto-start: ${startResult.error}`)
    line(info, 'Start it manually:  ollama serve')
    line(info, 'Then run:           npm run setup')
    process.exit(1)
  }
}

main().catch((err) => {
  line(fail, err.message)
  process.exit(1)
})