/**
 * The model runtime JARVIS fetches for itself — the whole of it.
 *
 * Ollama publishes standalone archives next to its installers, and a page can
 * download and unpack an archive where it cannot run an installer. That is the
 * difference between a one-click install and a two-step one, so this module does
 * the entire job: find the right archive for this machine, download it (with
 * resume and checksum verification), unpack it inside the project, start it, and
 * die with the parent process.
 *
 * Nothing here is installed system-wide, nothing is added to PATH, and no
 * administrator prompt is ever raised. Deleting `models/runtime/` removes it
 * completely.
 *
 * Two things about the releases this has to survive:
 *
 *   1. Asset names move. Linux archives were `.tgz` and are now `.tar.zst`;
 *      the names carry architecture and an optional `-rocm` marker for AMD.
 *      So the asset is *resolved* against the release's own asset list rather
 *      than hardcoded, with a name-preference fallback for when the API cannot
 *      be reached.
 *   2. The archives are large (1.3 GiB for Linux x64) and the machines running
 *      this are small. So downloads resume from a partial `.part` file, are
 *      verified against the release's own SHA-256 (the API's `digest`, or
 *      `sha256sum.txt`), and are unpacked with streaming decompression in
 *      Node itself — no `unzip`, no `tar`, nothing to install first.
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
  readSync,
  closeSync,
  rmSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import zlib, { createGunzip, createInflateRaw, constants as zlibConstants } from 'node:zlib'
import process from 'node:process'

/** The release this installs from. Overridable so tests and mirrors do not need the internet. */
export const DEFAULT_RELEASE_API = 'https://api.github.com/repos/ollama/ollama/releases/latest'
export const DEFAULT_RELEASE_BASE = 'https://github.com/ollama/ollama/releases/latest/download'

export function releaseApi(env = process.env) {
  return String(env.JARVIS_RUNTIME_API ?? DEFAULT_RELEASE_API)
}

export function releaseBase(env = process.env) {
  return String(env.JARVIS_RUNTIME_BASE ?? DEFAULT_RELEASE_BASE).replace(/\/+$/, '')
}

/** The folder the runtime is unpacked into. Inside the project, so it is one thing to delete. */
export function runtimeDir(env = process.env) {
  return resolve(env.JARVIS_RUNTIME_DIR ?? join('models', 'runtime'))
}

/** Where the models the runtime serves are kept. */
export function runtimeModelsDir(env = process.env) {
  return resolve(env.JARVIS_RUNTIME_MODELS ?? join('models', 'ollama'))
}

const SUPPORTED = Object.freeze({ linux: ['x64', 'arm64'], darwin: ['x64', 'arm64'], win32: ['x64', 'arm64'] })

export function platformSupported(platform = process.platform, arch = process.arch) {
  return Boolean(SUPPORTED[platform]?.includes(arch))
}

/**
 * Archive names to look for, best first.
 *
 * This list is the fallback when the release API cannot be reached, and the
 * order the API result is ranked by when it can: the newest naming convention
 * first, the older one behind it, and the AMD build only when it was asked for.
 */
export function candidateNames({ platform = process.platform, arch = process.arch, variant = 'default' } = {}) {
  const bits = platform === 'win32' ? (arch === 'arm64' ? 'arm64' : 'amd64') : arch
  if (platform === 'darwin') return ['ollama-darwin.tgz']
  if (platform === 'win32') {
    if (bits === 'arm64') return ['ollama-windows-arm64.zip', 'ollama-windows-arm64.tar.zst']
    return variant === 'rocm'
      ? ['ollama-windows-amd64-rocm.zip', 'ollama-windows-amd64-rocm.tgz']
      : ['ollama-windows-amd64.zip', 'ollama-windows-amd64.tgz']
  }
  if (platform === 'linux') {
    const archName = bits === 'arm64' ? 'arm64' : 'amd64'
    if (variant === 'rocm' && archName === 'amd64') {
      return ['ollama-linux-amd64-rocm.tar.zst', 'ollama-linux-amd64-rocm.tgz']
    }
    return [`ollama-linux-${archName}.tar.zst`, `ollama-linux-${archName}.tgz`, `ollama-linux-${archName}.tar.gz`]
  }
  return []
}

/** Which unpacker an archive name needs. */
export function archiveKind(name) {
  if (/\.zip$/i.test(name)) return 'zip'
  if (/\.tar\.zst$|\.tzst$/i.test(name)) return 'tar.zst'
  if (/\.tar\.gz$|\.tgz$/i.test(name)) return 'tar.gz'
  if (/\.tar$/i.test(name)) return 'tar'
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

/** The fallback when the API cannot be reached: names composed from the base URL. */
export function fallbackAsset({ platform = process.platform, arch = process.arch, variant = 'default', env = process.env } = {}) {
  const name = candidateNames({ platform, arch, variant })[0]
  if (!name) return null
  return { name, size: 0, url: `${releaseBase(env)}/${name}`, sha256: null, kind: archiveKind(name), source: 'fallback' }
}

/**
 * Read the release's asset list.
 *
 * Failures are not fatal: the caller falls back to a composed URL and says so
 * on the page, because a checksum-less download that works beats a correct
 * refusal when the only thing wrong is a rate-limited API.
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
      // GitHub reports the digest on newer releases; older ones ship sha256sum.txt.
      sha256: /^sha256:/i.test(String(asset.digest ?? '')) ? String(asset.digest).slice(7) : null,
    }))
    const picked = pickAsset(assets, { platform, arch, variant })
    if (!picked) return { ok: false, error: `no ${platform}/${arch}${variant === 'rocm' ? ' ROCm' : ''} archive in release ${data.tag_name ?? 'latest'}`, assets, variant, platform, arch }
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

/** Every variant that is worth offering on this machine, cheapest first. */
export async function resolveVariants({ platform = process.platform, arch = process.arch, env = process.env, fetchImpl = fetch } = {}) {
  const variants = []
  for (const id of ['default', 'rocm']) {
    if (id === 'rocm' && !((platform === 'linux' || platform === 'win32') && arch === 'x64')) continue
    const resolved = await fetchRelease({ platform, arch, variant: id, env, fetchImpl })
    if (resolved.asset) {
      variants.push({
        id,
        label: id === 'rocm' ? 'AMD GPU (ROCm build)' : 'Default build · NVIDIA CUDA + CPU',
        name: resolved.asset.name,
        sizeBytes: resolved.asset.size || 0,
        url: resolved.asset.url,
        sha256: resolved.asset.sha256 ?? null,
        kind: resolved.asset.kind ?? archiveKind(resolved.asset.name),
        verified: Boolean(resolved.asset.sha256),
        source: resolved.asset.source ?? 'fallback',
      })
    }
  }
  return { variants, tag: null, source: variants.some((v) => v.source === 'api') ? 'api' : 'fallback' }
}

/** Is an AMD ROCm stack already present? Only then is the ROCm build suggested. */
export function rocmSuggested({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'linux' && existsSync('/opt/rocm')) return true
  const names = platform === 'win32' ? ['rocm-smi.exe', 'rocminfo.exe'] : ['rocm-smi', 'rocminfo']
  const dirs = String(env.PATH ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
  return dirs.some((dir) => names.some((name) => existsSync(join(dir, name))))
}

/** What would be downloaded, and where it goes. Synchronous view, for status endpoints. */
export function runtimePlan({ platform = process.platform, arch = process.arch, variant = 'default', env = process.env } = {}) {
  const dir = runtimeDir(env)
  const name = candidateNames({ platform, arch, variant })[0]
  const bin = platform === 'win32' ? 'ollama.exe' : platform === 'darwin' ? 'ollama' : join('bin', 'ollama')
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
    kind: archiveKind(name),
    bin,
    path: join(dir, bin),
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

/* ----------------------------------------------------------------- unpacking */

const BLOCK = 512

/** Read exactly `n` bytes from an async iterator, or fewer at EOF. */
class ByteReader {
  constructor(iterator) {
    this.iterator = iterator
    this.buffer = Buffer.alloc(0)
    this.done = false
  }

  async pull(n) {
    while (!this.done && this.buffer.length < n) {
      const next = await this.iterator.next()
      if (next.done) {
        this.done = true
        break
      }
      const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value)
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    }
    const take = Math.min(n, this.buffer.length)
    const out = this.buffer.subarray(0, take)
    this.buffer = this.buffer.subarray(take)
    return { bytes: out, short: take < n }
  }

  async skip(n) {
    let left = n
    while (left > 0) {
      const { bytes } = await this.pull(Math.min(left, 1 << 20))
      if (!bytes.length) return
      left -= bytes.length
    }
  }
}

/** A path from the archive, made safe: no absolute paths, no walking out of the target. */
export function safeEntryPath(dir, rawName) {
  const name = String(rawName ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^[A-Za-z]:/, '')
  const cleaned = normalize(name).replace(/^(\.\.[/\\])+/, '')
  const target = resolve(dir, cleaned)
  const root = resolve(dir)
  if (target !== root && !target.startsWith(root + sep)) return null
  if (isAbsolute(rawName ?? '')) return null
  return target
}

function parseTarNumber(buffer) {
  // Base-256 encoding for sizes too large for the octal field (legal, and used
  // by some tools for very big entries).
  if (buffer[0] & 0x80) {
    let value = 0
    for (let index = 1; index < buffer.length; index += 1) value = value * 256 + buffer[index]
    return value
  }
  const text = buffer.toString('utf8').replace(/\0.*$/, '').trim()
  if (!text) return 0
  return Number.parseInt(text, 8) || 0
}

function tarEntryName(header) {
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
  return prefix ? `${prefix}/${name}` : name
}

/**
 * Unpack a tar stream. Handles the three things an Ollama archive contains —
 * directories, files, and the odd symlink — and streams file data instead of
 * buffering it, because the binary inside is a gigabyte.
 */
async function extractTarStream(source, dir, { onFile = () => {} } = {}) {
  const reader = new ByteReader(source[Symbol.asyncIterator]())
  let longName = null
  for (;;) {
    const { bytes: header, short } = await reader.pull(BLOCK)
    if (short || header.length < BLOCK) break
    if (header.every((byte) => byte === 0)) break

    const type = String.fromCharCode(header[156] || 0x30)
    const size = parseTarNumber(header.subarray(124, 136))
    const rawName = longName ?? tarEntryName(header)
    longName = null

    // GNU long names ('L') and pax headers ('x'/'g') carry the real name or
    // metadata in the following data block; the path itself is what we need.
    if (type === 'L') {
      const { bytes } = await reader.pull(size)
      longName = bytes.toString('utf8').replace(/\0.*$/, '')
      await reader.skip((BLOCK - (size % BLOCK)) % BLOCK)
      continue
    }
    if (type === 'x' || type === 'g') {
      const { bytes } = await reader.pull(size)
      const record = bytes.toString('utf8')
      const match = /(?:^|\n)\d+ path=([^\n]+)\n/.exec(record)
      if (match) longName = match[1]
      await reader.skip((BLOCK - (size % BLOCK)) % BLOCK)
      continue
    }

    const target = safeEntryPath(dir, rawName)
    if (type === '5' || rawName.endsWith('/')) {
      if (target) mkdirSync(target, { recursive: true })
      await reader.skip(size + ((BLOCK - (size % BLOCK)) % BLOCK))
      continue
    }
    if (!target) {
      onFile({ name: rawName, skipped: 'path outside the runtime folder' })
      await reader.skip(size + ((BLOCK - (size % BLOCK)) % BLOCK))
      continue
    }

    if (type === '2' || type === '1') {
      const { bytes } = await reader.pull(size)
      const linkName = bytes.toString('utf8').replace(/\0.*$/, '')
      await reader.skip((BLOCK - (size % BLOCK)) % BLOCK)
      mkdirSync(dirname(target), { recursive: true })
      if (type === '2') {
        if (linkName && !isAbsolute(linkName) && process.platform !== 'win32') {
          try {
            rmSync(target, { force: true })
            symlinkSync(linkName, target)
            onFile({ name: rawName, symlink: linkName })
          } catch {
            onFile({ name: rawName, skipped: 'symlink could not be created' })
          }
        } else {
          onFile({ name: rawName, skipped: 'symlink is not usable here' })
        }
      } else {
        // Hard link: the archive already wrote the target, or will; copy if it exists.
        const source = safeEntryPath(dir, linkName)
        if (source && existsSync(source)) {
          copyFileSync(source, target)
          onFile({ name: rawName, hardlink: linkName })
        } else {
          onFile({ name: rawName, skipped: 'hard link target not written yet' })
        }
      }
      continue
    }

    if (type !== '0' && type !== '\0' && type !== '') {
      onFile({ name: rawName, skipped: `unsupported tar entry type ${type}` })
      await reader.skip(size + ((BLOCK - (size % BLOCK)) % BLOCK))
      continue
    }

    mkdirSync(dirname(target), { recursive: true })
    const out = createWriteStream(target)
    let written = 0
    while (written < size) {
      const want = Math.min(size - written, 1 << 20)
      const { bytes } = await reader.pull(want)
      if (!bytes.length) break
      written += bytes.length
      if (!out.write(bytes)) await new Promise((r) => out.once('drain', r))
    }
    await new Promise((resolvePromise, reject) => out.end((error) => (error ? reject(error) : resolvePromise())))
    await reader.skip((BLOCK - (size % BLOCK)) % BLOCK)
    onFile({ name: rawName, bytes: size })
  }
  return { ok: true }
}

/** Unpack a zip with streaming inflate. Windows ships no `unzip`, so this cannot shell out. */
async function extractZip(archive, dir, { onFile = () => {} } = {}) {
  const fd = openSync(archive, 'r')
  try {
    const size = statSync(archive).size
    const tailLength = Math.min(size, 66_000)
    const tail = Buffer.alloc(tailLength)
    readSync(fd, tail, 0, tailLength, size - tailLength)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i
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
      const signature = cd.readUInt32LE(at)
      if (signature !== 0x02014b50) break
      const method = cd.readUInt16LE(at + 10)
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

      // Local header: 30 bytes plus its own name/extra lengths, then the data.
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

      const mode = (external >>> 16) & 0o777
      if (process.platform !== 'win32' && mode) {
        try {
          chmodSync(target, mode)
        } catch {
          /* a filesystem without modes is not a failure */
        }
      }
      onFile({ name, bytes: uncompressed })
    }
    return { ok: true }
  } finally {
    closeSync(fd)
  }
}

/**
 * Unpack an archive into `dir`, in Node, with streaming decompression.
 *
 * zstd needs Node 22.15+ (`zlib.createZstdDecompress`). Where it is missing the
 * system's own `tar --zstd` is tried, and if that is missing too the failure says
 * exactly what to do instead of leaving a half-unpacked folder.
 */
export async function extractArchive({ archive, kind = archiveKind(archive), dir, onFile = () => {} } = {}) {
  mkdirSync(dir, { recursive: true })
  if (kind === 'zip') return extractZip(archive, dir, { onFile })

  if (kind === 'tar.zst') {
    const zstd = zlibStream('zstd')
    if (!zstd) {
      const system = spawnSync('tar', ['--zstd', '-xf', archive, '-C', dir], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      if (!system.error && system.status === 0) return { ok: true, viaSystemTar: true }
      return {
        ok: false,
        error: 'this Node build has no zstd support (needs 22.15+) and no system tar with --zstd was found; install Ollama from its official installer and press re-check',
      }
    }
    const source = createReadStream(archive).pipe(zstd)
    return extractTarStream(source, dir, { onFile })
  }
  if (kind === 'tar.gz') return extractTarStream(createReadStream(archive).pipe(createGunzip()), dir, { onFile })
  if (kind === 'tar') return extractTarStream(createReadStream(archive), dir, { onFile })
  return { ok: false, error: `unknown archive kind for ${basename(archive)}` }
}

/**
 * zstd is only in Node 22.15+. Checking the property instead of importing the
 * name keeps an older Node working: a missing named export of a builtin is a
 * link-time error, not a runtime one.
 */
function zlibStream(name) {
  if (name !== 'zstd') return null
  return typeof zlib.createZstdDecompress === 'function' ? zlib.createZstdDecompress() : null
}

/* ---------------------------------------------------------------- downloading */

/**
 * Download one archive with resume and verification.
 *
 * A dropped connection leaves `<name>.part` behind, and the next press sends
 * `Range: bytes=<have>-` and continues where it stopped — on a 1.3 GiB download
 * over a phone tether, that is the difference between one click and five. The
 * digest comes from the release's own metadata; when there is none, the page is
 * told `verified: false` rather than being told nothing.
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
 * installed, else download the standalone build and start that.
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
} = {}) {
  if (!platformSupported(platform, arch)) {
    const error = `no standalone Ollama build exists for ${platform}/${arch}; install Ollama from its official download page and press re-check`
    onStep({ phase: 'runtime', status: error, ok: false })
    return { ok: false, error }
  }
  if (await apiUp(url, { fetchImpl })) {
    onStep({ phase: 'runtime', status: `a model server already answers at ${url}; nothing to start`, ok: true, skipped: true })
    return { ok: true, skipped: true, url }
  }

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
    const extracted = await extractArchive({ archive: downloaded.path, kind: asset.kind, dir: plan.dir, onFile: () => {} })
    rmSync(downloaded.path, { force: true })
    if (!extracted.ok) {
      onStep({ phase: 'runtime', status: extracted.error, ok: false })
      return { ok: false, error: extracted.error }
    }
    if (!existsSync(plan.path)) {
      const error = `the archive unpacked but ${plan.bin} is not there — the release layout may have changed`
      onStep({ phase: 'runtime', status: error, ok: false })
      return { ok: false, error }
    }
    if (platform !== 'win32') {
      try {
        chmodSync(plan.path, 0o755)
      } catch {
        /* a filesystem without modes is not a failure */
      }
    }
    onStep({ phase: 'runtime-ready', status: `runtime ready at ${plan.path}`, verified: downloaded.verified })
    bin = plan.path
  }

  const started = await startRuntime({ bin, url, modelsDir, onStep, env })
  if (!started.ok) onStep({ phase: 'runtime', status: started.error, ok: false })
  return { ...started, bin }
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
 * because a model server still holding port 11434 after the window was closed
 * is exactly the kind of leftover that makes people distrust an installer.
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
  try { child.kill('SIGKILL') } catch { /* already gone */ }
  return {
    ok: false,
    error: error
      ? `could not start ${bin}: ${error.message}`
      : exitCode !== null
        ? `${bin} serve exited with code ${exitCode}`
        : `${bin} did not answer on ${url} within ${Math.round(timeout / 1000)} s`,
  }
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
