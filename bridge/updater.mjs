/**
 * Automatic updates.
 *
 * The brief: the app should fetch and apply its own updates without being asked,
 * and keep running through it.
 *
 * The design constraint is that this process *is* the thing being updated. You
 * cannot overwrite a running executable on Windows — the loader holds it open —
 * so the swap has to be staged and deferred:
 *
 *   1. check the repo's latest release
 *   2. download the installer beside the running one
 *   3. if we are running as an installed app, spawn the installer and exit
 *   4. if we are running from source, stage the files and swap on next boot
 *
 * Step 3 is why this is a separate module rather than a branch in the agent loop.
 * Killing the process that is mid-conversation to install a patch is a bad
 * trade, so the default is to report and let a human decide; `auto` makes it
 * happen anyway.
 *
 * Everything is GitHub Releases, because that is where CI already publishes the
 * installer and it needs no credentials for a public repo.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

/** The repo the releases come from. */
export const REPO = 'luckyassociation1107/jarvis'

/** Where staged downloads go. */
const STAGE = join(dirname(fileURLToPath(import.meta.url)), '..', '.update')

const GB = 1024 * 1024 * 1024

/**
 * Compare two semver-ish tags.
 *
 * Releases are tagged `v1.2.3`, but CI also pushes commit SHAs. Only proper
 * `vMAJOR.MINOR.PATCH` tags are comparable; anything else is ignored rather than
 * guessed at, because comparing a SHA to a version number produces nonsense.
 *
 * @returns {number} negative if a<b, 0 if equal, positive if a>b
 */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

/**
 * Is a release tag something we should consider installing?
 *
 * Pre-releases are excluded. Someone publishing `v1.3.0-beta.1` wants it tested
 * by people who opted in, not pushed onto every machine that rebooted.
 */
function isInstallable(tag) {
  return /^v?\d+\.\d+\.\d+$/.test(String(tag))
}

/**
 * What version are we running?
 *
 * Read from package.json rather than a constant, so it cannot drift from what
 * was actually published.
 */
export async function currentVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'))
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Ask GitHub what the newest release is.
 *
 * @returns {Promise<{tag:string, name:string, body:string, assets:Array, url:string}|null>}
 */
export async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'jarvis-updater' },
  })
  if (res.status === 404) return null // no releases published yet
  if (!res.ok) throw new Error(`GitHub said ${res.status}`)
  const j = await res.json()
  return {
    tag: j.tag_name,
    name: j.name ?? j.tag_name,
    body: j.body ?? '',
    url: j.html_url,
    assets: (j.assets ?? []).map((a) => ({
      name: a.name,
      size: a.size,
      url: a.browser_download_url,
      downloads: a.download_count,
    })),
  }
}

/**
 * Check for an update.
 *
 * @returns {Promise<{available:boolean, current:string, latest:string, release:object|null}>}
 */
export async function check() {
  const current = await currentVersion()
  let rel = null
  try {
    rel = await latestRelease()
  } catch {
    // A failed check is not a failed update. The caller gets available:false and
    // the reason, rather than an exception it has to know how to handle.
    return { available: false, current, latest: current, release: null, error: 'could not reach GitHub' }
  }
  if (!rel) return { available: false, current, latest: current, release: null, error: 'no releases yet' }

  // Only installable tags count. A SHA tag is newer in time but not in version.
  const newest = rel.assets.length && isInstallable(rel.tag) ? rel : null
  if (!newest) {
    return { available: false, current, latest: rel.tag, release: rel, error: `tag ${rel.tag} is not a version` }
  }
  const available = compareVersions(rel.tag, current) > 0
  return { available, current, latest: rel.tag, release: rel }
}

/** The installer asset from a release, if there is one. */
function installerAsset(release) {
  if (!release) return null
  return (
    release.assets.find((a) => /^jarvis-setup.*\.exe$/i.test(a.name)) ??
    release.assets.find((a) => /\.exe$/i.test(a.name)) ??
    release.assets.find((a) => /\.dmg$/i.test(a.name)) ??
    null
  )
}

/**
 * Download a release asset to a path, reporting progress.
 *
 * @param {string} url
 * @param {string} dest
 * @param {(p:{received:number,total:number}) => void} [onProgress]
 */
export async function download(url, dest, onProgress = () => {}) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download said ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
  onProgress({ received: buf.length, total: total || buf.length })
  return { path: dest, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }
}

/**
 * Apply an update.
 *
 * `auto` spawns the installer and exits this process. That is deliberate: the
 * installer cannot replace files this process has open, so the only safe moment
 * to swap is after we are gone. Without `auto` it stages and reports, and a
 * human runs it.
 *
 * @param {{auto?:boolean, onStep?:Function}} [opts]
 */
export async function apply(opts = {}) {
  const { auto = false, onStep = () => {} } = opts
  const result = await check()

  if (result.error) return { ok: false, reason: result.error, current: result.current }
  if (!result.available) return { ok: false, reason: 'already current', current: result.current, latest: result.latest }

  const asset = installerAsset(result.release)
  if (!asset) return { ok: false, reason: `release ${result.latest} has no installer`, current: result.current }

  onStep({ phase: 'download', tag: result.latest, asset: asset.name, size: asset.size })
  await mkdir(STAGE, { recursive: true })
  const dest = join(STAGE, asset.name)

  const dl = await download(asset.url, dest, (p) => onStep({ phase: 'progress', ...p }))
  onStep({ phase: 'downloaded', ...dl })

  if (!auto) {
    return {
      ok: true,
      applied: false,
      staged: dest,
      from: result.current,
      to: result.latest,
      note: 'staged, not applied — run the installer or call again with auto:true',
    }
  }

  onStep({ phase: 'applying', from: result.current, to: result.latest })

  // Windows: the installer does the swap. Spawn it detached so it survives us,
  // then exit. /S is Inno Setup's silent flag; without it a dialog appears and
  // the user has to click through it, which is not "automated".
  if (process.platform === 'win32') {
    const child = spawn(dest, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    // Give the installer a moment to start before we vanish, or a fast exit can
    // race it and leave nothing running.
    await new Promise((r) => setTimeout(r, 1500))
    onStep({ phase: 'exiting' })
    process.exit(0)
  }

  // macOS: a .dmg is mounted by the user. Stage it and say so.
  return {
    ok: true,
    applied: false,
    staged: dest,
    from: result.current,
    to: result.latest,
    note: 'macOS needs the .dmg mounted by hand — staged beside the bridge',
  }
}

/** One line for the boot banner. */
export async function banner() {
  const r = await check()
  if (r.available) return `update: ${r.current} → ${r.latest} available`
  return `update: current (${r.current})`
}
