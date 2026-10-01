/**
 * Local speech-to-text, via whisper.cpp.
 *
 * The browser's SpeechRecognition API is what the web front-end uses and it is
 * not good enough here: it needs Chrome, it needs a network connection, and it
 * sends audio to Google. For an assistant that is supposed to run entirely on
 * your own machine, that last one is disqualinating.
 *
 * whisper.cpp is the fix. One binary plus a model file, runs on CPU, never
 * leaves the machine. This module shells out to it.
 *
 * The integration is deliberately narrow:
 *
 *   - audio arrives as 16 kHz mono PCM WAV, which is what whisper.cpp wants
 *   - it is written to a temp file, because whisper.cpp reads from disk
 *   - the transcript comes back as text
 *
 * Everything degrades. No binary, no model — each returns a specific, actionable
 * string rather than throwing, because "whisper.cpp not found at ..." is
 * something a user can act on and a stack trace is not.
 *
 * Set JARVIS_WHISPER_BIN and JARVIS_WHISPER_MODEL to point at your install.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm, readFile, stat } from 'node:fs/promises'
import { tmpdir, cpus } from 'node:os'
import { join } from 'node:path'

const BIN = process.env.JARVIS_WHISPER_BIN ?? 'whisper-cli'
const MODEL = process.env.JARVIS_WHISPER_MODEL ?? 'models/ggml-base.en.bin'

/** Models whisper.cpp ships, for a setup prompt in the UI. */
const MODELS = {
  'ggml-tiny.en.bin': 75 * 1024 * 1024,
  'ggml-base.en.bin': 142 * 1024 * 1024,
  'ggml-small.en.bin': 466 * 1024 * 1024,
  'ggml-medium.en.bin': 1.5 * 1024 * 1024 * 1024,
}

/**
 * Is local transcription available at all?
 *
 * Checks the binary and the model separately, because those are two different
 * problems with two different fixes, and collapsing them into one boolean sends
 * people looking in the wrong place.
 */
export async function available() {
  const bin = await which(BIN)
  if (!bin) {
    return { ok: false, why: `whisper.cpp binary not found (looked for "${BIN}")` }
  }
  const model = await fileAt(MODEL)
  if (!model) {
    return { ok: false, why: `whisper model not found at "${MODEL}"` }
  }
  return { ok: true, bin, model, why: null }
}

/**
 * Transcribe a WAV buffer.
 *
 * @param {Buffer} wav   16 kHz mono PCM WAV
 * @param {{language?:string, translate?:boolean}} [opts]
 * @returns {Promise<{text:string, language:string|null, ms:number}>}
 */
export async function transcribe(wav, opts = {}) {
  const check = await available()
  if (!check.ok) throw new Error(check.why)

  const started = Date.now()
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-whisper-'))
  const wavPath = join(dir, 'audio.wav')

  try {
    await writeFile(wavPath, wav)

    const args = [
      '-m', check.model,
      '-f', wavPath,
      '--no-timestamps',
      // One thread per core is wrong on a machine that is also running the model
      // slots. Four is a reasonable ceiling for a background task.
      '-t', String(Math.min(4, Math.max(1, cpuCount()))),
      '-otxt',
    ]
    if (opts.language && opts.language !== 'auto') args.push('-l', opts.language)
    if (opts.translate) args.push('--translate')

    const stdout = await run(check.bin, args)

    // whisper.cpp writes <input>.txt when given -otxt. Some builds ignore the
    // flag and print to stdout instead, so fall back to that.
    let text = ''
    try {
      text = await readFile(`${wavPath}.txt`, 'utf8')
    } catch {
      text = stdout
    }

    return { text: text.trim(), language: opts.language ?? null, ms: Date.now() - started }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Run a binary, collecting stdout. Rejects with stderr on failure. */
function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => reject(new Error(`failed to start ${bin}: ${e.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`${bin} exited ${code}: ${err.slice(0, 400)}`))
    })
  })
}

/** Resolve a binary on PATH, or accept a path directly. */
async function which(bin) {
  if (bin.includes('/') || bin.includes('\\')) {
    return (await fileAt(bin)) ? bin : null
  }
  for (const p of (process.env.PATH ?? '').split(':')) {
    if (!p) continue
    const candidate = join(p, bin)
    if (await fileAt(candidate)) return candidate
  }
  return null
}

async function fileAt(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function cpuCount() {
  try {
    return cpus().length
  } catch {
    return 1
  }
}

/** The models this knows about, for a setup prompt in the UI. */
export function knownModels() {
  return Object.entries(MODELS).map(([name, bytes]) => ({
    name,
    mb: Math.round(bytes / 1048576),
  }))
}
