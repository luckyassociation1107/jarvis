/**
 * The model manager.
 *
 * RAM-planned model slots only work once their selected weights are on disk. Ollama
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

/**
 * What one slot looks like right now.
 * @typedef {Object} SlotStatus
 * @property {string} slot
 * @property {string} model        the configured model name
 * @property {'ready'|'missing'|'unknown'|'unsupported'} state
 * @property {number|null} size    bytes on disk, if Ollama reported it
 * @property {boolean|null} fits   RAM planner fit flag, null when manually overridden
 * @property {number|null} residentBytes estimated resident memory
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
 * Matching is exact for explicit tags and quantizations. A tagless model name
 * may match Ollama's implicit `:latest`, but a different quantization is never
 * treated as equivalent because its RAM fit can be different.
 */
export async function status() {
  const up = await ollamaUp()
  if (!up) {
    return {
      ollama: false,
      slots: Object.keys(PIPELINE).map((slot) => ({
        slot,
        model: PIPELINE[slot].model,
        state: PIPELINE[slot].model ? 'unknown' : 'unsupported',
        size: null,
        fits: PIPELINE[slot].fits,
        residentBytes: PIPELINE[slot].residentBytes,
        note: PIPELINE[slot].model ? 'Ollama is not running' : 'not selected within the current RAM plan',
      })),
      ready: 0,
      total: Object.values(PIPELINE).filter((entry) => entry.model).length,
    }
  }

  const have = await installed()
  const slots = Object.entries(PIPELINE).map(([slot, cfg]) => {
    const wanted = cfg.model
    if (!wanted) {
      return {
        slot,
        model: null,
        state: 'unsupported',
        size: null,
        fits: false,
        residentBytes: null,
        note: 'not selected within the current RAM plan',
      }
    }
    const tagless = !wanted.includes(':')
    const match = have.find((m) => m.name === wanted || (tagless && m.name === `${wanted}:latest`))
    if (match) {
      return {
        slot,
        model: wanted,
        state: 'ready',
        size: match.size,
        fits: cfg.fits,
        residentBytes: cfg.residentBytes,
        note: match.name === wanted ? null : `matched as ${match.name}`,
      }
    }
    return {
      slot,
      model: wanted,
      state: 'missing',
      size: null,
      fits: cfg.fits,
      residentBytes: cfg.residentBytes,
      note: `not pulled — roughly ${approxSize(wanted)}`,
    }
  })

  return {
    ollama: true,
    slots,
    ready: slots.filter((s) => s.state === 'ready').length,
    total: slots.filter((s) => s.state !== 'unsupported').length,
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
  if (!cfg.model) return { slot, ok: false, note: `${slot} is unavailable within the current RAM plan` }

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
  const missing = s.slots.filter((x) => x.state !== 'ready' && x.state !== 'unsupported')
  const unavailable = s.slots.filter((x) => x.state === 'unsupported')
  const ready = `models: ${s.ready}/${s.total} selected ready`
  if (missing.length === 0) {
    return unavailable.length ? `${ready} — unavailable by RAM plan: ${unavailable.map((slot) => slot.slot).join(', ')}` : ready
  }
  return `${ready} — missing ${missing.map((m) => m.slot).join(', ')}${unavailable.length ? `; unavailable by RAM plan: ${unavailable.map((slot) => slot.slot).join(', ')}` : ''}`
}

function approxSize(model) {
  const lower = String(model ?? '').toLowerCase()
  if (lower.includes('qwen2.5-vl-abliterated:7b')) return 'about 6.0 GB'
  if (lower.includes('qwen2.5-vl-abliterated:3b')) return 'about 3.2 GB'
  if (lower.includes('q2_k')) return 'about 3.0 GB'
  if (lower.includes('q3_k_m')) return 'about 3.8 GB'
  if (lower.includes('qwen2.5-coder') && lower.includes(':1.5b')) return 'about 1.1 GB'
  if (lower.includes(':0.5b')) return 'about 398 MB'
  if (lower.includes(':1.5b')) return 'about 986 MB'
  if (lower.includes(':3b')) return 'about 1.9 GB'
  if (lower.includes(':7b')) return 'about 4.7 GB'
  if (lower.includes(':14b')) return 'about 9.0 GB'
  return 'check model catalogue'
}
