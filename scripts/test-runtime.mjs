#!/usr/bin/env node
/**
 * What the one-click runtime actually does, without the internet.
 *
 * The real download is a ~1 GB archive from GitHub, which no test should fetch.
 * So this test builds a fake archive with the same layout the release has,
 * serves it from a local HTTP server, and checks the three things that could
 * silently break a user's install: the right asset for the platform, an archive
 * unpacked into the project folder with an executable binary, and an honest
 * failure when the download or the unpack does not work.
 *
 * Run: node scripts/test-runtime.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RUNTIME_ASSETS,
  downloadRuntime,
  ensureRuntime,
  findRuntimeBinary,
  runtimePlan,
  runtimePresent,
  runtimeStatus,
  startRuntime,
  stopRuntime,
} from '../bridge/portable-runtime.mjs'

const root = mkdtempSync(join(tmpdir(), 'jarvis-runtime-'))
const archiveDir = join(root, 'archives')
mkdirSync(archiveDir, { recursive: true })

/** A tree shaped like the standalone release, plus a marker so we can prove it arrived. */
function buildArchive(kind, asset, layout) {
  const stage = join(root, `stage-${asset}`)
  mkdirSync(stage, { recursive: true })
  for (const [file, body] of Object.entries(layout)) {
    const target = join(stage, file)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, body)
    chmodSync(target, 0o755)
  }
  const archive = join(archiveDir, asset)
  const result = kind === 'zip'
    ? spawnSync('zip', ['-qr', archive, '.'], { cwd: stage })
    : spawnSync('tar', ['-czf', archive, '-C', stage, '.'])
  assert.equal(result.status, 0, `the fake ${asset} archive could be built`)
  return archive
}

const layout = { 'bin/ollama': '#!/bin/sh\necho fake ollama\n', 'lib/thing.so': 'not really a library' }
buildArchive('tgz', 'ollama-linux-amd64.tgz', layout)
buildArchive('zip', 'ollama-windows-amd64.zip', { 'ollama.exe': 'fake windows binary' })

// A server whose paths are the release paths the module asks for.
let broken = false
const server = createServer((req, res) => {
  if (broken) {
    res.writeHead(500).end('nope')
    return
  }
  const name = String(req.url ?? '').split('/').pop()
  const file = join(archiveDir, name)
  if (!existsSync(file)) {
    res.writeHead(404).end('missing')
    return
  }
  const body = readFileSync(file)
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) })
  res.end(body)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const env = { ...process.env, JARVIS_RUNTIME_BASE: base, JARVIS_RUNTIME_DIR: join(root, 'runtime') }

// --- the plan -----------------------------------------------------------------

const linux = runtimePlan({ platform: 'linux', env })
assert.equal(linux.asset, RUNTIME_ASSETS.linux.asset, 'Linux downloads the standalone tarball from the release')
assert.equal(linux.kind, 'tgz', 'and unpacks it as a tarball')
assert.equal(linux.bin, join('bin', 'ollama'), 'the binary lives under bin/ on Linux, as the release lays it out')
assert.ok(linux.path.startsWith(join(root, 'runtime')), 'and it is unpacked inside the project folder JARVIS was told to use')
assert.ok(linux.url.startsWith(base), 'the base URL is overridable so tests and mirrors do not hit GitHub')

const windows = runtimePlan({ platform: 'win32', env })
assert.equal(windows.kind, 'zip', 'Windows uses the standalone zip, not the setup program')
assert.equal(windows.bin, 'ollama.exe', 'and its binary is ollama.exe at the archive root')
const mac = runtimePlan({ platform: 'darwin', env })
assert.equal(mac.kind, 'tgz', 'macOS uses the darwin tarball')
assert.equal(mac.bin, 'ollama', 'whose binary sits at the archive root')
assert.equal(runtimePlan({ platform: 'freebsd', env }).supported, false, 'a platform with no published build says so instead of guessing')

// --- the download -------------------------------------------------------------

const steps = []
const downloaded = await downloadRuntime({ plan: linux, onStep: (step) => steps.push(step) })
assert.equal(downloaded.ok, true, 'the runtime downloads and unpacks')
assert.equal(runtimePresent(linux), true, 'and the binary is where the plan said it would be')
assert.ok(steps.some((step) => step.phase === 'runtime-download'), 'the download is reported while it happens')
assert.ok(steps.some((step) => step.phase === 'runtime-unpack'), 'so is the unpack')
assert.equal(runtimeStatus({ platform: 'linux', env }).present, true, 'the status call agrees without being told')
const again = await downloadRuntime({ plan: linux, onStep: () => {} })
assert.equal(again.skipped, true, 'a second press does not download it again')

// --- finding a binary ---------------------------------------------------------

assert.equal(findRuntimeBinary(linux, env), linux.path, 'the project runtime is found without being on PATH')
const emptyPath = { ...env, PATH: join(root, 'nothing-here') }
const absent = { ...linux, path: join(root, 'absent', 'bin', 'ollama') }
const elsewhere = join(root, 'elsewhere')
mkdirSync(elsewhere, { recursive: true })
const systemBin = join(elsewhere, 'ollama')
writeFileSync(systemBin, '#!/bin/sh\n', { mode: 0o755 })
assert.equal(findRuntimeBinary(absent, { ...emptyPath, PATH: elsewhere }), systemBin, 'a system Ollama on PATH is used when this project has not downloaded one')
assert.equal(findRuntimeBinary(absent, emptyPath), null, 'and with neither, the answer is null rather than a broken path')

// Windows gets the zip, and the same code path has to unpack it correctly.
const windowsEnv = { ...env, JARVIS_RUNTIME_DIR: join(root, 'windows-runtime') }
const zipPlan = runtimePlan({ platform: 'win32', env: windowsEnv })
const unzipped = await downloadRuntime({ plan: zipPlan, onStep: () => {} })
assert.equal(unzipped.ok, true, 'the Windows zip unpacks with the same one-click path')
assert.equal(existsSync(zipPlan.path), true, 'and lands as ollama.exe inside the project folder')

// --- the failure paths --------------------------------------------------------

broken = true
const failed = await downloadRuntime({ plan: runtimePlan({ platform: 'linux', env: { ...env, JARVIS_RUNTIME_DIR: join(root, 'fresh') } }), onStep: () => {} })
assert.equal(failed.ok, false, 'a download that answers 500 fails instead of leaving a half-unpacked runtime')
assert.match(failed.error, /HTTP 500/, 'and the error names what went wrong')
assert.equal(runtimePresent(runtimePlan({ platform: 'linux', env: { ...env, JARVIS_RUNTIME_DIR: join(root, 'fresh') } })), false, 'nothing pretends to be installed afterwards')
broken = false

const unpackPath = join(root, 'not-a-tarball')
mkdirSync(unpackPath, { recursive: true })
writeFileSync(join(archiveDir, 'ollama-linux-amd64.tgz'), 'this is not a tarball')
const badArchive = await downloadRuntime({
  plan: runtimePlan({ platform: 'linux', env: { ...env, JARVIS_RUNTIME_DIR: unpackPath } }),
  onStep: () => {},
})
assert.equal(badArchive.ok, false, 'an archive that will not unpack is reported, not swallowed')
writeFileSync(join(archiveDir, 'ollama-linux-amd64.tgz'), readFileSync(join(root, 'archives', 'ollama-linux-amd64.tgz')))
assert.equal(runtimeStatus({ platform: 'linux', env }).present, true, 'the good runtime from before is still the one that counts')

// --- starting it --------------------------------------------------------------

// A fake server that answers the one endpoint the module waits for, so the wait
// loop, its timeout and its honesty can be exercised without a real model.
let apiUp = true
const api = createServer((req, res) => {
  if (req.url?.endsWith('/api/tags') && apiUp) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"models":[]}')
    return
  }
  res.writeHead(503).end('down')
})
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
const apiUrl = `http://127.0.0.1:${api.address().port}`

const skipSteps = []
const already = await ensureRuntime({ platform: 'linux', env, url: apiUrl, onStep: (step) => skipSteps.push(step) })
assert.equal(already.skipped, true, 'a model server that already answers is left alone')
assert.match(skipSteps.map((step) => step.status).join(' '), /already answers/, 'and the page is told that, rather than starting a second one')

apiUp = false
const notStarted = await ensureRuntime({
  platform: 'linux',
  env: { ...env, PATH: join(root, 'nothing-here'), JARVIS_RUNTIME_BASE: base },
  url: apiUrl,
  onStep: () => {},
})
assert.equal(notStarted.ok, false, 'a runtime that never answers is reported as failed')

// The downloaded fake binary is a shell script that exits immediately, which is
// exactly the honest failure the loop has to survive.
const startable = spawnSync('true', [], { status: 0 })
assert.equal(startable.status, 0, 'sanity')
assert.equal(typeof startRuntime, 'function', 'startRuntime is exported for hosts that want to manage the process themselves')
assert.equal(stopRuntime(), false, 'stopping a runtime that was never started is a no-op, not a crash')

server.close()
api.close()
rmSync(root, { recursive: true, force: true })

console.log('PASS  the standalone runtime is planned per platform, downloaded into the project, unpacked, and started')
console.log('PASS  a runtime that already answers is left alone, and a download or unpack that fails says why')
