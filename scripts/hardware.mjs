#!/usr/bin/env node
/**
 * Hardware detection for JARVIS model picker.
 *
 * Detects CPU, RAM, GPU (NVIDIA/AMD/Apple Metal/CPU-only), and disk free space.
 * Returns a structured profile the model picker uses to filter the catalogue.
 *
 * Usage:
 *   import { detect } from './hardware.mjs'
 *   const hw = detect()
 *   console.log(hw)
 */

import { execSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { freemem, totalmem, cpus, arch, platform } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const GB = 1024 ** 3
const MB = 1024 ** 2

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/* ────────────────────────── CPU ─────────────────────────── */

function detectCpu() {
  const cores = cpus().length
  const archName = arch()
  const model = cpus()[0]?.model ?? 'unknown'

  return {
    arch: archName,
    cores,
    model,
    // Rough throughput estimate: more cores → can handle larger context
    tier: cores >= 16 ? 'high' : cores >= 8 ? 'mid' : 'low',
  }
}

/* ────────────────────────── RAM ─────────────────────────── */

function detectRam() {
  // Try /proc/meminfo first (more accurate on Linux, especially containers)
  let available = freemem()
  try {
    const meminfo = require('node:fs').readFileSync('/proc/meminfo', 'utf8')
    const match = meminfo.match(/^MemAvailable:\s+(\d+)\s*kB/m)
    if (match) available = Number(match[1]) * 1024
  } catch { /* macOS: freemem() is correct */ }

  const total = totalmem()
  return {
    totalGb: +(total / GB).toFixed(1),
    freeGb: +(available / GB).toFixed(1),
    usedGb: +((total - available) / GB).toFixed(1),
    // How much RAM the AI can realistically use (80% of free, conservative)
    aiBudgetGb: +((available * 0.80) / GB).toFixed(1),
  }
}

/* ────────────────────────── GPU ─────────────────────────── */

function detectNvidiaGpu() {
  const out = sh('nvidia-smi --query-gpu=memory.total,memory.free,name,driver_version --format=csv,noheader,nounits')
  if (!out) return null

  const lines = out.split('\n').filter(Boolean)
  const gpus = []
  for (const line of lines) {
    const [totalMb, freeMb, name, driver] = line.split(',').map((s) => s.trim())
    const total = Number(totalMb)
    const free = Number(freeMb)
    if (total > 0) {
      gpus.push({
        vendor: 'nvidia',
        name: name || 'NVIDIA GPU',
        driver: driver || '',
        vramGb: +(total / 1024).toFixed(1),
        vramFreeGb: +(free / 1024).toFixed(1),
        // Usable VRAM: 75% of total (leave room for CUDA overhead)
        usableGb: +((total * 0.75) / 1024).toFixed(1),
        backend: 'cuda',
      })
    }
  }
  return gpus.length ? gpus : null
}

function detectAmdGpu() {
  // ROCm
  const out = sh('rocm-smi --showmeminfo vram --csv 2>/dev/null')
  if (out) {
    const match = out.match(/(\d{3,})/)
    if (match) {
      const vramMb = Number(match[1]) / 1024
      return [{
        vendor: 'amd',
        name: 'AMD ROCm GPU',
        vramGb: +(vramMb / 1024).toFixed(1),
        vramFreeGb: +(vramMb / 1024 * 0.8).toFixed(1),
        usableGb: +((vramMb * 0.75) / 1024).toFixed(1),
        backend: 'rocm',
      }]
    }
  }

  // Check for AMD GPU device
  if (existsSync('/dev/kfd')) {
    return [{
      vendor: 'amd',
      name: 'AMD GPU (detected via /dev/kfd)',
      vramGb: 0,
      vramFreeGb: 0,
      usableGb: 0,
      backend: 'rocm',
      note: 'VRAM detection requires rocm-smi',
    }]
  }

  return null
}

function detectAppleGpu() {
  if (platform() !== 'darwin') return null

  // Apple Silicon uses unified memory — GPU shares system RAM
  const totalGb = totalmem() / GB
  const chip = sh('sysctl -n machdep.cpu.brand_string') ?? 'Apple Silicon'

  // Apple Silicon: GPU can use up to ~60% of unified memory for inference
  const isAppleSilicon = /apple|m[123]/i.test(chip) || arch() === 'arm64'
  if (!isAppleSilicon) return null

  return [{
    vendor: 'apple',
    name: chip,
    vramGb: +totalGb.toFixed(1), // unified memory
    vramFreeGb: +(freemem() / GB).toFixed(1),
    usableGb: +((totalGb * 0.60)).toFixed(1),
    backend: 'metal',
    unified: true,
  }]
}

function detectGpu() {
  return detectNvidiaGpu()
    ?? detectAmdGpu()
    ?? detectAppleGpu()
    ?? []
}

/* ────────────────────────── Disk ─────────────────────────── */

function detectDisk(dir = 'models') {
  const target = resolve(dir)
  try {
    const stat = statSync(target)
    if (!stat.isDirectory()) throw new Error()
  } catch {
    // models/ doesn't exist yet, check parent
  }

  // Use df to get free space
  const out = sh(`df -BG "${resolve('.')}" 2>/dev/null`)
  if (out) {
    const lines = out.split('\n')
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/)
      // df -BG outputs in 1G blocks
      const availGb = parseInt(parts[3]) || 0
      return { freeGb: availGb, path: resolve('.') }
    }
  }

  // macOS fallback
  const out2 = sh(`df -g "${resolve('.')}" 2>/dev/null`)
  if (out2) {
    const lines = out2.split('\n')
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/)
      const availGb = parseInt(parts[3]) || 0
      return { freeGb: availGb, path: resolve('.') }
    }
  }

  return { freeGb: 0, path: resolve('.') }
}

/* ──────────────────────── full profile ───────────────────── */

/**
 * Detect everything about this machine.
 *
 * Returns a profile object the model picker uses to filter the catalogue:
 *   - gpu: array of GPUs (empty = CPU only)
 *   - gpuMode: 'nvidia' | 'amd' | 'metal' | 'cpu'
 *   - preferredQuant: based on GPU capability
 *   - ram: total, free, AI budget
 *   - disk: free space
 *   - cpu: cores, arch
 */
export function detect() {
  const cpu = detectCpu()
  const ram = detectRam()
  const gpus = detectGpu()
  const disk = detectDisk()

  const primaryGpu = gpus[0] ?? null
  const gpuMode = primaryGpu?.backend ?? 'cpu'

  // Quantization recommendation based on GPU
  // GPU → Q8_0 (fast inference, quality matters)
  // CPU only → Q4_K_M (smaller, still great quality)
  // Low RAM CPU → Q2_K (smallest, fastest)
  let preferredQuant = 'Q4_K_M' // default: balanced
  if (primaryGpu) {
    preferredQuant = 'Q8_0' // GPU can handle larger quants fast
  }
  if (!primaryGpu && ram.freeGb < 4) {
    preferredQuant = 'Q4_K_M' // tight RAM, stay compact
  }
  if (!primaryGpu && ram.freeGb < 2) {
    preferredQuant = 'Q2_K' // very tight, smallest possible
  }

  return {
    platform: platform(),
    cpu,
    ram,
    gpu: gpus,
    gpuMode,
    primaryGpu,
    preferredQuant,
    disk,
    // Summary for display
    summary: buildSummary(cpu, ram, gpus, disk, preferredQuant),
  }
}

function buildSummary(cpu, ram, gpus, disk, preferredQuant) {
  const lines = []
  lines.push(`Platform:  ${platform()} / ${cpu.arch}`)
  lines.push(`CPU:       ${cpu.cores} cores · ${cpu.tier} tier`)
  lines.push(`RAM:       ${ram.totalGb} GB total · ${ram.freeGb} GB free · ${ram.aiBudgetGb} GB AI budget`)

  if (gpus.length) {
    for (const g of gpus) {
      const unified = g.unified ? ' (unified memory)' : ''
      lines.push(`GPU:       ${g.name} · ${g.vramGb} GB VRAM${unified} · ${g.backend.toUpperCase()}`)
    }
  } else {
    lines.push('GPU:       none (CPU-only inference)')
  }

  lines.push(`Disk:      ${disk.freeGb} GB free`)
  lines.push(`Preferred: ${preferredQuant} quantization`)

  return lines
}

/* ──────────────── model filtering helpers ────────────────── */

/**
 * Filter the model catalogue based on detected hardware.
 *
 * Rules:
 *   1. Only abliterated models (hard filter, never show non-abliterated)
 *   2. Download size must fit in disk free space
 *   3. Resident estimate must fit in AI RAM budget (with headroom)
 *   4. GPU-aware: prefer higher quants when GPU is available
 *   5. CPU-only: prefer Q4_K_M and below
 */
export function filterCatalogue(catalogue, hw) {
  const { ram, disk, primaryGpu, preferredQuant } = hw

  return catalogue
    .filter((m) => {
      // Hard filter: only abliterated
      if (!/abliterat/i.test(m.model ?? '')) return false

      // Filter: download must fit on disk
      if (m.sizeGb > disk.freeGb * 0.9) return false

      return true
    })
    .map((m) => {
      // Calculate fit scores
      const ramFit = m.residentGb <= ram.aiBudgetGb
      const diskFit = m.sizeGb <= disk.freeGb * 0.9
      const quantMatch = m.quant === preferredQuant

      // Score: higher = better fit for this machine
      let score = 0
      if (ramFit) score += 10
      if (diskFit) score += 5
      if (quantMatch) score += 3
      if (primaryGpu && m.quant === 'Q8_0') score += 2 // GPU prefers high quality
      if (!primaryGpu && m.quant === 'Q4_K_M') score += 2 // CPU prefers compact
      score += (m.quality ?? 0) // quality bonus

      return { ...m, ramFit, diskFit, quantMatch, score }
    })
    .sort((a, b) => b.score - a.score)
}

export default { detect, filterCatalogue }