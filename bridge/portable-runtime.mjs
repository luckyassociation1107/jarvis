/**
 * The model runtime JARVIS can fetch for itself.
 *
 * Ollama publishes standalone archives next to its installers — the same
 * `ollama serve` binary, without the setup program. That is the difference
 * between a one-click install and a two-step one: a page can download an
 * archive and unpack it, and it cannot run an installer. So this module fetches
 * the standalone build into a folder this project owns (`models/runtime`),
 * unpacks it, and starts the server out of it. No administrator prompt, no
 * system-wide change, nothing added to PATH — the whole thing lives next to the
 * models it will serve, and deleting that folder removes it completely.
 *
 * Assets are the official release attachments, so `latest` always means the
 * current build:
 *   https://github.com/ollama/ollama/releases/latest/download/<asset>
 *
 * The system installers stay the better option when the machine already has, or
 * wants, a managed Ollama. This is the path for the machine that has nothing.
 */
import { chmodSync, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import process from 'node:process'

/**
 * Standalone builds, by platform.
 *
 * `bin` is the path inside the archive. Linux ships the binary under `bin/`
 * beside its shared libraries; Windows and macOS unpack flat.
 */
export const RUNTIME_ASSETS = Object.freeze({
  linux: { asset: 'ollama-linux-amd64.tgz', kind: 'tgz', bin: join('bin', 'ollama') },
  darwin: { asset: 'ollama-darwin.tgz', kind: 'tgz', bin: 'ollama' },
  win32: { asset: 'ollama-windows-amd64.zip', kind: 'zip', bin: 'ollama.exe' },
})

/** Where the archives come from. Overridable so tests can serve their own. */
export const DEFAULT_RUNTIME_BASE = 'https://github.com/ollama/ollama/releases/latest/download'

export function runtimeBase(env = process.env) {
  return String(env.JARVIS_RUNTIME_BASE ?? DEFAULT_RUNTIME_BASE).replace(/\/+$/, '')
}

/** The folder the runtime is unpacked into. Inside the project, so it is one thing to delete. */
export function runtimeDir(env = process.env) {
  return resolve(env.JARVIS_RUNTIME_DIR ?? join('models', 'runtime'))
}

/** Where the models the runtime serves are kept. */
export function runtimeModelsDir(env = process.env) {
  return resolve(env.JARVIS_RUNTIME_MODELS ?? join('models', 'ollama'))
}

/**
 * What would be downloaded, and for which platform.
 *
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv }} options
 */
export function runtimePlan({ platform = process.platform, env = process.env } = {}) {
  const entry = RUNTIME_ASSETS[platform]
  const dir = runtimeDir(env)
  if (!entry) return { supported: false, platform, dir, url: null, asset: null, kind: null, bin: null, path: null }
  return {
    supported: true,
    platform,
    dir,
    asset: entry.asset,
    kind: entry.kind,
    bin: entry.bin,
    path: join(dir, entry.bin),
    url: `${runtimeBase(env)}/${entry.asset}`,
  }
}

/** Is the runtime already unpacked here? */
export function runtimePresent(plan) {
  return Boolean(plan?.path) && existsSync(plan.path)
}

/** A human answer for "is the runtime ready", without starting anything. */
export function runtimeStatus({ platform = process.platform, env = process.env } = {}) {
  const plan = runtimePlan({ platform, env })
  return {
    supported: plan.supported,
    present: runtimePresent(plan),
    path: plan.path,
    bin: plan.bin,
    asset: plan.asset,
    url: plan.url,
    dir: plan.dir,
  }
}

/**
 * First binary that can serve: the one this project downloaded, else whatever
 * `ollama` the machine already has on PATH. JARVIS's own copy wins, so a
 * one-click install is not silently shadowed by a half-broken PATH entry.
 */
export function findRuntimeBinary(plan, env = process.env) {
  if (runtimePresent(plan)) return plan.path
  const names = plan.platform === 'win32' ? ['ollama.exe', 'ollama'] : ['ollama']
  const dirs = String(env.PATH ?? '').split(plan.platform === 'win32' ? ';' : ':').filter(Boolean)
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
      } catch {
        /* an unreadable PATH entry is not a binary */
      }
    }
  }
  return null
}

/** Unpack an archive into the runtime folder with the platform's own tools. */
export function unpackArchive(archive, kind, dir) {
  mkdirSync(dir, { recursive: true })
  const command = kind === 'zip' ? 'unzip' : 'tar'
  const args = kind === 'zip' ? ['-oq', archive, '-d', dir] : ['-xzf', archive, '-C', dir]
  const result = spawnSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  if (result.error) return { ok: false, error: `${command} is needed to unpack the runtime: ${result.error.message}` }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? '').trim().split('\n').slice(-1)[0] ?? `exit ${result.status}`
    return { ok: false, error: `${command} could not unpack ${kind === 'zip' ? 'the zip' : 'the archive'}: ${detail}` }
  }
  return { ok: true }
}

/**
 * Download the standalone runtime and unpack it.
 *
 * Steps are reported the same way the model installer reports them, so the page
 * renders one progress list for the whole one-click install rather than two.
 */
export async function downloadRuntime({ plan = runtimePlan(), onStep = () => {}, fetchImpl = fetch } = {}) {
  if (!plan.supported) {
    return { ok: false, error: `No standalone Ollama build is published for ${plan.platform}.` }
  }
  if (runtimePresent(plan)) {
    return { ok: true, skipped: true, path: plan.path, note: 'the runtime is already unpacked here' }
  }

  mkdirSync(plan.dir, { recursive: true })
  const archive = join(plan.dir, plan.asset)
  onStep({ phase: 'runtime-download', status: `downloading ${plan.asset}`, completed: 0, total: 0 })
  try {
    const response = await fetchImpl(plan.url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${plan.url}`)
    const total = Number(response.headers?.get?.('content-length') ?? 0)
    let completed = 0
    let lastReport = 0
    // Counting inside the pipeline, not beside it, so a fast stream cannot
    // slip chunks past the progress report.
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        completed += chunk.length
        const now = Date.now()
        if (now - lastReport > 400) {
          lastReport = now
          onStep({ phase: 'runtime-download', status: `downloading ${plan.asset}`, completed, total })
        }
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(archive))
    const bytes = statSync(archive).size
    onStep({ phase: 'runtime-unpack', status: `unpacking ${plan.asset}`, completed: bytes, total: bytes })

    const unpacked = unpackArchive(archive, plan.kind, plan.dir)
    if (!unpacked.ok) {
      rmSync(archive, { force: true })
      return { ok: false, error: unpacked.error }
    }
    rmSync(archive, { force: true })
    if (!existsSync(plan.path)) {
      return {
        ok: false,
        error: `the archive unpacked but ${plan.bin} is not there — the release layout may have changed`,
      }
    }
    if (plan.platform !== 'win32') {
      try {
        chmodSync(plan.path, 0o755)
      } catch {
        /* already executable, or a filesystem that has no mode bits */
      }
    }
    onStep({ phase: 'runtime-ready', status: `runtime ready at ${plan.path}`, completed: bytes, total: bytes })
    return { ok: true, bytes, path: plan.path }
  } catch (error) {
    rmSync(archive, { force: true })
    return { ok: false, error: `could not download ${plan.asset}: ${error?.message ?? error}` }
  }
}

/** The Ollama API answers here? */
export async function apiUp(url, { timeout = 2000, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`${url.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(timeout) })
    return response.ok
  } catch {
    return false
  }
}

let served = null
let signalsHooked = false

/**
 * Start the runtime and wait until it answers.
 *
 * The child is JARVIS's own: it dies with this process rather than outliving
 * it, because a model server still holding port 11434 after the window was
 * closed is exactly the kind of leftover that makes people distrust an
 * installer.
 */
export async function startRuntime({ bin, url = 'http://localhost:11434', modelsDir = runtimeModelsDir(), onStep = () => {}, env = process.env } = {}) {
  const listen = url.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const child = spawn(bin, ['serve'], {
    env: {
      ...env,
      OLLAMA_HOST: listen,
      OLLAMA_MODELS: modelsDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', (chunk) => process.stdout.write(`[runtime] ${chunk}`))
  child.stderr?.on('data', (chunk) => process.stderr.write(`[runtime] ${chunk}`))
  let error = null
  let exitCode = null
  child.once('error', (err) => { error = err })
  child.once('exit', (code) => { exitCode = code })
  served = child

  // The child dies with the parent, three ways: it shares this process's group
  // (so a terminal Ctrl-C reaches it), a plain exit kills it below, and a bare
  // `kill <pid>` — which terminates Node without running exit handlers — is
  // covered by these handlers, which then re-exit with the conventional code so
  // the signal is still observable to a parent shell.
  process.once('exit', () => { try { child.kill('SIGKILL') } catch { /* already gone */ } })
  if (!signalsHooked) {
    signalsHooked = true
    const relay = (signal, code) => {
      try { served?.kill('SIGTERM') } catch { /* already gone */ }
      process.exit(code)
    }
    process.once('SIGINT', () => relay('SIGINT', 130))
    process.once('SIGTERM', () => relay('SIGTERM', 143))
  }

  const deadline = Date.now() + 60_000
  let reported = false
  while (Date.now() < deadline) {
    if (await apiUp(url)) {
      onStep({ phase: 'runtime', status: `runtime started at ${url}`, ok: true })
      return { ok: true, pid: child.pid, url }
    }
    if (error || exitCode !== null) break
    if (!reported) {
      reported = true
      onStep({ phase: 'runtime', status: `starting the runtime at ${url}`, ok: true })
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  try { child.kill('SIGKILL') } catch { /* already gone */ }
  return {
    ok: false,
    error: error
      ? `could not start ${bin}: ${error.message}`
      : exitCode !== null
        ? `${bin} serve exited with code ${exitCode}`
        : `${bin} did not answer on ${url} within 60 s`,
  }
}

/**
 * The whole one-click runtime story: use what is running, else start what is
 * installed, else download the standalone build and start that.
 */
export async function ensureRuntime({
  platform = process.platform,
  env = process.env,
  url = env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434',
  modelsDir = runtimeModelsDir(env),
  onStep = () => {},
  fetchImpl = fetch,
} = {}) {
  const plan = runtimePlan({ platform, env })
  if (await apiUp(url, { fetchImpl })) {
    onStep({ phase: 'runtime', status: `a model server already answers at ${url}; nothing to start`, ok: true, skipped: true })
    return { ok: true, skipped: true, url }
  }
  let bin = findRuntimeBinary(plan, env)
  if (!bin) {
    if (!plan.supported) {
      const error = `no standalone Ollama build exists for ${platform}; install Ollama from its official download page and press re-check`
      onStep({ phase: 'runtime', status: error, ok: false })
      return { ok: false, error }
    }
    const downloaded = await downloadRuntime({ plan, onStep, fetchImpl })
    if (!downloaded.ok) {
      onStep({ phase: 'runtime', status: downloaded.error, ok: false })
      return { ok: false, error: downloaded.error }
    }
    bin = plan.path
  }
  const started = await startRuntime({ bin, url, modelsDir, onStep, env })
  if (!started.ok) onStep({ phase: 'runtime', status: started.error, ok: false })
  return { ...started, bin }
}

/** The child this process started, if any. Exported so a host can stop it. */
export function servedRuntime() {
  return served
}

/** Stop the runtime this process started. */
export function stopRuntime() {
  if (!served || served.exitCode !== null || served.signalCode !== null) return false
  try {
    served.kill('SIGTERM')
  } catch {
    return false
  }
  return true
}

/** The parent directory of the unpacked binary, for PATH-style use. */
export function runtimeBinDir(plan) {
  return dirname(plan.path)
}
