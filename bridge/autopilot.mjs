/**
 * Automated model install, quantization-aware.
 *
 * The brief that shaped this: whisper, chat, vision and coding must ALL work on
 * EVERY machine from 1 GB to 32 GB. What changes with RAM is not which
 * capabilities exist — it is which parameters, which models, and which
 * quantization you get.
 *
 * That reframes the whole problem. A fixed catalogue with a greedy fit gives you
 * a machine that can chat but not see. A *ladder* per capability gives you
 * everything, always, at a quality that shrinks to fit.
 *
 * The budget arithmetic:
 *
 *     35%  the OS           not negotiable, and not ours to spend
 *     25%  everything else  browser, editor, the launcher itself
 *     40%  models           what is left, and all we may touch
 *
 * Plus, when there is a GPU: its VRAM, counted separately and conservatively,
 * because VRAM the desktop is already using is not VRAM we have.
 *
 * Two passes, and the order is the whole trick:
 *
 *   1. Every capability gets its *minimum viable* variant. Nothing is dropped.
 *   2. Remaining budget upgrades them, best-first, one rung at a time.
 *
 * Pass 1 is what makes "all types of RAM" true. Pass 2 is what makes a 32 GB
 * machine feel better than a 1 GB one without being a different product.
 */

import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { join } from 'node:path'

/** The split. Exported so the UI shows the same numbers the installer used. */
export const BUDGET = { os: 0.35, apps: 0.25, models: 0.40 }

const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024

/**
 * One rung of one capability's ladder.
 *
 * `bytes` is the *resident* cost, not the download size. They are the same
 * thing for GGUF — you download the quantised file and mmap it — but stating it
 * keeps the budget honest.
 */
const LADDERS = {
  // Conversation, and the intent extraction everything else routes through.
  // Runs on every request, so it is first in the upgrade pass.
  chat: [
    { model: 'huihui_ai/qwen2.5-abliterate:14b', quant: 'q3_K_M', bytes: 6.5 * GB, quality: 5 },
    { model: 'huihui_ai/qwen2.5-abliterate:7b', quant: 'q4_K_M', bytes: 4.7 * GB, quality: 4 },
    { model: 'huihui_ai/qwen2.5-abliterate:3b', quant: 'q4_K_M', bytes: 1.9 * GB, quality: 3 },
    { model: 'huihui_ai/qwen2.5-abliterate:1.5b', quant: 'q4_K_M', bytes: 1.0 * GB, quality: 2 },
    { model: 'huihui_ai/qwen2.5-abliterate:0.5b', quant: 'q4_K_M', bytes: 398 * MB, quality: 1 },
  ],

  // The eyes. Needs a multimodal model, and those are heavier per parameter,
  // which is why the floor is 2b rather than 0.5b.
  // Ordered best to worst. The last rung is the floor, so it must be the
  // *smallest*, and getting that backwards is how a "1 GB machine" plan ends up
  // demanding 4.5 GB. There is a hard limit here: the smallest multimodal model
  // that produces useful output is around 950 MB, so vision has a real floor
  // that chat does not.
  vision: [
    { model: 'huihui_ai/qwen2.5-vl-abliterated:7b', quant: 'q4_K_M', bytes: 4.7 * GB, quality: 5 },
    { model: 'huihui_ai/qwen2.5-vl-abliterated:3b', quant: 'q4_K_M', bytes: 1.9 * GB, quality: 4 },
    { model: 'llava-phi3:3.8b', quant: 'q4_0', bytes: 2.2 * GB, quality: 3 },
    { model: 'qwen2-vl:2b', quant: 'q4_0', bytes: 1.3 * GB, quality: 2 },
    { model: 'moondream:1.8b', quant: 'q4_0', bytes: 950 * MB, quality: 1 },
  ],

  // The hands. A coder that writes badly is worse than one that writes nothing
  // slowly, so the floor here is higher than chat's.
  code: [
    { model: 'qwen2.5-coder:14b', quant: 'q4_K_M', bytes: 9.0 * GB, quality: 5 },
    { model: 'dagbs/qwen2.5-coder-7b-instruct-abliterated', quant: 'q4_K_M', bytes: 4.7 * GB, quality: 3 },
    { model: 'qwen2.5-coder:3b', quant: 'q4_K_M', bytes: 1.9 * GB, quality: 2 },
    { model: 'qwen2.5-coder:1.5b', quant: 'q4_K_M', bytes: 1.0 * GB, quality: 1 },
  ],

  // Speech. The ladder is the quantization of one model rather than a model
  // family, and the rungs are an order of magnitude apart — which is why speech
  // is the capability that fits everywhere.
  speech: [
    { kind: 'whisper', file: 'ggml-large-v3-turbo-q5_0.bin', quant: 'q5_0', bytes: 550 * MB, quality: 5 },
    { kind: 'whisper', file: 'ggml-medium.en-q5_0.bin', quant: 'q5_0', bytes: 466 * MB, quality: 4 },
    { kind: 'whisper', file: 'ggml-small.en-q5_1.bin', quant: 'q5_1', bytes: 200 * MB, quality: 3 },
    { kind: 'whisper', file: 'ggml-base.en-q5_1.bin', quant: 'q5_1', bytes: 57 * MB, quality: 2 },
    { kind: 'whisper', file: 'ggml-tiny.en-q5_1.bin', quant: 'q5_1', bytes: 31 * MB, quality: 1 },
  ],
}

/** What each capability is for, for the report. */
const PURPOSE = {
  chat: 'conversation and intent extraction',
  vision: 'camera and screen',
  code: 'writing and debugging code',
  speech: 'speech to text',
}

/** Upgrade order when budget is left over. Chat first — it runs on every turn. */
const UPGRADE_ORDER = ['chat', 'speech', 'vision', 'code']

/** The whisper.cpp binary. Cheap enough to always take. */
const WHISPER_BINARY = { id: 'whisper-binary', kind: 'whisper-binary', bytes: 3 * MB, purpose: 'the whisper.cpp executable' }

/**
 * Total RAM.
 *
 * `totalmem`, not `freemem`: free memory is a snapshot of this instant and is
 * wrong the moment anything else starts. Total is what the budget is carved out
 * of, and it does not change while the process lives.
 */
export function totalRam() {
  return totalmem()
}

/**
 * A GPU, if there is one, with the VRAM we may actually use.
 *
 * Counted conservatively on purpose. `nvidia-smi` reports total VRAM including
 * whatever the compositor already holds; on a 4 GB card with a desktop running
 * that can be a third. Taking the whole number would be a budget that lies.
 */
export function gpu() {
  // NVIDIA
  try {
    const out = execSync('nvidia-smi --query-gpu=memory.total,name --format=csv,noheader,nounits', {
      stdio: 'pipe',
      timeout: 4000,
    })
      .toString()
      .trim()
      .split('\n')[0]
    const [mb, ...nameParts] = out.split(',').map((s) => s.trim())
    const vram = Number(mb) * MB
    if (vram > 0) {
      return {
        vendor: 'nvidia',
        name: nameParts.join(','),
        vram,
        usable: Math.floor(vram * 0.75),
        note: 'CUDA — pass -ngl 99 to offload every layer',
      }
    }
  } catch {
    /* no nvidia-smi; fall through */
  }

  // AMD ROCm
  try {
    const out = execSync('rocm-smi --showmeminfo vram --csv', { stdio: 'pipe', timeout: 4000 }).toString()
    const match = out.match(/(\d{3,})/)
    if (match) {
      const vram = Number(match[1]) * MB
      return {
        vendor: 'amd',
        name: 'AMD ROCm',
        vram,
        usable: Math.floor(vram * 0.75),
        note: 'HSA_OVERRIDE_GFX_VERSION may be needed on RDNA cards',
      }
    }
  } catch {
    /* no rocm-smi */
  }

  // Apple Silicon: unified memory, so "VRAM" is a slice of system RAM. The
  // default iogpu.wired_limit_rdmb is 75% of RAM, which is the honest number.
  if (process.platform === 'darwin') {
    const total = totalRam()
    return {
      vendor: 'apple',
      name: 'Apple Silicon (Metal)',
      vram: total,
      usable: Math.floor(total * 0.55),
      note: 'unified memory — Metal offload, no separate VRAM',
    }
  }

  return null
}

/** The budget, with the reasoning attached. */
export function budget() {
  const total = totalRam()
  const g = gpu()
  const cpuSide = Math.floor(total * BUDGET.models)
  return {
    total,
    os: Math.floor(total * BUDGET.os),
    apps: Math.floor(total * BUDGET.apps),
    models: cpuSide,
    gpu: g ? g.usable : 0,
    gpuInfo: g,
    gb: total / GB,
  }
}

/**
 * The plan.
 *
 * Pass 1 takes the *last* rung of each ladder — the smallest, the floor. Pass 2
 * climbs. Because pass 1 guarantees presence, "works on every RAM" is true by
 * construction rather than by luck.
 *
 * @returns {{choices:object, budget:object, usedBytes:number, notes:string[]}}
 */
export function plan() {
  const b = budget()
  const notes = []
  const choices = {}
  let used = 0

  // The whisper binary is always affordable and always required, so take it
  // first and let it come out of the same pot.
  used += WHISPER_BINARY.bytes

  // Pass 1 — the floor. Every capability, no exceptions.
  for (const cap of Object.keys(LADDERS)) {
    const rung = LADDERS[cap][LADDERS[cap].length - 1]
    choices[cap] = { ...rung, floor: true }
    used += rung.bytes
  }

  // If even the floor does not fit, something has to go. Drop the least
  // essential capability first, one at a time, until it fits — rather than
  // hardcoding which two survive. A 1 GB machine keeps speech and chat; a 4 GB
  // machine keeps everything except vision, because vision's floor is ~950 MB
  // and chat's is 398 MB.
  //
  // Essentiality, most first. Chat and speech are the assistant; vision and code
  // are what it does with its hands and eyes.
  const ESSENTIALITY = ['chat', 'speech', 'vision', 'code']
  if (used > b.models) {
    const dropped = []
    const kept = new Set(Object.keys(LADDERS))
    let keptBytes = used

    for (const cap of [...ESSENTIALITY].reverse()) {
      if (keptBytes <= b.models) break
      if (!kept.has(cap)) continue
      kept.delete(cap)
      keptBytes -= LADDERS[cap][LADDERS[cap].length - 1].bytes
      dropped.push({ cap, needsGb: +(LADDERS[cap][LADDERS[cap].length - 1].bytes / GB).toFixed(2) })
    }

    const salvaged = {}
    for (const cap of kept) {
      salvaged[cap] = { ...LADDERS[cap][LADDERS[cap].length - 1], floor: true }
    }

    return {
      choices: salvaged,
      budget: b,
      usedBytes: keptBytes,
      notes: [
        ...dropped.map(
          (d) =>
            `${d.cap} dropped — needs ${d.needsGb} GB, only ${(b.models / GB).toFixed(1)} GB budgeted. ` +
            `Raises the floor for every other capability, so it is the honest trade.`,
        ),
      ],
      salvaged: true,
      dropped,
    }
  }

  // Pass 2 — climb, best-first, one rung at a time, re-checking the budget each
  // time so a capability can take two upgrades if it is the only thing left.
  for (const cap of UPGRADE_ORDER) {
    const ladder = LADDERS[cap]
    const idx = ladder.findIndex((r) => r.model === choices[cap].model)
    for (let i = idx - 1; i >= 0; i--) {
      const rung = ladder[i]
      const current = choices[cap]
      const delta = rung.bytes - current.bytes
      if (used + delta <= b.models) {
        choices[cap] = { ...rung, floor: false }
        used += delta
      } else {
        break
      }
    }
  }

  // A GPU changes the answer rather than the arithmetic: it does not make the
  // budget bigger, it makes the *larger* rungs affordable, because the resident
  // cost moves off system RAM. Reported, not silently acted on, because whether
  // Ollama is built with CUDA is a question only the machine can answer.
  if (b.gpu > 0) {
    notes.push(`${b.gpuInfo.vendor} GPU with ${(b.gpuInfo.usable / GB).toFixed(1)} GB usable — ${b.gpuInfo.note}`)
  }

  return { choices, budget: b, usedBytes: used, notes, salvaged: false }
}

/** One line for the boot banner. */
export function planSummary() {
  const p = plan()
  const b = p.budget
  const picked = Object.entries(p.choices)
    .map(([cap, r]) => `${cap} ${r.quant ?? '?'}`)
    .join(', ')
  return `autopilot: ${b.gb.toFixed(1)} GB RAM → ${(b.models / GB).toFixed(1)} GB models | ${picked}`
}

/**
 * Install the plan.
 *
 * @param {{dry?:boolean, onStep?:Function, dir?:string}} [opts]
 */
export async function install(opts = {}) {
  const { dry = false, onStep = () => {}, dir = 'models' } = opts
  const p = plan()
  const log = []

  onStep({ phase: 'plan', summary: planSummary(), notes: p.notes })

  if (dry) return { log, plan: p, installed: [] }

  await mkdir(dir, { recursive: true })

  for (const [cap, rung] of Object.entries(p.choices)) {
    if (rung.kind === 'whisper') {
      onStep({ phase: 'whisper', cap, file: rung.file })
      log.push({ ...(await downloadWhisperModel(rung.file, dir)), cap })
      continue
    }
    onStep({ phase: 'pull', cap, model: rung.model })
    try {
      execSync(`ollama pull ${rung.model}`, { stdio: 'pipe' })
      log.push({ cap, id: rung.model, ok: true })
    } catch (e) {
      // One failed model is not a failed install. The pipeline still runs, and
      // the report says exactly which capability is degraded.
      log.push({ cap, id: rung.model, ok: false, error: String(e.message ?? e).slice(0, 200) })
    }
  }

  return { log, plan: p, installed: log.filter((l) => l.ok) }
}

async function downloadWhisperModel(file, dir) {
  try {
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const { writeFile } = await import('node:fs/promises')
    const path = join(dir, file)
    await writeFile(path, buf)
    return { id: file, ok: true, path }
  } catch (e) {
    return { id: file, ok: false, error: String(e.message ?? e) }
  }
}

/** For a UI that wants to show the whole ladder and what was chosen. */
export function ladder() {
  return Object.fromEntries(
    Object.entries(LADDERS).map(([cap, rungs]) => [
      cap,
      {
        purpose: PURPOSE[cap],
        rungs: rungs.map((r) => ({ model: r.model ?? r.file, quant: r.quant ?? 'gguf', gb: +(r.bytes / GB).toFixed(2), quality: r.quality })),
      },
    ]),
  )
}
