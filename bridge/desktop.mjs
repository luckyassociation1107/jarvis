/**
 * The desktop, as a tool: windows, mouse, keyboard, and every installed app.
 *
 * This is the half of "control the machine" the browser tools cannot reach.
 * `jarvis_chrome` drives one program convincingly; this drives the rest of the
 * screen — focusing the window that is already open, typing into it, clicking
 * where the user is pointing, and launching anything installed.
 *
 * Windows only, and it uses what Windows already has: PowerShell driving
 * user32 for windows, the pointer and the keyboard, plus SendKeys for typing.
 * There is nothing to install first. On another platform every acting tool
 * reports that plainly instead of half-working, and `desktop_capabilities` says
 * so before anything is promised.
 *
 * Every op reports what actually happened, rather than a stack trace or a
 * silent no-op.
 *
 * Acting tools are built only when the bridge runs with JARVIS_ALLOW_WRITES=1,
 * the same gate as the browser, the command line and the window manager. Read
 * tools — capabilities, window list, installed apps — exist either way, because
 * looking changes nothing.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { createSdkMcpServer, tool } from './mcp.mjs'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 20_000

// ---------------------------------------------------------------------------
// Pure helpers — no process is spawned in any of them, so every rule below is
// covered by deterministic tests.
// ---------------------------------------------------------------------------

const MODIFIER_NAMES = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'super', 'meta', 'win'])

/** Keys whose name is not the character you type, per platform. */
const NAMED_KEYS = new Set([
  'return', 'enter', 'tab', 'space', 'escape', 'esc', 'backspace', 'delete',
  'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
])

/**
 * Parse "ctrl+shift+t" into a canonical combo.
 * @returns {{ ok: boolean, key?: string, modifiers?: string[], reason?: string }}
 */
export function parseKeyCombo(combo) {
  const parts = String(combo ?? '').split('+').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return { ok: false, reason: 'No key was named.' }
  const modifiers = []
  let key = null
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (MODIFIER_NAMES.has(lower)) {
      modifiers.push(lower === 'control' ? 'ctrl' : lower === 'option' ? 'alt' : lower === 'command' ? 'cmd' : lower === 'meta' || lower === 'win' ? 'super' : lower)
      continue
    }
    if (key) return { ok: false, reason: 'Only one non-modifier key is allowed, for example "ctrl+shift+t".' }
    key = lower
  }
  if (!key) return { ok: false, reason: 'A combo needs a key, for example "ctrl+shift+t".' }
  if (key.length > 1 && !NAMED_KEYS.has(key)) {
    return { ok: false, reason: `Unknown key name "${key}". Use a single character or one of: ${[...NAMED_KEYS].join(', ')}.` }
  }
  if (key.length === 1 && !/[a-z0-9\-=.,/;'[\]\\`]/.test(key)) {
    return { ok: false, reason: `Key "${key}" is not something this tool will type; use type_text for arbitrary text.` }
  }
  return { ok: true, key, modifiers }
}

/**
 * Escape a string for .NET SendKeys.
 *
 * SendKeys treats { } + ^ % ~ ( ) as commands. A ten-character password with
 * a bracket in it would otherwise type something else entirely, so every one of
 * them is wrapped: "{" becomes "{{}".
 */
export function sendKeysEscape(text) {
  return String(text ?? '').replace(/[{}()+^%~[\]]/g, (char) => `{${char}}`)
}

/** SendKeys modifier prefix: ctrl is ^, shift is +, alt is %, and so on. */
export function sendKeysCombo({ key, modifiers }) {
  const prefix = modifiers.map((modifier) => ({ ctrl: '^', shift: '+', alt: '%', cmd: '^', super: '^' })[modifier] ?? '').join('')
  const named = { return: '{ENTER}', enter: '{ENTER}', tab: '{TAB}', space: ' ', escape: '{ESC}', esc: '{ESC}', backspace: '{BACKSPACE}', delete: '{DELETE}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}' }[key]
  return prefix + (named ?? (NAMED_KEYS.has(key) ? `{${key.toUpperCase()}}` : key))
}

/** Normalize `Get-StartApps | ConvertTo-Json` output into the same shape. */
export function parseWindowsApps(json) {
  let parsed
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  return rows
    .map((row) => ({ id: String(row?.AppID ?? row?.appId ?? ''), name: String(row?.Name ?? row?.name ?? ''), source: 'start-menu' }))
    .filter((row) => row.id && row.name)
}

/** People type "visual studio code"; the Start menu entry is "Visual Studio Code". */
export function matchApp(query, apps) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return null
  const exact = apps.find((app) => app.name.toLowerCase() === needle || app.id.toLowerCase() === needle)
  if (exact) return exact
  const starts = apps.filter((app) => app.name.toLowerCase().startsWith(needle))
  if (starts.length === 1) return starts[0]
  const contains = apps.filter((app) => app.name.toLowerCase().includes(needle))
  if (contains.length === 1) return contains[0]
  return null
}

/**
 * What the desktop control surface can actually do here.
 *
 * On Windows there is nothing to check: PowerShell ships with the system and
 * user32 is always there, so the surface is complete or the host is not Windows
 * at all. That second case is stated rather than worked around — every acting
 * tool then reports it, and `desktop_capabilities` says it before anything is
 * promised.
 */
export function desktopCapabilities({ platform = process.platform } = {}) {
  if (platform !== 'win32') {
    return {
      platform,
      session: 'unsupported',
      gaps: [`desktop control is Windows-only; this host is ${platform}`],
      pointer: null,
    }
  }
  return { platform, session: 'windows', gaps: [], pointer: 'user32' }
}

/**
 * Build the process call for one desktop op.
 *
 * Returns `{ file, args, env }` or `{ unsupported: reason }`. Nothing runs
 * here; this is the single place where platform differences are expressed,
 * which is what makes the differences testable.
 */
export function buildDesktopCommand(op, args = {}, { platform = process.platform } = {}) {
  if (platform !== 'win32') {
    return { unsupported: `Desktop control is Windows-only; this host is ${platform}.` }
  }
  const shell = { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT] }

  if (op === 'list_windows') return { ...shell, env: { JARVIS_DESKTOP_OP: 'list' } }

  if (op === 'list_apps') {
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-StartApps | ConvertTo-Json -Compress'], env: {} }
  }

  if (op === 'launch') {
    // A packaged (UWP/MSIX) app is launched through its AppUserModelID;
    // anything else is an ordinary executable or document path.
    const id = String(args.app ?? '')
    const target = id.includes('!') ? `shell:AppsFolder\\${id}` : id
    return { ...shell, env: { JARVIS_DESKTOP_OP: 'launch', JARVIS_DESKTOP_TARGET: target } }
  }

  if (op === 'quit') {
    return { ...shell, env: { JARVIS_DESKTOP_OP: 'quit', JARVIS_DESKTOP_TARGET: String(args.app ?? '') } }
  }

  if (op === 'focus' || op === 'window_action') {
    return {
      ...shell,
      env: {
        JARVIS_DESKTOP_OP: op === 'focus' ? 'focus' : (args.action ?? 'focus'),
        JARVIS_DESKTOP_TARGET: String(args.title ?? ''),
        JARVIS_DESKTOP_GEOMETRY: geometryString(args),
      },
    }
  }

  if (op === 'type_text') {
    return { ...shell, env: { JARVIS_DESKTOP_OP: 'type', JARVIS_DESKTOP_TEXT: sendKeysEscape(String(args.text ?? '')) } }
  }

  if (op === 'press_keys') {
    const combo = parseKeyCombo(args.keys)
    if (!combo.ok) return { unsupported: combo.reason }
    return { ...shell, env: { JARVIS_DESKTOP_OP: 'keys', JARVIS_DESKTOP_TEXT: sendKeysCombo(combo) } }
  }

  if (op === 'move_mouse' || op === 'click' || op === 'scroll') {
    return {
      ...shell,
      env: {
        JARVIS_DESKTOP_OP: op,
        JARVIS_DESKTOP_TARGET: `${Math.round(args.x ?? -1)},${Math.round(args.y ?? -1)}`,
        JARVIS_DESKTOP_GEOMETRY: `${args.button ?? 'left'},${Math.max(1, Math.round(args.count ?? 1))},${args.direction ?? 'down'},${Math.round(args.amount ?? 3)}`,
      },
    }
  }

  return { unsupported: `Unknown desktop operation "${op}".` }
}


/** Geometry as "x,y,w,h", empty when a move is not part of the action. */
export function geometryString(args = {}) {
  const parts = [args.x, args.y, args.width, args.height].map((value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : ''))
  return parts.some(Boolean) ? parts.join(',') : ''
}

export const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class JarvisDesk {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hwnd, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static string Title(IntPtr hwnd) { StringBuilder text = new StringBuilder(1024); GetWindowText(hwnd, text, text.Capacity); return text.ToString(); }
  public static IntPtr Find(string fragment) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
      if (!IsWindowVisible(hwnd)) return true;
      string title = Title(hwnd);
      if (title.IndexOf(fragment, StringComparison.OrdinalIgnoreCase) >= 0) { found = hwnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static object[] List() {
    List<object> rows = new List<object>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
      if (!IsWindowVisible(hwnd)) return true;
      string title = Title(hwnd);
      if (String.IsNullOrWhiteSpace(title)) return true;
      uint pid; GetWindowThreadProcessId(hwnd, out pid);
      rows.Add(new Dictionary<string, object> { { "handle", hwnd.ToInt64() }, { "pid", (int)pid }, { "title", title } });
      return true;
    }, IntPtr.Zero);
    return rows.ToArray();
  }
}
'@
$op = $env:JARVIS_DESKTOP_OP
$target = $env:JARVIS_DESKTOP_TARGET
$geometry = $env:JARVIS_DESKTOP_GEOMETRY
switch ($op) {
  'list' { [JarvisDesk]::List() | ConvertTo-Json -Compress -Depth 4 }
  'focus' { $h = [JarvisDesk]::Find($target); if ($h -eq [IntPtr]::Zero) { throw "no visible window matching '$target'" }; [JarvisDesk]::ShowWindow($h, 9) | Out-Null; [JarvisDesk]::SetForegroundWindow($h) }
  'minimize' { $h = [JarvisDesk]::Find($target); if ($h -eq [IntPtr]::Zero) { throw "no visible window matching '$target'" }; [JarvisDesk]::ShowWindow($h, 6) | Out-Null; 'minimized' }
  'maximize' { $h = [JarvisDesk]::Find($target); if ($h -eq [IntPtr]::Zero) { throw "no visible window matching '$target'" }; [JarvisDesk]::ShowWindow($h, 3) | Out-Null; 'maximized' }
  'restore' { $h = [JarvisDesk]::Find($target); if ($h -eq [IntPtr]::Zero) { throw "no visible window matching '$target'" }; [JarvisDesk]::ShowWindow($h, 9) | Out-Null; 'restored' }
  'close' { $h = [JarvisDesk]::Find($target); if ($h -eq [IntPtr]::Zero) { throw "no visible window matching '$target'" }; [JarvisDesk]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; 'close requested' }
  'move' { $h = [JarvisDesk]::Find($target); if ($h -eq [IntPtr]::Zero) { throw "no visible window matching '$target'" }; $p = $geometry.Split(','); [JarvisDesk]::MoveWindow($h, [int]$p[0], [int]$p[1], [int]$p[2], [int]$p[3], $true) }
  'type' { [System.Windows.Forms.SendKeys]::SendWait($env:JARVIS_DESKTOP_TEXT); 'typed' }
  'keys' { [System.Windows.Forms.SendKeys]::SendWait($env:JARVIS_DESKTOP_TEXT); 'sent' }
  'move_mouse' { $p = $target.Split(','); [JarvisDesk]::SetProcessDPIAware() | Out-Null; [JarvisDesk]::SetCursorPos([int]$p[0], [int]$p[1]) }
  'click' {
    $p = $target.Split(','); $g = $geometry.Split(',')
    if ([int]$p[0] -ge 0) { [JarvisDesk]::SetProcessDPIAware() | Out-Null; [JarvisDesk]::SetCursorPos([int]$p[0], [int]$p[1]) | Out-Null }
    $flags = switch ($g[0]) { 'right' { 0x0008, 0x0010 } 'middle' { 0x0020, 0x0040 } default { 0x0002, 0x0004 } }
    for ($i = 0; $i -lt [int]$g[1]; $i++) { [JarvisDesk]::mouse_event($flags[0], 0, 0, 0, [UIntPtr]::Zero); [JarvisDesk]::mouse_event($flags[1], 0, 0, 0, [UIntPtr]::Zero) }
    'clicked'
  }
  'scroll' { $g = $geometry.Split(','); $delta = if ($g[2] -eq 'up') { 120 } else { -120 }; for ($i = 0; $i -lt [int]$g[3]; $i++) { [JarvisDesk]::mouse_event(0x0800, 0, 0, [uint32]$delta, [UIntPtr]::Zero) }; 'scrolled' }
  'launch' { Start-Process -FilePath $target; "launched $target" }
  'quit' {
    $h = [JarvisDesk]::Find($target)
    if ($h -ne [IntPtr]::Zero) { [JarvisDesk]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; "asked $target to close"; break }
    $p = Get-Process -Name $target -ErrorAction SilentlyContinue
    if ($null -eq $p) { throw "no running process named '$target'" }
    $p.CloseMainWindow() | Out-Null; "asked $target to close"
  }
  default { throw "unsupported operation '$op'" }
}
`.trim()

// ---------------------------------------------------------------------------
// Runner and tools
// ---------------------------------------------------------------------------

async function runBuilt(built) {
  if (built?.unsupported) return { ok: false, error: built.unsupported }
  try {
    const { stdout, stderr } = await execFileAsync(built.file, built.args, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, ...(built.env ?? {}) },
    })
    return { ok: true, stdout: String(stdout ?? '').trim(), stderr: String(stderr ?? '').trim() }
  } catch (error) {
    return { ok: false, error: String(error?.stderr || error?.message || error).slice(0, 400) }
  }
}

/** Read the installed apps, from the Start menu. */
export async function listInstalledApps({ platform = process.platform } = {}) {
  if (platform !== 'win32') {
    return { ok: false, error: `Listing installed applications is Windows-only; this host is ${platform}.` }
  }
  const result = await runBuilt(buildDesktopCommand('list_apps', {}, { platform }))
  return result.ok ? { ok: true, apps: parseWindowsApps(result.stdout) } : result
}

/** The visible window list, as handle/pid/title rows. */
export async function listDesktopWindows({ platform = process.platform } = {}) {
  const result = await runBuilt(buildDesktopCommand('list_windows', {}, { platform }))
  if (!result.ok) return result
  const rows = JSON.parse(result.stdout || '[]')
  const list = Array.isArray(rows) ? rows : [rows]
  return { ok: true, windows: list.map((row) => ({ handle: row.handle, pid: row.pid, title: row.title })) }
}

function textResult(value) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(value?.ok === false ? { isError: true } : {}),
  }
}

/**
 * The desktop, as MCP tools.
 *
 * Read tools exist in both modes. Everything that moves the pointer, types, or
 * changes a window is registered only behind JARVIS_ALLOW_WRITES=1, so a
 * read-only bridge cannot be talked into clicking anything.
 */
export function desktopServer({ allowWrites = false, env = process.env } = {}) {
  const platform = process.platform
  const tools = [
    tool(
      'desktop_capabilities',
      'Read-only. Report whether this host can be driven at all: JARVIS controls the desktop on Windows (PowerShell + user32) and says so plainly everywhere else. Check this before promising a GUI action.',
      { why: z.string().max(200).optional().describe('One short sentence for the log.') },
      async () => textResult({ ok: true, writesEnabled: allowWrites, ...desktopCapabilities({ platform, env }) }),
    ),
    tool(
      'list_windows',
      'Read-only. List visible application windows with titles, so "bring up my editor" can be resolved to a real window before acting on it.',
      { why: z.string().max(200).optional().describe('One short sentence for the log.') },
      async () => textResult(await listDesktopWindows({ platform })),
    ),
    tool(
      'list_apps',
      'Read-only. List the applications installed on this machine, from the Windows Start menu. Launch names come from here.',
      {
        match: z.string().max(120).optional().describe('Optional fragment to filter by, for example "studio".'),
        limit: z.number().int().min(1).max(300).optional().describe('Maximum apps to return. Defaults to 60.'),
      },
      async ({ match, limit = 60 }) => {
        const found = await listInstalledApps({ platform })
        if (!found.ok) return textResult(found)
        const needle = String(match ?? '').trim().toLowerCase()
        const apps = needle ? found.apps.filter((app) => app.name.toLowerCase().includes(needle)) : found.apps
        return textResult({ ok: true, total: found.apps.length, shown: apps.slice(0, limit).length, apps: apps.slice(0, limit) })
      },
    ),
  ]

  if (allowWrites) {
    const titleSchema = z.string().min(2).max(160).describe('A distinctive fragment of the visible window title.')
    tools.push(
      tool(
        'focus_window',
        'Bring one window to the front by title fragment. Ambiguous matches are resolved to the first visible window whose title contains the fragment.',
        { title_contains: titleSchema },
        async ({ title_contains }) => textResult(await runBuilt(buildDesktopCommand('focus', { title: title_contains }, { platform, env }))),
      ),
      tool(
        'window_action',
        'Move, resize, minimize, maximize, restore or close one window by title fragment. Close asks the application to close (WM_CLOSE) rather than killing it, so unsaved work can still prompt.',
        {
          title_contains: titleSchema,
          action: z.enum(['focus', 'minimize', 'maximize', 'restore', 'close', 'move', 'resize']).describe('What to do with the matched window.'),
          x: z.number().int().optional().describe('Screen x for move, or left edge for resize.'),
          y: z.number().int().optional().describe('Screen y for move, or top edge for resize.'),
          width: z.number().int().min(80).optional().describe('Width in pixels for resize.'),
          height: z.number().int().min(80).optional().describe('Height in pixels for resize.'),
        },
        async (args) => textResult(await runBuilt(buildDesktopCommand('window_action', args, { platform, env }))),
      ),
      tool(
        'launch_app',
        'Launch an installed application by name, as listed by list_apps. The name goes to the Windows shell, so packaged apps and installed programs both work. No command lines or arguments are accepted — use run_command for those.',
        { app: z.string().min(1).max(160).describe('Application name, for example "Visual Studio Code" or "Calculator".') },
        async ({ app }) => {
          const found = await listInstalledApps({ platform })
          const match = found.ok ? matchApp(app, found.apps) : null
          if (!match) {
            return textResult({ ok: false, error: `No installed application matches "${app}". Check list_apps, or set JARVIS_SHELL_ALLOW and start it with run_command.` })
          }
          const built = buildDesktopCommand('launch', { app: match.id }, { platform, env })
          return textResult({ ...(await runBuilt(built)), launched: match.name })
        },
      ),
      tool(
        'quit_app',
        'Ask a running application to quit by name (its window, or the process if it has no window). Graceful: applications get the chance to prompt about unsaved work.',
        { app: z.string().min(1).max(160).describe('Application name, for example "Spotify".') },
        async ({ app }) => textResult(await runBuilt(buildDesktopCommand('quit', { app }, { platform, env }))),
      ),
      tool(
        'type_text',
        'Type text into whatever window currently has keyboard focus. Focus the window first; this does not choose a target. Requires JARVIS_ALLOW_WRITES=1.',
        {
          text: z.string().min(1).max(4000).describe('The exact text to type.'),
          why: z.string().max(200).optional().describe('One short sentence for the log: where this text is going.'),
        },
        async ({ text }) => textResult(await runBuilt(buildDesktopCommand('type_text', { text }, { platform, env }))),
      ),
      tool(
        'press_keys',
        'Send one key combination to whatever has focus, such as "ctrl+shift+t" or "alt+tab". Use type_text for ordinary prose.',
        { keys: z.string().min(1).max(60).describe('A combo like ctrl+shift+t, alt+tab or return.') },
        async ({ keys }) => textResult(await runBuilt(buildDesktopCommand('press_keys', { keys }, { platform, env }))),
      ),
      tool(
        'move_mouse',
        'Move the pointer to absolute screen coordinates. Coordinates are the whole screen, not the focused window.',
        { x: z.number().int().min(0).max(20000), y: z.number().int().min(0).max(20000) },
        async ({ x, y }) => textResult(await runBuilt(buildDesktopCommand('move_mouse', { x, y }, { platform, env }))),
      ),
      tool(
        'click',
        'Click a mouse button at screen coordinates, or at the pointer\'s current position when x and y are omitted. Left, middle and right are supported, with an optional repeat count for double-clicks.',
        {
          x: z.number().int().min(0).max(20000).optional(),
          y: z.number().int().min(0).max(20000).optional(),
          button: z.enum(['left', 'middle', 'right']).optional().describe('Defaults to left.'),
          count: z.number().int().min(1).max(4).optional().describe('Click count; 2 is a double-click.'),
        },
        async ({ x, y, button, count }) => textResult(await runBuilt(buildDesktopCommand('click', { x, y, button, count }, { platform, env }))),
      ),
      tool(
        'scroll',
        'Scroll the window under the pointer, up or down, by a number of wheel steps.',
        {
          direction: z.enum(['up', 'down']).describe('Wheel direction.'),
          amount: z.number().int().min(1).max(50).optional().describe('Wheel steps. Defaults to 3.'),
        },
        async ({ direction, amount }) => textResult(await runBuilt(buildDesktopCommand('scroll', { direction, amount }, { platform, env }))),
      ),
    )
  }

  const caps = desktopCapabilities({ platform, env })
  const instruction = [
    'Control the desktop through these tools: applications, windows, pointer and keyboard.',
    `Host: ${caps.platform}/${caps.session}.`,
    caps.gaps.length ? `Known limits: ${caps.gaps.join('; ')}.` : 'Windows control is built in — PowerShell, user32 and SendKeys need nothing installed.',
    allowWrites
      ? 'Focus or launch the window before typing, and prefer the app\'s own window over the pointer wherever possible. Say in one sentence what you are about to do when it changes something, and never claim an action succeeded unless the tool said so.'
      : 'Acting tools are withheld until the bridge is restarted with JARVIS_ALLOW_WRITES=1; only listing and capability checks are available, so do not claim to have clicked, typed or launched anything.',
  ].join(' ')

  return createSdkMcpServer({ name: 'jarvis_desktop', version: '1.0.0', instructions: instruction, tools })
}
