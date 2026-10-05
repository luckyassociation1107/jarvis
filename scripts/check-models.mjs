#!/usr/bin/env node
/**
 * The mandatory tiny set, pulled and prompted from the CLI.
 *
 * Three models, asked for by name, are the smallest rung of each job in the
 * catalogue — and the point of them is that a first run is minutes: chat is
 * `qwen2.5:0.5b` (29 languages, tool-capable), coding is `qwen2.5-coder:0.5b`,
 * and vision is `ahmadwaqar/smolvlm2-256m-video:q8_0` (SigLIP + SmolLM2, reads
 * images, screenshots and video frames). Together they are about 1.08 GB.
 *
 * This script proves they are real: it installs the runtime if the machine has
 * none, pulls each tag through the `ollama` CLI itself, then asks each model a
 * question only that model can answer — a word for chat, a function for code,
 * and a colour for the model that is supposed to have eyes. Nothing here is a
 * mock; if a registry has moved a tag, this fails and says which one.
 *
 *   npm run check:models                 # install runtime if needed, pull, prompt
 *   npm run check:models -- --pull-only  # stop after the pulls
 *   npm run check:models -- --check      # do not install or pull; report what is there
 *
 * Environment: JARVIS_OLLAMA_URL (default http://localhost:11434),
 * JARVIS_OLLAMA_BIN (explicit path to the CLI), JARVIS_MODELS_REPORT.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import process from 'node:process'

const args = process.argv.slice(2)
const pullOnly = args.includes('--pull-only')
const checkOnly = args.includes('--check')
const url = (process.env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, '')
const reportPath = resolve(process.env.JARVIS_MODELS_REPORT ?? 'models/check-models-report.txt')
const lines = []

const say = (line = '') => {
  console.log(line)
  lines.push(line)
}
const step = (label, detail) => say(`  ${label.padEnd(9)} ${detail}`)

/** The three tags, taken from the declared mandatory set rather than copied here. */
const { NAMED_TINY } = await import('../bridge/autopilot.mjs')
const MANDATORY = [
  { slot: 'chat', tag: NAMED_TINY.chat.model, note: NAMED_TINY.chat.note },
  { slot: 'coder', tag: NAMED_TINY.coder.model, note: NAMED_TINY.coder.note },
  { slot: 'vision', tag: NAMED_TINY.vision.model, note: NAMED_TINY.vision.note },
]

/* ------------------------------------------------------------------ helpers */

const request = async (path, init = {}, timeoutMs = 300_000) => {
  const response = await fetch(`${url}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`)
  return response
}

/** Where the runtime lives: explicit, on PATH, or the project's own unzip. */
function findCli() {
  const candidates = [
    process.env.JARVIS_OLLAMA_BIN,
    join(process.cwd(), 'models', 'runtime', process.platform === 'win32' ? 'ollama.exe' : 'bin', process.platform === 'win32' ? '' : 'ollama'),
    join(process.cwd(), 'models', 'runtime', 'bin', 'ollama.exe'),
  ].filter((candidate) => candidate && !candidate.endsWith(join('bin', '')))
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ollama'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const first = found.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0]
    if (first && existsSync(first)) return first
  } catch { /* no CLI on PATH: the HTTP API still works */ }
  return null
}

/* ------------------------------------------------------------------- the run */

try {
  const { apiUp, ensureRuntime } = await import('../bridge/portable-runtime.mjs')
  if (!checkOnly) {
    step('runtime', 'installing or starting Ollama if this machine has none…')
    const ready = await ensureRuntime({ url, onStep: (entry) => { if (entry?.status) step('runtime', entry.status) } })
    if (!ready.ok) throw new Error(ready.error ?? 'the runtime could not be started')
    step('runtime', ready.skipped ? `already answering at ${url}` : `ready${ready.bin ? ` at ${ready.bin}` : ''}`)
  } else if (!await apiUp(url, { timeout: 5_000 })) {
    throw new Error(`nothing is answering at ${url} — run without --check to install and pull`)
  }

  const cli = findCli()
  step('cli', cli ?? 'no ollama binary found — pulling over the HTTP API instead')

  /* ── pull ── */
  if (!checkOnly) {
    for (const model of MANDATORY) {
      const started = Date.now()
      if (cli) {
        step('pull', `ollama pull ${model.tag}`)
        const code = await new Promise((resolveCode, reject) => {
          const child = spawn(cli, ['pull', model.tag], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true })
          child.once('error', reject)
          child.once('close', resolveCode)
        })
        if (code !== 0) throw new Error(`ollama pull ${model.tag} exited with ${code}`)
      } else {
        step('pull', `${model.tag} over ${url}/api/pull`)
        const response = await request('/api/pull', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: model.tag, stream: true }),
        }, 3_600_000)
        const reader = response.body.getReader()
        for (;;) {
          const { done } = await reader.read()
          if (done) break
        }
      }
      step('pulled', `${model.tag} in ${((Date.now() - started) / 1000).toFixed(1)} s`)
    }
  }
  if (pullOnly) {
    say('')
    say('Pulls done. Every mandatory tag is on this machine.')
    process.exit(0)
  }

  /* ── what the runtime now holds ── */
  const tags = await request('/api/tags').then((response) => response.json())
  const onDisk = new Map((tags.models ?? []).map((entry) => [entry.name, entry.size ?? 0]))
  for (const model of MANDATORY) {
    const size = onDisk.get(model.tag) ?? onDisk.get(`${model.tag}:latest`) ?? null
    if (size === null) throw new Error(`${model.tag} is not installed after the pull`)
    step('installed', `${model.tag} — ${(size / 1024 ** 3).toFixed(2)} GB on disk`)
  }

  /* ── ask each one something only it can answer ── */
  const ask = async (model, content, { images = null, timeoutMs = 300_000 } = {}) => {
    const response = await request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content, ...(images ? { images } : {}) }],
        stream: false,
        options: { temperature: 0, num_predict: 300 },
      }),
    }, timeoutMs)
    const data = await response.json()
    return String(data?.message?.content ?? '').trim()
  }

  const oneLine = (text) => text.replace(/\s+/g, ' ').slice(0, 140)
  const checks = []

  const chatTag = MANDATORY.find((model) => model.slot === 'chat').tag
  const chatAnswer = await ask(chatTag, 'Reply with exactly this and nothing else: JARVIS-OK')
  checks.push({ name: `chat · ${chatTag}`, ok: /JARVIS-OK/i.test(chatAnswer), evidence: `"${oneLine(chatAnswer)}"` })

  const coderTag = MANDATORY.find((model) => model.slot === 'coder').tag
  const coderAnswer = await ask(coderTag, 'Write a Python function that adds two numbers. Reply with code only.')
  checks.push({ name: `coder · ${coderTag}`, ok: /def |lambda|return/i.test(coderAnswer), evidence: `"${oneLine(coderAnswer)}"` })

  const visionTag = MANDATORY.find((model) => model.slot === 'vision').tag
  // Two solid-colour images, each asked about twice: once as a plain caption and
  // once as a forced choice. A model that never looks at the pixels has to end
  // up naming both colours by luck, and a model that does look has the easiest
  // possible question in front of it. Every answer goes in the evidence, so a
  // failure shows what the model actually said.
  const colours = { red: [0xd3, 0x1f, 0x1f], blue: [0x1b, 0x3f, 0xc9] }
  const names = (colour, reply) => {
    const other = colour === 'red' ? 'blue' : 'red'
    return new RegExp(colour, 'i').test(reply) && !new RegExp(other, 'i').test(reply)
  }
  const visionAnswers = []
  const missed = []
  for (const colour of ['red', 'blue']) {
    const other = colour === 'red' ? 'blue' : 'red'
    const image = solidPng(colours[colour]).toString('base64')
    let reply = await ask(visionTag, 'Describe this image in one word.', { images: [image] })
    if (!names(colour, reply)) {
      visionAnswers.push(`${colour} image → captioned "${oneLine(reply)}"`)
      reply = await ask(visionTag, `Is the colour of this image ${colour} or ${other}? Reply with one word.`, { images: [image] })
      if (!names(colour, reply)) missed.push(colour)
    }
    visionAnswers.push(`${colour} image → "${oneLine(reply)}"`)
  }
  checks.push({ name: `vision · ${visionTag}`, ok: missed.length === 0, evidence: visionAnswers.join(' · ') })

  /* ── report ── */
  say('')
  for (const check of checks) {
    say(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}\n         ${check.evidence}`)
    if (!check.ok) {
      const why = MANDATORY.find((model) => check.name.endsWith(model.tag))?.note
      if (why) say(`         mandatory because: ${why}`)
    }
  }
  const failed = checks.filter((check) => !check.ok)
  say('')
  say(failed.length
    ? `RESULT: ${checks.length - failed.length}/${checks.length} mandatory models answered; ${failed.map((check) => check.name).join(', ')} did not.`
    : `RESULT: all ${checks.length} mandatory models are installed and answering (chat, coder, vision).`)

  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8')
  process.exit(failed.length ? 1 : 0)
} catch (error) {
  say('')
  say(`RESULT: ${error?.message ?? error}`)
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8')
  process.exit(1)
}

/* ------------------------------------------------------------------ artefacts */

/**
 * One solid colour, as PNG bytes.
 *
 * The vision check has to hand the model something to look at, and a generated
 * PNG is better than a fixture: it is exact, tiny, and there is no file in the
 * repository whose absence can turn a real failure into a confusing one. A
 * field of one saturated colour is the easiest image there is to name, which is
 * the point — the question is whether the model looks at all, not whether a
 * 256M model can describe a scene.
 */
function solidPng([red, green, blue], size = 64) {
  const raw = Buffer.alloc(size * (1 + size * 3))
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 3)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const at = row + 1 + x * 3
      raw[at] = red
      raw[at + 1] = green
      raw[at + 2] = blue
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length, 0)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body), 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** CRC-32, the one PNG needs and Node does not expose. */
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
