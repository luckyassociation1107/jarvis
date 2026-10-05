/**
 * The model runtime JARVIS fetches for itself.
 *
 * Ollama publishes a standalone zip next to its installer, and a page can
 * download and unpack a zip where it cannot run a setup program. That is the
 * difference between a one-click install and a two-step one, so this module does
 * the whole job: find the right archive for this machine, download it (resuming
 * if the connection dropped, verifying the published SHA-256), unpack it inside
 * the project, start it, and die with the parent process.
 *
 * Windows: standalone zip, no installer, no PATH, no admin prompt.
 * Other platforms must use their official Ollama installer; this module does
 * not advertise an archive until that format is safely implemented and tested.
 *
 * Two things this has to survive:
 *
 *   1. Asset names move. The archive is *resolved* against the release's own
 *      asset list, with a name-preference fallback for when GitHub's API cannot
 *      be reached, so a rename upstream cannot 404 an install.
 *   2. The archive is large (over a gigabyte for the CUDA build) and the
 *      machines running this are small. Downloads resume from a partial `.part`
 *      file, are verified against the release's own SHA-256, and are unpacked
 *      with `zlib.createInflateRaw` in Node itself — Windows has no `unzip`, so
 *      shelling out was never an option.
 */
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  rmSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { execSync, spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInflateRaw, constants as zlibConstants } from 'node:zlib'
import process from 'node:process'

/** The release this installs from. Overridable so tests and mirrors do not need the internet. */
export const DEFAULT_RELEASE_API = 'https://api.github.com/repos/ollama/ollama/releases/latest'
export const DEFAULT_RELEASE_BASE = 'https://github.com/ollama/ollama/releases/latest/download'

/** The official Windows installer. Downloaded and run by the app, never a browser. */
export const OLLAMA_SETUP_URL = 'https://ollama.com/download/OllamaSetup.exe'
/** Ollama's own installers. Both are CLI-only: no download page, no browser. */
export const OLLAMA_INSTALL_PS1 = 'https://ollama.com/install.ps1'
export const OLLAMA_INSTALL_SH = 'https://ollama.com/install.sh'

export function releaseApi(env = process.env) {
  return String(env.JARVIS_RUNTIME_API ?? DEFAULT_RELEASE_API)
}

export function releaseBase(env = process.env) {
  return String(env.JARVIS_RUNTIME_BASE ?? DEFAULT_RELEASE_BASE).replace(/\/+$/, '')
}

/** The folder the runtime is unpacked into. Inside the project, so it is one folder to delete. */
export function runtimeDir(env = process.env) {
  return resolve(env.JARVIS_RUNTIME_DIR ?? join('models', 'runtime'))
}

/** Where the models the runtime serves are kept. */
export function runtimeModelsDir(env = process.env) {
  return resolve(env.JARVIS_RUNTIME_MODELS ?? join('models', 'ollama'))
}

/** Windows only: x64 and arm64 both have a standalone zip. */
export function platformSupported(platform = process.platform, arch = process.arch) {
  // This module's bundled runtime is the Windows standalone zip. Linux and
  // macOS users can install their own Ollama; never claim we can unpack a
  // package we do not ship an extractor for.
  return platform === 'win32' && (arch === 'x64' || arch === 'arm64')
}

/**
 * Archive names to look for, best first.
 *
 * This is the fallback when the release API cannot be reached, and the order the
 * API result is ranked by when it can.
 */
export function candidateNames({ platform = process.platform, arch = process.arch, variant = 'default' } = {}) {
  if (platform !== 'win32' || !['x64', 'arm64'].includes(arch)) return []
  if (arch === 'arm64') return ['ollama-windows-arm64.zip']
  return variant === 'rocm'
    ? ['ollama-windows-amd64-rocm.zip']
    : ['ollama-windows-amd64.zip']
}

/** Which unpacker an archive name needs. Everything Windows ships as a zip. */
export function archiveKind(name) {
  // The portable installer ships a Windows zip only. Keep tarballs out of the
  // plan until their extractors are implemented and covered by tests.
  if (/\.zip$/i.test(String(name ?? ''))) return 'zip'
  return null
}

/**
 * Pick the archive from a release's own asset list.
 *
 * @param {Array<{name: string, size?: number, url?: string, sha256?: string}>} assets
 */
export function pickAsset(assets = [], { platform = process.platform, arch = process.arch, variant = 'default' } = {}) {
  const wanted = candidateNames({ platform, arch, variant })
  const byName = new Map(assets.map((asset) => [asset.name, asset]))
  for (const name of wanted) {
    const hit = byName.get(name)
    if (hit) return { ...hit, kind: archiveKind(hit.name) }
  }
  return null
}

/** The fallback when the API cannot be reached: a name composed from the base URL. */
export function fallbackAsset({ platform = process.platform, arch = process.arch, variant = 'default', env = process.env } = {}) {
  const name = candidateNames({ platform, arch, variant })[0]
  if (!name) return null
  return { name, size: 0, url: `${releaseBase(env)}/${name}`, sha256: null, kind: 'zip', source: 'fallback' }
}

/**
 * Read the release's asset list.
 *
 * A failure is not fatal: the caller falls back to a composed URL and says so on
 * the page, because a checksum-less download that works beats a correct refusal
 * when the only thing wrong is a rate-limited API.
 */
export async function fetchRelease({ platform = process.platform, arch = process.arch, variant = 'default', env = process.env, fetchImpl = fetch, timeout = 8000 } = {}) {
  const url = releaseApi(env)
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'jarvis-setup' },
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const assets = (data.assets ?? []).map((asset) => ({
      name: String(asset.name ?? ''),
      size: Number(asset.size ?? 0),
      url: String(asset.browser_download_url ?? ''),
      sha256: /^sha256:/i.test(String(asset.digest ?? '')) ? String(asset.digest).slice(7) : null,
    }))
    const picked = pickAsset(assets, { platform, arch, variant })
    if (!picked) {
      return { ok: false, error: `no Windows/${arch}${variant === 'rocm' ? ' ROCm' : ''} archive in release ${data.tag_name ?? 'latest'}`, assets, variant, platform, arch }
    }
    return { ok: true, tag: String(data.tag_name ?? ''), asset: { ...picked, source: 'api' }, assets, variant, platform, arch }
  } catch (error) {
    const asset = fallbackAsset({ platform, arch, variant, env })
    return {
      ok: false,
      error: `${url}: ${error?.message ?? error}`,
      asset,
      assets: asset ? [asset] : [],
      variant,
      platform,
      arch,
    }
  }
}

/** The variants worth offering on this machine. */
export async function resolveVariants({ platform = process.platform, arch = process.arch, env = process.env, fetchImpl = fetch } = {}) {
  const variants = []
  if (!platformSupported(platform, arch)) return { variants, source: 'unsupported' }
  for (const id of ['default', 'rocm']) {
    // The ROCm build is x64 only; ARM Windows has one archive.
    if (id === 'rocm' && arch !== 'x64') continue
    const resolved = await fetchRelease({ platform, arch, variant: id, env, fetchImpl })
    if (resolved.asset) {
      variants.push({
        id,
        label: id === 'rocm' ? 'AMD GPU (ROCm build)' : 'Default build · NVIDIA CUDA + CPU',
        name: resolved.asset.name,
        sizeBytes: resolved.asset.size || 0,
        url: resolved.asset.url,
        sha256: resolved.asset.sha256 ?? null,
        kind: 'zip',
        verified: Boolean(resolved.asset.sha256),
        source: resolved.asset.source ?? 'fallback',
      })
    }
  }
  if (!variants.length) {
    // Nothing to offer at all: not a fallback URL, just a host that cannot use
    // any of these archives. The page says so rather than showing a download
    // button that would produce a file nothing here can run.
    return { variants, source: 'unsupported' }
  }
  return { variants, source: variants.some((variant) => variant.source === 'api') ? 'api' : 'fallback' }
}

/** Is an AMD ROCm stack present? Only then is the ROCm build suggested. */
export function rocmSuggested({ env = process.env } = {}) {
  const names = ['rocm-smi.exe', 'rocminfo.exe']
  const dirs = String(env.PATH ?? '').split(';').filter(Boolean)
  return dirs.some((dir) => names.some((name) => existsSync(join(dir, name))))
}

/** What would be downloaded, and where it goes. Synchronous view, for status endpoints. */
export function runtimePlan({ platform = process.platform, arch = process.arch, variant = 'default', env = process.env } = {}) {
  const dir = runtimeDir(env)
  const name = candidateNames({ platform, arch, variant })[0]
  if (!name || !platformSupported(platform, arch)) {
    return { supported: false, platform, arch, variant, dir, asset: null, kind: null, bin: null, path: null, url: null }
  }
  return {
    supported: true,
    platform,
    arch,
    variant,
    dir,
    asset: name,
    kind: 'zip',
    bin: 'ollama.exe',
    path: join(dir, 'ollama.exe'),
    url: `${releaseBase(env)}/${name}`,
  }
}

/** Is the runtime already unpacked here? */
export function runtimePresent(plan) {
  return Boolean(plan?.path) && existsSync(plan.path)
}

/** A human answer for "is the runtime ready", without starting anything. */
export function runtimeStatus({ platform = process.platform, arch = process.arch, variant = 'default', env = process.env } = {}) {
  const plan = runtimePlan({ platform, arch, variant, env })
  return {
    supported: plan.supported,
    present: runtimePresent(plan),
    path: plan.path,
    bin: plan.bin,
    asset: plan.asset,
    kind: plan.kind,
    url: plan.url,
    dir: plan.dir,
    variant,
  }
}

/**
 * First binary that can serve: the one this project downloaded, else whatever
 * `ollama.exe` the machine already has on PATH. JARVIS's own copy wins, so a
 * one-click install is not silently shadowed by a half-broken PATH entry.
 */
export function findRuntimeBinary(plan, env = process.env) {
  if (runtimePresent(plan)) return plan.path
  const dirs = String(env.PATH ?? '').split(';').filter(Boolean)
  for (const dir of dirs) {
    for (const name of ['ollama.exe', 'ollama']) {
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

/* ------------------------------------------------------------------ checking */

export function sha256File(path, { onProgress } = {}) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    let done = 0
    const stream = createReadStream(path, { highWaterMark: 1 << 20 })
    stream.on('data', (chunk) => {
      hash.update(chunk)
      done += chunk.length
      onProgress?.(done)
    })
    stream.once('error', reject)
    stream.once('end', () => resolvePromise(hash.digest('hex')))
  })
}

/** Fetch `sha256sum.txt` for the release and return the digest for one asset. */
async function fetchChecksum(name, { env, fetchImpl }) {
  const url = `${releaseBase(env)}/sha256sum.txt`
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return null
    const text = await response.text()
    for (const line of text.split('\n')) {
      const [digest, file] = line.trim().split(/\s+/)
      if (file && basename(file) === name && /^[0-9a-f]{64}$/i.test(digest ?? '')) return digest.toLowerCase()
    }
    return null
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------- unpacking */

/**
 * A path from the archive, made safe: no absolute paths, no drive letters, no
 * walking out of the target folder.
 *
 * An entry that *tries* to leave is refused rather than quietly rewritten down
 * into the folder: the archive is then reported as carrying a hostile entry,
 * which is something the person installing deserves to be told, and the caller
 * skips it instead of writing it.
 */
export function safeEntryPath(dir, rawName) {
  const raw = String(rawName ?? '')
  if (isAbsolute(raw)) return null
  if (/^[A-Za-z]:/.test(raw)) return null
  const name = raw.replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!name || name === '.') return null
  const cleaned = normalize(name)
  if (cleaned === '..' || cleaned.startsWith('../')) return null
  const target = resolve(dir, cleaned)
  const root = resolve(dir)
  if (target !== root && !target.startsWith(root + sep)) return null
  return target
}

let crcTable = null
/** Standard CRC-32, for checking each zip entry against its header. */
export function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256).map((_, index) => {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      return value
    })
  }
  let crc = -1
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return ((crc ^ -1) >>> 0) >>> 0
}

/**
 * Unpack a zip with streaming inflate, in Node.
 *
 * Windows has no `unzip`, so shelling out was never available. Entries are read
 * from the central directory, inflated one at a time, and checked against their
 * stored CRC — a truncated download is caught here rather than at first run.
 */
export async function extractArchive({ archive, dir, onFile = () => {} } = {}) {
  if (!archive || !existsSync(archive)) return { ok: false, error: `no archive at ${archive}` }
  mkdirSync(dir, { recursive: true })
  const fd = openSync(archive, 'r')
  try {
    const size = statSync(archive).size
    const tailLength = Math.min(size, 66_000)
    const tail = Buffer.alloc(tailLength)
    readSync(fd, tail, 0, tailLength, size - tailLength)
    let eocd = -1
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) {
        eocd = index
        break
      }
    }
    if (eocd === -1) return { ok: false, error: 'not a zip archive (no end-of-central-directory record)' }
    const entries = tail.readUInt16LE(eocd + 10)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cd = Buffer.alloc(cdSize)
    readSync(fd, cd, 0, cdSize, cdOffset)

    let at = 0
    for (let index = 0; index < entries && at + 46 <= cd.length; index += 1) {
      if (cd.readUInt32LE(at) !== 0x02014b50) break
      const method = cd.readUInt16LE(at + 10)
      const crc = cd.readUInt32LE(at + 16)
      const compressedSize = cd.readUInt32LE(at + 20)
      const uncompressed = cd.readUInt32LE(at + 24)
      const nameLength = cd.readUInt16LE(at + 28)
      const extraLength = cd.readUInt16LE(at + 30)
      const commentLength = cd.readUInt16LE(at + 32)
      const external = cd.readUInt32LE(at + 38)
      const localOffset = cd.readUInt32LE(at + 42)
      const name = cd.subarray(at + 46, at + 46 + nameLength).toString('utf8')
      at += 46 + nameLength + extraLength + commentLength

      const target = safeEntryPath(dir, name)
      const isDir = name.endsWith('/')
      if (isDir || uncompressed === 0) {
        if (target && isDir) mkdirSync(target, { recursive: true })
        if (target && !isDir) {
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, Buffer.alloc(0))
        }
        continue
      }
      if (!target) {
        onFile({ name, skipped: 'path outside the runtime folder' })
        continue
      }

      const localHeader = Buffer.alloc(30)
      readSync(fd, localHeader, 0, 30, localOffset)
      if (localHeader.readUInt32LE(0) !== 0x04034b50) return { ok: false, error: `corrupt zip: bad local header for ${name}` }
      const dataStart = localOffset + 30 + localHeader.readUInt16LE(26) + localHeader.readUInt16LE(28)

      mkdirSync(dirname(target), { recursive: true })
      const source = createReadStream(archive, { start: dataStart, end: dataStart + compressedSize - 1 })
      const sink = createWriteStream(target)
      if (method === 0) await pipeline(source, sink)
      else if (method === 8) await pipeline(source, createInflateRaw({ chunkSize: zlibConstants.Z_DEFAULT_CHUNK }), sink)
      else return { ok: false, error: `unsupported zip compression method ${method} for ${name}` }

      const written = readFileSync(target)
      if (written.length !== uncompressed) {
        return { ok: false, error: `${name} unpacked to ${written.length} bytes, expected ${uncompressed} — the download is incomplete` }
      }
      if (crc !== 0 && crc32(written) !== crc) {
        return { ok: false, error: `${name} failed its CRC check — the download is corrupt` }
      }

      const mode = (external >>> 16) & 0o777
      if (mode) {
        try {
          chmodSync(target, mode)
        } catch {
          /* Windows ignores mode bits; that is not a failure */
        }
      }
      onFile({ name, bytes: uncompressed })
    }
    return { ok: true }
  } finally {
    closeSync(fd)
  }
}

/* ---------------------------------------------------------------- downloading */

/**
 * Download the archive with resume and verification.
 *
 * A dropped connection leaves `<name>.part` behind, and the next press sends
 * `Range: bytes=<have>-` and continues where it stopped. The digest comes from
 * the release's own metadata; when there is none, the page is told
 * `verified: false` rather than being told nothing.
 */
export async function downloadArchive({ asset, dir, onStep = () => {}, fetchImpl = fetch, env = process.env, verify = true } = {}) {
  if (!asset?.url) return { ok: false, error: 'no archive to download' }
  mkdirSync(dir, { recursive: true })
  const target = join(dir, asset.name)
  const part = `${target}.part`
  const expected = Number(asset.size ?? 0)

  if (existsSync(target) && (!expected || statSync(target).size === expected)) {
    const digest = await verifyDigest(target, asset, { env, fetchImpl, verify, onStep })
    if (digest.ok) return { ok: true, skipped: true, path: target, bytes: statSync(target).size, verified: digest.verified }
    // A file that fails its own checksum is worse than none: fetch it again.
    rmSync(target, { force: true })
  }

  let have = existsSync(part) ? statSync(part).size : 0
  if (expected && have > expected) {
    rmSync(part, { force: true })
    have = 0
  }
  const headers = have ? { Range: `bytes=${have}-` } : {}
  onStep({ phase: 'runtime-download', status: `downloading ${asset.name}`, completed: have, total: expected, resumed: have > 0 })

  let response
  try {
    response = await fetchImpl(asset.url, { headers, redirect: 'follow' })
  } catch (error) {
    return { ok: false, error: `could not reach ${asset.url}: ${error?.message ?? error}`, resumable: true, have }
  }
  if (response.status === 416 && expected) {
    // The server says our partial file is the whole file.
    rmSync(part, { force: true })
    have = 0
    response = await fetchImpl(asset.url, { redirect: 'follow' })
  }
  if (!response.ok) return { ok: false, error: `HTTP ${response.status} from ${asset.url}` }
  const resumed = response.status === 206 && have > 0
  if (!resumed && have) {
    rmSync(part, { force: true })
    have = 0
  }
  const total = resumed && response.headers?.get?.('content-range')
    ? Number(String(response.headers.get('content-range')).split('/')[1]) || expected
    : Number(response.headers?.get?.('content-length') ?? expected) || expected

  let completed = have
  let lastReport = 0
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      completed += chunk.length
      const now = Date.now()
      if (now - lastReport > 400) {
        lastReport = now
        onStep({ phase: 'runtime-download', status: `downloading ${asset.name}`, completed, total, resumed })
      }
      callback(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(part, { flags: resumed ? 'a' : 'w' }))
  } catch (error) {
    return {
      ok: false,
      error: `${asset.name} stopped at ${(completed / 1048576).toFixed(1)} MB: ${error?.message ?? error} — press the button again to resume`,
      resumable: true,
      have: existsSync(part) ? statSync(part).size : completed,
    }
  }

  const bytes = statSync(part).size
  if (expected && bytes !== expected) {
    return { ok: false, error: `${asset.name} is ${bytes} bytes, expected ${expected} — press the button again to resume`, resumable: true, have: bytes }
  }

  const digest = await verifyDigest(part, asset, { env, fetchImpl, verify, onStep })
  if (!digest.ok) {
    rmSync(part, { force: true })
    return { ok: false, error: digest.error }
  }
  renameSync(part, target)
  onStep({ phase: 'runtime-unpack', status: `unpacking ${asset.name}`, completed: bytes, total: bytes })
  return { ok: true, path: target, bytes, verified: digest.verified }
}

async function verifyDigest(file, asset, { env, fetchImpl, verify, onStep }) {
  if (!verify) return { ok: true, verified: false }
  let want = asset.sha256 ?? null
  if (!want) want = await fetchChecksum(asset.name, { env, fetchImpl })
  if (!want) {
    onStep({ phase: 'runtime-download', status: `downloaded ${asset.name} (no published checksum to verify against)`, verified: false })
    return { ok: true, verified: false }
  }
  onStep({ phase: 'runtime-verify', status: `verifying ${asset.name}` })
  const got = await sha256File(file, { onProgress: (done) => onStep({ phase: 'runtime-verify', status: `verifying ${asset.name}`, completed: done }) })
  if (got !== want) {
    return { ok: false, error: `${asset.name} failed its SHA-256 check (expected ${want.slice(0, 12)}…, got ${got.slice(0, 12)}…) — the download was corrupted or tampered with, so it was deleted` }
  }
  onStep({ phase: 'runtime-verify', status: `${asset.name} verified`, verified: true })
  return { ok: true, verified: true }
}

/**
 * The whole one-click runtime story: use what is running, else start what is
 * installed, else download the standalone zip and start that.
 */
export async function ensureRuntime({
  platform = process.platform,
  arch = process.arch,
  variant = 'default',
  env = process.env,
  url = env.JARVIS_OLLAMA_URL ?? 'http://localhost:11434',
  modelsDir = runtimeModelsDir(env),
  onStep = () => {},
  fetchImpl = fetch,
  // 'auto' installs Ollama system-wide on Windows the way a person would — the
  // official installer, run silently, over the CLI — and falls back to the
  // standalone build. 'portable' keeps everything inside the project, which is
  // what CI wants: no admin, no system PATH, no version drift between runs.
  installMode = env.JARVIS_OLLAMA_INSTALL ?? 'auto',
} = {}) {
  // A server that already answers settles the question on every platform: there
  // is nothing to install, so a Linux or macOS machine running its own Ollama
  // must not be told "Windows only" for a runtime it does not need.
  if (await apiUp(url, { fetchImpl })) {
    onStep({ phase: 'runtime', status: `a model server already answers at ${url}; nothing to start`, ok: true, skipped: true })
    return { ok: true, skipped: true, url }
  }
  // ── Linux / macOS: Ollama's own installer, over the CLI ──
  // Before the portable build is even considered: these platforms have an
  // official script that needs no zip, no download page and no browser.
  if (platform === 'linux' || platform === 'darwin') {
    return ensureRuntimeUnix({ platform, arch, variant, env, url, modelsDir, onStep, fetchImpl })
  }
  if (!platformSupported(platform, arch)) {
    const error = `JARVIS cannot install the model runtime on ${platform}/${arch} by itself; run Ollama's own installer (Windows: irm ${OLLAMA_INSTALL_PS1} | iex; Linux and macOS: curl -fsSL ${OLLAMA_INSTALL_SH} | sh) and press re-check`
    onStep({ phase: 'runtime', status: error, ok: false })
    return { ok: false, error }
  }

  // ── Windows: the silent system install first, the standalone build after ──
  // The person installing JARVIS asked for Ollama to appear on their machine
  // without a browser and without a wizard; the fallback is what keeps this
  // working on a locked-down machine where an installer cannot run at all.
  if (platform === 'win32' && installMode !== 'portable') {
    const system = await installOllamaSystem({ onStep, env, fetchImpl })
    if (system.ok) {
      const started = await startRuntime({ bin: system.bin, url, modelsDir, onStep, env })
      if (!started.ok) onStep({ phase: 'runtime', status: started.error, ok: false })
      return { ...started, bin: system.bin, system: true, version: system.version }
    }
    onStep({
      phase: 'runtime',
      status: `the silent system installer did not take over (${system.error}); unpacking the standalone build instead`,
      ok: true,
    })
  }

  // ── Windows: the portable runtime flow ──
  const plan = runtimePlan({ platform, arch, variant, env })
  let bin = findRuntimeBinary(plan, env)
  if (!bin) {
    const release = await fetchRelease({ platform, arch, variant, env, fetchImpl })
    const asset = release.asset
    if (!asset?.url) {
      const error = release.error ?? 'could not work out which runtime archive to download'
      onStep({ phase: 'runtime', status: error, ok: false })
      return { ok: false, error }
    }
    if (!release.ok) {
      onStep({ phase: 'runtime', status: `${release.error} — falling back to the plain download URL`, ok: true })
    }
    const downloaded = await downloadArchive({ asset, dir: plan.dir, onStep, fetchImpl, env })
    if (!downloaded.ok) {
      onStep({ phase: 'runtime', status: downloaded.error, ok: false })
      return { ok: false, error: downloaded.error }
    }
    onStep({ phase: 'runtime-unpack', status: `unpacking ${asset.name} into ${plan.dir}` })
    const extracted = await extractArchive({ archive: downloaded.path, dir: plan.dir, onFile: () => {} })
    rmSync(downloaded.path, { force: true })
    if (!extracted.ok) {
      onStep({ phase: 'runtime', status: extracted.error, ok: false })
      return { ok: false, error: extracted.error }
    }
    if (!existsSync(plan.path)) {
      const error = 'the archive unpacked but ollama.exe is not there — the release layout may have changed'
      onStep({ phase: 'runtime', status: error, ok: false })
      return { ok: false, error }
    }
    onStep({ phase: 'runtime-ready', status: `runtime ready at ${plan.path}`, verified: downloaded.verified })
    bin = plan.path
  }

  const started = await startRuntime({ bin, url, modelsDir, onStep, env })
  if (!started.ok) onStep({ phase: 'runtime', status: started.error, ok: false })
  return { ...started, bin }
}

/**
 * Install Ollama the way Ollama says to: their own script, run over the CLI.
 *
 *   Windows            irm https://ollama.com/install.ps1 | iex
 *   Linux and macOS    curl -fsSL https://ollama.com/install.sh | sh
 *
 * Neither needs a browser and neither needs a person: the Windows script also
 * verifies that OllamaSetup.exe is signed by Ollama Inc. before it runs it
 * silently, so the checks we would have written ourselves come with it. When the
 * shell has no PowerShell or no curl, the same script is fetched over HTTPS by
 * Node and handed to the shell — the same file by a different road — and the
 * caller still has the standalone build to fall back on.
 */
export async function installOllamaCli({
  platform = process.platform,
  onStep = () => {},
  env = process.env,
  timeout = 30 * 60 * 1000,
  fetchImpl = fetch,
} = {}) {
  if (platform === 'win32') {
    const powershell = env.JARVIS_POWERSHELL || 'powershell.exe'
    onStep({ phase: 'runtime-install', status: `running the official installer (irm ${OLLAMA_INSTALL_PS1} | iex)` })
    const result = await runCommand(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `$ProgressPreference = 'SilentlyContinue'; irm ${OLLAMA_INSTALL_PS1} | iex`],
      { onStep, env, timeout },
    )
    return { ...result, method: result.ok ? 'install.ps1' : null }
  }

  onStep({ phase: 'runtime-install', status: `running the official installer (curl -fsSL ${OLLAMA_INSTALL_SH} | sh)` })
  const direct = await runCommand('sh', ['-c', `curl -fsSL ${OLLAMA_INSTALL_SH} | sh`], { onStep, env, timeout })
  if (direct.ok) return { ...direct, method: 'curl | sh' }

  onStep({ phase: 'runtime-install', status: `${direct.error ?? 'curl could not run'}; fetching the script with Node instead` })
  try {
    const response = await fetchImpl(OLLAMA_INSTALL_SH, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const script = await response.text()
    const file = join(tmpdir(), 'jarvis-ollama-install.sh')
    writeFileSync(file, script, { mode: 0o755 })
    const fetched = await runCommand('sh', [file], { onStep, env, timeout })
    try { unlinkSync(file) } catch { /* already gone */ }
    return { ...fetched, method: fetched.ok ? 'install.sh' : null }
  } catch (error) {
    return { ok: false, code: null, method: null, error: `could not run the official installer: ${error?.message ?? error}` }
  }
}

/** Run a command, stream its output as install steps, resolve with its exit code. */
function runCommand(command, argv, { onStep = () => {}, env = process.env, timeout = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'], env, windowsHide: true })
    } catch (error) {
      resolve({ ok: false, code: null, error: `${command} could not be started: ${error.message}` })
      return
    }
    const lines = []
    const push = (chunk) => {
      for (const raw of String(chunk).split(/\r?\n/)) {
        const text = raw.trim()
        if (!text) continue
        lines.push(text)
        onStep({ phase: 'runtime-install', status: text.slice(0, 200) })
      }
    }
    child.stdout?.on('data', push)
    child.stderr?.on('data', push)
    const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ } }, timeout)
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, code: null, error: `${command} failed: ${error.message}` })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      const last = lines.at(-1)
      resolve({
        ok: code === 0,
        code,
        error: code === 0 ? null : `${command} exited with code ${code}${last ? `: ${last}` : ''}`,
      })
    })
  })
}

/**
 * Windows: the official script first, the installer file second.
 *
 * The one-liner above is what a person would type, and it verifies the
 * installer's signature before it runs it. This is the fallback for a machine
 * where PowerShell itself is locked down: the same OllamaSetup.exe, fetched over
 * HTTPS by the app and run with Inno Setup's `/VERYSILENT`, per-user, no
 * administrator, no wizard. The installer's own exit code is the answer, and if
 * it says no the caller falls back to the standalone build rather than leaving
 * the person with nothing.
 */
async function installOllamaSystem({ onStep = () => {}, env = process.env, fetchImpl = fetch } = {}) {
  const script = await installOllamaCli({ platform: 'win32', onStep, env, fetchImpl })
  if (script.ok) {
    const bin = findInstalledOllama(env)
    if (bin) {
      onStep({ phase: 'runtime-ready', status: `Ollama installed at ${bin} (official install.ps1)`, ok: true })
      return { ok: true, bin, version: null, mode: 'system', method: 'install.ps1' }
    }
    onStep({ phase: 'runtime', status: 'the official script finished but no ollama.exe was found; fetching the installer directly' })
  } else {
    onStep({
      phase: 'runtime',
      status: `the official install.ps1 route did not work (${script.error}); downloading ${OLLAMA_SETUP_URL} and running it silently instead`,
    })
  }

  const dir = join(tmpdir(), 'jarvis-ollama-setup')
  const setup = join(dir, 'OllamaSetup.exe')
  try {
    await mkdir(dir, { recursive: true })
    onStep({ phase: 'runtime-download', status: `downloading ${OLLAMA_SETUP_URL} over HTTPS` })
    const response = await fetchImpl(OLLAMA_SETUP_URL, { signal: AbortSignal.timeout(600_000), redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    await pipeline(response.body, createWriteStream(setup))
    const bytes = statSync(setup).size
    // A captive portal or a proxy error page is not an installer, and running
    // one would be worse than failing: a size floor is the cheapest guard.
    if (bytes < 20 * 1024 * 1024) throw new Error(`the downloaded installer is only ${bytes} bytes; that is not an installer`)
    onStep({ phase: 'runtime-install', status: `running OllamaSetup.exe /VERYSILENT (${(bytes / MB).toFixed(0)} MB, per-user, no administrator)` })

    const code = await new Promise((resolve, reject) => {
      const child = spawn(setup, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout?.on('data', (chunk) => onStep({ phase: 'runtime-install', status: String(chunk).trim() }))
      child.stderr?.on('data', (chunk) => onStep({ phase: 'runtime-install', status: String(chunk).trim() }))
      child.once('error', reject)
      child.once('close', resolve)
    })
    if (code !== 0) throw new Error(`OllamaSetup.exe exited with code ${code}`)

    const bin = findInstalledOllama(env)
    if (!bin) throw new Error('the installer finished but no ollama.exe was found in the usual places')
    onStep({ phase: 'runtime-ready', status: `Ollama installed at ${bin}`, ok: true })
    return { ok: true, bin, version: null, mode: 'system' }
  } catch (error) {
    const message = String(error?.message ?? error)
    onStep({ phase: 'runtime', status: `silent install failed: ${message}`, ok: false })
    return { ok: false, error: message }
  }
}

/** Where the installer puts `ollama.exe`, in the order it is worth looking. */
function findInstalledOllama(env = process.env) {
  const candidates = [
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') : null,
    env.ProgramFiles ? join(env.ProgramFiles, 'Ollama', 'ollama.exe') : null,
    env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'Ollama', 'ollama.exe') : null,
    join(homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Linux / macOS runtime installation.
 *
 * Tries, in order:
 *   1. The official Ollama install script (curl | sh equivalent)
 *   2. Direct tarball download and extraction
 *   3. Starting an already-installed ollama binary
 */
async function ensureRuntimeUnix({ platform, arch, variant, env, url, modelsDir, onStep, fetchImpl }) {
  onStep({ phase: 'runtime', status: `installing Ollama on ${platform}/${arch}` })

  // Check if ollama binary already exists on PATH
  const existingBin = findUnixBinary()
  if (existingBin) {
    onStep({ phase: 'runtime', status: `Ollama binary found at ${existingBin}`, ok: true })
    const started = await startRuntime({ bin: existingBin, url, modelsDir, onStep, env })
    return { ...started, bin: existingBin }
  }

  // Method 1: the official CLI installer, exactly as Ollama documents it
  onStep({ phase: 'runtime-download', status: 'running the official Ollama installer over the CLI' })
  const scriptResult = await installOllamaCli({ platform, onStep, env, fetchImpl })
  if (scriptResult.ok) {
    const bin = findUnixBinary()
    if (bin) {
      onStep({ phase: 'runtime-ready', status: `Ollama installed at ${bin}` })
      const started = await startRuntime({ bin, url, modelsDir, onStep, env })
      return { ...started, bin }
    }
  }

  // Method 2: Direct binary tarball
  onStep({ phase: 'runtime-download', status: 'install script failed; trying direct binary download' })
  const binResult = await installUnixViaTarball({ platform, arch, variant, onStep, fetchImpl, env })
  if (binResult.ok && binResult.bin) {
    onStep({ phase: 'runtime-ready', status: `Ollama installed at ${binResult.bin}` })
    const started = await startRuntime({ bin: binResult.bin, url, modelsDir, onStep, env })
    return { ...started, bin: binResult.bin }
  }

  const error = `Could not install Ollama automatically. Install it manually: curl -fsSL ${OLLAMA_INSTALL_SH} | sh`
  onStep({ phase: 'runtime', status: error, ok: false })
  return { ok: false, error }
}

function findUnixBinary() {
  const candidates = ['/usr/local/bin/ollama', '/usr/bin/ollama']
  const home = homedir()
  if (home) candidates.push(join(home, '.local/bin/ollama'))

  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  // Try `which`
  try {
    const which = execSync('which ollama', { encoding: 'utf8', timeout: 5000 }).trim()
    if (which && existsSync(which)) return which
  } catch { /* not found */ }

  return null
}

async function installUnixViaTarball({ platform, arch, variant, onStep, fetchImpl, env }) {
  const bits = arch === 'arm64' ? 'arm64' : 'amd64'
  const url = platform === 'darwin'
    ? `https://ollama.com/download/ollama-darwin-${bits}.tgz`
    : `https://ollama.com/download/ollama-linux-${bits}.tgz`

  const tmpTgz = '/tmp/ollama-runtime.tgz'
  const tmpDir = '/tmp/ollama-runtime-extract'

  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10 * 60 * 1000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const total = Number(response.headers?.get?.('content-length') ?? 0)
    let completed = 0
    let lastReport = 0

    const counter = new Transform({
      transform(chunk, _enc, cb) {
        completed += chunk.length
        const now = Date.now()
        if (now - lastReport > 1500) {
          lastReport = now
          onStep({ phase: 'runtime-download', status: `downloading Ollama binary`, completed, total })
        }
        cb(null, chunk)
      },
    })

    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(tmpTgz))
  } catch (err) {
    return { ok: false, error: `download failed: ${err.message}` }
  }

  // Extract
  onStep({ phase: 'runtime-unpack', status: 'extracting the Ollama binary' })
  try {
    rmSync(tmpDir, { force: true, recursive: true })
    mkdirSync(tmpDir, { recursive: true })
    execSync(`tar xzf ${tmpTgz} -C ${tmpDir}`, { timeout: 60_000 })
  } catch (err) {
    return { ok: false, error: `extraction failed: ${err.message}` }
  }

  const binCandidates = [join(tmpDir, 'bin/ollama'), join(tmpDir, 'ollama')]
  const binPath = binCandidates.find((p) => existsSync(p))
  if (!binPath) return { ok: false, error: 'ollama binary not found in the archive' }

  // Install to /usr/local/bin
  const target = '/usr/local/bin/ollama'
  try {
    execSync(`sudo mkdir -p /usr/local/bin && sudo cp ${binPath} ${target} && sudo chmod 755 ${target}`, { timeout: 15_000 })
  } catch {
    // Fallback: ~/.local/bin
    const homeTarget = join(homedir(), '.local/bin/ollama')
    mkdirSync(join(homedir(), '.local/bin'), { recursive: true })
    copyFileSync(binPath, homeTarget)
    chmodSync(homeTarget, 0o755)
    rmSync(tmpTgz, { force: true })
    rmSync(tmpDir, { force: true, recursive: true })
    return { ok: true, bin: homeTarget }
  }

  rmSync(tmpTgz, { force: true })
  rmSync(tmpDir, { force: true, recursive: true })
  return { ok: true, bin: target }
}

/* ------------------------------------------------------------------- running */

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
 * The child is JARVIS's own: it dies with this process rather than outliving it,
 * because a model server still holding port 11434 after the window was closed is
 * exactly the kind of leftover that makes people distrust an installer.
 */
export async function startRuntime({ bin, url = 'http://localhost:11434', modelsDir = runtimeModelsDir(), onStep = () => {}, env = process.env, timeout = 60_000 } = {}) {
  const listen = url.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const child = spawn(bin, ['serve'], {
    env: { ...env, OLLAMA_HOST: listen, OLLAMA_MODELS: modelsDir },
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

  process.once('exit', () => { try { child.kill() } catch { /* already gone */ } })
  if (!signalsHooked) {
    signalsHooked = true
    const relay = (code) => {
      try { served?.kill() } catch { /* already gone */ }
      process.exit(code)
    }
    process.once('SIGINT', () => relay(130))
    process.once('SIGTERM', () => relay(143))
  }

  const deadline = Date.now() + timeout
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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 700))
  }
  try { child.kill() } catch { /* already gone */ }
  return {
    ok: false,
    error: error
      ? `could not start ${bin}: ${error.message}`
      : exitCode !== null
        ? `${bin} serve exited with code ${exitCode}`
        : `${bin} did not answer on ${url} within ${Math.round(timeout / 1000)} s`,
  }
}

/** Stop the runtime this process started. */
export function stopRuntime() {
  if (!served || served.exitCode !== null || served.signalCode !== null) return false
  try {
    served.kill()
  } catch {
    return false
  }
  return true
}
