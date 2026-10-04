/**
 * The machine's command line, as a tool.
 *
 * JARVIS could already drive Chrome, read the screen and manage windows. This
 * is the piece that reaches everything else: any program with a CLI, so "resize
 * every image in that folder" or "what is using port 8787" is a real action
 * rather than a described one.
 *
 * Three things keep this from being an unattended root shell:
 *
 *   1. The whole server is built behind the bridge's write gate. Without
 *      JARVIS_ALLOW_WRITES=1 only `command_info` and `list_processes` exist, so
 *      the model cannot even see a way to run anything.
 *   2. `allowlist` is the default mode: every program named in the command has
 *      to be in the allowlist, so an unknown binary is refused by name instead
 *      of executed. JARVIS_SHELL_MODE=full removes that check for people who
 *      want the whole command line; JARVIS_SHELL_ALLOW extends the list.
 *   3. A deny list runs in every mode, because the few commands that can end
 *      the session — formatting a disk, powering the machine off, piping a
 *      download into an interpreter — are never the ones a voice loop should
 *      get right by luck.
 *
 * The honest caveat, and it is written here because it is the thing a reader
 * will assume away: an allowlist over shell text is a seatbelt, not a sandbox.
 * `git`, `find` and `node` can all be made to run other programs, and a regex
 * cannot out-think a shell. It exists so that the ordinary case is safe and the
 * unusual case is visible, not so that a hostile prompt cannot get out.
 */

import { execFile } from 'node:child_process'
import { accessSync, constants, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, isAbsolute, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { createSdkMcpServer, tool } from './mcp.mjs'

const execFileAsync = promisify(execFile)

/** Every shell run is capped, so a hung command cannot hold the turn open. */
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 5 * 60_000
/** Output is trimmed rather than streamed: a spoken answer has no use for a log. */
const MAX_OUTPUT_CHARS = 20_000

/**
 * Programs that run other programs, which is exactly what an allowlist is for
 * preventing. They are deliberately absent from the default list: with `sh` in
 * it, "sh -c anything" would pass every check that follows.
 */
const SHELL_ESCAPES = new Set([
  'cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta', 'rundll32',
  'wmic', 'schtasks', 'reg', 'regedit', 'msiexec', 'forfiles', 'start',
  'wt', 'conhost', 'psexec',
])

/**
 * The ordinary read-and-build commands a person would type at their own
 * machine. Deliberately broad: a tool that refuses `git status` is a toy, and
 * the write gate in front of the whole server is the real control.
 */
export const DEFAULT_ALLOW = Object.freeze([
  // files and text — cmd and PowerShell aliases that resolve to real programs
  'dir', 'type', 'find', 'findstr', 'sort', 'more', 'fc', 'comp',
  'copy', 'xcopy', 'robocopy', 'move', 'ren', 'del', 'mkdir', 'rmdir', 'tree',
  'attrib', 'icacls', 'takeown', 'mklink', 'where', 'whoami', 'hostname',
  'echo', 'set', 'path', 'date', 'time', 'ver', 'systeminfo', 'fsutil', 'compact',
  'certutil', 'clip', 'tar', 'expand', 'makecab', 'cabarc',
  'base64',
  // system and process inspection
  'tasklist', 'taskkill', 'sc', 'net', 'netstat', 'ping', 'tracert', 'pathping',
  'nslookup', 'ipconfig', 'route', 'arp', 'getmac', 'nbtstat', 'netsh',
  'powercfg', 'shutdown', 'openfiles', 'query', 'quser',
  'curl', 'wget', 'bitsadmin', 'telnet', 'ftp', 'ssh', 'scp', 'sftp',
  'pnputil', 'driverquery', 'wevtutil', 'logman', 'perfmon', 'typeperf',
  // editors and viewers
  'notepad', 'code', 'code-insiders', 'subl', 'notepad++', 'explorer',
  // toolchains (a developer machine is the expected host)
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno',
  'python', 'python3', 'py', 'pip', 'pip3', 'uv', 'poetry', 'pytest',
  'git', 'gh', 'svn', 'hg', 'winget', 'choco', 'scoop',
  'make', 'cmake', 'ninja', 'msbuild', 'cargo', 'rustc', 'go', 'gofmt',
  'java', 'javac', 'mvn', 'gradle', 'dotnet',
  'ruby', 'gem', 'bundle', 'php', 'composer', 'perl', 'lua',
  'docker', 'podman', 'docker-compose', 'kubectl', 'helm', 'terraform',
  'ansible', 'vagrant',
  'sqlite3', 'psql', 'mysql', 'mongosh', 'redis-cli',
  'ffmpeg', 'ffprobe', 'magick', 'pandoc', 'pdftotext', 'qpdf',
  'ollama', 'whisper', 'whisper-cli', 'yt-dlp',
].filter((program) => !SHELL_ESCAPES.has(program)))

/**
 * Rules that hold in every mode, including `full`.
 *
 * Each one is a command that is unrecoverable or hands the machine to someone
 * else. The list is short on purpose — a long deny list reads as cover for a
 * policy that is not there.
 */
export const DENY_RULES = Object.freeze([
  // A named target inside the allowed roots — `rm -rf node_modules` — is a
  // normal developer action and stays permitted. What is refused is the shape
  // that cannot be walked back: everything, or the system underneath it.
  { re: /\brm\b[^\n]*\s(-[a-z]+\s+)*(\/|\/\*|~\/?|\$HOME\b|\$\{HOME\}|\$HOME\/\*|\$\{HOME\}\/\*|~\/\*|\.\.?\/?|\*)(\s|$)/i, reason: 'recursive delete of a root, home, wildcard or parent directory' },
  { re: /\brm\b[^\n]*\s(\/(usr|etc|var|bin|sbin|boot|dev|proc|sys|System|Library|Applications|opt)\b|[A-Za-z]:\\?(Windows|Program Files|ProgramData|Users)\b)/i, reason: 'delete inside a system directory' },
  { re: /\bmkfs(\.[a-z0-9]+)?\b/i, reason: 'filesystem format' },
  { re: /\bdd\b[^\n]*\bof=\s*\/dev\//i, reason: 'raw write to a block device' },
  { re: /\bdiskutil\s+(erase|reformat|zeroDisk)/i, reason: 'disk erase' },
  { re: /\bdiskpart\b|\bformat\s+[a-z]:/i, reason: 'disk erase' },
  { re: /\b(shutdown|reboot|poweroff|halt|Stop-Computer|Restart-Computer)\b/i, reason: 'power state change' },
  { re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|dash|python[0-9.]*|perl|ruby|node)\b/i, reason: 'piping a download straight into an interpreter' },
  { re: /:\s*\(\s*\)\s*\{[^}]*\}\s*;\s*:/, reason: 'fork bomb' },
  { re: /\b(sudo|doas|su)\s+(-\w+\s+)*(rm|dd|mkfs|shutdown|reboot)\b/i, reason: 'privileged destructive command' },
  { re: /\breg\s+(delete|add)\b/i, reason: 'registry write' },
  { re: /\b(del|erase|rd|rmdir)\b[^\n]*\s[a-z]:\\?(\s|$|\*)/i, reason: 'delete of a whole drive' },
  { re: /\b(del|erase|rd|rmdir)\b[^\n]*\s(\*\.[a-z0-9]+\s*$|[a-z]:\\?(Windows|Program Files|ProgramData|Users)\b)/i, reason: 'delete of a system directory or every file of a kind' },
  { re: /\bRemove-Item\b[^\n]*(-Recurse|-Force)[^\n]*[a-z]:\\?(Windows|Program Files|ProgramData|Users)?(\s|$|\*)/i, reason: 'recursive delete of a drive or system directory' },
  { re: /\b(vssadmin\s+delete|wbadmin\s+delete|bcdedit|bootrec|vssadmin\s+resize|cipher\s+\/w)\b/i, reason: 'recovery options or boot configuration destroyed' },
  { re: /\b(iwr|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(iex|Invoke-Expression)/i, reason: 'piping a download straight into an interpreter' },
  { re: /\bnc\b[^\n]*\s-[a-z]*e[a-z]*\b/i, reason: 'reverse shell' },
  { re: /\bhistory\s+-c\b|\bclear\s*;?\s*$|>\s*~\/\.\w*(history|profile|bashrc|zshrc)/i, reason: 'tampering with shell history or startup files' },
])

/**
 * Split a command line into segments on `;`, `&&`, `||`, `|` and newlines,
 * ignoring separators inside single or double quotes. Not a shell parser — a
 * shell parser is a bigger surface than this guard, and the failure mode here
 * is conservative: an unparsed segment yields more programs to check, not fewer.
 */
export function splitSegments(command) {
  const text = String(command ?? '')
  const segments = []
  let current = ''
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '\n' || char === ';' || char === '&' || char === '|') {
      // Collapse the two-character separators (&&, ||) into one boundary.
      while (text[i + 1] === char) i++
      segments.push(current)
      current = ''
      continue
    }
    current += char
  }
  segments.push(current)
  return segments.map((s) => s.trim()).filter(Boolean)
}

/** The programs a command would invoke, as bare names, in order. */
export function commandPrograms(command) {
  const programs = []
  for (const segment of splitSegments(command)) {
    const tokens = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
    let index = 0
    // Leading VAR=value assignments are part of the environment, not the program.
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index++
    const head = tokens[index]
    if (!head) continue
    // Strip a wrapper's quoting and any directory part: /usr/bin/git is git.
    const name = basename(head.replace(/^["']|["']$/g, '').replace(/\\/g, sep))
    if (name && /^[\w.+-]+$/.test(name)) programs.push(name.toLowerCase())
  }
  return programs
}

/** The allowlist in force: the defaults plus JARVIS_SHELL_ALLOW. */
export function allowList(env = process.env) {
  const extra = String(env.JARVIS_SHELL_ALLOW ?? '')
    .split(',')
    .map((s) => basename(s.trim()).toLowerCase())
    .filter(Boolean)
  if (extra.includes('*')) return new Set(['*'])
  return new Set([...DEFAULT_ALLOW, ...extra])
}

/** `allowlist` (default) or `full`. Anything else is treated as allowlist. */
export function shellMode(env = process.env) {
  return String(env.JARVIS_SHELL_MODE ?? '').trim().toLowerCase() === 'full' ? 'full' : 'allowlist'
}

/**
 * Decide whether a command may run, and why not when it may not.
 *
 * Pure, so the policy is testable without executing anything.
 */
export function commandDecision(command, options = {}) {
  const text = String(command ?? '').trim()
  if (!text) return { ok: false, reason: 'No command was supplied.' }
  if (text.length > 4000) return { ok: false, reason: 'That command line is too long to review safely.' }

  for (const rule of DENY_RULES) {
    if (rule.re.test(text)) return { ok: false, reason: `Refused: ${rule.reason}. This is blocked in every mode.` }
  }

  const mode = options.mode ?? shellMode(options.env)
  const programs = commandPrograms(text)
  if (!programs.length) return { ok: false, reason: 'No program name could be read out of that command.' }

  if (mode === 'allowlist') {
    const allow = options.allow ?? allowList(options.env)
    if (!allow.has('*')) {
      const refused = programs.filter((program) => !allow.has(program))
      if (refused.length) {
        return {
          ok: false,
          mode,
          programs,
          reason: `Refused: ${refused.join(', ')} ${refused.length === 1 ? 'is' : 'are'} not in the shell allowlist. ` +
            'Add it with JARVIS_SHELL_ALLOW, or set JARVIS_SHELL_MODE=full for the whole command line.',
        }
      }
    }
  }

  return { ok: true, mode, programs }
}

/** Directories a command may run in. Same shape as JARVIS_FILE_ROOTS. */
export function shellRoots(env = process.env) {
  return [
    homedir(),
    tmpdir(),
    process.cwd(),
    ...String(env.JARVIS_SHELL_ROOTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ].map((root) => {
    try {
      return realpathSync(root)
    } catch {
      return resolve(root)
    }
  })
}

/** True when `target` is one of the roots or sits inside one. */
export function withinRoots(target, roots = shellRoots()) {
  const path = resolve(target)
  return roots.some((root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep))
}

/** Resolve a program against PATH, honouring PATHEXT. */
export function programPath(program, env = process.env) {
  const name = String(program ?? '').trim()
  if (!name) return null
  const candidates = [name]
  if (!/\.[a-z0-9]+$/i.test(name)) {
    for (const ext of String(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')) {
      if (ext.trim()) candidates.push(`${name}${ext.trim().toLowerCase()}`)
    }
  }
  const dirs = String(env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const candidate of candidates) {
    if (isAbsolute(candidate) || candidate.includes(sep)) {
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch { /* keep looking */ }
      continue
    }
    for (const dir of dirs) {
      const full = resolve(dir, candidate)
      try {
        accessSync(full, constants.X_OK)
        return full
      } catch { /* keep looking */ }
    }
  }
  return null
}

/** Run one command. The caller has already decided that it may run. */
export async function runCommand(command, options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd()
  if (!withinRoots(cwd, options.roots ?? shellRoots(options.env))) {
    return { ok: false, error: `Refused: ${cwd} is outside the directories commands may run in (JARVIS_SHELL_ROOTS).` }
  }
  const timeout = Math.min(Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS)
  try {
    const { stdout, stderr } = await execFileAsync(command, {
      cwd,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      shell: true,
      env: options.env ?? process.env,
    })
    return {
      ok: true,
      cwd,
      exitCode: 0,
      stdout: trim(stdout),
      stderr: trim(stderr),
    }
  } catch (error) {
    // A non-zero exit is a result, not a failure of the tool: report what the
    // command said rather than a Node stack trace.
    const stdout = trim(error?.stdout ?? '')
    const stderr = trim(error?.stderr ?? '')
    const timedOut = error?.killed === true || error?.signal === 'SIGTERM'
    return {
      ok: false,
      cwd,
      exitCode: typeof error?.code === 'number' ? error.code : null,
      timedOut,
      stdout,
      stderr: stderr || (timedOut ? `Command exceeded the ${timeout} ms limit and was stopped.` : trim(String(error?.message ?? error))),
    }
  }
}

function trim(value) {
  const text = String(value ?? '')
  if (text.length <= MAX_OUTPUT_CHARS) return text
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated at ${MAX_OUTPUT_CHARS} characters`
}

function textResult(value) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(value?.ok === false ? { isError: true } : {}),
  }
}

/** Read-only: does this program exist, and where. */
export async function commandInfo(program, env = process.env) {
  const found = programPath(program, env)
  const decision = commandDecision(program, { mode: 'full', env })
  return {
    ok: true,
    program,
    available: Boolean(found),
    path: found,
    blockedByPolicy: !decision.ok ? decision.reason : null,
  }
}

/** Read-only process inventory, as Windows reports it. */
export async function listProcesses({ match, limit = 40 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 200)
  try {
    const rows = await execFileAsync('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    const lines = String(rows.stdout ?? '').split(/\r?\n/).filter(Boolean)
    const filtered = match ? lines.filter((line) => line.toLowerCase().includes(String(match).toLowerCase())) : lines
    const shown = filtered.slice(0, cap)
    return {
      ok: true,
      match: match ?? null,
      total: filtered.length,
      shown: shown.length,
      truncated: filtered.length > shown.length,
      lines: shown,
    }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 400) }
  }
}

/**
 * The command line, as MCP tools.
 *
 * Effectful tools are registered only behind the write gate, exactly like the
 * browser and window servers, so a read-only bridge cannot execute anything at
 * all — not even one the model has been talked into.
 */
export function shellServer({ allowWrites = false, env = process.env } = {}) {
  const mode = shellMode(env)
  const tools = [
    tool(
      'command_info',
      'Read-only. Check whether a program exists on PATH and where it resolves to. Use this before promising to run something.',
      {
        program: z.string().min(1).max(120).describe('A bare program name such as git, ffmpeg or ffprobe.'),
        why: z.string().max(200).optional().describe('One short sentence for the log: why this lookup is needed.'),
      },
      async ({ program }) => textResult(await commandInfo(program, env)),
    ),
    tool(
      'list_processes',
      'Read-only. List running processes with CPU and memory, optionally filtered by a name fragment. Use it to answer "what is using this port" or "is that still running" from live data.',
      {
        match: z.string().max(120).optional().describe('Case-insensitive fragment to filter on, for example ollama.'),
        limit: z.number().int().min(1).max(200).optional().describe('Maximum rows to return. Defaults to 40.'),
      },
      async ({ match, limit }) => textResult(await listProcesses({ match, limit })),
    ),
  ]

  if (allowWrites) {
    tools.push(tool(
      'run_command',
      `Run a shell command on this machine and return its output. Working directory defaults to the project root; pipes and && work. ` +
        `Policy mode is "${mode}": ` +
        (mode === 'full'
          ? 'any command is accepted except a short deny list of unrecoverable ones (disk format, recursive delete of a root, power state, piping a download into an interpreter).'
          : 'every program in the command must be in the shell allowlist; unknown programs are refused by name. JARVIS_SHELL_ALLOW adds names, JARVIS_SHELL_MODE=full opens the rest.') +
        ' Say in one sentence what you are about to run when it changes anything, then report the actual output rather than a summary you did not read.',
      {
        command: z.string().min(1).max(4000).describe('The full command line, for example "git status --short".'),
        cwd: z.string().max(400).optional().describe('Directory to run in. Must sit under an allowed root.'),
        timeout_ms: z.number().int().min(1000).max(300_000).optional().describe('Milliseconds before the command is stopped. Defaults to 30000.'),
        why: z.string().max(200).optional().describe('One short sentence for the log: why this command is being run.'),
      },
      async ({ command, cwd, timeout_ms }) => {
        const decision = commandDecision(command, { env })
        if (!decision.ok) return textResult({ ok: false, error: decision.reason })
        return textResult(await runCommand(command, {
          cwd: cwd ? (isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd)) : process.cwd(),
          timeoutMs: timeout_ms,
          env,
        }))
      },
    ))
  }

  const instruction = allowWrites
    ? `The machine's command line is available${mode === 'allowlist' ? ' for allowlisted programs' : ''}. Prefer a direct command over describing one; never present output you did not receive. A refused command is a hard stop: say it is not permitted, do not look for a way around it.`
    : 'Command-line execution is withheld until the bridge is restarted with JARVIS_ALLOW_WRITES=1. Only program lookup and process listing are available; do not claim to have run anything.'

  return createSdkMcpServer({ name: 'jarvis_shell', version: '1.0.0', instructions: instruction, tools })
}
