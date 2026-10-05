/**
 * RAM-aware local model planner and explicit installer.
 *
 * There is no fixed OS/apps/model split. The planner samples how much RAM is
 * free right now and lets the AI use the share the user asked for — 100% of
 * free memory by default, or any 1–100% the user picks, optionally bounded by
 * a hard gigabyte cap. Whatever is not allocated simply stays free for the
 * rest of the machine. The share can be set with JARVIS_RAM_SHARE /
 * JARVIS_RAM_CAP_GB, from the MODEL STACK panel in the HUD, or by POSTing
 * /autopilot/config; the panel writes the same settings file the bridge reads
 * on the next start.
 *
 * Chat, vision, coding and Whisper are planned with runtime/context headroom
 * against that ceiling. Most allocations share one Qwen3.5 multimodal tag
 * across chat, vision and reason; when the allocation is large enough an
 * official 125B Q4_K_M multimodal tag becomes reachable, and when it is tight
 * a smaller rung is selected instead of pretending the largest one fits.
 * Distinct model downloads count once each. Identical local tags can stay warm
 * between routes; the bridge unloads them before a different local tag or
 * Whisper uses the one-model resident budget.
 *
 * Vision is part of every reference profile. At the smallest allocations it is
 * explicitly best-effort, not installed or invoked; the planner never claims
 * that an over-budget model can safely run.
 */

import { execFile, execFileSync } from 'node:child_process'
import { createWriteStream, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { freemem, totalmem } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

/**
 * Default allocation: the AI may use every byte that is free right now.
 * `share` is a 0–1 fraction of currently free RAM; `capGb` is an optional hard
 * ceiling in gigabytes that wins when it is smaller than the share.
 */
export const ALLOCATION = Object.freeze({ share: 1, capGb: null })

/** Environment names for the same two knobs, plus the saved-settings file. */
export const ALLOCATION_ENV = Object.freeze({
  share: 'JARVIS_RAM_SHARE',
  capGb: 'JARVIS_RAM_CAP_GB',
  config: 'JARVIS_RAM_CONFIG',
})

const DEFAULT_CONFIG_PATH = 'models/ram-allocation.json'

const GB = 1024 ** 3
const MB = 1024 ** 2
const OLLAMA_HOST = (process.env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, '')
const WHISPER_DIR = 'models'
const ACTIVE_WHISPER_FILE = '.whisper-active'

/**
 * The same abliterated Qwen3.5 family backs chat, vision and coding. Most
 * tiers share one multimodal Ollama tag across all three routes. The 32 GB
 * tier uses a larger Q2_K text/coding candidate but keeps vision on a separate
 * native Q8_0 Ollama model so image capability does not depend on GGUF import.
 *
 * Sizes follow the published Ollama catalogue. residentBytes includes
 * conservative runtime/context headroom, not a guarantee. The 32 GB profile
 * uses a larger 27.8B Q2_K text/reason GGUF alongside a native 9.65B Q8_0
 * vision model. The Q2_K Ollama import is not yet exercised by the test suite;
 * image input never depends on it. Native 27B/36B Q8_0, 36B F16, and the
 * official 125B Q4_K_M remain on high-memory rungs only when their resident
 * estimates fit.
 */
/**
 * The three models the person asked for by name — the mandatory tiny set.
 *
 * They sit at the small end of their ladders, which is what makes them the
 * cheapest rows of the catalogue: it lists smallest download first, so this is
 * what the setup window opens on and a first run is 1.08 GB — minutes, not
 * hours. `plan()` walks the other way (largest rung that fits), so on a big
 * machine the planner never reaches these three; they are here because they were
 * asked for by name, not because the planner judged them best.
 *
 * They are *not* abliterated merges, and `assertModelPolicy` would refuse them
 * for that reason alone; each carries `namedByUser`, so the exception is stated
 * in the catalogue and visible in the code, not smuggled in through a regex.
 */
export const NAMED_TINY = Object.freeze({
  chat: {
    model: 'qwen2.5:0.5b',
    quant: 'Q4_K_M',
    parametersB: 0.494,
    bytes: 398e6,
    residentBytes: 0.6 * GB,
    quality: 1,
    multilingual: true,
    namedByUser: true,
    note: 'Qwen2.5 0.5B instruct — 29 languages, tool-capable, 398 MB. A plain instruct build rather than an abliterated merge; named for the mandatory tiny install.',
  },
  coder: {
    model: 'qwen2.5-coder:0.5b',
    quant: 'Q4_K_M',
    parametersB: 0.494,
    bytes: 398e6,
    residentBytes: 0.6 * GB,
    quality: 1,
    namedByUser: true,
    note: 'Qwen2.5-Coder 0.5B instruct — code generation, code reasoning, code repair, 398 MB, tool-capable. Named for the mandatory tiny install.',
  },
  vision: {
    model: 'ahmadwaqar/smolvlm2-256m-video:q8_0',
    quant: 'Q8_0',
    parametersB: 0.256,
    bytes: 279e6,
    residentBytes: 1.2 * GB,
    quality: 1,
    multimodal: true,
    namedByUser: true,
    note: 'SmolVLM2 256M video/image (SigLIP + SmolLM2), Q8_0, 279 MB download · ~1.2 GB with the vision encoder resident. Reads images, screenshots and video frames; named for the mandatory tiny install.',
  },
})

const NATIVE_MULTIMODAL = [
  // Ollama's official 122B tag is a 125B-parameter Q4_K_M multimodal model.
  // Its 81 GB download / 96 GB resident estimate stays out of normal machines;
  // it is only selected when the user's allocation is at least that large.
  { model: 'huihui_ai/qwen3.5-abliterated:122B', quant: 'Q4_K_M', parametersB: 125.0, bytes: 81.0 * GB, residentBytes: 96.0 * GB, quality: 5, multimodal: true, note: 'Official 122B tag (125B parameters), Q4_K_M, text + image; estimated 96 GB resident. Requires workstation-class RAM and remains subject to current-free-memory planning.' },
  { model: 'huihui_ai/qwen3.5-abliterated:35b-a3b-fp16', quant: 'F16', parametersB: 36.0, bytes: 72.0 * GB, residentBytes: 80.0 * GB, quality: 5, multimodal: true },
  { model: 'huihui_ai/qwen3.5-abliterated:35b-a3b-q8_0', quant: 'Q8_0', parametersB: 36.0, bytes: 39.0 * GB, residentBytes: 46.0 * GB, quality: 5, multimodal: true },
  { model: 'huihui_ai/qwen3.5-abliterated:27b-q8_0', quant: 'Q8_0', parametersB: 27.8, bytes: 30.0 * GB, residentBytes: 35.0 * GB, quality: 5, multimodal: true },
  { model: 'huihui_ai/qwen3.5-abliterated:35b', quant: 'Q4_K_M', parametersB: 36.0, bytes: 24.0 * GB, residentBytes: 28.0 * GB, quality: 5, multimodal: true },
  { model: 'huihui_ai/qwen3.5-abliterated:27b', quant: 'Q4_K_M', parametersB: 27.8, bytes: 17.0 * GB, residentBytes: 20.0 * GB, quality: 5, multimodal: true },
  { model: 'huihui_ai/qwen3.5-abliterated:9b-q8_0', quant: 'Q8_0', parametersB: 9.65, bytes: 11.0 * GB, residentBytes: 12.3 * GB, quality: 5, multimodal: true, note: 'Native Ollama multimodal Q8_0 tag; image-input capability is checked against Ollama before pixels are sent.' },
  { model: 'huihui_ai/qwen3.5-abliterated:9b', quant: 'Q4_K_M', parametersB: 9.65, bytes: 6.6 * GB, residentBytes: 7.8 * GB, quality: 4, multimodal: true },
  { model: 'huihui_ai/qwen3.5-abliterated:4B-q8_0', quant: 'Q8_0', parametersB: 4.54, bytes: 5.2 * GB, residentBytes: 6.1 * GB, quality: 4, multimodal: true },
  { model: 'huihui_ai/qwen3.5-abliterated:4b', quant: 'Q4_K_M', parametersB: 4.54, bytes: 3.3 * GB, residentBytes: 4.1 * GB, quality: 3, multimodal: true },
  { model: 'huihui_ai/qwen3.5-abliterated:2B-q8_0', quant: 'Q8_0', parametersB: 2.27, bytes: 2.7 * GB, residentBytes: 3.15 * GB, quality: 3, multimodal: true },
  { model: 'huihui_ai/qwen3.5-abliterated:2b', quant: 'Q4_K_M', parametersB: 2.27, bytes: 1.9 * GB, residentBytes: 2.35 * GB, quality: 2, multimodal: true },
  { model: 'huihui_ai/qwen3.5-abliterated:0.8b', quant: 'Q8_0', parametersB: 0.873, bytes: 1.0 * GB, residentBytes: 1.3 * GB, quality: 1, multimodal: true },
]

const HIGH_PARAMETER_TEXT = [
  ...NATIVE_MULTIMODAL.slice(0, 6),
  {
    model: 'hf.co/mradermacher/Huihui-Qwen3.5-27B-abliterated-GGUF:Q2_K',
    quant: 'Q2_K',
    parametersB: 27.8,
    bytes: 10.9 * GB,
    residentBytes: 12.4 * GB,
    quality: 3,
    multimodal: false,
    note: '27.8B Q2_K text/coding rung; estimate includes the repository’s separate Q8_0 projector. The Ollama HF import is untested here; image requests use the separate native Qwen3.5 vision rung.',
  },
  ...NATIVE_MULTIMODAL.slice(6),
]

/**
 * Every rung this project knows, per pipeline slot, ordered largest first —
 * which is the order `selectRung()` reads: the largest rung whose resident
 * estimate fits the allocation. The mandatory tiny set is last on purpose, one
 * step below the smallest abliterated rung, so the planner only falls to it when
 * nothing bigger can run.
 *
 * Exported because `bridge/catalogue.mjs` shows these rows to the person choosing
 * instead of letting the planner choose for them: one source of truth, so the
 * numbers in the shop window and the numbers in the plan cannot drift apart. The
 * catalogue sorts by download size, so the tiny rows are what it opens on.
 */
export const LADDERS = {
  chat: [...HIGH_PARAMETER_TEXT, NAMED_TINY.chat],
  vision: [...NATIVE_MULTIMODAL, NAMED_TINY.vision],
  reason: [...HIGH_PARAMETER_TEXT, NAMED_TINY.coder],

  speech: [
    { kind: 'whisper', file: 'ggml-large-v3-turbo-q5_0.bin', quant: 'Q5_0', bytes: 550 * MB, residentBytes: 1.35 * GB, quality: 5, multilingual: true },
    { kind: 'whisper', file: 'ggml-medium-q5_0.bin', quant: 'Q5_0', bytes: 539 * MB, residentBytes: 1.25 * GB, quality: 4, multilingual: true },
    { kind: 'whisper', file: 'ggml-small-q5_1.bin', quant: 'Q5_1', bytes: 190 * MB, residentBytes: 700 * MB, quality: 3, multilingual: true },
    { kind: 'whisper', file: 'ggml-base-q5_1.bin', quant: 'Q5_1', bytes: 57 * MB, residentBytes: 340 * MB, quality: 2, multilingual: true },
    { kind: 'whisper', file: 'ggml-tiny-q5_1.bin', quant: 'Q5_1', bytes: 32 * MB, residentBytes: 240 * MB, quality: 1, multilingual: true },
  ],
  tts: [
    { kind: 'tts', engine: 'kokoro', dtype: 'fp32', model: 'onnx-community/Kokoro-82M-v1.0-ONNX (fp32)', quant: 'FP32', bytes: 330 * MB, residentBytes: 1.5 * GB, quality: 3, note: 'browser-local neural voice; resident estimate is conservative and must be validated on the target GPU/browser' },
    { kind: 'tts', engine: 'kokoro', dtype: 'q8', model: 'onnx-community/Kokoro-82M-v1.0-ONNX (q8)', quant: 'Q8', bytes: 86 * MB, residentBytes: 750 * MB, quality: 2, note: 'browser-local neural voice; downloaded and cached by the browser on first use' },
    { kind: 'tts', engine: 'system', dtype: null, model: 'Browser / operating-system SpeechSynthesis', quant: 'SYSTEM', bytes: 0, residentBytes: 0, quality: 1, note: 'no JARVIS model download; available voices and languages depend on the browser and OS' },
  ],
}

const PURPOSE = Object.freeze({
  chat: 'multilingual chat, intent extraction, English translation',
  vision: 'image understanding',
  reason: 'coding, tool use and technical reasoning',
  speech: 'local multilingual speech-to-text',
  tts: 'browser/system text-to-speech',
})
function assertModelPolicy() {
  const problems = []
  for (const cap of ['chat', 'reason', 'vision']) {
    for (const rung of LADDERS[cap]) {
      // Abliterated merges are the rule this project ships. The named tiny
      // models are the exception someone asked for by name, and they say so on
      // the rung itself (`namedByUser`), so the catalogue shows the trade
      // instead of a list nobody can see.
      if (!/abliterat/i.test(rung.model ?? '') && rung.namedByUser !== true) problems.push(`${cap}: ${rung.model}`)
      if (cap === 'vision' && rung.multimodal !== true) problems.push(`vision model is not multimodal: ${rung.model}`)
    }
  }
  if (problems.length) {
    throw new Error(`refusing a non-abliterated or non-multimodal model: ${problems.join(', ')}`)
  }
  for (const rung of LADDERS.speech) {
    if (/\.en\./i.test(rung.file)) throw new Error(`Whisper model must be multilingual: ${rung.file}`)
  }
}

/** System memory, in bytes. */
export function totalRam() {
  return totalmem()
}

/**
 * How much RAM is actually free to hand out, in bytes.
 *
 * On Windows this is `os.freemem()`: the memory the OS reports as available,
 * which is the conservative number. A machine whose monitor shows 12 GB free
 * because ten of it is file cache will not hand all twelve to a model, and
 * planning against the larger figure is how a small machine starts swapping.
 *
 * The `/proc/meminfo` branch exists for the Linux host the test suites run on,
 * where `freemem()` inside a container answers for the host rather than the
 * container and would make every RAM test meaningless.
 */
export function availableRam() {
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf8')
    const match = meminfo.match(/^MemAvailable:\s+(\d+)\s*kB/m)
    if (match) return Number(match[1]) * 1024
  } catch { /* Windows has no /proc: os.freemem() is the answer */ }
  return freemem()
}

/** Where the user's saved allocation lives (relative paths resolve from cwd). */
export function allocationConfigPath() {
  return resolve(process.env[ALLOCATION_ENV.config] ?? DEFAULT_CONFIG_PATH)
}

/** Accepts 0.8, "0.8", "80" or "80%" and returns a 0–1 fraction, else null. */
export function parseShare(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  const percent = text.endsWith('%')
  const numeric = Number(percent ? text.slice(0, -1).trim() : text)
  if (!Number.isFinite(numeric)) return null
  const share = percent || numeric > 1 ? numeric / 100 : numeric
  if (!(share > 0) || share > 1) return null
  return share
}

/** Accepts a positive number of gigabytes; null/'' means "no hard cap". */
export function parseCapGb(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return numeric
}

/** The saved allocation file, read synchronously because plan() is sync. */
export function readAllocationConfig() {
  try {
    const parsed = JSON.parse(readFileSync(allocationConfigPath(), 'utf8'))
    return {
      share: parseShare(parsed?.share),
      capGb: parseCapGb(parsed?.capGb),
    }
  } catch {
    return { share: null, capGb: null }
  }
}

/**
 * Resolve the allocation actually in force.
 *
 * Precedence: explicit options (tests, tierProfiles) → saved user settings →
 * environment variables → defaults (all free RAM, no cap).
 */
export function resolveAllocation(options = {}) {
  const saved = options.config ?? readAllocationConfig()
  const envShare = parseShare(process.env[ALLOCATION_ENV.share])
  const envCap = parseCapGb(process.env[ALLOCATION_ENV.capGb])
  const optionShare = parseShare(options.share)
  const optionCap = options.capGb === undefined ? undefined : parseCapGb(options.capGb)
  const share = optionShare ?? saved.share ?? envShare ?? ALLOCATION.share
  const capGb = optionCap !== undefined ? optionCap : (saved.capGb ?? envCap ?? ALLOCATION.capGb)
  const source = optionShare !== null || optionCap !== undefined
    ? 'override'
    : saved.share !== null || saved.capGb !== null
      ? 'saved'
      : envShare !== null || envCap !== null
        ? 'environment'
        : 'default'
  return { share, capGb, source, configPath: allocationConfigPath() }
}

/**
 * Persist a user-requested allocation and report what changed.
 *
 * `share: null` and `capGb: null` clear the saved value so the environment or
 * the default takes over again. Validation is strict on purpose: a silent
 * fallback would leave the panel showing a number the planner is not using.
 */
export async function saveAllocation(patch = {}) {
  const current = readAllocationConfig()
  const next = { share: current.share, capGb: current.capGb }
  // undefined means "leave this knob alone"; null/'' clears it.
  if (Object.hasOwn(patch, 'share') && patch.share !== undefined) {
    if (patch.share === null || patch.share === '') {
      next.share = null
    } else {
      const share = parseShare(patch.share)
      if (share === null) {
        return { ok: false, error: 'share must be between 1% and 100% of free RAM (for example 75 or "75%").' }
      }
      next.share = share
    }
  }
  if (Object.hasOwn(patch, 'capGb') && patch.capGb !== undefined) {
    if (patch.capGb === null || patch.capGb === '') {
      next.capGb = null
    } else {
      const numeric = Number(patch.capGb)
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return { ok: false, error: 'capGb must be a positive number of gigabytes, or null for no hard cap.' }
      }
      next.capGb = numeric
    }
  }
  const path = allocationConfigPath()
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify({ share: next.share, capGb: next.capGb }, null, 2)}\n`, 'utf8')
  } catch (error) {
    return { ok: false, error: `Could not save the allocation: ${String(error?.message ?? error)}` }
  }
  return { ok: true, path, allocation: { share: next.share, capGb: next.capGb, source: 'saved' } }
}

/** GPU telemetry is advisory only. System RAM remains the hard budget. */
export function gpu() {
  try {
    const stdout = execFileSync('nvidia-smi', ['--query-gpu=memory.total,name', '--format=csv,noheader,nounits'], { timeout: 2500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const [first] = stdout.trim().split(/\r?\n/)
    const [mb, ...name] = first.split(',').map((s) => s.trim())
    const vram = Number(mb) * MB
    if (vram > 0) return { vendor: 'nvidia', name: name.join(','), vram, usable: Math.floor(vram * 0.75), note: 'GPU is advisory; CPU RAM cap is unchanged' }
  } catch { /* no NVIDIA telemetry */ }
  try {
    const stdout = execFileSync('rocm-smi', ['--showmeminfo', 'vram', '--csv'], { timeout: 2500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const match = stdout.match(/(\d{3,})/)
    if (match) {
      const vram = Number(match[1]) * MB
      return { vendor: 'amd', name: 'AMD ROCm', vram, usable: Math.floor(vram * 0.75), note: 'GPU is advisory; CPU RAM cap is unchanged' }
    }
  } catch { /* no ROCm telemetry */ }
  return null
}

/**
 * The exact allocation arithmetic, with an injected total/free/allocation for
 * deterministic tests.
 *
 * `models` is the ceiling for one active model: the user's share of the RAM
 * that is free right now, reduced by an explicit hard cap when one is set.
 * There is no OS/apps split any more — `unallocated` is simply what is left
 * free because the user did not hand it to the AI.
 */
export function budget(total = totalRam(), free = availableRam(), allocation = resolveAllocation()) {
  const share = allocation.share ?? ALLOCATION.share
  const capBytes = allocation.capGb != null ? Math.floor(allocation.capGb * GB) : null
  const byShare = Math.floor(free * share)
  const models = capBytes != null ? Math.min(byShare, capBytes) : byShare
  const sharePercent = Math.round(share * 1000) / 10
  return {
    total,
    free,
    gb: total / GB,
    share,
    sharePercent,
    capBytes,
    capGb: allocation.capGb ?? null,
    models,
    freeForModels: models,
    unallocated: Math.max(0, free - models),
    source: allocation.source ?? 'default',
    configPath: allocation.configPath ?? allocationConfigPath(),
    gpuInfo: null,
  }
}

function smallest(ladder) {
  return ladder[ladder.length - 1]
}

function selectRung(cap, ramBudget, selected, skipped) {
  const ladder = LADDERS[cap]
  const languagePolicy = cap === 'chat' ? { multilingual: true } : cap === 'reason' ? { englishOnly: true } : {}
  const rung = ladder.find((candidate) => candidate.residentBytes <= ramBudget)
  if (rung) {
    selected[cap] = { ...rung, ...languagePolicy, fits: true, mode: 'within-budget' }
    return
  }
  // Keep the nearest multimodal rung visible as best-effort in every LLM role,
  // but never auto-install or invoke it when the reserved memory ceiling says
  // no. This keeps image support in every RAM profile without pretending a
  // sub-1.3 GB VLM can run inside a 0.2–1.2 GB budget.
  if (['chat', 'vision', 'reason'].includes(cap)) {
    const floor = smallest(ladder)
    selected[cap] = { ...floor, ...languagePolicy, fits: false, mode: 'best-effort' }
    skipped.push({ cap, model: floor.model, needsGb: +(floor.residentBytes / GB).toFixed(2), why: `minimum ${cap} model estimates ${(floor.residentBytes / GB).toFixed(2)} GB resident; the AI allocation for this machine is ${(ramBudget / GB).toFixed(2)} GB. Best-effort only.` })
    return
  }
  const floor = smallest(ladder)
  skipped.push({ cap, model: null, needsGb: +(floor.residentBytes / GB).toFixed(2), why: `${cap} is unavailable within this allocation. The smallest supported choice estimates ${(floor.residentBytes / GB).toFixed(2)} GB resident.` })
}

/**
 * Plan each feature against the same sequential-runtime ceiling.
 *
 * `total`/`free`/`share`/`capGb` can be injected for tests. Per-capability
 * resident estimates are compared to the user's allocation of free RAM;
 * downloads are summed separately for disk.
 */
export function plan(options = {}) {
  assertModelPolicy()
  const total = options.total ?? totalRam()
  const free = options.free ?? availableRam()
  const b = budget(total, free, resolveAllocation(options))
  b.gpuInfo = Object.hasOwn(options, 'gpuInfo')
    ? options.gpuInfo
    : (options.total === undefined && options.free === undefined ? gpu() : null)
  // The ceiling is exactly what the user asked the AI to take from free RAM:
  // no percentage is silently held back on top of that choice.
  const ceiling = b.models
  const choices = {}
  const skipped = []
  for (const cap of Object.keys(LADDERS).filter((name) => name !== 'tts')) {
    selectRung(cap, ceiling, choices, skipped)
  }

  // Kokoro is retained in the browser while Ollama runs. Reserve its RAM beside
  // the largest other active local model; if that cannot fit, use zero-model
  // SpeechSynthesis rather than exceeding the user's allocation.
  const primaryPeak = Math.max(0, ...Object.values(choices).filter((rung) => rung.fits).map((rung) => rung.residentBytes))
  const selectedTts = LADDERS.tts.find((candidate) => primaryPeak + candidate.residentBytes <= ceiling)
  choices.tts = { ...(selectedTts ?? LADDERS.tts.at(-1)), fits: true, mode: 'within-budget' }

  const fittingChoices = Object.values(choices).filter((rung) => rung.fits)
  const uniqueAssets = new Map()
  for (const rung of fittingChoices) {
    const key = rung.kind === 'whisper'
      ? `whisper:${rung.file}`
      : rung.kind === 'tts'
        ? `tts:${rung.model}`
        : `ollama:${rung.model}`
    if (!uniqueAssets.has(key)) uniqueAssets.set(key, rung)
  }
  const maxResidentBytes = primaryPeak + choices.tts.residentBytes
  const totalDownloadBytes = [...uniqueAssets.values()].reduce((sum, rung) => sum + rung.bytes, 0)
  const llmModelCount = new Set(['chat', 'vision', 'reason'].map((cap) => choices[cap]?.model).filter(Boolean)).size
  const sharedModelNote = llmModelCount <= 1
    ? 'Chat, vision and coding share one abliterated multimodal model under this allocation; its download is counted once and the fitting model stays warm across those slots.'
    : `Chat/vision/coding use ${llmModelCount} distinct model tags under this allocation; repeated tags are counted once. Vision stays on a native multimodal Ollama rung.`
  const allocationSource = b.source === 'saved'
    ? ' from your saved MODEL STACK setting'
    : b.source === 'environment'
      ? ' from the JARVIS_RAM_* environment'
      : b.source === 'override'
        ? ' (explicitly supplied to the planner)'
        : ' (default)'
  const capNote = b.capGb != null ? `, bounded by your ${b.capGb.toFixed(2)} GB hard cap` : ''
  const notes = [
    `AI allocation${allocationSource}: ${b.sharePercent}% of the ${(b.free / GB).toFixed(2)} GB free when the plan was made = ${(b.models / GB).toFixed(2)} GB${capNote}. There is no fixed OS/apps split; change the share or set a cap in MODEL STACK, or with ${ALLOCATION_ENV.share}/${ALLOCATION_ENV.capGb}.`,
    sharedModelNote,
    `Only ${(ceiling / GB).toFixed(2)} GB is currently planned for one active model at a time; context/runtime estimates vary by backend.`,
    choices.tts.engine === 'system'
      ? 'TTS uses the browser/OS voice under this allocation; voice language availability depends on the installed OS voices.'
      : `TTS selects browser-local Kokoro ${choices.tts.dtype} (${(choices.tts.bytes / MB).toFixed(0)} MB weights). The browser downloads and caches it on first use; resident use is an estimate, not a measured guarantee.`,
  ]
  if (skipped.some((item) => item.cap === 'vision')) {
    const vision = choices.vision
    const totalFloorGb = vision.residentBytes / (b.share * GB)
    notes.push(`Vision is present in every profile as ${vision.model}, but is best-effort here: its smallest multimodal rung estimates ${(vision.residentBytes / GB).toFixed(2)} GB resident and first fits when about ${totalFloorGb.toFixed(1)} GB is free at the current share.`)
  }
  if (skipped.some((item) => item.cap === 'chat' || item.cap === 'reason')) {
    notes.push(`The smallest 0.8B Q8 multimodal model estimates 1.30 GB resident; below the ${(ceiling / GB).toFixed(2)} GB allocation it remains best-effort and is not installed or invoked.`)
  }
  const selectedModelNotes = new Set(['chat', 'vision', 'reason']
    .map((cap) => choices[cap]?.fits ? choices[cap].note : null)
    .filter(Boolean))
  notes.push(...selectedModelNotes)
  if (b.models < b.free) {
    notes.push(`${(b.unallocated / GB).toFixed(2)} GB of the free RAM was left unallocated for other applications on purpose.`)
  }
  const g = b.gpuInfo
  if (g) notes.push(`${g.name}: ${(g.usable / GB).toFixed(1)} GB advisory VRAM; the system-RAM allocation still applies.`)

  return {
    choices,
    budget: b,
    allocation: { share: b.share, sharePercent: b.sharePercent, capGb: b.capGb, source: b.source, configPath: b.configPath },
    ramBudgetBytes: b.models,
    effectiveModelBytes: ceiling,
    maxResidentBytes,
    totalDownloadBytes,
    usedBytes: maxResidentBytes,
    notes,
    skipped,
    dropped: skipped.map((item) => ({ cap: item.cap, needsGb: item.needsGb, why: item.why })),
    salvaged: skipped.length > 0,
  }
}

export function planSummary(input) {
  const p = input ?? plan()
  const llmSlots = ['chat', 'vision', 'reason']
  const shared = llmSlots.map((cap) => p.choices[cap])
  const sharesOneModel = shared.every((rung) => rung?.model && rung.model === shared[0]?.model)
  const describeParameters = (parametersB) => parametersB == null
    ? ''
    : parametersB < 1
      ? `${Math.round(parametersB * 1000)}M `
      : `${Number.isInteger(parametersB) ? parametersB : Number(parametersB.toFixed(2))}B `
  const picks = []
  if (sharesOneModel) {
    const rung = shared[0]
    picks.push(`${describeParameters(rung.parametersB)}${rung.quant ?? 'unknown'} ${rung.fits ? 'shared chat/vision/coding' : 'shared chat/vision/coding (best-effort only)'}`)
  }
  for (const [cap, rung] of Object.entries(p.choices)) {
    if (sharesOneModel && llmSlots.includes(cap)) continue
    picks.push(`${cap} ${rung.quant ?? 'unknown'}${rung.fits ? '' : ' (best-effort)'}`)
  }
  const cap = p.budget.capGb != null ? `, hard cap ${p.budget.capGb.toFixed(1)} GB` : ''
  return `autopilot: ${p.budget.gb.toFixed(1)} GB RAM / ${(p.budget.free / GB).toFixed(1)} GB free → AI share ${p.budget.sharePercent}% = ${(p.budget.models / GB).toFixed(2)} GB${cap} | ${picks.join(', ')}`
}

/** Install only after an explicit local UI action or setup-script invocation. */
export async function install(opts = {}) {
  const {
    dry = false,
    onStep = () => {},
    dir = WHISPER_DIR,
    planned,
    skipOllamaModels = false,
    onlyOllamaSlots,
    // A caller that only needs the brain — the live model test, a diagnostics
    // route — can leave the half-gigabyte speech weights alone. The app's own
    // first run passes nothing here and installs everything the plan fits.
    skipWhisper = false,
  } = opts
  const p = planned ?? plan()
  const log = []
  const root = resolve(dir)
  const allowedOllamaSlots = skipOllamaModels
    ? new Set()
    : Array.isArray(onlyOllamaSlots)
      ? new Set(onlyOllamaSlots)
      : null
  const usesOllamaSlot = (cap, rung) =>
    rung.fits && rung.kind !== 'whisper' && rung.kind !== 'tts' && Boolean(rung.model)
    && (allowedOllamaSlots === null || allowedOllamaSlots.has(cap))
  onStep({ phase: 'plan', summary: planSummary(p), notes: p.notes, totalDownloadBytes: p.totalDownloadBytes })
  if (dry) return { log, plan: p, installed: [] }

  await mkdir(root, { recursive: true })
  const hasFittingOllamaModels = !skipOllamaModels && Object.entries(p.choices).some(([cap, rung]) =>
    usesOllamaSlot(cap, rung),
  )
  const ollamaReady = hasFittingOllamaModels ? await ollamaUp() : false
  const existingModels = ollamaReady ? await installedOllamaModels() : new Set()

  for (const [cap, rung] of Object.entries(p.choices)) {
    const id = rung.model ?? rung.file ?? cap
    if (!rung.fits) {
      const why = `skipped: ${cap} is outside the ${ (p.effectiveModelBytes / GB).toFixed(2) } GB active-memory plan; no over-cap model was downloaded`
      onStep({ phase: 'skip', cap, model: id, status: why, fits: false })
      log.push({ cap, id, ok: true, skipped: true, fits: false, note: why })
      continue
    }

    if (rung.kind !== 'whisper' && rung.kind !== 'tts' && rung.model && !usesOllamaSlot(cap, rung)) {
      const note = skipOllamaModels
        ? 'skipped: a non-Ollama model endpoint is configured; no local Ollama weights were downloaded'
        : 'skipped: this slot is not routed to the local Ollama selected for automatic setup; planner weights were left untouched'
      onStep({ phase: 'skip', cap, model: rung.model, status: note, fits: rung.fits })
      log.push({ cap, id: rung.model, ok: true, skipped: true, fits: rung.fits, note })
      continue
    }

    if (rung.kind === 'tts') {
      const note = rung.engine === 'system'
        ? 'uses the installed browser/OS voice; no model download required'
        : 'browser model is fetched and cached on first Kokoro use, not by the Ollama bridge'
      onStep({ phase: 'browser-voice', cap, model: rung.model, status: note })
      log.push({ cap, id: rung.model, ok: true, skipped: true, note })
      continue
    }

    if (rung.kind === 'whisper') {
      if (skipWhisper) {
        const note = 'skipped: speech weights are not part of this run'
        onStep({ phase: 'skip', cap, file: rung.file, status: note, fits: rung.fits })
        log.push({ cap, id: rung.file, ok: true, skipped: true, fits: rung.fits, note })
        continue
      }
      onStep({ phase: 'whisper', cap, file: rung.file, completed: 0, total: rung.bytes })
      try {
        const modelPath = join(root, rung.file)
        const alreadyHaveModel = await fileIsComplete(modelPath, rung.bytes)
        const result = alreadyHaveModel
          ? { id: rung.file, ok: true, skipped: true, path: modelPath, bytes: (await stat(modelPath)).size, note: 'already installed; kept existing multilingual Whisper weights' }
          : await downloadWhisperModel(rung.file, root, (progress) => onStep({ phase: 'whisper', cap, file: rung.file, ...progress }))
        log.push({ ...result, cap })
        if (result.ok) {
          await writeFile(join(root, ACTIVE_WHISPER_FILE), rung.file, 'utf8')
          const runtime = await ensureWhisperPackage()
          log.push({ ...runtime, cap })
        }
      } catch (error) {
        log.push({ cap, id: rung.file, ok: false, error: concise(error) })
      }
      continue
    }

    if (!ollamaReady) {
      const note = 'not downloaded because Ollama is offline; start it and run the installer again'
      onStep({ phase: 'skip', cap, model: rung.model, status: note })
      log.push({ cap, id: rung.model, ok: true, skipped: true, fits: true, note })
      continue
    }
    if (existingModels.has(rung.model)) {
      const note = 'already installed in Ollama; download skipped'
      onStep({ phase: 'skip', cap, model: rung.model, status: note, fits: true })
      log.push({ cap, id: rung.model, ok: true, skipped: true, fits: true, note })
      continue
    }

    onStep({ phase: 'pull', cap, model: rung.model, completed: 0, total: rung.bytes, fits: true })
    try {
      await pullOllamaModel(rung.model, (progress) => onStep({ phase: 'pull', cap, model: rung.model, fits: true, ...progress }))
      existingModels.add(rung.model)
      log.push({ cap, id: rung.model, ok: true, fits: true })
    } catch (error) {
      log.push({ cap, id: rung.model, ok: false, fits: true, error: concise(error) })
    }
  }

  const failures = log.filter((item) => !item.ok && !item.skipped)
  const installed = log.filter((item) => item.ok && !item.skipped)
  onStep({ phase: 'done', installed: installed.length, skipped: log.filter((item) => item.skipped).length, failed: failures.length })
  return { log, plan: p, installed }
}

/**
 * Download exactly the models a person chose, and nothing else.
 *
 * The planner is still consulted — for the machine's shape, the notes and the
 * slots that are not one of the three — but the three model slots are overwritten
 * with the chosen rungs, so the ladder's opinion cannot sneak a download in.
 * Unknown tags are refused loudly: a catalogue page that has gone stale should
 * fail with a sentence, not with a five-gigabyte pull of the wrong thing.
 *
 * @param {{chat?: string, vision?: string, coder?: string}} selection
 */
export async function installSelection(selection = {}, opts = {}) {
  const base = plan()
  const ladderFor = { chat: 'chat', vision: 'vision', coder: 'reason' }
  const choices = { ...base.choices }
  const chosen = []
  for (const [userSlot, ladder] of Object.entries(ladderFor)) {
    const wanted = selection?.[userSlot]
    if (!wanted) throw new Error(`no ${userSlot} model was chosen; all three slots are required`)
    const rung = LADDERS[ladder].find((candidate) => candidate.model === wanted)
    if (!rung) throw new Error(`${wanted} is not a ${userSlot} model in the catalogue`)
    choices[ladder] = { ...rung, kind: rung.kind ?? 'ollama', mode: 'chosen', fits: true }
    chosen.push(rung)
  }
  // Everything the planner would have picked on its own is skipped, including
  // the speech weights: this call downloads the three, no more.
  for (const cap of Object.keys(choices)) {
    if (Object.values(ladderFor).includes(cap)) continue
    choices[cap] = { ...choices[cap], fits: false }
  }
  const planned = {
    ...base,
    choices,
    effectiveModelBytes: chosen.reduce((sum, rung) => sum + (rung.residentBytes ?? 0), 0),
    totalDownloadBytes: chosen.reduce((sum, rung) => sum + (rung.bytes ?? 0), 0),
    notes: [
      'Models chosen by hand in the setup window; the RAM ladder picked none of them.',
      ...base.notes.filter((note) => !/AI allocation/.test(note)),
    ],
  }
  return install({ ...opts, planned, skipWhisper: true })
}

async function installedOllamaModels() {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return new Set()
    const data = await response.json()
    return new Set((data.models ?? []).map((model) => String(model.name ?? '')).filter(Boolean))
  } catch {
    return new Set()
  }
}

async function fileIsComplete(path, expectedBytes) {
  try {
    const entry = await stat(path)
    return entry.isFile() && entry.size >= expectedBytes * 0.9
  } catch {
    return false
  }
}

async function ollamaUp() {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500) })
    return response.ok
  } catch {
    return false
  }
}

async function pullOllamaModel(model, onProgress) {
  const response = await fetch(`${OLLAMA_HOST}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
    signal: AbortSignal.timeout(60 * 60 * 1000),
  })
  if (!response.ok) throw new Error(`Ollama pull ${model}: HTTP ${response.status}`)
  if (!response.body) throw new Error('Ollama returned no download stream')
  const reader = response.body.getReader()
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
        const event = JSON.parse(line)
        onProgress({ status: event.status ?? '', completed: event.completed ?? null, total: event.total ?? null })
        if (event.error) throw new Error(event.error)
      } catch (error) {
        if (error instanceof SyntaxError) continue
        throw error
      }
    }
  }
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer)
      if (event.error) throw new Error(event.error)
      onProgress({ status: event.status ?? '', completed: event.completed ?? null, total: event.total ?? null })
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
}

async function ensureWhisperPackage() {
  const id = 'whisper-runtime'
  const pkg = '@lumen-labs-dev/whisper-node@0.4.1'
  try {
    require.resolve('@lumen-labs-dev/whisper-node')
    return { id, ok: true, skipped: true, path: 'node_modules/@lumen-labs-dev/whisper-node', note: 'already installed' }
  } catch { /* install it below */ }
  try {
    await execFileAsync('npm.cmd', ['install', '--no-save', '--prefix', process.cwd(), pkg], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 8 * MB,
      windowsHide: true,
      shell: true,
    })
    return { id, ok: true, path: 'node_modules/@lumen-labs-dev/whisper-node', note: 'local Whisper runtime installed by explicit model-manager action' }
  } catch (error) {
    return { id, ok: false, error: `Could not install ${pkg}: ${concise(error)}` }
  }
}

async function downloadWhisperModel(file, dir, onProgress = () => {}) {
  const part = join(dir, `${file}.part`)
  const target = join(dir, file)
  try {
    const response = await fetch(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`, { signal: AbortSignal.timeout(30 * 60 * 1000) })
    if (!response.ok) throw new Error(`Hugging Face HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length')) || null
    let completed = 0
    const body = response.body
    if (!body) throw new Error('Whisper download returned no body')
    const progressStream = new TransformStream({
      transform(chunk, controller) {
        completed += chunk.byteLength
        onProgress({ completed, total, status: 'downloading multilingual Whisper model' })
        controller.enqueue(chunk)
      },
    })
    await pipeline(body.pipeThrough(progressStream), createWriteStream(part))
    await rm(target, { force: true })
    await rename(part, target)
    return { id: file, ok: true, path: target, bytes: completed }
  } catch (error) {
    await import('node:fs/promises').then(({ rm }) => rm(part, { force: true })).catch(() => {})
    throw error
  }
}

function concise(error) {
  return String(error?.message ?? error).slice(0, 320)
}

/** Full selectable catalogue, for the model manager. */
export function ladder() {
  return Object.fromEntries(Object.entries(LADDERS).map(([cap, rungs]) => [
    cap,
    {
      purpose: PURPOSE[cap],
      rungs: rungs.map((rung) => ({
        model: rung.model ?? rung.file,
        quant: rung.quant,
        downloadGb: +(rung.bytes / GB).toFixed(2),
        residentGb: +(rung.residentBytes / GB).toFixed(2),
        quality: rung.quality,
        parametersB: rung.parametersB ?? undefined,
        multimodal: rung.multimodal ?? undefined,
        multilingual: rung.multilingual ?? undefined,
        // Carried through so both the shop window and the tests can tell a rung
        // the planner judged from one the person named by hand.
        namedByUser: rung.namedByUser === true ? true : undefined,
        note: rung.note ?? undefined,
      })),
    },
  ]))
}

/**
 * Reference plan for each requested machine-size tier. The catalog is for
 * comparison only: it does not install or download the models in other rows.
 * Profiles assume all reported system RAM is currently free and reuse the
 * caller's allocation (share/cap), so the grid answers "what would this
 * machine get with the settings I am using right now?".
 */
export function tierProfiles(options = {}) {
  const sizes = [0.5, ...Array.from({ length: 32 }, (_, index) => index + 1)]
  return sizes.map((ramGb) => {
    const profile = plan({ ...options, total: ramGb * GB, free: ramGb * GB, gpuInfo: null })
    const slots = Object.fromEntries(Object.entries(profile.choices).map(([cap, rung]) => [
      cap,
      {
        model: rung.model ?? rung.file ?? null,
        quant: rung.quant ?? null,
        parametersB: rung.parametersB ?? null,
        fits: Boolean(rung.fits),
        state: rung.fits ? 'fits' : ['chat', 'vision', 'reason'].includes(cap) ? 'best-effort' : 'unavailable',
        engine: rung.engine ?? null,
        dtype: rung.dtype ?? null,
        multimodal: rung.multimodal ?? false,
        // True when this row is one the person named rather than one the
        // planner judged best — the tiny set at the bottom of each ladder.
        namedByUser: rung.namedByUser === true,
      },
    ]))
    return {
      ramGb,
      aiCapGb: +(profile.budget.models / GB).toFixed(2),
      totalDownloadGb: +(profile.totalDownloadBytes / GB).toFixed(2),
      slots,
    }
  })
}

/** The selected multilingual Whisper file, persisted across bridge restarts. */
export async function selectedWhisperModel(dir = WHISPER_DIR) {
  try {
    const file = (await readFile(join(dir, ACTIVE_WHISPER_FILE), 'utf8')).trim()
    if (file && !file.includes('/') && !file.includes('\\')) return join(resolve(dir), file)
  } catch { /* no saved selection */ }
  return join(resolve(dir), 'ggml-tiny-q5_1.bin')
}

/** True when a Whisper model is installed locally. */
export async function whisperFileReady(modelPath) {
  try {
    const entry = await stat(modelPath)
    if (!entry.isFile()) return false
    const expected = LADDERS.speech.find((rung) => rung.file === basename(modelPath))?.bytes
    // Known planned files must be essentially complete; unknown user overrides
    // still need a substantial model file rather than a zero-byte placeholder.
    return entry.size >= (expected ? expected * 0.9 : 32 * MB)
  } catch {
    return false
  }
}
