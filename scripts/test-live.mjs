#!/usr/bin/env node
/**
 * Live model test — proof that JARVIS can actually think.
 *
 * Every other self-test in this repository stops short of that. `smoke.mjs`
 * talks to a stub model server; `desktop/selftest.mjs` proves the loopback
 * wiring; the packaged `--self-test` proves the installed app starts, serves
 * its interface and accepts the handshake on 127.0.0.1. None of them download a
 * model, and none of them ask it a question — so all of them can pass while the
 * machine underneath has no runtime, no weights, or a model that cannot answer.
 *
 * This one does the whole first-run story on a real machine, with nobody
 * watching:
 *
 *   1. install the model runtime — the same portable Ollama build the setup
 *      page installs, unpacked into `models/runtime`,
 *   2. start it, with its weights under `models/ollama`,
 *   3. pull the models the RAM planner selected for this machine (nothing else,
 *      exactly like the app's own setup),
 *   4. send prompts through `bridge/local-llm.mjs` — the same client the bridge
 *      uses — and check the answers are the ones that were asked for,
 *   5. write a report naming the runtime, the model, the timings and the raw
 *      answers, and exit 0 only if the model answered.
 *
 * Usage:
 *   npm run test:live              install what is missing, then ask
 *   npm run test:live -- --plan    print what it would do; no network, no writes
 *   npm run test:live -- --keep-runtime   leave the runtime running afterwards
 *
 * Environment:
 *   JARVIS_LIVE_CAP_GB   active-memory budget the plan is capped to (default 4,
 *                        so the smallest planned model is chosen and a CI run
 *                        stays inside a runner's disk and patience);
 *                        an explicit JARVIS_RAM_CAP_GB wins over it.
 *   JARVIS_MODEL_BASE_URL / JARVIS_OLLAMA_URL   point at an already-running
 *                        runtime instead of the one this test would start.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = new Set(process.argv.slice(2))
const PLAN_ONLY = args.has('--plan')
const KEEP_RUNTIME = args.has('--keep-runtime')
const unknown = [...args].filter((arg) => !['--plan', '--keep-runtime'].includes(arg))
if (unknown.length) {
  console.error(`Unknown option${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`)
  process.exit(2)
}

const RUNTIME_URL = (process.env.JARVIS_OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
const CAP_GB = process.env.JARVIS_RAM_CAP_GB ?? process.env.JARVIS_LIVE_CAP_GB ?? '4'

// Set every input the modules below read at import time, before they are
// imported: the plan, the client pipeline and the runtime all resolve their
// configuration while their module body runs.
process.env.JARVIS_RAM_CAP_GB = process.env.JARVIS_RAM_CAP_GB ?? CAP_GB
process.env.JARVIS_RAM_CONFIG ??= join(mkdtempSync(join(tmpdir(), 'jarvis-live-ram-')), 'ram-allocation.json')
process.env.JARVIS_OLLAMA_URL ??= RUNTIME_URL
process.env.JARVIS_MODEL_BASE_URL ??= `${RUNTIME_URL}/v1`
process.env.JARVIS_NO_BROWSER = '1'

const { availableRam, install, plan, planSummary, totalRam } = await import('../bridge/autopilot.mjs')
const {
  ensureRuntime,
  findRuntimeBinary,
  runtimeModelsDir,
  runtimePlan,
  runtimePresent,
  stopRuntime,
} = await import('../bridge/portable-runtime.mjs')
const { complete } = await import('../bridge/local-llm.mjs')
const {
  MODEL_SLOTS,
  configuredModelBaseUrl,
  hasExplicitModelOverride,
  isLocalOllamaApi,
} = await import('./ollama-endpoints.mjs')

const GB = 1024 ** 3
const said = []
const step = (line) => {
  console.log(`  ${line}`)
  said.push(`  ${line}`)
}
const heading = (line) => {
  console.log(line)
  said.push(line)
}

/* ------------------------------------------------------------------- planning */

const currentPlan = plan()
const fittedOllamaSlots = MODEL_SLOTS.filter((cap) => {
  const choice = currentPlan.choices[cap]
  return Boolean(choice?.fits && choice.model)
})
// The slots this test may pull: planner-selected, not overridden by hand, and
// pointed at the local runtime this test started. The same filter the app's
// first-run installer applies.
const pullableSlots = fittedOllamaSlots.filter((cap) =>
  !hasExplicitModelOverride(cap)
  && isLocalOllamaApi(configuredModelBaseUrl(cap), RUNTIME_URL),
)
const modelTags = [...new Set(pullableSlots.map((cap) => currentPlan.choices[cap].model))]
const downloadBytes = [...new Map(pullableSlots.map((cap) => {
  const choice = currentPlan.choices[cap]
  return [`ollama:${choice.model}`, choice.bytes]
})).values()].reduce((sum, bytes) => sum + bytes, 0)

const runtime = runtimePlan()
const runtimeBin = findRuntimeBinary(runtime, process.env)

heading('JARVIS live model test')
heading('=======================')
step(`machine: ${(totalRam() / GB).toFixed(1)} GB RAM, ${(availableRam() / GB).toFixed(1)} GB free`)
step(`budget:  ${processSummaryBudget()} → ${(modelTags.length ? modelTags.join(', ') : 'no local chat model fits')}`)
step(`runtime: ${runtimePresent(runtime) ? `ready at ${runtime.path}` : runtime.supported ? `would install ${runtime.asset} into ${runtime.dir}` : `cannot be installed on ${process.platform}/${process.arch}`}`)
step(`weights: ${runtimeModelsDir(process.env)}`)
step(`model:   ${modelTags.length ? `${modelTags.join(', ')} (${(downloadBytes / GB).toFixed(2)} GB to download if not already present)` : 'none — this machine has no local chat rung'}`)
if (!modelTags.length && !runtimePresent(runtime)) {
  step('nothing to do: no local model is planned, and no runtime is installed')
}

if (PLAN_ONLY) {
  heading('')
  step('plan only: nothing was downloaded, started or written')
  process.exit(modelTags.length ? 0 : 1)
}

function processSummaryBudget() {
  const cap = Number(process.env.JARVIS_RAM_CAP_GB)
  return Number.isFinite(cap) && cap > 0
    ? `${cap.toFixed(1)} GB (JARVIS_RAM_CAP_GB)`
    : planSummary(currentPlan)
}

/* ------------------------------------------------------------------ installing */

const installStart = Date.now()
let installedSeconds = 0

if (!modelTags.length) {
  heading('')
  step('FAIL: the RAM plan selects no local Ollama model, so there is nothing to ask')
  finish(1)
}

heading('')
heading('Installing what is missing')
const ensured = await ensureRuntime({
  url: RUNTIME_URL,
  onStep: (entry) => { if (entry.status) step(`runtime: ${entry.status}`) },
})
if (!ensured.ok) {
  step(`FAIL: the runtime could not be installed or started — ${ensured.error}`)
  finish(1)
}
const binary = ensured.bin ?? runtimeBin ?? findRuntimeBinary(runtimePlan(), process.env)
step(`runtime: ${ensured.skipped ? 'already answering' : 'started'} (${binary ?? 'unknown binary'})`)

const pulled = await install({
  planned: currentPlan,
  onlyOllamaSlots: pullableSlots,
  skipWhisper: true,
  onStep: (entry) => {
    if (entry.phase === 'plan') return
    if (entry.phase === 'pull') {
      const progress = entry.total
        ? ` ${(entry.completed / 1024 ** 2).toFixed(0)} / ${(entry.total / 1024 ** 2).toFixed(0)} MB`
        : entry.completed ? ` ${(entry.completed / 1024 ** 2).toFixed(0)} MB` : ''
      step(`pull ${entry.model}${progress}${entry.status ? ` — ${entry.status}` : ''}`)
      return
    }
    if (entry.status) step(`${entry.cap ?? entry.phase ?? 'setup'}: ${entry.status}`)
  },
})
installedSeconds = Math.round((Date.now() - installStart) / 1000)

const missing = pulled.log.filter((entry) => !entry.ok && !entry.skipped)
const offline = pulled.log.filter((entry) => entry.ok && entry.skipped && entry.fits && /offline/i.test(entry.note ?? ''))
if (missing.length || offline.length) {
  for (const entry of [...missing, ...offline]) step(`FAIL: ${entry.cap ?? entry.id}: ${entry.error ?? entry.note ?? 'unknown error'}`)
  finish(1)
}

// Do not take the installer's word for it: ask the runtime what it holds.
const tags = await runtimeTags()
const absent = modelTags.filter((tag) => !tags.some((id) => id === tag || id === `${tag}:latest` || tag.startsWith(`${id}:`)))
if (absent.length) {
  step(`FAIL: the runtime does not list ${absent.join(', ')} after installation (it lists: ${tags.join(', ') || 'nothing'})`)
  finish(1)
}
step(`weights: ${modelTags.join(', ')} present (${installedSeconds} s for this step)`)

/* ------------------------------------------------------------------- prompting */

const CHECKS = [
  {
    name: 'instruction',
    prompt: 'Reply with exactly this word and nothing else: JARVIS-OK',
    ok: (text) => /\bJARVIS[-_ ]?OK\b/i.test(text),
  },
  {
    name: 'arithmetic',
    prompt: 'What is 17 + 25? Reply with the number only.',
    ok: (text) => /(^|\D)42(\D|$)/.test(text),
  },
  {
    name: 'json',
    prompt: 'Reply with valid JSON only, no code fences and no other words: {"status":"ok"}',
    ok: (text) => {
      try {
        return JSON.parse(text.replace(/```(?:json)?/gi, '').trim())?.status === 'ok'
      } catch {
        return false
      }
    },
  },
  {
    name: 'multilingual',
    prompt: 'How do you say "hello" in Telugu? Reply with the Telugu word only.',
    // Any Telugu codepoint is enough: the point is that the same weights can
    // answer in a script that is not English, not that it picked one spelling.
    ok: (text) => /[\u0C00-\u0C7F]/.test(text),
  },
]

heading('')
heading('Asking the model through the bridge\'s own client')
const answers = []
for (const check of CHECKS) {
  const started = Date.now()
  let text = ''
  let error = null
  try {
    text = await complete('chat', [{ role: 'user', content: check.prompt }], {
      temperature: 0,
      maxTokens: 96,
      timeoutMs: 300_000,
    })
  } catch (problem) {
    error = problem?.message ?? String(problem)
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  const trimmed = (text ?? '').trim()
  const pass = !error && check.ok(trimmed)
  answers.push({ ...check, text: trimmed, error, pass, seconds })
  step(`${pass ? 'PASS' : 'FAIL'}  ${check.name.padEnd(13)} ${String(seconds).padStart(5)} s  ${error ? `error: ${error}` : `→ ${oneLine(trimmed)}`}`)
}

const passed = answers.filter((answer) => answer.pass).length
const model = modelTags.join(', ')
heading('')
heading(passed === answers.length
  ? `RESULT: the AI is working — ${model} answered ${passed}/${answers.length} prompts`
  : `RESULT: the AI is NOT working — ${model} answered ${passed}/${answers.length} prompts`)

/* --------------------------------------------------------------------- report */

const report = [
  `JARVIS live model test — ${new Date().toISOString()}`,
  '',
  `runtime   ${binary ?? 'unknown'}`,
  `weights   ${runtimeModelsDir(process.env)}`,
  `model     ${model}`,
  `budget    ${process.env.JARVIS_RAM_CAP_GB} GB cap, ${(totalRam() / GB).toFixed(1)} GB RAM, ${(availableRam() / GB).toFixed(1)} GB free`,
  `plan      ${planSummary(currentPlan)}`,
  `install   ${installedSeconds} s`,
  '',
  ...answers.flatMap((answer) => [
    `[${answer.pass ? 'PASS' : 'FAIL'}] ${answer.name} (${answer.seconds} s)`,
    `  prompt: ${answer.prompt}`,
    `  answer: ${answer.error ? `error: ${answer.error}` : answer.text.replace(/\n/g, '\n          ')}`,
    '',
  ]),
  passed === answers.length
    ? `RESULT: the AI is working (${passed}/${answers.length})`
    : `RESULT: the AI is NOT working (${passed}/${answers.length})`,
  '',
].join('\n')

const reportPath = join(process.cwd(), 'models', 'live-test-report.txt')
try {
  writeFileSync(reportPath, report)
  step(`report: ${reportPath}`)
} catch (error) {
  step(`report: could not be written (${error?.message ?? error}) — the log above has everything`)
}

finish(passed === answers.length ? 0 : 1)

/* --------------------------------------------------------------------- helpers */

async function runtimeTags() {
  try {
    const response = await fetch(`${RUNTIME_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return []
    const data = await response.json()
    return (data?.models ?? []).map((entry) => entry?.name).filter(Boolean)
  } catch {
    return []
  }
}

function oneLine(text) {
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? ''
  return first.length > 120 ? `${first.slice(0, 120)}…` : first
}

function finish(code) {
  if (!KEEP_RUNTIME) stopRuntime()
  process.exit(code)
}
