#!/usr/bin/env node
/**
 * The one-click runtime, proved without a 1.3 GiB download.
 *
 * Everything here runs against two local servers: one that answers like
 * GitHub's release API, and one that serves real archives (built during the
 * test) with Range support, so resume and checksum verification are exercised
 * for real rather than described. The archives are tiny — the layouts are what
 * matter, and the layouts are what would break an install.
 *
 * Run: node scripts/test-runtime.mjs
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import {
  archiveKind,
  candidateNames,
  downloadArchive,
  ensureRuntime,
  extractArchive,
  fetchRelease,
  findRuntimeBinary,
  pickAsset,
  resolveVariants,
  rocmSuggested,
  runtimePlan,
  runtimeStatus,
  safeEntryPath,
  startRuntime,
  stopRuntime,
} from '../bridge/portable-runtime.mjs'

const root = mkdtempSync(join(tmpdir(), 'jarvis-runtime-'))
// A failed assertion exits before the tidy-up at the bottom of this file, so the
// scratch tree is also removed on exit. Nothing is left in the temp directory by
// a test run that fails — that is exactly when nobody is looking.
process.on('exit', () => {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* the OS will get it */
  }
})
const served = join(root, 'served')
mkdirSync(served, { recursive: true })

/* ------------------------------------------------------------------ archives */

/** A tar entry: 512-byte header plus padded data. */
function tarHeader(name, size, type = '0', link = '') {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8')
  header.write(type, 156, 1, 'utf8')
  if (link) header.write(link, 157, 100, 'utf8')
  header.write('ustar\0' + '00', 257, 8, 'utf8')
  // Checksum: sum of the header with the checksum field read as spaces.
  header.write('        ', 148, 8, 'utf8')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8')
  return header
}

function tarEntry(name, body, type = '0', link = '') {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512)
  data.copy(padded)
  return { header: tarHeader(name, data.length, type, link), data: padded }
}

function buildTar(entries) {
  const parts = []
  for (const entry of entries) parts.push(entry.header, entry.data)
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

const binary = '#!/bin/sh\necho fake ollama\n'
const tarPlain = buildTar([
  tarEntry('bin/', Buffer.alloc(0), '5'),
  tarEntry('bin/ollama', binary),
  tarEntry('lib/', Buffer.alloc(0), '5'),
  tarEntry('lib/thing.so', 'not really a library'),
])
const tarWithLink = buildTar([
  tarEntry('bin/', Buffer.alloc(0), '5'),
  tarEntry('bin/ollama', binary),
  tarEntry('bin/ollama-alias', Buffer.alloc(0), '2', 'ollama'),
])

const archives = {
  'ollama-linux-amd64.tar.zst': typeof zlib.zstdCompressSync === 'function'
    ? zlib.zstdCompressSync(tarPlain)
    : null,
  'ollama-linux-amd64.tgz': zlib.gzipSync(tarPlain),
  'ollama-linux-amd64-rocm.tar.zst': typeof zlib.zstdCompressSync === 'function'
    ? zlib.zstdCompressSync(buildTar([tarEntry('bin/', Buffer.alloc(0), '5'), tarEntry('bin/ollama', '#!/bin/sh\necho rocm ollama\n')]))
    : null,
  'ollama-windows-amd64.zip': null, // built below, needs a real deflate
  'ollama-windows-arm64.zip': null,
  'ollama-darwin.tgz': zlib.gzipSync(buildTar([tarEntry('ollama', binary)])),
}

/** A zip with a stored entry and a deflated entry, written by hand. */
function buildZip(entries) {
  const locals = []
  const central = []
  let offset = 0
  for (const [name, body, method] of entries) {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body)
    const payload = method === 8 ? zlib.deflateRawSync(data) : data
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, payload)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(payload.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBytes.length, 28)
    cd.writeUInt32LE((0o100755 << 16) >>> 0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBytes)
    offset += local.length + nameBytes.length + payload.length
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...central, end])
}

let crcTable = null
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256).map((_, n) => {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c
    })
  }
  let crc = -1
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return ((crc ^ -1) >>> 0) >>> 0
}

const winZip = buildZip([
  ['ollama.exe', Buffer.concat([Buffer.from('MZ fake windows binary\n'), Buffer.alloc(4096, 7)]), 8],
  ['lib/ollama/', Buffer.alloc(0), 0],
  ['lib/ollama/thing.dll', 'a library', 8],
])
archives['ollama-windows-amd64.zip'] = winZip
archives['ollama-windows-arm64.zip'] = winZip

for (const [name, body] of Object.entries(archives)) {
  if (body) writeFileSync(join(served, name), body)
}
writeFileSync(join(served, 'LICENSE'), 'not an archive at all')

const digests = Object.fromEntries(
  Object.entries(archives)
    .filter(([, body]) => body)
    .map(([name, body]) => [name, createHash('sha256').update(body).digest('hex')]),
)
writeFileSync(join(served, 'sha256sum.txt'), Object.entries(digests).map(([name, hash]) => `${hash}  ./${name}`).join('\n'))

/* -------------------------------------------------------------------- servers */

let rangeHits = 0
let killAfter = null
const assetServer = createServer((req, res) => {
  const name = decodeURIComponent(String(req.url ?? '/').split('/').pop() ?? '')
  const file = join(served, name)
  if (!existsSync(file)) {
    res.writeHead(404).end('missing')
    return
  }
  const body = readFileSync(file)
  const range = /^bytes=(\d+)-$/.exec(String(req.headers.range ?? ''))
  if (range) {
    rangeHits += 1
    const start = Number(range[1])
    res.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${body.length - 1}/${body.length}`,
      'content-length': String(body.length - start),
    })
    res.end(body.subarray(start))
    return
  }
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) })
  if (killAfter !== null) {
    // Send a prefix, then drop the socket: the shape of a real interrupted download.
    res.write(body.subarray(0, killAfter))
    setTimeout(() => res.destroy(), 20)
    return
  }
  res.end(body)
})

const releaseAssets = Object.keys(archives)
  .filter((name) => archives[name])
  .map((name) => ({
    name,
    size: statSync(join(served, name)).size,
    browser_download_url: '', // filled in once the port is known
    digest: `sha256:${digests[name]}`,
  }))

let apiMode = 'ok'
const apiServer = createServer((req, res) => {
  if (apiMode === 'down') {
    res.writeHead(503).end('unavailable')
    return
  }
  const port = assetServer.address().port
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    tag_name: 'v-test',
    assets: releaseAssets.map((asset) => ({ ...asset, browser_download_url: `http://127.0.0.1:${port}/${asset.name}` })),
  }))
})

await new Promise((resolve) => assetServer.listen(0, '127.0.0.1', resolve))
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve))
const assetBase = `http://127.0.0.1:${assetServer.address().port}`
const apiBase = `http://127.0.0.1:${apiServer.address().port}/latest`
const env = {
  ...process.env,
  JARVIS_RUNTIME_API: apiBase,
  JARVIS_RUNTIME_BASE: assetBase,
}

/* ------------------------------------------------------------------ the plan */

assert.deepEqual(
  candidateNames({ platform: 'linux', arch: 'x64' }).slice(0, 2),
  ['ollama-linux-amd64.tar.zst', 'ollama-linux-amd64.tgz'],
  'Linux looks for the current zstd asset first and the older tarball second — the names moved and both exist in the wild',
)
assert.ok(candidateNames({ platform: 'linux', arch: 'x64', variant: 'rocm' })[0].includes('rocm'), 'the AMD build is a different asset, not a flag')
assert.equal(candidateNames({ platform: 'win32', arch: 'arm64' })[0], 'ollama-windows-arm64.zip', 'Windows on ARM gets its own zip')
assert.equal(candidateNames({ platform: 'darwin', arch: 'arm64' })[0], 'ollama-darwin.tgz', 'macOS has one universal archive')
assert.deepEqual(['a.zip', 'b.tar.zst', 'c.tgz', 'd.tar'].map(archiveKind), ['zip', 'tar.zst', 'tar.gz', 'tar'], 'each naming convention maps to an unpacker')
assert.equal(archiveKind('ollama-linux-amd64.tar.zst'), 'tar.zst', 'and zstd is not mistaken for gzip')

const picked = pickAsset(releaseAssets.map((asset) => ({ name: asset.name, size: asset.size })), { platform: 'linux', arch: 'x64' })
assert.equal(picked.name, 'ollama-linux-amd64.tar.zst', 'the release asset list is what decides, so a rename upstream does not break an install')
assert.equal(picked.kind, 'tar.zst', 'and the unpacker follows the picked name')
const rocmPicked = pickAsset(releaseAssets.map((asset) => ({ name: asset.name })), { platform: 'linux', arch: 'x64', variant: 'rocm' })
assert.equal(rocmPicked.name, 'ollama-linux-amd64-rocm.tar.zst', 'asking for the AMD build gets the AMD archive')
assert.equal(pickAsset([{ name: 'ollama-linux-amd64.tar.zst' }], { platform: 'linux', arch: 'x64', variant: 'rocm' }), null, 'and it is not silently replaced by the default build')

const plan = runtimePlan({ platform: 'linux', arch: 'x64', env: { JARVIS_RUNTIME_DIR: join(root, 'runtime') } })
assert.equal(plan.bin, join('bin', 'ollama'), 'the Linux binary is under bin/, as the release lays it out')
assert.ok(plan.path.startsWith(join(root, 'runtime')), 'and it is unpacked inside the folder JARVIS was told to use')
assert.equal(runtimePlan({ platform: 'freebsd', arch: 'x64' }).supported, false, 'an unsupported platform says so instead of guessing')
assert.equal(runtimePlan({ platform: 'linux', arch: 'riscv64' }).supported, false, 'and so does an unsupported architecture')
assert.equal(safeEntryPath('/tmp/rt', 'bin/ollama'), '/tmp/rt/bin/ollama', 'ordinary entries land where they should')
assert.ok(safeEntryPath('/tmp/rt', '../../etc/passwd').startsWith('/tmp/rt/'), 'a traversal entry is contained inside the runtime folder')
assert.equal(safeEntryPath('/tmp/rt', '/etc/passwd'), null, 'an absolute entry is refused outright, not written')
assert.equal(safeEntryPath('/tmp/rt', 'C:/Windows/system32'), null, 'and a Windows drive path is refused too')

/* ------------------------------------------------------------------- release */

const release = await fetchRelease({ platform: 'linux', arch: 'x64', env })
assert.equal(release.ok, true, 'the release metadata is read')
assert.ok(release.asset.size > 0 && release.asset.sha256, 'and carries the real size and the published SHA-256 digest')

const variants = await resolveVariants({ platform: 'linux', arch: 'x64', env })
assert.equal(variants.variants.length, 2, 'the AMD build is offered beside the default one')
assert.ok(variants.variants[0].sizeBytes > 0, 'and the page can show how much each one downloads')
assert.equal(variants.source, 'api', 'the sizes and checksums came from the release, not from a guess')

/* --------------------------------------------------------------------------- */
  const suggested = rocmSuggested({ platform: 'linux', env: { ...env, PATH: join(root, 'no-rocm-here') } })
  assert.equal(suggested, false, 'ROCm is not suggested when nothing AMD is installed')

/* ------------------------------------------------------------------ download */

const steps = []
const target = join(root, 'downloads')
const defaultAsset = variants.variants[0]
const downloaded = await downloadArchive({ asset: defaultAsset, dir: target, onStep: (step) => steps.push(step), env })
assert.equal(downloaded.ok, true, 'the archive downloads')
assert.equal(downloaded.verified, true, 'and is verified against the release checksum')
assert.equal(downloaded.path, join(target, defaultAsset.name), 'the file lands under the name the release gave it')
assert.equal(statSync(downloaded.path).size, defaultAsset.sizeBytes, 'and on disk it is exactly the size the release declared')
assert.ok(steps.some((step) => step.phase === 'runtime-verify'), 'verification is reported while it happens')

const twice = await downloadArchive({ asset: defaultAsset, dir: target, env })
assert.equal(twice.skipped, true, 'pressing the button twice does not download twice')

/* --------------------------------------------------------------------------- */
  killAfter = Math.floor(defaultAsset.sizeBytes / 2)
  const partialDir = join(root, 'resume')
  const interrupted = await downloadArchive({ asset: defaultAsset, dir: partialDir, env })
  assert.equal(interrupted.ok, false, 'a connection that drops mid-download fails')
  assert.match(interrupted.error, /press the button again to resume/, 'and tells the user the download resumes rather than starting over')
  assert.equal(interrupted.resumable, true, 'and reports itself as resumable')
  const before = rangeHits
  killAfter = null
  const resumed = await downloadArchive({ asset: defaultAsset, dir: partialDir, env })
  assert.equal(resumed.ok, true, 'the second attempt finishes the download')
  assert.ok(rangeHits > before, 'using a Range request against the bytes already on disk')
  assert.equal(statSync(resumed.path).size, defaultAsset.sizeBytes, 'and the finished file is whole')
  assert.equal(resumed.verified, true, 'and still verified')

/* --------------------------------------------------------------------------- */
  const badDir = join(root, 'corrupt')
  const badAsset = { ...defaultAsset, sha256: 'f'.repeat(64) }
  const corrupt = await downloadArchive({ asset: badAsset, dir: badDir, env })
  assert.equal(corrupt.ok, false, 'a file that fails its checksum is refused')
  assert.match(corrupt.error, /SHA-256/, 'with an error that names the check')
  assert.equal(existsSync(join(badDir, badAsset.name)), false, 'and it is deleted rather than unpacked')

/* --------------------------------------------------------------------------- */
  const looseDir = join(root, 'no-checksum')
  const looseAsset = {
    ...defaultAsset,
    name: 'LICENSE',
    url: `${assetBase}/LICENSE`,
    sha256: null,
    size: statSync(join(served, 'LICENSE')).size,
  }
  const unverified = await downloadArchive({ asset: looseAsset, dir: looseDir, env })
  assert.equal(unverified.ok, true, 'a release with no published checksum still installs')
  assert.equal(unverified.verified, false, 'and says it was not verified instead of pretending')

/* ----------------------------------------------------------------- extraction */

const extractRoot = join(root, 'extract')
const tgzArchive = join(extractRoot, 'linux.tgz')
mkdirSync(extractRoot, { recursive: true })
writeFileSync(tgzArchive, archives['ollama-linux-amd64.tgz'])
const untarred = await extractArchive({ archive: tgzArchive, kind: 'tar.gz', dir: join(extractRoot, 'tgz') })
assert.equal(untarred.ok, true, 'a gzipped tar unpacks with no tar binary involved')
assert.equal(readFileSync(join(extractRoot, 'tgz', 'bin', 'ollama'), 'utf8'), binary, 'with the binary at the path the plan expects')
assert.equal(readFileSync(join(extractRoot, 'tgz', 'lib', 'thing.so'), 'utf8'), 'not really a library', 'and the other entries intact')

const linkArchive = join(extractRoot, 'links.tgz')
writeFileSync(linkArchive, zlib.gzipSync(tarWithLink))
await extractArchive({ archive: linkArchive, kind: 'tar.gz', dir: join(extractRoot, 'links') })
assert.equal(existsSync(join(extractRoot, 'links', 'bin', 'ollama')), true, 'a symlinked entry does not stop the unpack')

assert.ok(typeof zlib.zstdCompressSync === 'function', 'this Node build has zstd, so the zstd path can be proved here')
if (archives['ollama-linux-amd64.tar.zst']) {
  const zstdArchive = join(extractRoot, 'linux.tar.zst')
  writeFileSync(zstdArchive, archives['ollama-linux-amd64.tar.zst'])
  const result = await extractArchive({ archive: zstdArchive, kind: 'tar.zst', dir: join(extractRoot, 'zst') })
  assert.equal(result.ok, true, 'the zstd archive — the one today`s releases actually publish — unpacks in Node')
  assert.equal(readFileSync(join(extractRoot, 'zst', 'bin', 'ollama'), 'utf8'), binary, 'with the same result as the tarball')
}

const zipArchive = join(extractRoot, 'windows.zip')
writeFileSync(zipArchive, winZip)
const unzipped = await extractArchive({ archive: zipArchive, kind: 'zip', dir: join(extractRoot, 'zip') })
assert.equal(unzipped.ok, true, 'the Windows zip unpacks without unzip.exe — which Windows does not have')
assert.equal(existsSync(join(extractRoot, 'zip', 'ollama.exe')), true, 'with ollama.exe at the archive root, where the plan looks for it')
assert.equal(statSync(join(extractRoot, 'zip', 'ollama.exe')).size, 4096 + 'MZ fake windows binary\n'.length, 'the deflated entry is inflated to its full size')
assert.equal(readFileSync(join(extractRoot, 'zip', 'lib', 'ollama', 'thing.dll'), 'utf8'), 'a library', 'nested deflated entries come out too')

const notAnArchive = join(extractRoot, 'broken.zip')
writeFileSync(notAnArchive, 'this is not a zip')
const refused = await extractArchive({ archive: notAnArchive, kind: 'zip', dir: join(extractRoot, 'broken') })
assert.equal(refused.ok, false, 'a file that is not an archive is refused')
assert.match(refused.error, /end-of-central-directory/, 'with an error that says why')

/* ---------------------------------------------------------------------- start */

apiMode = 'down'
const fallback = await fetchRelease({ platform: 'linux', arch: 'x64', env })
assert.equal(fallback.ok, false, 'a release API that is down does not take the installer down with it')
assert.ok(fallback.asset?.url.endsWith('ollama-linux-amd64.tar.zst'), 'the composed URL still points at the right asset name')
assert.equal(fallback.asset.sha256, null, 'and the page is told there is no checksum for it')
apiMode = 'ok'

let modelApiUp = true
const modelApi = createServer((req, res) => {
  if (req.url?.endsWith('/api/tags') && modelApiUp) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"models":[]}')
    return
  }
  res.writeHead(503).end('down')
})
await new Promise((resolve) => modelApi.listen(0, '127.0.0.1', resolve))
const modelUrl = `http://127.0.0.1:${modelApi.address().port}`

const skipSteps = []
const already = await ensureRuntime({ platform: 'linux', arch: 'x64', env, url: modelUrl, onStep: (step) => skipSteps.push(step) })
assert.equal(already.skipped, true, 'a model server that already answers is left alone')
assert.match(skipSteps.map((step) => step.status).join(' '), /already answers/, 'and the page is told that, rather than starting a second one')

modelApiUp = false
const endToEndDir = join(root, 'end-to-end')
const endToEnd = await ensureRuntime({
  platform: 'linux',
  arch: 'x64',
  env: { ...env, JARVIS_RUNTIME_DIR: endToEndDir, PATH: join(root, 'nothing-here'), JARVIS_RUNTIME_MODELS: join(root, 'models') },
  url: modelUrl,
  onStep: () => {},
})
assert.equal(endToEnd.ok, false, 'a runtime whose endpoint never answers is reported as failed')
assert.equal(runtimeStatus({ platform: 'linux', arch: 'x64', env: { ...env, JARVIS_RUNTIME_DIR: endToEndDir } }).present, true, 'even then, the unpacked runtime is kept for the next press')
assert.ok(existsSync(join(endToEndDir, 'bin', 'ollama')), 'and it is in the project folder, not scattered anywhere else')

const found = findRuntimeBinary({ ...plan, path: join(endToEndDir, 'bin', 'ollama') }, env)
assert.equal(found, join(endToEndDir, 'bin', 'ollama'), 'the project runtime is found without being on PATH')
const elsewhere = join(root, 'elsewhere')
mkdirSync(elsewhere, { recursive: true })
const systemBin = join(elsewhere, 'ollama')
writeFileSync(systemBin, '#!/bin/sh\n', { mode: 0o755 })
chmodSync(systemBin, 0o755)
assert.equal(
  findRuntimeBinary({ ...plan, path: join(root, 'absent', 'bin', 'ollama') }, { ...env, PATH: elsewhere }),
  systemBin,
  'a system Ollama on PATH is used when this project has not downloaded one',
)
assert.equal(findRuntimeBinary({ ...plan, path: join(root, 'absent', 'bin', 'ollama') }, { ...env, PATH: join(root, 'nothing') }), null, 'and with neither, the answer is null rather than a broken path')

const started = spawnSync('true', [])
assert.equal(started.status, 0, 'sanity')
assert.equal(typeof startRuntime, 'function', 'startRuntime is exported for hosts that manage the process themselves')
assert.equal(stopRuntime(), false, 'stopping a runtime that was never started is a no-op, not a crash')

assetServer.close()
apiServer.close()
modelApi.close()
rmSync(root, { recursive: true, force: true })

console.log('PASS  the right archive is resolved per platform, architecture and GPU, from the release itself')
console.log('PASS  downloads resume from a dropped connection and are refused when the checksum fails')
console.log('PASS  tar.gz, tar.zst and zip all unpack in Node, so one click needs nothing installed first')
