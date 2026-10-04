/**
 * What this machine can actually do.
 *
 * The model used to be told about the machine only through the tools it was
 * handed, so "can you do X" was answered from imagination: either a reflexive
 * no, or a confident yes that quietly produced nothing. This module reverses
 * that. It probes the host — the programs that are installed, the disk and RAM
 * headroom, whether writes are enabled, which local model slots are filled,
 * which servers are connected — and renders one compact block that is placed at
 * the top of the system prompt. The model plans against facts instead of
 * assumptions, and when it has to say no it can name the missing piece rather
 * than shrugging.
 *
 * The block is a snapshot, so it says so: the live tools win whenever they
 * disagree with it.
 */
import { arch, cpus, loadavg, release, totalmem, homedir } from 'node:os'
import { statfsSync } from 'node:fs'
import { programPath, shellMode, shellRoots, allowList } from './shell.mjs'
import { desktopCapabilities } from './desktop.mjs'
import { availableRam } from './autopilot.mjs'

const GB = 1024 ** 3

/**
 * The programs worth knowing about, chosen so that a missing one changes a
 * plan rather than merely being absent. Not the allowlist — this is a probe
 * list, and an entry here means "the machine has this capability". Names are
 * what Windows' own resolver accepts: `python`, not `python3`; `soffice`, not
 * `libreoffice`. PowerShell and cmd are probed too, because on Windows they are
 * the difference between a script and no script.
 */
export const PROBE_PROGRAMS = [
  // media
  'ffmpeg', 'ffprobe', 'magick', 'sox', 'yt-dlp', 'tesseract',
  // documents
  'pandoc', 'pdftotext', 'soffice', 'qpdf',
  // development
  'git', 'node', 'npm', 'npx', 'python', 'pip', 'docker', 'dotnet', 'cargo', 'go', 'code',
  // data and files
  'jq', 'sqlite3', 'curl', 'wget', 'tar', '7z', 'ssh', 'scp', 'robocopy', 'winget',
  // the shell itself
  'powershell', 'pwsh', 'cmd', 'where', 'findstr', 'tasklist',
]

/** Everything worth probing here — the list is already Windows-shaped. */
export function probePrograms() {
  return [...PROBE_PROGRAMS]
}

/**
 * A one-minute cache for the program probe.
 *
 * Resolving a name walks every directory on PATH, and there are thirty-odd
 * names here — seconds of work that cannot sit in front of a spoken answer.
 * A minute is short enough that an install the user just asked for shows up in
 * the next few questions, and long enough that the cost is paid once.
 */
const PROBE_TTL_MS = 60_000
const probeCache = new Map()

function memoisedProbe(platform) {
  const now = Date.now()
  let entry = probeCache.get(platform)
  if (!entry || now - entry.at > PROBE_TTL_MS) {
    const names = probePrograms(platform)
    entry = { at: now, names, present: new Set(names.filter((name) => programPath(name))) }
    probeCache.set(platform, entry)
  }
  return entry
}

function memoisedHas(platform) {
  return (name) => memoisedProbe(platform).present.has(name) || Boolean(programPath(name))
}

/** How many program names to spell out before summarising the rest. */
const LIST_CAP = 24

const list = (names, cap = LIST_CAP) =>
  names.length <= cap ? names.join(', ') : `${names.slice(0, cap).join(', ')}, and ${names.length - cap} more`

/**
 * Probe the host. Every field can be overridden, which is what makes the
 * renderer below testable without a desktop session or a particular toolchain.
 */
export function gatherCapabilities({
  platform = process.platform,
  env = process.env,
  has = memoisedHas(platform),
  slots = [],
  servers = [],
  writes = false,
  mode = null,
  allow = null,
  roots = null,
  freeBytes = null,
  diskBytes = null,
  quota = null,
} = {}) {
  const caps = desktopCapabilities({ platform })
  const probed = probePrograms(platform)
  const installed = probed.filter((name) => has(name))
  const missing = probed.filter((name) => !has(name))
  const free = freeBytes ?? availableRam()
  const total = totalmem()
  let disk = diskBytes
  let diskPath = homedir()
  if (disk === null) {
    try {
      const fs = statfsSync(diskPath)
      disk = fs.bavail * fs.bsize
    } catch {
      disk = null
    }
  }
  const own = roots ?? shellRoots(env)
  return {
    platform,
    arch: arch(),
    release: release(),
    cores: cpus().length,
    load1: loadavg()[0] ?? 0,
    totalRamGb: Number((total / GB).toFixed(1)),
    freeRamGb: Number((free / GB).toFixed(2)),
    diskFreeGb: disk === null ? null : Number((disk / GB).toFixed(1)),
    diskPath,
    session: caps.session,
    gaps: caps.gaps,
    pointer: caps.pointer,
    installed,
    missing,
    writes,
    shellMode: mode ?? shellMode(env),
    shellAllowCount: allow?.size ?? allowList(env).size,
    roots: own.map((root) => root),
    slots,
    servers,
    quota,
  }
}

/**
 * Render the block. Pure: same facts in, same text out. Plain declarative
 * sentences because the model reads it as facts, not as a persona.
 */
export function summariseCapabilities(facts) {
  const {
    platform, arch: cpuArch, cores, load1, totalRamGb, freeRamGb, diskFreeGb, diskPath,
    session, gaps, installed, missing, writes, shellMode: mode, shellAllowCount, roots,
    slots, servers, quota,
  } = facts

  const lines = ['WHAT THIS MACHINE CAN DO — probed now, and again before every question:']
  lines.push(
    `- Host: ${platform} ${cpuArch}, ${cores} cores, ${totalRamGb} GB RAM with ${freeRamGb} GB free right now` +
      (diskFreeGb === null ? '.' : `, ${diskFreeGb} GB free on the volume holding ${diskPath}, load ${load1.toFixed(2)}.`),
  )
  if (session === 'windows') {
    lines.push('- Desktop: Windows, driven through PowerShell and user32 — pointer, typing and window control are available with nothing to install.')
    if (gaps.length > 0) lines.push(`- Control gaps: ${gaps.join('; ')}.`)
  } else {
    lines.push('- Desktop: this host is not Windows, so screen and window control are off. JARVIS drives the desktop on Windows only.')
  }
  lines.push(`- Programs installed here: ${installed.length > 0 ? list(installed) : 'none of the ones worth checking'}.`)
  if (missing.length > 0) {
    lines.push(`- Programs not installed: ${list(missing)}. For anything that needs one, plan the nearest route with what is here, or name the install that would unlock it.`)
  }
  lines.push(
    mode === 'full'
      ? '- Command line: full — any program the deny list permits.'
      : `- Command line: allowlist (${shellAllowCount} programs)${writes ? '' : ', and writes are off, so run_command is not registered'}.`,
  )
  lines.push(
    writes
      ? '- Acting tools: on — commands, apps, windows, pointer and keyboard can change this machine.'
      : '- Acting tools: off — commands that change things and every desktop action are not registered. Say write mode is needed rather than pretending.',
  )
  lines.push(`- Working directories for commands: ${list(roots.map(String), 6)}.`)
  if (Array.isArray(slots) && slots.length > 0) {
    const painted = slots.map((entry) => `${entry.slot}=${entry.model ?? 'none'}${entry.fits === false ? ' (over allocation)' : ''}`)
    lines.push(`- Local model slots: ${painted.join(', ')}${quota ? `, ceiling ${quota}` : ''}.`)
  }
  if (Array.isArray(servers) && servers.length > 0) {
    lines.push(`- Servers connected: ${servers.join(', ')}.`)
  }
  lines.push('- This block is a probe, refreshed before each question; the live tools still win. desktop_capabilities, command_info, list_processes, list_apps and the file listing all answer with what is true now.')
  return lines.join('\n')
}

/** Probe and render in one step, for the bridge's per-turn refresh. */
export function machineCard(options = {}) {
  return summariseCapabilities(gatherCapabilities(options))
}
