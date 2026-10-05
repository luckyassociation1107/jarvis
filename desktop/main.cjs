// Installed desktop shell: serve the production UI from loopback and run the
// local bridge inside Electron's Node-capable main process.
const { app, BrowserWindow, shell, dialog, session } = require('electron')
const { createServer } = require('node:http')
const { readFile } = require('node:fs/promises')
const { join, resolve, sep, extname } = require('node:path')
const { mkdirSync, existsSync } = require('node:fs')
const { spawn } = require('node:child_process')

const types = {
  '.css': 'text/css',
  '.glb': 'model/gltf-binary',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}

let server
let window
let runtime

// Keep Electron's profile and JARVIS data outside app.asar. Prefer LocalAppData:
// Ollama models can occupy many GB and should not roam with a Windows profile.
const data = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'JARVIS')
  : app.getPath('userData')
app.setPath('userData', data)

async function launch() {
  const root = app.getAppPath()
  mkdirSync(data, { recursive: true })
  process.chdir(data)
  process.env.JARVIS_RUNTIME_DIR = join(data, 'models', 'runtime')
  process.env.JARVIS_RUNTIME_MODELS = join(data, 'models', 'ollama')

  const dist = join(root, 'dist')
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const file = resolve(dist, '.' + pathname)
      if (file !== dist && !file.startsWith(dist + sep)) {
        res.writeHead(403).end()
        return
      }
      const target = pathname === '/' ? join(dist, 'index.html') : file
      const body = await readFile(target)
      res.writeHead(200, {
        'Content-Type': types[extname(target)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end('Not found')
    }
  })

  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok))
  const origin = `http://127.0.0.1:${server.address().port}`
  process.env.JARVIS_ALLOWED_ORIGINS = origin

  // The HUD needs camera/microphone access for its voice and vision features.
  // Grant media permission only to this app's own loopback origin.
  const isAppOrigin = (url) => {
    try { return new URL(url).origin === origin } catch { return false }
  }
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || webContents?.getURL() || ''
    callback(permission === 'media' && isAppOrigin(requestingUrl))
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    permission === 'media' && isAppOrigin(requestingOrigin),
  )

  // Start the project-local Ollama runtime if the user has installed it and
  // there is not already an Ollama server answering on the default port.
  const binary = join(data, 'models', 'runtime', 'ollama.exe')
  if (existsSync(binary)) {
    try {
      const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1000) })
      if (!response.ok) throw new Error('not ready')
    } catch {
      runtime = spawn(binary, ['serve'], {
        windowsHide: true,
        env: { ...process.env, OLLAMA_MODELS: process.env.JARVIS_RUNTIME_MODELS },
      })
      runtime.on('error', (error) => console.error('Ollama:', error))
    }
  }

  await import('../bridge/server.mjs')
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppOrigin(url)) event.preventDefault()
  })
  await window.loadURL(origin)
  window.on('closed', () => app.quit())
}

app.whenReady().then(() => launch().catch((error) => {
  dialog.showErrorBox('JARVIS could not start', String(error.stack || error))
  app.quit()
}))
app.on('before-quit', () => { server?.close(); runtime?.kill() })
app.on('window-all-closed', () => app.quit())
