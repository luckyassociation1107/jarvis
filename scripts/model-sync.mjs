#!/usr/bin/env node
/**
 * Sync the latest abliterated models from Ollama's registry.
 *
 * Searches for "abliterated" and "dolphin" models, filters to only
 * abliterated ones, and merges with the built-in catalogue.
 *
 * Falls back to the built-in catalogue if the registry is unreachable.
 *
 * Usage:
 *   import { syncModels, builtinCatalogue } from './model-sync.mjs'
 *   const models = await syncModels()
 */

import process from 'node:process'

const GB = 1024 ** 3
const MB = 1024 ** 2
const REGISTRY_TIMEOUT = 15_000

/* ──────────────────── built-in catalogue ─────────────────── */

/**
 * The known-good abliterated models.
 *
 * These are always available even offline. The sync merges any new
 * models found in the Ollama registry on top of this list.
 */
export function builtinCatalogue() {
  return [
    // ── Qwen3.5 abliterated multimodal ──
    { model: 'huihui_ai/qwen3.5-abliterated:122B',           quant: 'Q4_K_M', params: 125.0, sizeGb: 81.0,  residentGb: 96.0,  quality: 5, multimodal: true,  family: 'qwen3.5', note: '125B Q4_K_M, workstation-class' },
    { model: 'huihui_ai/qwen3.5-abliterated:35b-a3b-fp16',  quant: 'F16',     params: 36.0,  sizeGb: 72.0,  residentGb: 80.0,  quality: 5, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:35b-a3b-q8_0',  quant: 'Q8_0',    params: 36.0,  sizeGb: 39.0,  residentGb: 46.0,  quality: 5, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:27b-q8_0',      quant: 'Q8_0',    params: 27.8,  sizeGb: 30.0,  residentGb: 35.0,  quality: 5, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:35b',            quant: 'Q4_K_M',  params: 36.0,  sizeGb: 24.0,  residentGb: 28.0,  quality: 5, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:27b',            quant: 'Q4_K_M',  params: 27.8,  sizeGb: 17.0,  residentGb: 20.0,  quality: 5, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:9b-q8_0',       quant: 'Q8_0',    params: 9.65,  sizeGb: 11.0,  residentGb: 12.3,  quality: 5, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:9b',             quant: 'Q4_K_M',  params: 9.65,  sizeGb: 6.6,   residentGb: 7.8,   quality: 4, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:4B-q8_0',       quant: 'Q8_0',    params: 4.54,  sizeGb: 5.2,   residentGb: 6.1,   quality: 4, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:4b',             quant: 'Q4_K_M',  params: 4.54,  sizeGb: 3.3,   residentGb: 4.1,   quality: 3, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:2B-q8_0',       quant: 'Q8_0',    params: 2.27,  sizeGb: 2.7,   residentGb: 3.15,  quality: 3, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:2b',             quant: 'Q4_K_M',  params: 2.27,  sizeGb: 1.9,   residentGb: 2.35,  quality: 2, multimodal: true,  family: 'qwen3.5' },
    { model: 'huihui_ai/qwen3.5-abliterated:0.8b',           quant: 'Q8_0',    params: 0.873, sizeGb: 1.0,   residentGb: 1.3,   quality: 1, multimodal: true,  family: 'qwen3.5' },
    // ── GGUF import (text/coding only) ──
    { model: 'hf.co/mradermacher/Huihui-Qwen3.5-27B-abliterated-GGUF:Q2_K', quant: 'Q2_K', params: 27.8, sizeGb: 10.9, residentGb: 12.4, quality: 3, multimodal: false, family: 'qwen3.5', note: '27.8B Q2_K GGUF import, text/coding only' },
  ]
}

/* ──────────────────── registry search ────────────────────── */

/**
 * Search Ollama's registry for abliterated models.
 *
 * Uses the public search endpoint. Returns an array of model entries
 * with name, description, and pull count.
 */
async function searchRegistry(query, { timeout = REGISTRY_TIMEOUT } = {}) {
  try {
    const res = await fetch(`https://ollama.com/api/search?q=${encodeURIComponent(query)}`, {
      headers: { 'accept': 'application/json', 'user-agent': 'jarvis-model-sync' },
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.models ?? data.results ?? []
  } catch {
    return []
  }
}

/**
 * Get model details (tags/sizes) from Ollama's registry.
 */
async function getModelDetails(name, { timeout = REGISTRY_TIMEOUT } = {}) {
  try {
    // Ollama uses namespace/name format
    const res = await fetch(`https://ollama.com/api/models/${encodeURIComponent(name)}`, {
      headers: { 'accept': 'application/json', 'user-agent': 'jarvis-model-sync' },
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/* ──────────────────── quantization parser ────────────────── */

/**
 * Extract quantization from a model tag name.
 * e.g. "huihui_ai/qwen3.5-abliterated:9b-q8_0" → "Q8_0"
 */
function parseQuant(tag) {
  const lower = String(tag ?? '').toLowerCase()
  if (lower.includes('fp16') || lower.includes('-fp16')) return 'F16'
  if (lower.includes('q8_0') || lower.includes(':q8')) return 'Q8_0'
  if (lower.includes('q6_k')) return 'Q6_K'
  if (lower.includes('q5_k_m')) return 'Q5_K_M'
  if (lower.includes('q4_k_m') || (!lower.includes('q') && !lower.includes('fp'))) return 'Q4_K_M'
  if (lower.includes('q3_k_m')) return 'Q3_K_M'
  if (lower.includes('q2_k') || lower.includes(':q2')) return 'Q2_K'
  if (lower.includes('q4_0')) return 'Q4_0'
  return 'Q4_K_M' // default assumption
}

/**
 * Extract parameter count from a model tag name.
 * e.g. "huihui_ai/qwen3.5-abliterated:9b" → 9.65
 * Returns null if unknown.
 */
function parseParams(tag) {
  const match = String(tag ?? '').match(/[:\s](\d+\.?\d*)\s*[bB]/)
  if (!match) return null
  return Number(match[1])
}

/**
 * Estimate download size from parameter count and quantization.
 * Very rough — for display when the registry doesn't report it.
 */
function estimateSize(paramsB, quant) {
  if (!paramsB) return 0
  const bytesPerParam = {
    'F16': 2.0,
    'Q8_0': 1.0,
    'Q6_K': 0.82,
    'Q5_K_M': 0.72,
    'Q4_K_M': 0.56,
    'Q3_K_M': 0.44,
    'Q2_K': 0.34,
  }
  return +(paramsB * (bytesPerParam[quant] ?? 0.56)).toFixed(1)
}

/* ──────────────────── sync & merge ───────────────────────── */

/**
 * Sync models from the Ollama registry and merge with built-in.
 *
 * Searches for: abliterated, dolphin (abliterated variants)
 * Filters to: only abliterated models (hard requirement)
 * Returns: merged, deduplicated, sorted catalogue
 */
export async function syncModels({ onProgress = () => {} } = {}) {
  const builtin = builtinCatalogue()
  const seen = new Set(builtin.map((m) => m.model))

  onProgress('Searching Ollama registry for latest abliterated models…')

  // Search for abliterated models
  const searches = ['abliterated', 'qwen3.5-abliterated', 'dolphin-abliterated']
  const registryResults = []

  for (const query of searches) {
    onProgress(`  searching: "${query}"…`)
    const results = await searchRegistry(query)
    for (const r of results) {
      const name = r.name ?? r.model ?? ''
      // Hard filter: only abliterated
      if (!/abliterat/i.test(name)) continue
      // Skip if already in built-in
      if (seen.has(name)) continue
      seen.add(name)
      registryResults.push(r)
    }
  }

  onProgress(`  found ${registryResults.length} new model(s) from registry`)

  // Convert registry results to our catalogue format
  const synced = []
  for (const r of registryResults) {
    const name = r.name ?? r.model ?? ''
    const desc = r.description ?? r.details ?? ''
    const pulls = r.pull_count ?? r.downloads ?? 0

    // Try to get tag details for size info
    let sizeGb = 0
    let quant = parseQuant(name)
    let params = parseParams(name)

    const details = await getModelDetails(name).catch(() => null)
    if (details?.tags) {
      // Pick the largest tag as representative
      for (const tag of details.tags) {
        if (tag.size) sizeGb = Math.max(sizeGb, +(tag.size / GB).toFixed(1))
      }
    }

    if (!sizeGb && params) {
      sizeGb = estimateSize(params, quant)
    }

    // Detect if multimodal from name/description
    const multimodal = /vision|vl|multimodal/i.test(`${name} ${desc}`)

    synced.push({
      model: name,
      quant,
      params: params ?? 0,
      sizeGb,
      residentGb: +(sizeGb * 1.2).toFixed(1), // rough estimate
      quality: pulls > 10000 ? 4 : pulls > 1000 ? 3 : 2,
      multimodal,
      family: name.includes('qwen') ? 'qwen' : name.includes('llama') ? 'llama' : 'other',
      note: `from registry · ${pulls ? `${(pulls/1000).toFixed(0)}k pulls` : 'new'}`,
      synced: true,
    })
  }

  // Merge: builtin first (trusted), then synced
  const merged = [...builtin, ...synced]

  onProgress(`  catalogue: ${merged.length} models (${builtin.length} built-in + ${synced.length} synced)`)

  return merged
}

/**
 * Recommend models for each role in the workflow.
 *
 * The JARVIS workflow has three roles:
 *   - Planner (chat): multilingual, intent, plan creation → needs best quality
 *   - Executor (reason): coding, tool use, execution → needs instruction following
 *   - Observer (vision): image understanding → needs multimodal
 *
 * One model can fill multiple roles (the shared Qwen3.5 abliterated tags do).
 * This function recommends which model(s) to pull based on available RAM.
 */
export function recommendRoles(catalogue, hw) {
  const { ram, primaryGpu } = hw
  const budget = ram.aiBudgetGb

  // Filter to abliterated, sort by quality then size
  const abliterated = catalogue
    .filter((m) => /abliterat/i.test(m.model ?? ''))
    .sort((a, b) => (b.quality - a.quality) || (b.params - a.params))

  // Find the best model that fits
  const fitsBudget = abliterated.filter((m) => m.residentGb <= budget)
  const bestFit = fitsBudget[0] ?? abliterated[abliterated.length - 1] ?? null

  // For multimodal (observer), prefer vision-capable models
  const visionCapable = abliterated.filter((m) => m.multimodal)
  const bestVision = visionCapable.filter((m) => m.residentGb <= budget)[0]
    ?? visionCapable[visionCapable.length - 1] ?? null

  return {
    planner: {
      role: 'Planner (Chat)',
      purpose: 'Multilingual understanding, intent extraction, plan creation',
      recommended: bestFit,
      note: bestFit ? `${bestFit.model} — handles all languages, creates execution plans` : 'no model fits',
    },
    executor: {
      role: 'Executor (Reason)',
      purpose: 'Code execution, tool use, task completion',
      recommended: bestFit, // Usually the same model
      note: bestFit ? `${bestFit.model} — executes plans, writes code, calls tools` : 'no model fits',
    },
    observer: {
      role: 'Observer (Vision)',
      purpose: 'Image understanding, screenshot reading, visual feedback',
      recommended: bestVision,
      note: bestVision
        ? `${bestVision.model} — reads screenshots, camera photos, UI elements`
        : 'no multimodal model fits — vision disabled',
    },
    shared: bestFit === bestVision,
  }
}

export default { builtinCatalogue, syncModels }