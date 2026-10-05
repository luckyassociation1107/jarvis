/**
 * J.A.R.V.I.S. as an installed Windows application.
 *
 * The browser path (`npm start`) already works and is documented in the README.
 * This file exists for the person who does not have Node, does not want a
 * terminal, and reasonably expects "an exe" to mean an icon, a window, and an
 * uninstaller in Add/Remove Programs. It is a wrapper, not a second product:
 * the same `bridge/server.mjs` runs the intelligence, the same `dist/` is the
 * face, and the same setup page installs the models.
 *
 * What a desktop shell has to add, and does here:
 *
 *   - A window. The face is a web page, but a page needs an origin, so the
 *     built `dist/` is served from 127.0.0.1 (see `desktop/serve.mjs`) rather
 *     than opened over `file://`, which has no origin the microphone, the
 *     bridge's origin check, or localStorage would accept.
 *   - A tray icon, so closing the window does not kill a conversation. Quitting
 *     is explicit, from the tray or the File menu.
 *   - Supervision. The bridge is started as an Electron utility process (the
 *     installed machine has no Node to spawn), restarted if it dies, and the
 *     window is reloaded if the renderer crashes. The previous shell for this
 *     project promised auto-restart; this is where that promise is kept.
 *   - Microphone permission. Chromium asks the user; an assistant that has to
 *     be granted its own microphone on every launch is a toy, so the request is
 *     answered for the HUD origin only, and refused for anything else.
 *
 * Deliberately absent: any IPC bridge into the page. The HUD talks to the local
 * bridge over HTTP and WebSocket like it always has, so nothing here can widen
 * what the interface is allowed to do.
 */

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  nativeImage,
  session,
  shell,
  utilityProcess,
} from 'electron'
import { startHudServer } from './serve.mjs'

const APP_ID = 'com.jarvis.assistant'
/** What the user reads in a title bar, the tray and a dialog. */
const APP_NAME = 'J.A.R.V.I.S.'
/**
 * What the filesystem reads.
 *
 * Windows strips trailing dots from a path component, so a folder called
 * `J.A.R.V.I.S.` is really called `J.A.R.V.I.S` — a difference that turns every
 * "open the data folder" instruction into a small lie. The display name keeps
 * the full stops; the folder does not have them.
 */
const APP_FOLDER = 'JARVIS'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(HERE, '..')
const PACKAGED = app.isPackaged
const INSTALL_ROOT = PACKAGED ? dirname(app.getPath('exe')) : APP_ROOT
const HUD_FILES = PACKAGED ? join(process.resourcesPath, 'hud') : join(APP_ROOT, 'dist')

const HIDDEN_START = process.argv.includes('--hidden')
// `npm run desktop:writes` — the source-checkout equivalent of the tray's
// writes toggle, for whoever wants the acting tools without clicking.
const WRITES_FLAG = process.argv.includes('--allow-writes')
const SELF_TEST = process.argv.includes('--self-test') || process.env.JARVIS_SELF_TEST === '1'
/**
 * How long the packaged self-test may run before it gives up.
 *
 * It is a sequence of loopback calls that each have their own timeout, so this
 * should never fire — which is exactly why it is here. CI learns the difference
 * between "the app is broken" and "the job is hung" from the exit code, and a
 * hung job is the one failure a self-test cannot report about itself. The
 * budget has to clear the slowest legitimate run (a 30 s wait for Electron plus
 * a 120 s wait for the bridge), because a watchdog that fires first reports
 * "timed out" where the interesting answer is which check never finished.
 */
const SELF_TEST_TIMEOUT_MS = Number(process.env.JARVIS_SELF_TEST_TIMEOUT_MS ?? 240_000)
const BRIDGE_PORT = Number(process.env.JARVIS_BRIDGE_PORT ?? 8787)
const HUD_PORT = Number(process.env.JARVIS_HUD_PORT ?? 4173)

/* ------------------------------------------------------------------ settings */

/**
 * Settings live beside the data, not in the registry: one folder to inspect,
 * one folder to delete, and nothing that survives an uninstall invisibly.
 */
function writableDir(candidate) {
  try {
    mkdirSync(candidate, { recursive: true })
    // Actually write: `mkdir` can succeed on a path the account then cannot
    // create files in, and this decision is made once, at startup, for the
    // folder every model download will land in.
    const probe = join(candidate, '.write-probe')
    writeFileSync(probe, '')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

function firstWritable(...candidates) {
  for (const candidate of candidates) {
    if (candidate && writableDir(candidate)) return candidate
  }
  // Nothing is writable, which means every later step fails anyway; hand back
  // the first candidate so the error names the folder we actually wanted.
  return candidates.find(Boolean)
}

/**
 * Where models, memory, screenshots and settings live.
 *
 * `%LOCALAPPDATA%\JARVIS`, deliberately not the install folder. Two things
 * happen to install folders that must not cost the user a fresh multi-gigabyte
 * download: an upgrade can replace or move them, and a machine-wide install
 * under `Program Files` cannot be written to at all by a normal account. User
 * data has to survive both, so it lives with the rest of the user's data. The
 * install folder is only a fallback, for the case where local app data itself
 * is not writable.
 */
const LOCAL_DATA = join(process.env.LOCALAPPDATA ?? app.getPath('appData'), APP_FOLDER)

// In a source checkout the working tree already holds `models/`, pulled by
// whoever ran `npm start`, and the bridge resolves everything relative to its
// working directory — so in development the working directory is the repository
// and models are shared with `npm start` instead of downloaded twice.
const DATA_DIR = PACKAGED ? firstWritable(LOCAL_DATA, join(INSTALL_ROOT, 'data')) : APP_ROOT
/**
 * Where the shell's own files live: settings, logs, Chromium's cache.
 *
 * In an installed app that is the same `data` folder as the models. In a source
 * checkout it is a `data/` subfolder, because the point of that mode is to run
 * out of the working tree without dropping `desktop-settings.json` next to
 * `package.json`.
 */
const SHELL_DIR = PACKAGED ? DATA_DIR : join(APP_ROOT, 'data')
const LOG_DIR = join(SHELL_DIR, 'logs')
const LOG_FILE = join(LOG_DIR, 'desktop.log')
const SETTINGS_FILE = join(SHELL_DIR, 'desktop-settings.json')

app.setPath('userData', join(SHELL_DIR, 'electron'))
app.setAppUserModelId(APP_ID)

// The wake word is answered with speech, and a voice assistant started by the
// login item has no click behind it. Without this, Chromium's autoplay policy
// starts every reply muted — which reads as "the installer is broken".
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const DEFAULT_SETTINGS = {
  /** Let JARVIS take real actions — shell, files, devices. Off until asked for. */
  allowWrites: false,
  /** Registered as a login item on first launch; the tray toggles it. */
  startWithWindows: true,
  /** Closing the window quits instead of minimising to the tray. */
  quitOnClose: false,
  /** Whether the setup window has been offered once. */
  setupOffered: false,
  /** Set once the login item has been registered, so we do not fight the user. */
  loginItemRegistered: false,
}

function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let settings = readSettings()
if (WRITES_FLAG) settings.allowWrites = true

function saveSettings() {
  try {
    writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`)
  } catch (error) {
    log(`could not save settings: ${error?.message ?? error}`)
  }
}

/* ---------------------------------------------------------------------- logs */

let logStream = null

/**
 * A GUI app on Windows has no stdout to read. Every line the bridge prints —
 * which model answered, which tool ran, why a turn failed — would otherwise be
 * lost the moment something goes wrong, so it is all mirrored to one file the
 * tray can open.
 */
function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`
  process.stdout.write(`${stamped}\n`)
  try {
    if (!logStream) {
      mkdirSync(LOG_DIR, { recursive: true })
      // One generation of rotation: enough to cover "it crashed last night".
      try {
        if (statSync(LOG_FILE).size > 5 * 1024 * 1024) renameSync(LOG_FILE, `${LOG_FILE}.1`)
      } catch { /* no file yet, or no permission to rotate */ }
      logStream = LOG_FILE
    }
    appendFileSync(logStream, `${stamped}\n`)
  } catch { /* logging must never be the reason startup fails */ }
}

/**
 * An exception is logged, not fatal, for a user: a failed turn is not a reason
 * to close the window they are looking at. The self-test has nobody to click
 * anything, so there a logged exception has to also end the process — otherwise
 * the app keeps running with its work abandoned and the CI step waits for the
 * job's timeout instead of reporting a red build.
 */
function reportFatal(kind, error) {
  log(`${kind}: ${error?.stack ?? error}`)
  if (SELF_TEST) app.exit(3)
}

process.on('uncaughtException', (error) => reportFatal('uncaught exception', error))
process.on('unhandledRejection', (error) => reportFatal('unhandled rejection', error))

if (SELF_TEST) {
  // A build runner has no GPU, and on some images no interactive desktop
  // either. Chromium's attempt to initialise one of those can leave
  // `app.whenReady()` pending forever: no error, no exit code, just a job that
  // runs until it is cancelled. The self-test only needs the interface to be
  // *served* — nothing is painted — so it starts without acceleration and
  // without the sandbox. An installed app, where a person is looking at the
  // window, keeps both.
  app.disableHardwareAcceleration()
  for (const flag of ['disable-gpu', 'disable-gpu-compositing', 'disable-software-rasterizer', 'no-sandbox']) {
    app.commandLine.appendSwitch(flag)
  }

  const watchdog = setTimeout(() => {
    log(`self-test timed out after ${Math.round(SELF_TEST_TIMEOUT_MS / 1000)}s`)
    app.exit(2)
  }, SELF_TEST_TIMEOUT_MS)
  watchdog.unref?.()
}

// The first line of every log. When a shell fails to come up, the question is
// always "how far did it get", and a log that starts mid-sentence cannot say.
log(`shell starting — ${PACKAGED ? 'installed' : 'source checkout'}, version ${app.getVersion()}, data ${DATA_DIR}`)

/* ---------------------------------------------------------------- supervision */

let hud = null
let bridge = null
let tray = null
let win = null
let setupWin = null
let quitting = false
const bridgeRestarts = []

function hudOrigin() {
  return hud ? `http://127.0.0.1:${hud.port}` : `http://127.0.0.1:${HUD_PORT}`
}

function stopProcessTree(child) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') {
      // The bridge owns the model server as a grandchild. SIGTERM does not
      // travel that far on Windows, and an orphaned ollama.exe holding a
      // multi-gigabyte model in RAM after the window closed is precisely the
      // leftover an installer should never leave behind.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      process.kill(child.pid, 'SIGKILL')
    }
  } catch { /* already gone */ }
}

/**
 * Is something already answering on the bridge port?
 *
 * The likeliest cause is the user's own `npm start` session, which is the same
 * brain on the same port and whose origin rules already accept a face on
 * 4173-4199 — exactly the range this shell binds. Starting a second bridge
 * would fail to bind, restart, fail again, and end in a dialog about a broken
 * app. Using the one that is already there is both simpler and true.
 */
async function existingBridge() {
  try {
    const response = await fetch(`${bridgeHttp()}/health`, { signal: AbortSignal.timeout(1200) })
    return response.ok ? await response.json().catch(() => ({})) : null
  } catch {
    return null
  }
}

function startBridge() {
  const env = {
    ...process.env,
    JARVIS_DATA_DIR: DATA_DIR,
    JARVIS_BRIDGE_PORT: String(BRIDGE_PORT),
    JARVIS_HUD_ORIGINS: `${hudOrigin()},http://localhost:${hud?.port ?? HUD_PORT}`,
    JARVIS_RUNTIME_DIR: join(DATA_DIR, 'models', 'runtime'),
    JARVIS_RUNTIME_MODELS: join(DATA_DIR, 'models', 'ollama'),
    JARVIS_RAM_CONFIG: join(DATA_DIR, 'models', 'ram-allocation.json'),
    JARVIS_ALLOW_WRITES: settings.allowWrites ? '1' : '0',
  }

  log(`starting the bridge on port ${BRIDGE_PORT} (writes ${settings.allowWrites ? 'enabled' : 'disabled'})`)
  const child = utilityProcess.fork(join(HERE, 'bridge.mjs'), [], {
    env,
    serviceName: 'jarvis-bridge',
    stdio: 'pipe',
  })
  child.stdout?.on('data', (chunk) => log(`[brain] ${String(chunk).trimEnd()}`))
  child.stderr?.on('data', (chunk) => log(`[brain] ${String(chunk).trimEnd()}`))
  child.once('exit', (code) => {
    bridge = null
    if (quitting) {
      log(`bridge stopped (${code})`)
      return
    }
    log(`bridge exited unexpectedly (${code})`)
    const recent = bridgeRestarts.filter((at) => Date.now() - at < 120_000)
    bridgeRestarts.length = 0
    bridgeRestarts.push(...recent, Date.now())
    if (bridgeRestarts.length > 4) {
      log('bridge keeps failing; not restarting again. Check the Model setup window and the log.')
      void dialog.showMessageBox({
        type: 'warning',
        title: APP_NAME,
        message: 'The local bridge keeps stopping.',
        detail: `It has been restarted four times in two minutes and will stay down now.\n\nOpen the Model setup window, or read:\n${LOG_FILE}`,
      })
      return
    }
    log('restarting the bridge')
    setTimeout(() => { if (!quitting) startBridge() }, 1500)
  })
  bridge = child
  return child
}

function stopBridge() {
  if (!bridge) return
  const child = bridge
  bridge = null
  try { child.kill() } catch { /* already gone */ }
  // Give the graceful path a moment, then make sure of it. The bridge kills the
  // model server it started on the way out; the tree kill covers the rest.
  setTimeout(() => stopProcessTree(child), 1200).unref?.()
}

async function startHud() {
  // 4173 is a convention, not a requirement — and it is also Vite's preview
  // port, so a developer with `npm run preview` open must not turn this app
  // into a blank window. Any free port will do; the bridge is told which one.
  const wanted = [HUD_PORT, ...Array.from({ length: 9 }, (_, index) => HUD_PORT + index + 1), 0]
  for (const port of wanted) {
    try {
      return await startHudServer({
        root: HUD_FILES,
        host: '127.0.0.1',
        port,
        log,
        health: () => ({ app: APP_NAME, port: hud?.port ?? HUD_PORT, bridge: BRIDGE_PORT }),
      })
    } catch (error) {
      if (port === 0) throw error
      log(`interface port ${port} was busy (${error?.message ?? error}); trying the next one`)
    }
  }
  throw new Error('no interface port could be bound')
}

/* -------------------------------------------------------------------- windows */

/**
 * The icon, as a real file.
 *
 * Packaged builds ship the icons twice on purpose: inside the asar archive for
 * the dev path, and beside it in `resources/` because the tray, the taskbar and
 * the installer all want a path the OS itself can open. The first one that
 * exists wins.
 */
function iconPath(preferIco = process.platform === 'win32') {
  const name = preferIco ? 'icon.ico' : 'icon.png'
  const candidates = PACKAGED ? [join(process.resourcesPath, name), join(HERE, name)] : [join(HERE, name)]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

/**
 * Hand a URL to the operating system's browser — but only a web URL.
 *
 * `shell.openExternal` on an arbitrary scheme is a way to launch a local
 * program from a click (`file:`, `ms-msdt:`, an app's own protocol handler),
 * and the interface renders text a model wrote. Two schemes, nothing else.
 */
function openExternally(raw) {
  if (!/^https?:\/\//i.test(raw)) {
    log(`refused to open non-web link: ${raw}`)
    return
  }
  void shell.openExternal(raw)
}

function isHudUrl(raw) {
  try {
    const url = new URL(raw)
    return url.hostname === '127.0.0.1' && url.port === String(hud?.port ?? HUD_PORT)
  } catch {
    return false
  }
}

function createWindow({ show = !HIDDEN_START } = {}) {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#01060c',
    title: APP_NAME,
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The wake word and the voice loop are the point of the app; a hidden
      // window that Chromium decides to throttle is a window that stops
      // listening the moment the user looks at something else.
      backgroundThrottling: false,
    },
  })

  if (process.platform !== 'darwin') win.setMenuBarVisibility(false)

  win.once('ready-to-show', () => {
    if (show) win?.show()
  })

  // Links to the wider web open where they belong. The interface frames
  // articles through the bridge on purpose; a publisher's own page, or an
  // OAuth flow, has no business replacing the HUD.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isHudUrl(url)) return
    event.preventDefault()
    openExternally(url)
  })

  // Keyboard affordances a desktop user expects. The menu bar is hidden, so
  // these are the only way to reload or inspect the interface.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const devtools = (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i'
    if (input.key === 'F12' || devtools) {
      win?.webContents.toggleDevTools()
      event.preventDefault()
    } else if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
      win?.webContents.reload()
      event.preventDefault()
    }
  })

  win.on('close', (event) => {
    if (quitting || settings.quitOnClose) return
    // Keeping the assistant alive in the tray is the desktop behaviour people
    // expect from something that listens for a wake word.
    event.preventDefault()
    win?.hide()
  })

  win.on('closed', () => { win = null })

  log(`loading the interface from ${hudOrigin()}`)
  void win.loadURL(`${hudOrigin()}/`)
}

function showWindow() {
  if (!win) {
    createWindow({ show: true })
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * The one-click model installer, in its own window.
 *
 * It is served by the bridge (`/install`) rather than shipped as a page in the
 * bundle, because the page's whole job is to talk to the bridge's planner and
 * installer endpoints — and because `npm start` deliberately opens the very
 * same page in a browser. One page, two shells.
 */
function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.show()
    setupWin.focus()
    return
  }
  setupWin = new BrowserWindow({
    width: 1120,
    height: 860,
    title: `${APP_NAME} — model setup`,
    icon: iconPath(),
    autoHideMenuBar: true,
    backgroundColor: '#01060c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  setupWin.on('closed', () => { setupWin = null })

  // The setup page links back to the interface when it is done. That link
  // belongs to the window the interface is already in — loading it here would
  // turn the installer into a second, silent copy of the app — and anything
  // else the page might link to belongs in the user's browser.
  setupWin.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })
  setupWin.webContents.on('will-navigate', (event, url) => {
    if (isHudUrl(url)) {
      event.preventDefault()
      showWindow()
      return
    }
    if (!url.startsWith(bridgeHttp())) {
      event.preventDefault()
      openExternally(url)
    }
  })

  void setupWin.loadURL(`${bridgeHttp()}/install?hud=${encodeURIComponent(hudOrigin())}`)
}

function bridgeHttp() {
  return `http://127.0.0.1:${BRIDGE_PORT}`
}

/* ----------------------------------------------------------------------- tray */

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: `Open ${APP_NAME}`, click: showWindow },
    { label: 'Model setup…', click: openSetup },
    { type: 'separator' },
    {
      label: 'Let JARVIS take actions (writes)',
      type: 'checkbox',
      checked: settings.allowWrites,
      click: (item) => {
        settings.allowWrites = item.checked
        saveSettings()
        refreshTrayMenu()
        log(`writes ${settings.allowWrites ? 'enabled' : 'disabled'}; restarting the bridge`)
        stopBridge()
        setTimeout(() => { if (!quitting) startBridge() }, 800)
      },
    },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: settings.startWithWindows && app.getLoginItemSettings().openAtLogin,
      enabled: PACKAGED,
      click: (item) => {
        settings.startWithWindows = item.checked
        settings.loginItemRegistered = item.checked
        saveSettings()
        refreshTrayMenu()
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          args: ['--hidden'],
        })
      },
    },
    {
      label: 'Close window quits',
      type: 'checkbox',
      checked: settings.quitOnClose,
      click: (item) => {
        settings.quitOnClose = item.checked
        saveSettings()
        refreshTrayMenu()
      },
    },
    { type: 'separator' },
    { label: 'Open logs', click: () => { void shell.openPath(LOG_FILE) } },
    { label: 'Open data folder', click: () => { void shell.openPath(DATA_DIR) } },
    { label: 'Developer tools', click: () => { win?.webContents.toggleDevTools() } },
    { type: 'separator' },
    { label: 'Restart', click: () => { app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') }) ; app.exit(0) } },
    { label: `Quit ${APP_NAME}`, click: () => { quitting = true; app.quit() } },
  ])
}

/** Rebuild the menu so a checkbox the user just clicked reads correctly. */
function refreshTrayMenu() {
  try { tray?.setContextMenu(trayMenu()) } catch { /* tray gone */ }
}

function createTray() {
  try {
    const image = nativeImage.createFromPath(iconPath())
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
    tray.setToolTip(`${APP_NAME} — say “Hey Jarvis”`)
    tray.setContextMenu(trayMenu())
    tray.on('click', showWindow)
    tray.on('double-click', showWindow)
  } catch (error) {
    log(`tray icon unavailable: ${error?.message ?? error}`)
  }
}

/* ----------------------------------------------------------------- permissions */

/**
 * Chromium's own prompt for the microphone and the camera, answered for the
 * HUD and for nothing else. A page cannot grant itself a microphone by
 * accident this way, and the user is not asked the same question on every
 * launch — which, for an assistant whose whole front end is a wake word, is
 * the difference between an appliance and a demo.
 */
function wirePermissions() {
  // Exactly the permissions this interface uses: the microphone and the camera
  // (both arrive as `media`), desktop notifications for the proactive panel, and
  // the clipboard its copy buttons write to. Anything else — geolocation, USB,
  // serial, screen capture — is refused, because a grant here is silent and
  // permanent and nothing in the app has asked for one.
  const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = details?.requestingUrl ?? contents?.getURL?.() ?? ''
    const ok = allowed.has(permission) && isHudUrl(url)
    if (!ok) log(`refused ${permission} for ${url || 'unknown origin'}`)
    callback(ok)
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return allowed.has(permission) && isHudUrl(requestingOrigin)
  })
}

/* -------------------------------------------------------------------- startup */

async function waitForBridge(deadlineMs = 120_000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${bridgeHttp()}/health`, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return await response.json()
    } catch { /* still binding */ }
    await new Promise((done) => setTimeout(done, 500))
  }
  return null
}

/**
 * A WebSocket handshake, spoken by hand.
 *
 * `ws` is a dependency and could be imported here, but a self-test that needs
 * the very module it is testing to be loadable from an asar archive is a
 * self-test with a blind spot. This is fifteen lines of HTTP: the answer is
 * either 101 (upgraded) or the status the bridge refused the origin with.
 */
function handshake(origin) {
  return new Promise((done) => {
    const req = request({
      host: '127.0.0.1',
      port: BRIDGE_PORT,
      path: '/',
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        origin,
      },
    })
    const settle = (value) => { done(value) }
    req.on('upgrade', (res, socket) => { socket.destroy(); settle(res.statusCode ?? 101) })
    req.on('response', (res) => { res.resume(); settle(res.statusCode ?? 0) })
    req.on('error', () => settle(0))
    req.setTimeout(8000, () => { req.destroy(); settle(0) })
    req.end()
  })
}

async function runSelfTest() {
  log('self-test: running')
  const results = []
  const record = (name, ok, detail = '') => {
    results.push({ name, ok, detail })
    log(`self-test ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  }

  record('the built interface is present', existsSync(join(HUD_FILES, 'index.html')), HUD_FILES)

  hud = await startHud()
  const served = await fetch(`${hudOrigin()}/`, { signal: AbortSignal.timeout(8000) }).catch((error) => ({ ok: false, error }))
  record('the interface server answers', Boolean(served.ok), served.error ? `${hudOrigin()} — ${served.error.message}` : hudOrigin())

  // Percent-encoded, because `new URL()` collapses a literal `..` before the
  // request is ever sent — the naive spelling tests nothing but the 404 page.
  const traversal = await fetch(`${hudOrigin()}/%2e%2e/%2e%2e/package.json`)
  record('path traversal is refused', traversal.status === 400 || traversal.status === 404, `HTTP ${traversal.status}`)

  startBridge()
  const health = await waitForBridge()
  record('the bridge answers /health', Boolean(health), health ? `ok=${health.ok}` : 'timed out')

  // The handshake is the one place the bridge decides who may drive it, and a
  // shell that produces a window the bridge then refuses is the exact failure
  // this packaging has to rule out. The negative case is checked too: an
  // installed app that quietly started accepting any origin would otherwise
  // pass this test while being wide open.
  const allowed = await handshake(hudOrigin())
  record('the bridge accepts the interface origin', allowed === 101, `HTTP ${allowed}`)
  const refused = await handshake('http://not-this-app.example')
  record('the bridge refuses a foreign origin', refused === 403, `HTTP ${refused}`)

  const failed = results.filter((entry) => !entry.ok)
  log(`self-test: ${results.length - failed.length}/${results.length} checks passed`)
  return failed.length === 0 ? 0 : 1
}

async function main() {
  if (!existsSync(join(HUD_FILES, 'index.html'))) {
    // `dialog.showErrorBox` blocks until it is dismissed. That is right for a
    // person and fatal for the self-test, which would sit behind the dialog
    // until the CI job times out instead of reporting the missing folder.
    const advice = PACKAGED
      ? 'Reinstall the application — the installer did not finish copying its files.'
      : 'Run `npm run build` first, then start the desktop shell again.'
    log(`${APP_NAME} is not complete: ${HUD_FILES} has no index.html. ${advice}`)
    if (!SELF_TEST) dialog.showErrorBox(`${APP_NAME} is not complete`, `The interface files are missing from:\n${HUD_FILES}\n\n${advice}`)
    app.exit(1)
    return
  }

  if (SELF_TEST) {
    const code = await runSelfTest()
    quitting = true
    stopBridge()
    await hud?.close()
    app.exit(code)
    return
  }

  hud = await startHud()
  log(`interface served from ${hudOrigin()} (${HUD_FILES})`)

  const already = await existingBridge()
  if (already) {
    log(`a bridge is already answering on port ${BRIDGE_PORT}; using it instead of starting a second one`)
  } else {
    startBridge()
  }

  wirePermissions()

  if (process.platform === 'darwin') {
    // A desktop app with no menu cannot copy or paste on macOS.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]))
  } else {
    Menu.setApplicationMenu(null)
  }

  createTray()
  createWindow()

  // Registering the login item on first launch is the behaviour the earlier
  // shell script promised; the tray toggle is how a user turns it off, and it
  // is never done in a source checkout where "start with Windows" would mean
  // starting an Electron dev binary at login.
  if (PACKAGED && settings.startWithWindows && !settings.loginItemRegistered) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
    settings.loginItemRegistered = true
    saveSettings()
  }

  // First launch on a machine with no models: the interface is up but cannot
  // think yet, and the fix is one window away. Offer it once, then stay out of
  // the way — the MODEL STACK panel keeps the same installer reachable forever.
  if (!settings.setupOffered) {
    const health = await waitForBridge(30_000)
    if (!health?.ok) openSetup()
    settings.setupOffered = true
    saveSettings()
  }
}

if (!app.requestSingleInstanceLock()) {
  // The tray is where a second launch should land, not a second copy of the
  // app holding a second model server.
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.on('window-all-closed', () => {
    // Staying alive in the tray is the point; `quitting` is set by the tray's
    // Quit item and by before-quit below.
    if (quitting || settings.quitOnClose) app.quit()
  })

  // A crashed renderer is not a reason to lose the assistant. Reload the face;
  // the bridge and the models never went anywhere.
  app.on('render-process-gone', (_event, contents, details) => {
    log(`renderer gone: ${details?.reason ?? 'unknown'}`)
    if (!quitting && contents === win?.webContents) setTimeout(() => win?.reload(), 1000)
  })

  // macOS convention, and harmless everywhere else: clicking the dock icon of
  // a running app should bring its window back.
  app.on('activate', () => {
    if (!quitting) showWindow()
  })

  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', (event) => {
    if (bridge) {
      event.preventDefault()
      stopBridge()
      void hud?.close()
      setTimeout(() => app.quit(), 1400)
    }
  })

  // Electron's `whenReady()` waits on a window system. On a CI runner without
  // one it can stay pending forever, and a self-test that waits on it reports
  // nothing at all: the job hangs and the watchdog's single line is the only
  // evidence. So it is bounded, and the answer is written down — everything the
  // self-test exercises is loopback, and a HUD server and a utility-process
  // bridge do not need a display to answer on 127.0.0.1.
  log('waiting for Electron to finish starting')
  const ready = await Promise.race([
    app.whenReady().then(() => true).catch(() => false),
    new Promise((done) => {
      const timer = setTimeout(() => done(false), 30_000)
      timer.unref?.()
    }),
  ])
  log(ready
    ? (SELF_TEST ? 'electron is ready; running the self-test' : 'electron is ready; opening the window')
    : 'electron did not finish starting within 30s; continuing without it')

  try {
    await main()
  } catch (error) {
    log(`startup failed: ${error?.stack ?? error}`)
    // A modal dialog in self-test mode would block until the CI job's timeout:
    // the exit code and the log are the report there.
    if (!SELF_TEST) {
      dialog.showErrorBox(
        `${APP_NAME} could not start`,
        `${error?.message ?? error}\n\nLog file:\n${LOG_FILE}`,
      )
    }
    app.exit(1)
  }
}
