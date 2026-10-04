#!/usr/bin/env node
/**
 * The one-click Windows runtime, proved without a 1.3 GiB download.
 *
 * Everything here runs against two local servers: one that answers like
 * GitHub's release API, and one that serves real zips (built during the test)
 * with Range support, so resume and checksum verification are exercised for
 * real rather than described. The archives are tiny — the layouts are what
 * matter, and the layouts are what would break an install.
 *
 * The zip is written by hand here for the same reason the module unpacks it by
 * hand: neither Windows nor the sandbox has `unzip` on PATH, and a test that
 * skipped the real format would be a test of nothing.
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

/* A zip with stored and deflated entries, written by hand — the same layout
 * `ollama-windows-amd64.zip` uses: ollama.exe at the root, libraries in lib/. */
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

/* A fake ollama.exe. It starts with a shebang and exits immediately so the
 * sandbox host, which will try to run it, does so quietly: Windows would see a
 * PE header here, the test only needs the bytes and the size. */
const exeBody = Buffer.concat([Buffer.from('#!/bin/sh\nexit 1\n'), Buffer.alloc(4096, 0x23)])
const winZip = buildZip([
  ['ollama.exe', exeBody, 8],
  ['lib/ollama/', Buffer.alloc(0), 0],
  ['lib/ollama/thing.dll', 'a library', 8],
])
const rocmZip = buildZip([
  ['ollama.exe', Buffer.concat([Buffer.from('MZ fake rocm binary\n'), Buffer.alloc(2048, 3)]), 8],
  ['lib/ollama/rocm/thing.dll', 'a rocm library', 8],
])
const armZip = buildZip([
  ['ollama.exe', Buffer.concat([Buffer.from('MZ fake arm binary\n'), Buffer.alloc(1024, 5)]), 0],
])

const archives = {
  'ollama-windows-amd64.zip': winZip,
  'ollama-windows-arm64.zip': armZip,
  'ollama-windows-amd64-rocm.zip': rocmZip,
}

for (const [name, body] of Object.entries(archives)) writeFileSync(join(served, name), body)
writeFileSync(join(served, 'LICENSE'), 'not an archive at all')

const digests = Object.fromEntries(
  Object.entries(archives).map(([name, body]) => [name, createHash('sha256').update(body).digest('hex')]),
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

const releaseAssets = Object.keys(archives).map((name) => ({
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

assert.equal(candidateNames({ platform: 'win32', arch: 'x64' })[0], 'ollama-windows-amd64.zip', 'the default Windows build is one zip')
assert.equal(candidateNames({ platform: 'win32', arch: 'x64', variant: 'rocm' })[0], 'ollama-windows-amd64-rocm.zip', 'the AMD build is a different asset, not a flag')
assert.equal(candidateNames({ platform: 'win32', arch: 'arm64' })[0], 'ollama-windows-arm64.zip', 'Windows on ARM gets its own zip')
assert.deepEqual(candidateNames({ platform: 'darwin', arch: 'arm64' }), [], 'macOS was dropped: nothing is composed for it')
assert.deepEqual(candidateNames({ platform: 'linux', arch: 'x64' }), [], 'and neither is Linux')
assert.equal(archiveKind('ollama-windows-amd64.zip'), 'zip', 'the one format Windows ships is the one the module unpacks')
assert.equal(archiveKind('ollama-linux-amd64.tar.zst'), null, 'a tarball is no longer something this module claims to handle')

const picked = pickAsset(releaseAssets.map((asset) => ({ name: asset.name, size: asset.size })), { platform: 'win32', arch: 'x64' })
assert.equal(picked.name, 'ollama-windows-amd64.zip', 'the release asset list is what decides, so a rename upstream does not break an install')
const rocmPicked = pickAsset(releaseAssets.map((asset) => ({ name: asset.name })), { platform: 'win32', arch: 'x64', variant: 'rocm' })
assert.equal(rocmPicked.name, 'ollama-windows-amd64-rocm.zip', 'asking for the AMD build gets the AMD archive')
assert.equal(pickAsset([{ name: 'ollama-windows-amd64.zip' }], { platform: 'win32', arch: 'x64', variant: 'rocm' }), null, 'and it is not silently replaced by the default build')
assert.equal(pickAsset(releaseAssets, { platform: 'linux', arch: 'x64' }), null, 'a Linux host gets no asset at all, rather than a wrong one')

const plan = runtimePlan({ platform: 'win32', arch: 'x64', env: { JARVIS_RUNTIME_DIR: join(root, 'runtime') } })
assert.equal(plan.bin, 'ollama.exe', 'the Windows binary is ollama.exe at the archive root')
assert.equal(plan.path, join(root, 'runtime', 'ollama.exe'), 'and it is unpacked inside the folder JARVIS was told to use')
assert.equal(plan.kind, 'zip', 'with the unpacker chosen before the download even starts')
assert.equal(runtimePlan({ platform: 'freebsd', arch: 'x64' }).supported, false, 'an unsupported platform says so instead of guessing')
assert.equal(runtimePlan({ platform: 'win32', arch: 'riscv64' }).supported, false, 'and so does an unsupported architecture')
assert.equal(runtimePlan({ platform: 'linux', arch: 'x64' }).supported, false, 'Linux is not a supported target any more, and says so plainly')

const runtimeRoot = join(root, 'rt')
assert.equal(safeEntryPath(runtimeRoot, 'lib/ollama/thing.dll'), join(runtimeRoot, 'lib', 'ollama', 'thing.dll'), 'ordinary entries land where they should')
assert.equal(safeEntryPath(runtimeRoot, '../../etc/passwd'), null, 'a traversal entry is refused, not quietly rewritten into the folder')
assert.equal(safeEntryPath(runtimeRoot, './lib/ollama/thing.dll'), join(runtimeRoot, 'lib', 'ollama', 'thing.dll'), 'while an ordinary ./ prefix is just a path')
assert.equal(safeEntryPath(runtimeRoot, '/etc/passwd'), null, 'an absolute entry is refused outright, not written')
assert.equal(safeEntryPath(runtimeRoot, 'C:/Windows/system32'), null, 'and a Windows drive path is refused too')

/* ------------------------------------------------------------------- release */

const release = await fetchRelease({ platform: 'win32', arch: 'x64', env })
assert.equal(release.ok, true, 'the release metadata is read')
assert.ok(release.asset.size > 0 && release.asset.sha256, 'and carries the real size and the published SHA-256 digest')

const variants = await resolveVariants({ platform: 'win32', arch: 'x64', env })
assert.equal(variants.variants.length, 2, 'the AMD build is offered beside the default one')
assert.ok(variants.variants[0].sizeBytes > 0, 'and the page can show how much each one downloads')
assert.equal(variants.source, 'api', 'the sizes and checksums came from the release, not from a guess')
assert.equal(variants.variants.every((variant) => variant.kind === 'zip'), true, 'both Windows builds unpack as zips')

const armVariants = await resolveVariants({ platform: 'win32', arch: 'arm64', env })
assert.equal(armVariants.variants.length, 1, 'ARM Windows is offered exactly the one build that exists for it')

const unsupportedVariants = await resolveVariants({ platform: 'linux', arch: 'x64', env })
assert.equal(unsupportedVariants.variants.length, 0, 'a host that is not Windows is offered nothing to download')
assert.equal(unsupportedVariants.source, 'unsupported', 'and it is called unsupported, not a fallback URL that would fetch a zip it cannot run')

const suggested = rocmSuggested({ env: { ...env, PATH: join(root, 'no-rocm-here') } })
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

/* A dropped connection, then the same button again. */
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

/* A corrupted download must never be unpacked. */
const badDir = join(root, 'corrupt')
const badAsset = { ...defaultAsset, sha256: 'f'.repeat(64) }
const corrupt = await downloadArchive({ asset: badAsset, dir: badDir, env })
assert.equal(corrupt.ok, false, 'a file that fails its checksum is refused')
assert.match(corrupt.error, /SHA-256/, 'with an error that names the check')
assert.equal(existsSync(join(badDir, badAsset.name)), false, 'and it is deleted rather than unpacked')

/* No published digest is stated, not hidden. */
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
mkdirSync(extractRoot, { recursive: true })
const zipArchive = join(extractRoot, 'windows.zip')
writeFileSync(zipArchive, winZip)
const unzipped = await extractArchive({ archive: zipArchive, dir: join(extractRoot, 'zip') })
assert.equal(unzipped.ok, true, 'the Windows zip unpacks without unzip.exe — which Windows does not have')
assert.equal(existsSync(join(extractRoot, 'zip', 'ollama.exe')), true, 'with ollama.exe at the archive root, where the plan looks for it')
assert.equal(statSync(join(extractRoot, 'zip', 'ollama.exe')).size, exeBody.length, 'the deflated entry is inflated to its full size')
assert.equal(readFileSync(join(extractRoot, 'zip', 'lib', 'ollama', 'thing.dll'), 'utf8'), 'a library', 'nested deflated entries come out too')

/* A zip whose payload does not match its CRC is refused, not half-unpacked. */
const brokenZipPath = join(extractRoot, 'broken-entry.zip')
const brokenZip = buildZip([['ollama.exe', 'a plausible binary', 0]])
brokenZip.writeUInt32LE(0xdeadbeef, 30 + 'ollama.exe'.length + 4)
writeFileSync(brokenZipPath, brokenZip)
const refusedCrc = await extractArchive({ archive: brokenZipPath, dir: join(extractRoot, 'broken-entry') })
assert.equal(refusedCrc.ok, false, 'a zip entry that fails its CRC check is refused')
assert.match(refusedCrc.error, /CRC check/, 'with an error that says which check failed')

/* An entry that tries to leave the folder is skipped and reported. */
const traversalZip = buildZip([
  ['ollama.exe', 'the real binary', 0],
  ['../escaped.txt', 'should not be written', 0],
])
const traversalPath = join(extractRoot, 'traversal.zip')
writeFileSync(traversalPath, traversalZip)
const skippedEntries = []
const traversal = await extractArchive({ archive: traversalPath, dir: join(extractRoot, 'traversal'), onFile: (entry) => skippedEntries.push(entry) })
assert.equal(traversal.ok, true, 'an archive with a hostile entry still unpacks the good ones')
assert.equal(existsSync(join(extractRoot, 'escaped.txt')), false, 'but the hostile entry is never written outside the folder')
assert.ok(skippedEntries.some((entry) => entry.skipped), 'and the skip is reported rather than swallowed')

const notAnArchive = join(extractRoot, 'not-a-zip.zip')
writeFileSync(notAnArchive, 'this is not a zip')
const refused = await extractArchive({ archive: notAnArchive, dir: join(extractRoot, 'broken') })
assert.equal(refused.ok, false, 'a file that is not an archive is refused')
assert.match(refused.error, /end-of-central-directory/, 'with an error that says why')

/* ---------------------------------------------------------------------- start */

apiMode = 'down'
const fallback = await fetchRelease({ platform: 'win32', arch: 'x64', env })
assert.equal(fallback.ok, false, 'a release API that is down does not take the installer down with it')
assert.ok(fallback.asset?.url.endsWith('ollama-windows-amd64.zip'), 'the composed URL still points at the right asset name')
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
const already = await ensureRuntime({ platform: 'win32', arch: 'x64', env, url: modelUrl, onStep: (step) => skipSteps.push(step) })
assert.equal(already.skipped, true, 'a model server that already answers is left alone')
assert.match(skipSteps.map((step) => step.status).join(' '), /already answers/, 'and the page is told that, rather than starting a second one')

modelApiUp = false
const endToEndDir = join(root, 'end-to-end')
const endToEnd = await ensureRuntime({
  platform: 'win32',
  arch: 'x64',
  env: { ...env, JARVIS_RUNTIME_DIR: endToEndDir, PATH: join(root, 'nothing-here'), JARVIS_RUNTIME_MODELS: join(root, 'models') },
  url: modelUrl,
  onStep: () => {},
})
assert.equal(endToEnd.ok, false, 'a runtime whose endpoint never answers is reported as failed')
assert.equal(runtimeStatus({ platform: 'win32', arch: 'x64', env: { ...env, JARVIS_RUNTIME_DIR: endToEndDir } }).present, true, 'even then, the unpacked runtime is kept for the next press')
assert.ok(existsSync(join(endToEndDir, 'ollama.exe')), 'and it is in the project folder, not scattered anywhere else')

const projectBin = join(endToEndDir, 'ollama.exe')
const found = findRuntimeBinary({ ...plan, path: projectBin }, env)
assert.equal(found, projectBin, 'the project runtime is found without being on PATH')
const elsewhere = join(root, 'elsewhere')
mkdirSync(elsewhere, { recursive: true })
const systemBin = join(elsewhere, 'ollama.exe')
writeFileSync(systemBin, 'MZ an ollama the user installed themselves\n')
chmodSync(systemBin, 0o755)
assert.equal(
  findRuntimeBinary({ ...plan, path: join(root, 'absent', 'ollama.exe') }, { ...env, PATH: elsewhere }),
  systemBin,
  'an Ollama the user installed themselves is used when this project has not downloaded one',
)
assert.equal(
  findRuntimeBinary({ ...plan, path: projectBin }, { ...env, PATH: elsewhere }),
  projectBin,
  'and the project copy wins over a PATH entry, so a one-click install is not shadowed',
)
assert.equal(findRuntimeBinary({ ...plan, path: join(root, 'absent', 'ollama.exe') }, { ...env, PATH: join(root, 'nothing') }), null, 'and with neither, the answer is null rather than a broken path')

const nonWindows = await ensureRuntime({ platform: 'linux', arch: 'x64', env, url: modelUrl, onStep: () => {} })
assert.equal(nonWindows.ok, false, 'on a machine that is not Windows the installer refuses rather than pretending')
assert.match(nonWindows.error, /Windows only/, 'and says exactly that, with the download link a person would need')

const started = spawnSync(process.execPath, ['-e', 'process.exit(0)'])
assert.equal(started.status, 0, 'sanity')
assert.equal(typeof startRuntime, 'function', 'startRuntime is exported for hosts that manage the process themselves')
assert.equal(stopRuntime(), false, 'stopping a runtime that was never started is a no-op, not a crash')

assetServer.close()
apiServer.close()
modelApi.close()
rmSync(root, { recursive: true, force: true })

console.log('PASS  the Windows zip is resolved from the release itself — x64, arm64 and the ROCm build')
console.log('PASS  downloads resume from a dropped connection and are refused when the checksum fails')
console.log('PASS  the zip unpacks in Node and a bad CRC or a hostile entry is caught before it is kept')
console.log('PASS  a machine with nothing installed ends one click later with ollama.exe inside the project')
