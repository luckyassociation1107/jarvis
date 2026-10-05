// Installed desktop shell: serve the production UI from loopback and run the
// local bridge inside Electron's Node-capable main process.
const { app, BrowserWindow, shell, dialog } = require('electron')
const { createServer } = require('node:http')
const { readFile } = require('node:fs/promises')
const { join, resolve, sep, extname } = require('node:path')
const { mkdirSync, existsSync } = require('node:fs')
const { spawn } = require('node:child_process')

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary' }
let server
let window
let runtime

async function launch() {
  const root = app.getAppPath()
  // The runtime and downloaded models must survive upgrades; ASAR is read-only.
  const data = app.getPath('userData')
  mkdirSync(data, { recursive: true })
  process.chdir(data)
  process.env.JARVIS_RUNTIME_DIR = join(data, 'models', 'runtime')
  process.env.JARVIS_RUNTIME_MODELS = join(data, 'models', 'ollama')
  const dist = join(root, 'dist')
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const file = resolve(dist, '.' + pathname)
      if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(403).end(); return }
      const target = pathname === '/' ? join(dist, 'index.html') : file
      const body = await readFile(target)
      res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' })
      res.end(body)
    } catch { res.writeHead(404).end('Not found') }
  })
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok))
  const origin = `http://localhost:${server.address().port}`
  process.env.JARVIS_ALLOWED_ORIGINS = origin
  // Persistent writable working directory for downloads, allocation and memory.
  const binary = join(data, 'models', 'runtime', 'ollama.exe')
  if (existsSync(binary)) {
    try {
      const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1000) })
      if (!response.ok) throw new Error('not ready')
    } catch {
      runtime = spawn(binary, ['serve'], { windowsHide: true, env: { ...process.env, OLLAMA_MODELS: process.env.JARVIS_RUNTIME_MODELS } })
      runtime.on('error', (error) => console.error('Ollama:', error))
    }
  }
  await import('../bridge/server.mjs')
  window = new BrowserWindow({ width: 1440, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/')) event.preventDefault() })
  await window.loadURL(origin)
  window.on('closed', () => app.quit())
}

app.whenReady().then(() => launch().catch((error) => {
  dialog.showErrorBox('JARVIS could not start', String(error.stack || error))
  app.quit()
}))
app.on('before-quit', () => { server?.close(); runtime?.kill() })
app.on('window-all-closed', () => app.quit())
