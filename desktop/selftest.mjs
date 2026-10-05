/**
 * Desktop packaging self-test.
 *
 * Runs under plain Node — no Electron, no display, no model server — and checks
 * the three things that can be wrong in a packaged build without anything
 * obviously failing at build time:
 *
 *   1. The interface files are where the shell will look for them, and the
 *      loopback server that serves them answers, refuses traversal, and does
 *      not hand an HTML page back for a missing script.
 *   2. The brain starts under the environment the shell gives it: a data folder
 *      it can write, a bridge port it was told about, and the window's origin
 *      allowed. The WebSocket handshake is checked from both sides — the
 *      interface origin must be accepted and a foreign origin must not be —
 *      because a build where the window loads but the bridge refuses its socket
 *      is a build that looks alive and answers nothing.
 *   3. The pieces the installer needs at build time (a multi-resolution .ico,
 *      the builder config in package.json) are present and consistent.
 *
 * `npm run test:desktop` — runs on Linux and Windows alike in CI, before the
 * slow part of the build.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHudServer } from './serve.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function freePort() {
  const { createServer } = await import('node:net')
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.on('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => done(port))
    })
  })
}

function handshake(port, origin) {
  return new Promise((done) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: '/',
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        origin,
      },
    })
    req.on('upgrade', (res, socket) => { socket.destroy(); done(res.statusCode ?? 101) })
    req.on('response', (res) => { res.resume(); done(res.statusCode ?? 0) })
    req.on('error', () => done(0))
    req.setTimeout(8000, () => { req.destroy(); done(0) })
    req.end()
  })
}

async function waitFor(url, deadlineMs) {
  const deadline = Date.now() + deadlineMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return { response, body: await response.text() }
    } catch (error) {
      lastError = error
    }
    await new Promise((done) => setTimeout(done, 400))
  }
  return { response: null, body: '', error: lastError }
}

/* ------------------------------------------------------------------ interface */

const DIST = join(ROOT, 'dist')

async function testInterface() {
  check('the built interface exists (dist/index.html)', existsSync(join(DIST, 'index.html')), DIST)
  if (!existsSync(join(DIST, 'index.html'))) return null

  const index = readFileSync(join(DIST, 'index.html'), 'utf8')
  const entry = index.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1] ?? null
  check('index.html references a hashed bundle', Boolean(entry), entry ?? 'no /assets/ reference found')

  const server = await startHudServer({ root: DIST, port: 0, health: () => ({ ok: true, app: 'self-test' }) })
  try {
    const home = await fetch(`${server.url}/`)
    check('the interface server answers on loopback', home.ok, `HTTP ${home.status}`)
    check('it serves HTML with the right type', (home.headers.get('content-type') ?? '').startsWith('text/html'),
      home.headers.get('content-type') ?? 'no content-type')

    if (entry) {
      const asset = await fetch(`${server.url}${entry}`)
      const type = asset.headers.get('content-type') ?? ''
      check('the entry bundle is served as JavaScript', asset.ok && type.includes('javascript'), `HTTP ${asset.status}, ${type}`)
      check('hashed bundles are cached immutably',
        (asset.headers.get('cache-control') ?? '').includes('immutable'), asset.headers.get('cache-control') ?? 'none')
    }

    const traversal = await fetch(`${server.url}/%2e%2e/%2e%2e/package.json`)
    check('path traversal is refused', traversal.status === 400 || traversal.status === 404, `HTTP ${traversal.status}`)

    const missing = await fetch(`${server.url}/assets/does-not-exist.js`)
    check('a missing script is a 404, not the HTML page', missing.status === 404, `HTTP ${missing.status}`)

    const route = await fetch(`${server.url}/some/deep/route`)
    check('a deep link still gets the app', route.ok, `HTTP ${route.status}`)

    const headStatus = await new Promise((done) => {
      const req = request({ host: '127.0.0.1', port: server.port, path: '/', method: 'HEAD' }, (res) => {
        res.resume()
        done(res.statusCode ?? 0)
      })
      req.on('error', () => done(0))
      req.end()
    })
    check('HEAD is answered without a body', headStatus === 200, `HTTP ${headStatus}`)

    const health = await fetch(`${server.url}/__jarvis`)
    const healthBody = await health.json().catch(() => ({}))
    check('the launcher health probe answers', health.ok && healthBody.ok === true, JSON.stringify(healthBody))
  } finally {
    await server.close()
  }
  return server
}

/* ---------------------------------------------------------------------- brain */

async function testBridge() {
  const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-selftest-'))
  const bridgePort = await freePort()
  const hudPort = await freePort()
  const hudOrigin = `http://127.0.0.1:${hudPort}`

  const child = spawn(process.execPath, [join(ROOT, 'desktop', 'bridge.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      JARVIS_DATA_DIR: dataDir,
      JARVIS_BRIDGE_PORT: String(bridgePort),
      JARVIS_HUD_ORIGINS: `${hudOrigin},http://localhost:${hudPort}`,
      JARVIS_NO_BROWSER: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })

  try {
    const { response, body, error } = await waitFor(`http://127.0.0.1:${bridgePort}/health`, 60_000)
    check('the brain starts and answers /health', Boolean(response), error ? String(error.message ?? error) : `HTTP ${response?.status}`)
    if (!response) {
      console.log(output.split('\n').slice(-25).map((line) => `        │ ${line}`).join('\n'))
      return
    }
    const health = JSON.parse(body)
    check('health reports model slots', Array.isArray(health.models) && health.models.length > 0,
      `${health.models?.length ?? 0} slots, ok=${health.ok}`)

    const setup = await fetch(`http://127.0.0.1:${bridgePort}/install`)
    const setupHtml = await setup.text()
    check('the one-click setup page is served', setup.ok && setupHtml.includes('<!doctype html'),
      `HTTP ${setup.status}, ${setupHtml.length} bytes`)

    check('the brain writes into the data folder it was given', existsSync(join(dataDir, 'models')), join(dataDir, 'models'))

    const accepted = await handshake(bridgePort, hudOrigin)
    check('the window origin is accepted by the bridge', accepted === 101, `HTTP ${accepted}`)
    const refused = await handshake(bridgePort, 'http://not-this-app.example')
    check('a foreign origin is refused by the bridge', refused === 403, `HTTP ${refused}`)
  } finally {
    child.kill('SIGTERM')
    await new Promise((done) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); done() }, 5000)
      child.once('exit', () => { clearTimeout(timer); done() })
    })
    rmSync(dataDir, { recursive: true, force: true })
  }
}

/* ------------------------------------------------------------------- packaging */

function testPackaging() {
  const icon = join(ROOT, 'desktop', 'icon.ico')
  check('the Windows icon is committed', existsSync(icon), icon)
  if (existsSync(icon)) {
    const bytes = readFileSync(icon)
    const count = bytes.readUInt16LE(4)
    check('the icon is multi-resolution', count >= 6, `${count} sizes`)
    // electron-builder refuses an icon with no 256px image, and the failure
    // arrives after a three-minute build, which is a miserable way to learn it.
    let has256 = false
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16
      const width = bytes[entry] === 0 ? 256 : bytes[entry]
      if (width >= 256) has256 = true
    }
    check('the icon has a 256px image', has256)
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const build = pkg.build ?? {}
  check('electron-builder is configured', Boolean(build.win && build.appId), build.appId ?? 'missing build config')
  check('the installer is an assisted NSIS installer',
    build.win?.target?.some((target) => (typeof target === 'string' ? target : target.target) === 'nsis') ?? false,
    JSON.stringify(build.win?.target ?? null))
  check('the interface is shipped outside the asar archive',
    (build.extraResources ?? []).some((entry) => entry.to === 'hud'), JSON.stringify(build.extraResources ?? []))
  check('the desktop shell is a declared entry point',
    (build.files ?? []).some((pattern) => String(pattern).includes('desktop')), JSON.stringify(build.files ?? []))
  check('the brain is a declared entry point',
    (build.files ?? []).some((pattern) => String(pattern).includes('bridge')), JSON.stringify(build.files ?? []))
  check('the packaging module scripts are shipped',
    ['scripts/ollama-start.mjs', 'scripts/ollama-endpoints.mjs'].every((needed) => (build.files ?? []).includes(needed)),
    JSON.stringify(build.files ?? []))
  // A product name ending in a dot becomes an executable called `JARVIS..exe`
  // on Windows, and every trailing dot is silently dropped from the path — so
  // a build with that name installs somewhere other than where it says.
  check('the executable name has no trailing dot', !String(build.win?.executableName ?? build.productName ?? '').endsWith('.'),
    String(build.win?.executableName ?? build.productName ?? ''))
  check('the Electron entry point is the desktop shell', pkg.main === 'desktop/main.mjs', pkg.main ?? 'missing main')
}

/* ------------------------------------------------------------------------- run */

console.log('\nJ.A.R.V.I.S. desktop self-test\n')
await testInterface()
testPackaging()
await testBridge()

const failed = results.filter((entry) => !entry.ok)
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed\n`)
process.exit(failed.length === 0 ? 0 : 1)
