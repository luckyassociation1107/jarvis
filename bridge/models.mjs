/**
 * The model manager.
 *
 * Three model slots and none of them work until the models are on disk. Ollama
 * will happily report "model not found" on the first request, which surfaces to
 * the user as JARVIS silently failing to think — the worst possible failure mode,
 * because it looks like a bug in the assistant rather than a missing download.
 *
 * So this asks Ollama what it has, compares that against what the slots want,
 * and reports the gap. `ensure()` can also pull, but only when told to: a 7 GB
 * download should never start as a side effect of booting.
 *
 * All of it is read-only by default and every failure is soft. If Ollama is not
 * running, `status()` reports that rather than throwing, because "Ollama is not
 * running" is the single most useful thing this file can tell anyone.
 */

import { PIPELINE } from './local-llm.mjs'

const OLLAMA_HOST = process.env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434'

/** Rough download sizes, for the "this will take a while" warning. */
const APPROX_BYTES = {
  '0.5b': 398 * 1024 * 1024,
  '3b': 1.9 * 1024 * 1024 * 1024,
  '7b': 4.7 * 1024 * 1024 * 1024,
}

/**
 * What one slot looks like right now.
 * @typedef {Object} SlotStatus
 * @property {string} slot
 * @property {string} model        the configured model name
 * @property {'ready'|'missing'|'unknown'} state
 * @property {number|null} size    bytes on disk, if Ollama reported it
 * @property {string|null} note    human-readable detail
 */

/** Is Ollama reachable at all? */
export async function ollamaUp() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Every model Ollama has, as `{name, size}`. */
export async function installed() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size ?? null,
    }))
  } catch {
    return []
  }
}

/**
 * Compare the configured slots against what is installed.
 *
 * Matching is on the model *name* before the tag, because `qwen2.5:7b` and
 * `qwen2.5:latest` are the same weights and a user who pulled `:latest` should
 * not be told they are missing a model.
 */
export async function status() {
  const up = await ollamaUp()
  if (!up) {
    return {
      ollama: false,
      slots: Object.keys(PIPELINE).map((slot) => ({
        slot,
        model: PIPELINE[slot].model,
        state: 'unknown',
        size: null,
        note: 'Ollama is not running',
      })),
      ready: 0,
      total: Object.keys(PIPELINE).length,
    }
  }

  const have = await installed()
  const slots = Object.entries(PIPELINE).map(([slot, cfg]) => {
    const wanted = cfg.model
    const base = wanted.split(':')[0]
    const match = have.find((m) => m.name === wanted || m.name.split(':')[0] === base)
    if (match) {
      return {
        slot,
        model: wanted,
        state: 'ready',
        size: match.size,
        note: match.name === wanted ? null : `matched as ${match.name}`,
      }
    }
    return {
      slot,
      model: wanted,
      state: 'missing',
      size: null,
      note: `not pulled — roughly ${approxSize(wanted)}`,
    }
  })

  return {
    ollama: true,
    slots,
    ready: slots.filter((s) => s.state === 'ready').length,
    total: slots.length,
  }
}

/**
 * Pull a model, reporting progress.
 *
 * Streams Ollama's newline-delimited progress rather than waiting for the whole
 * download, because a 7 GB pull with no feedback is indistinguishable from a
 * hang. `onProgress` gets `{status, completed, total}`.
 */
export async function pull(model, onProgress = () => {}) {
  const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
    signal: AbortSignal.timeout(60 * 60 * 1000),
  })
  if (!res.ok) {
    throw new Error(`pull failed for ${model}: HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const evt = JSON.parse(line)
        onProgress({
          status: evt.status ?? '',
          completed: evt.completed ?? null,
          total: evt.total ?? null,
        })
      } catch {
        // A partial line is normal mid-stream; ignore it.
      }
    }
  }
}

/**
 * Make sure a slot's model is present, pulling it if `auto` is set.
 *
 * Returns what happened rather than throwing, so a caller can show one line
 * instead of wrapping this in a try/catch that does the same thing.
 */
export async function ensure(slot, { auto = false, onProgress } = {}) {
  const cfg = PIPELINE[slot]
  if (!cfg) return { slot, ok: false, note: `no such slot: ${slot}` }

  const current = await status()
  const entry = current.slots.find((s) => s.slot === slot)

  if (entry?.state === 'ready') {
    return { slot, ok: true, pulled: false, note: entry.note }
  }
  if (!current.ollama) {
    return { slot, ok: false, pulled: false, note: 'Ollama is not running' }
  }
  if (!auto) {
    return {
      slot,
      ok: false,
      pulled: false,
      note: `missing — run: ollama pull ${cfg.model}`,
    }
  }

  await pull(cfg.model, onProgress ?? (() => {}))
  return { slot, ok: true, pulled: true, note: 'pulled' }
}

/** One line for the boot banner. */
export async function summary() {
  const s = await status()
  if (!s.ollama) return 'models: Ollama is not running'
  const missing = s.slots.filter((x) => x.state !== 'ready')
  if (missing.length === 0) return `models: ${s.ready}/${s.total} ready`
  return `models: ${s.ready}/${s.total} ready — missing ${missing.map((m) => m.slot).join(', ')}`
}

function approxSize(model) {
  const lower = model.toLowerCase()
  for (const [key, bytes] of Object.entries(APPROX_BYTES)) {
    if (lower.includes(key)) return formatBytes(bytes)
  }
  return 'a few GB'
}

function formatBytes(b) {
  const gb = b / (1024 * 1024 * 1024)
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(b / 1048576)} MB`
}
