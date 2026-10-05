/**
 * The installed app's face: a loopback static server for `dist/`.
 *
 * `npm start` runs Vite to serve the HUD, and Vite is a build tool — a
 * development server with a module graph, a file watcher and an HMR socket,
 * none of which an installed app should ship. The built `dist/` is plain files,
 * so this is the smallest thing that can serve them, and it exists for three
 * reasons that matter:
 *
 *   1. A page needs an http origin. `file://` has none to speak of, so the
 *      microphone is refused, the bridge refuses the socket (its Origin check
 *      would see `null`), and localStorage is a different, emptier bucket.
 *   2. Nothing here touches the disk outside `root`. Every request path is
 *      resolved and then checked to still be inside the directory it was asked
 *      for, so a crafted `../../` cannot hand out the rest of the disk. The
 *      bridge has a file endpoint of its own for the files JARVIS is meant to
 *      show; this one has no business serving anything but the interface.
 *   3. It binds 127.0.0.1 only. The HUD is for the person sitting at the
 *      machine, and a static server on 0.0.0.0 would be a page anyone on the
 *      same network could read.
 *
 * No dependencies, no watching, no transforms: read a file, guess its type,
 * stream it, done. The HUD is a single page with hashed assets, so the only
 * caching decision here is "hashed bundles may be cached forever, index.html
 * may never be cached at all".
 */

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
}

/** Long-lived only for content-hashed filenames, which is every bundle Vite emits. */
function cacheControl(pathname) {
  if (pathname === '/' || pathname.endsWith('/index.html')) return 'no-store'
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  return 'public, max-age=3600'
}

async function fileFor(root, pathname) {
  // Decode first: a percent-encoded `..` is still a traversal attempt, and it
  // has to be judged as the path it actually names.
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const relative = normalize(decoded).replace(/^([/\\])+/, '')
  const target = resolve(join(root, relative))
  // `resolve` collapses `..` for us; the check is that the collapse did not
  // climb out of root. Comparing with the separator appended stops `/distfoo`
  // from passing as a child of `/dist`.
  if (target !== root && !target.startsWith(root + sep)) return null
  return target
}

/**
 * @param {{ root: string, host?: string, port?: number, health?: () => object, log?: (line: string) => void }} options
 * @returns {Promise<{ port: number, url: string, close: () => Promise<void> }>}
 */
export async function startHudServer({ root, host = '127.0.0.1', port = 0, health = null, log = () => {} }) {
  const servedRoot = resolve(root)

  const server = createServer((req, res) => {
    void (async () => {
      const method = req.method ?? 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        return res.end()
      }

      const pathname = (req.url ?? '/').split('?')[0].split('#')[0]

      // The launcher's own liveness probe. It answers before the UI exists, so
      // a second double-click can tell "already running" from "not running"
      // without ever loading the page.
      if (health && (pathname === '/__jarvis' || pathname === '/__jarvis/')) {
        const body = JSON.stringify({ ok: true, ...health() })
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(body),
        })
        return res.end(method === 'HEAD' ? undefined : body)
      }

      let target = await fileFor(servedRoot, pathname)
      if (!target) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        return res.end('Bad request')
      }

      let info = await stat(target).catch(() => null)
      if (info?.isDirectory()) {
        target = join(target, 'index.html')
        info = await stat(target).catch(() => null)
      }

      // A client-side route that is not a file on disk still gets the app, so a
      // deep link into the interface is not a 404. Only extensionless paths
      // qualify: a missing `.js` must fail loudly rather than be answered with
      // HTML, which is the classic way a module load turns into a syntax error.
      if (!info?.isFile() && !extname(pathname)) {
        target = join(servedRoot, 'index.html')
        info = await stat(target).catch(() => null)
      }

      if (!info?.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        return res.end('Not found')
      }

      const headers = {
        'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': cacheControl(pathname),
        // The interface is ours and its type is decided by the extension. A
        // browser that sniffs an uploaded-looking file into `text/html` is a
        // browser that will run it.
        'x-content-type-options': 'nosniff',
      }
      res.writeHead(200, headers)
      if (method === 'HEAD') return res.end()

      const stream = createReadStream(target)
      // A file can disappear between the stat and the read (an installer, an
      // antivirus, a user cleaning up), and a client can hang up mid-transfer.
      // Without these two lines either one is an unhandled 'error' event, which
      // in Node means the process — and with it the window's interface — dies.
      stream.on('error', (error) => {
        log(`could not read ${target}: ${error?.message ?? error}`)
        res.destroy()
      })
      res.on('close', () => stream.destroy())
      stream.pipe(res)
    })().catch((error) => {
      log(`request failed: ${error?.message ?? error}`)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end()
    })
  })

  server.on('error', (error) => {
    log(`server error: ${error?.message ?? error}`)
  })

  await new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(port, host, () => {
      server.removeListener('error', fail)
      done()
    })
  })

  const bound = server.address()
  const boundPort = typeof bound === 'object' && bound ? bound.port : port
  return {
    port: boundPort,
    url: `http://${host}:${boundPort}`,
    close: () =>
      new Promise((done) => {
        server.close(() => done())
        // Sockets held open by a paused video or a hung request must not keep
        // the process alive after the user has asked it to stop.
        server.closeAllConnections?.()
      }),
  }
}
