/**
 * Optional, local Whisper speech-to-text.
 *
 * JARVIS sends captured audio to this bridge endpoint only when
 * VITE_STT_ENGINE=whisper. Audio is decoded to 16 kHz mono PCM in the browser;
 * the selected multilingual whisper.cpp model and runtime stay on this machine.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm, readFile, stat } from 'node:fs/promises'
import { tmpdir, cpus } from 'node:os'
import { delimiter, extname, join, resolve } from 'node:path'
import { selectedWhisperModel, whisperFileReady } from './autopilot.mjs'

const BIN = process.env.JARVIS_WHISPER_BIN ?? 'whisper-cli'
const MULTILINGUAL_MODELS = {
  'ggml-tiny-q5_1.bin': 32 * 1024 * 1024,
  'ggml-base-q5_1.bin': 57 * 1024 * 1024,
  'ggml-small-q5_1.bin': 190 * 1024 * 1024,
  'ggml-medium-q5_0.bin': 539 * 1024 * 1024,
  'ggml-large-v3-turbo-q5_0.bin': 550 * 1024 * 1024,
}

let bindingPromise
async function whisperBinding() {
  if (!bindingPromise) {
    bindingPromise = import('@lumen-labs-dev/whisper-node')
      .then((module) => module.whisper ?? module.default?.whisper ?? (typeof module.default === 'function' ? module.default : null))
      .catch(() => null)
  }
  return bindingPromise
}

async function configuredModel() {
  const path = process.env.JARVIS_WHISPER_MODEL
    ? resolve(process.env.JARVIS_WHISPER_MODEL)
    : await selectedWhisperModel()
  return path
}

/** Is local multilingual transcription ready? */
export async function available() {
  const model = await configuredModel()
  if (!(await whisperFileReady(model))) {
    return { ok: false, why: `multilingual Whisper model is missing or incomplete at "${model}"`, model }
  }

  const bin = await which(BIN)
  if (bin) return { ok: true, engine: 'cli', bin, model, why: null }

  const whisper = await whisperBinding()
  if (whisper) return { ok: true, engine: 'node', whisper, model, why: null }

  return {
    ok: false,
    why: `Whisper runtime not found. Use the local Model Manager to install it, or set JARVIS_WHISPER_BIN.`,
    model,
  }
}

/**
 * Transcribe a 16 kHz mono PCM WAV buffer with language auto-detection by default.
 * @param {Buffer} wav
 * @param {{language?:string, translate?:boolean}} [opts]
 * @returns {Promise<{text:string, language:string|null, ms:number}>}
 */
export async function transcribe(wav, opts = {}) {
  const check = await available()
  if (!check.ok) throw new Error(check.why)
  if (!Buffer.isBuffer(wav) || wav.length < 44) throw new Error('audio payload is not a valid WAV file')

  const started = Date.now()
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-whisper-'))
  const wavPath = join(dir, 'audio.wav')
  const language = opts.language ?? 'auto'

  try {
    await writeFile(wavPath, wav)
    let text = ''
    if (check.engine === 'node') {
      const lines = await check.whisper(wavPath, {
        modelPath: check.model,
        whisperOptions: {
          language,
          gen_file_txt: false,
          gen_file_subtitle: false,
          gen_file_vtt: false,
          word_timestamps: false,
        },
        shellOptions: { silent: true, async: false },
      })
      text = Array.isArray(lines) ? lines.map((line) => line?.speech ?? '').join(' ') : String(lines ?? '')
    } else {
      const args = [
        '-m', check.model,
        '-f', wavPath,
        '--no-timestamps',
        '-t', String(Math.min(4, Math.max(1, cpus().length))),
        '-otxt',
      ]
      if (language && language !== 'auto') args.push('-l', language)
      if (opts.translate) args.push('--translate')
      const stdout = await run(check.bin, args)
      try {
        text = await readFile(`${wavPath}.txt`, 'utf8')
      } catch {
        text = stdout
      }
    }
    return { text: text.trim(), language: language === 'auto' ? null : language, ms: Date.now() - started }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function run(bin, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (data) => { out += data })
    child.stderr.on('data', (data) => { err += data })
    child.on('error', (error) => reject(new Error(`failed to start ${bin}: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolvePromise(out)
      else reject(new Error(`${bin} exited ${code}: ${err.slice(0, 400)}`))
    })
  })
}

/** Resolve a binary on PATH, or accept an explicit path. */
async function which(bin) {
  if (bin.includes('/') || bin.includes('\\')) return (await fileAt(bin)) ? bin : null
  const candidates = process.platform === 'win32' && !extname(bin) ? [`${bin}.exe`, bin] : [bin]
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    for (const name of candidates) {
      const candidate = join(directory, name)
      if (await fileAt(candidate)) return candidate
    }
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

export function knownModels() {
  return Object.entries(MULTILINGUAL_MODELS).map(([name, bytes]) => ({
    name,
    mb: Math.round(bytes / 1048576),
    multilingual: true,
  }))
}
