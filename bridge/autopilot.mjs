/**
 * Automated model installation.
 *
 * The brief: read the machine's RAM, work out what is actually available, and
 * install the largest set of models that fits — Ollama slots and whisper.cpp —
 * with no further questions asked. Across 1 GB to 32 GB.
 *
 * The budget arithmetic is the whole design:
 *
 *     35% to the OS           — not negotiable, and not ours to spend
 *     25% to everything else  — browser, editor, the launcher itself
 *     40% to models           — what is left, and all we may touch
 *
 * Those numbers are not arbitrary. A model loaded into VRAM or RAM is resident
 * for as long as it is running, so a 7b model is not a 4.7 GB download, it is
 * 4.7 GB permanently gone from everything else. Spending more than the leftover
 * 40% is how you get a machine that swaps.
 *
 * Selection is greedy by priority, not by size. The 0.5b chat model is 398 MB
 * and is the difference between an assistant and a paperweight; the 14b chat
 * model is 9 GB and is a nicer conversation. Order matters more than fit.
 */

import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { join } from 'node:path'

/** The split. Exported so the UI can show the same numbers. */
export const BUDGET = { os: 0.35, apps: 0.25, models: 0.40 }

const GB = 1024 * 1024 * 1024

/**
 * The catalogue, in priority order.
 *
 * `kind` decides how it is installed: Ollama pulls by name, whisper is a binary
 * plus a model file fetched from HuggingFace. Mixing them in one ordered list is
 * what lets the greedy walk treat them as one budget.
 */
const CATALOG = [
  {
    id: 'chat-0.5b',
    kind: 'ollama',
    model: 'huihui_ai/qwen2.5-abliterate:0.5b',
    slot: 'chat',
    bytes: 398 * 1024 * 1024,
    why: 'intent extraction and conversation — the minimum viable assistant',
  },
  {
    id: 'whisper-base',
    kind: 'whisper',
    file: 'ggml-base.en.bin',
    bytes: 142 * 1024 * 1024,
    why: 'local speech-to-text, English, good enough for commands',
  },
  {
    id: 'whisper-binary',
    kind: 'whisper-binary',
    bytes: 3 * 1024 * 1024,
    why: 'the whisper.cpp executable itself',
  },
  {
    id: 'vision-3b',
    kind: 'ollama',
    model: 'huihui_ai/qwen2.5-vl-abliterated:3b',
    slot: 'vision',
    bytes: 1.9 * GB,
    why: 'the eyes — camera and screen',
  },
  {
    id: 'coder-7b',
    kind: 'ollama',
    model: 'dagbs/qwen2.5-coder-7b-instruct-abliterated',
    slot: 'reason',
    bytes: 4.7 * GB,
    why: 'the hands — writes and debugs code',
  },
  {
    id: 'chat-7b',
    kind: 'ollama',
    model: 'huihui_ai/qwen2.5-abliterate:7b',
    slot: 'chat',
    bytes: 4.7 * GB,
    why: 'a better conversation, if there is room',
  },
  {
    id: 'whisper-small',
    kind: 'whisper',
    file: 'ggml-small.en.bin',
    bytes: 466 * 1024 * 1024,
    why: 'better transcription, if there is room',
  },
]

/**
 * Total RAM, in bytes.
 *
 * `totalmem`, not `freemem`: free memory is a snapshot of this instant and is
 * wrong the moment anything else starts. Total is what the budget is carved out
 * of, and it is the number that does not change while the process lives.
 */
export function totalRam() {
  return totalmem()
}

/**
 * The budget, in bytes, with the reasoning attached.
 *
 * @returns {{total:number, os:number, apps:number, models:number, gb:number}}
 */
export function budget() {
  const total = totalRam()
  return {
    total,
    os: Math.floor(total * BUDGET.os),
    apps: Math.floor(total * BUDGET.apps),
    models: Math.floor(total * BUDGET.models),
    gb: total / GB,
  }
}

/**
 * What should be installed on this machine.
 *
 * Greedy in priority order, skipping anything that does not fit rather than
 * stopping at the first miss — a machine with 6 GB cannot afford the coder but
 * can still afford vision, and stopping early would throw that away.
 *
 * @returns {{fits:Array, skipped:Array, budget:object, usedBytes:number}}
 */
export function plan() {
  const b = budget()
  const fits = []
  const skipped = []
  let used = 0

  for (const item of CATALOG) {
    if (used + item.bytes <= b.models) {
      fits.push(item)
      used += item.bytes
    } else {
      skipped.push({
        ...item,
        shortfall: used + item.bytes - b.models,
      })
    }
  }

  return { fits, skipped, budget: b, usedBytes: used }
}

/** One line for the boot banner. */
export function planSummary() {
  const p = plan()
  const b = p.budget
  return `autopilot: ${b.gb.toFixed(1)} GB RAM → ${(b.models / GB).toFixed(1)} GB for models, ` +
    `${p.fits.length} items, ${(p.usedBytes / GB).toFixed(1)} GB used`
}

/**
 * Install the plan.
 *
 * `dry` reports without downloading. Ollama is used for the model slots because
 * it is already a dependency of the pipeline; whisper.cpp is fetched as a
 * prebuilt binary plus its model file, because building it needs cmake and a
 * compiler and most people do not have those.
 *
 * @param {{dry?:boolean, onStep?:Function, dir?:string}} [opts]
 */
export async function install(opts = {}) {
  const { dry = false, onStep = () => {}, dir = 'models' } = opts
  const p = plan()
  const log = []

  onStep({ phase: 'plan', ...summarise(p) })

  if (dry) return { log, plan: p, installed: [], skipped: p.skipped }

  await mkdir(dir, { recursive: true })

  for (const item of p.fits) {
    if (item.kind === 'ollama') {
      onStep({ phase: 'pull', id: item.id, model: item.model })
      try {
        execSync(`ollama pull ${item.model}`, { stdio: 'pipe' })
        log.push({ id: item.id, ok: true })
      } catch (e) {
        // One failed model is not a failed install. The rest of the pipeline
        // still works, and the report says exactly which one is missing.
        log.push({ id: item.id, ok: false, error: String(e.message ?? e).slice(0, 200) })
      }
      continue
    }

    if (item.kind === 'whisper-binary') {
      onStep({ phase: 'whisper-binary', id: item.id })
      log.push(await installWhisperBinary(dir))
      continue
    }

    if (item.kind === 'whisper') {
      onStep({ phase: 'whisper-model', id: item.id, file: item.file })
      log.push(await downloadWhisperModel(item.file, dir))
    }
  }

  return { log, plan: p, installed: log.filter((l) => l.ok), skipped: p.skipped }
}

function summarise(p) {
  const b = p.budget
  return {
    totalGb: +(b.total / GB).toFixed(1),
    osGb: +(b.os / GB).toFixed(1),
    appsGb: +(b.apps / GB).toFixed(1),
    modelGb: +(b.models / GB).toFixed(1),
    usedGb: +(p.usedBytes / GB).toFixed(1),
    fitting: p.fits.map((f) => f.id),
    skipped: p.skipped.map((s) => ({ id: s.id, shortfallGb: +(s.shortfall / GB).toFixed(1) })),
  }
}

/** Fetch the whisper.cpp binary. */
async function installWhisperBinary(dir) {
  const target = join(dir, 'whisper-cli')
  try {
    // Prebuilt from the project's releases. Windows first, because that is the
    // target the rest of this repo ships for; the others fall through to the
    // "build it yourself" message rather than pretending.
    const url =
      process.platform === 'win32'
        ? 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/whisper-bin-x64.zip'
        : null
    if (!url) {
      return { id: 'whisper-binary', ok: false, error: `no prebuilt binary for ${process.platform} — build whisper.cpp from source` }
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const { writeFile } = await import('node:fs/promises')
    // The zip is written out as-is; unpacking it needs unzip, which Windows
    // does not have on PATH by default. Documented rather than shelled out to.
    await writeFile(`${target}.zip`, buf)
    return { id: 'whisper-binary', ok: true, note: `wrote ${target}.zip — unzip it and set JARVIS_WHISPER_BIN` }
  } catch (e) {
    return { id: 'whisper-binary', ok: false, error: String(e.message ?? e) }
  }
}

/** Fetch a whisper model file. */
async function downloadWhisperModel(file, dir) {
  try {
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const { writeFile } = await import('node:fs/promises')
    const path = join(dir, file)
    await writeFile(path, buf)
    return { id: `whisper-${file}`, ok: true, path }
  } catch (e) {
    return { id: `whisper-${file}`, ok: false, error: String(e.message ?? e) }
  }
}

/** The catalogue, for a UI that wants to show what exists. */
export function catalogue() {
  return CATALOG.map((c) => ({ id: c.id, kind: c.kind, bytes: c.bytes, why: c.why }))
}
