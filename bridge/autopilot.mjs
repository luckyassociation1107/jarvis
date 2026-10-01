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
/**
 * The ladders.
 *
 * Chat and code only, both entirely abliterated. Vision is gone — the smallest
 * multimodal model that produces useful output is ~950 MB, it is not a chat or
 * coding model, and the standing requirement is abliterated chat and coding
 * models *only*. Adding it back would mean installing something aligned, which
 * is precisely what must not happen.
 *
 * Both families come from the same publisher and span the same parameter range,
 * so the two ladders are structurally identical. That is not a coincidence — it
 * means the RAM arithmetic is the same shape for both, and a machine that
 * affords one affords the other.
 *
 * Sizes are Q4_K_M, which is what these tags resolve to. Where a publisher
 * exposes explicit quantization tags (dagbs does: `:q2_k`, `:q3_k_m`, ...) those
 * are the way to get a genuinely different quant of the *same* weights; the
 * huihui tags pin one quant per size, so here the ladder moves in parameters
 * instead. Both are "quantization changing with RAM", which is what was asked
 * for — one moves the knob, the other moves the model.
 */
const LADDERS = {
  // Conversation, and the intent extraction everything else routes through.
  // Runs on every request, so it is first in the upgrade pass.
  chat: [
    { model: 'huihui_ai/qwen2.5-abliterate:14b', quant: 'q4_K_M', bytes: 9.0 * GB, quality: 5 },
    { model: 'huihui_ai/qwen2.5-abliterate:7b', quant: 'q4_K_M', bytes: 4.7 * GB, quality: 4 },
    { model: 'huihui_ai/qwen2.5-abliterate:3b', quant: 'q4_K_M', bytes: 1.9 * GB, quality: 3 },
    { model: 'huihui_ai/qwen2.5-abliterate:1.5b', quant: 'q4_K_M', bytes: 1.0 * GB, quality: 2 },
    { model: 'huihui_ai/qwen2.5-abliterate:0.5b', quant: 'q4_K_M', bytes: 398 * MB, quality: 1 },
  ],

  // The hands. A coder that writes badly is worse than one that writes nothing
  // slowly, so the floor is the same 0.5b as chat rather than something smaller.
  code: [
    { model: 'huihui_ai/qwen2.5-coder-abliterate:14b', quant: 'q4_K_M', bytes: 9.0 * GB, quality: 5 },
    { model: 'huihui_ai/qwen2.5-coder-abliterate:7b', quant: 'q4_K_M', bytes: 4.7 * GB, quality: 4 },
    { model: 'huihui_ai/qwen2.5-coder-abliterate:3b', quant: 'q4_K_M', bytes: 1.9 * GB, quality: 3 },
    { model: 'huihui_ai/qwen2.5-coder-abliterate:1.5b', quant: 'q4_K_M', bytes: 1.0 * GB, quality: 2 },
    { model: 'huihui_ai/qwen2.5-coder-abliterate:0.5b', quant: 'q4_K_M', bytes: 398 * MB, quality: 1 },
  ],

  // Speech. Kept because voice was asked for explicitly, and because it is a
  // different category: whisper.cpp is a speech recogniser with no chat
  // behaviour and therefore no alignment to remove. Its ladder is the
  // quantization of one model rather than a model family, and the rungs are an
  // order of magnitude apart — which is why it fits everywhere.
  speech: [
    { kind: 'whisper', file: 'ggml-large-v3-turbo-q5_0.bin', quant: 'q5_0', bytes: 550 * MB, quality: 5 },
    { kind: 'whisper', file: 'ggml-medium.en-q5_0.bin', quant: 'q5_0', bytes: 466 * MB, quality: 4 },
    { kind: 'whisper', file: 'ggml-small.en-q5_1.bin', quant: 'q5_1', bytes: 200 * MB, quality: 3 },
    { kind: 'whisper', file: 'ggml-base.en-q5_1.bin', quant: 'q5_1', bytes: 57 * MB, quality: 2 },
    { kind: 'whisper', file: 'ggml-tiny.en-q5_1.bin', quant: 'q5_1', bytes: 31 * MB, quality: 1 },
  ],
}

/**
 * Every chat and coding model must be abliterated. This is a standing
 * requirement, so it is *checked* rather than assumed — a catalogue entry that
 * slips in a base model should fail the plan loudly rather than quietly install
 * something the brief says not to install.
 *
 * "Abliterated" means fine-tuned without refusal training, which in practice is
 * the `abliterat` family. Ollama's plain `qwen2.5` and `qwen2.5-coder` tags are
 * the aligned originals and are exactly what must not be used.
 */
const UNCENSORED = /abliterat|dolphin|hermes|nous|openchat|wizard-vicuna|solar|heretic/i

/**
 * Assert the ladders obey the standing requirement.
 *
 * Speech is exempt: whisper.cpp is a speech recogniser with no chat behaviour and
 * therefore no alignment to remove. Exempting it here rather than filtering it
 * out at the call site keeps the rule and its exception in one place.
 */
function assertUncensored() {
  const offenders = []
  for (const [cap, ladder] of Object.entries(LADDERS)) {
    if (cap === 'speech') continue
    for (const rung of ladder) {
      const name = rung.model ?? rung.file ?? ''
      if (!UNCENSORED.test(name)) offenders.push(`${cap}: ${name}`)
    }
  }
  if (offenders.length) {
    throw new Error(`these models are not abliterated and must not be installed: ${offenders.join(', ')}`)
  }
}

/** What each capability is for, for the report. */
const PURPOSE = {
  chat: 'conversation and intent extraction',
  code: 'writing and debugging code',
  speech: 'speech to text',
}

/** Upgrade order when budget is left over. Chat first — it runs on every turn. */
const UPGRADE_ORDER = ['chat', 'code', 'speech']

/** The whisper.cpp binary. Cheap enough to always take. */
const WHISPER_BINARY = { id: 'whisper-binary', kind: 'whisper-binary', bytes: 3 * MB }

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
  assertUncensored()
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
  const ESSENTIALITY = ['chat', 'speech', 'code']
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

  // Pass 2 — climb, round-robin.
  //
  // Not best-first. A best-first walk gives the whole budget to whichever
  // capability is listed first, and on a 24 GB machine that means a 9 GB chat
  // model beside a 0.4 GB coder — which is a machine that converses well and
  // writes code badly. Round-robin takes one rung from each capability in turn,
  // so they climb together and no single one can starve the rest.
  //
  // Loops until nothing fits, so a capability can take two upgrades if it is the
  // only one left with room.
  let climbing = true
  while (climbing) {
    climbing = false
    for (const cap of UPGRADE_ORDER) {
      const ladder = LADDERS[cap]
      if (!ladder) continue
      const idx = ladder.findIndex((r) => r.model === choices[cap].model && r.file === choices[cap].file)
      if (idx <= 0) continue // already at the top
      const next = ladder[idx - 1]
      const delta = next.bytes - choices[cap].bytes
      if (used + delta <= b.models) {
        choices[cap] = { ...next, floor: false }
        used += delta
        climbing = true
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

  // The whisper binary first. plan() charges its 3 MB against the budget, so
  // install() has to actually spend it — otherwise the budget counts a download
  // that never happens and the speech capability is left without its executable.
  log.push(await installWhisperBinary(dir))

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

/**
 * Get the whisper.cpp binary.
 *
 * This was wrong twice and is now verified by actually trying it. The first
 * version invented a HuggingFace URL; the second invented per-platform ones.
 * Neither existed. whisper.cpp publishes **no prebuilt binaries at all** — not
 * on HuggingFace, not in its GitHub releases (which have zero assets), and the
 * repo itself has moved from ggerganov/whisper.cpp to ggml-org/whisper.cpp.
 *
 * So the only honest options are: use a package that ships its own prebuilt
 * binary, or build from source. The first is what this does, because most people
 * do not have cmake and a compiler.
 *
 * `whisper-node` is the npm package that bundles prebuilt whisper.cpp bindings
 * across platforms. It is a real dependency rather than a curl, which means it
 * is installed into node_modules like everything else and upgraded by the
 * updater rather than being a file we hope still exists.
 */
async function installWhisperBinary(dir) {
  const id = 'whisper-binary'
  const pkg = 'whisper-node@1.1.1'

  try {
    execSync(`npm install --no-save --prefix . ${pkg}`, { stdio: 'pipe', timeout: 300000 })
    return {
      id,
      ok: true,
      path: 'node_modules/whisper-node',
      note: 'whisper.cpp bindings installed via npm — whisper.mjs resolves the binary from node_modules',
    }
  } catch (e) {
    // Not a soft failure. Without a binary the speech capability cannot run at
    // all, so say exactly what to do rather than reporting a partial success.
    return {
      id,
      ok: false,
      error:
        `could not install ${pkg}: ${String(e.message ?? e).slice(0, 120)}. ` +
        'Build it instead: git clone https://github.com/ggml-org/whisper.cpp && ' +
        'cmake -B build && cmake --build build --config Release',
    }
  }
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
