/**
 * The desktop, as a tool: windows, mouse, keyboard, and every installed app.
 *
 * This is the half of "control the machine" the browser tools cannot reach.
 * `jarvis_chrome` drives one program convincingly; this drives the rest of the
 * screen — focusing the window that is already open, typing into it, clicking
 * where the user is pointing, and launching anything installed.
 *
 * Platform coverage is honest rather than uniform:
 *
 *   Windows  PowerShell + user32 (the same technique as windows.mjs)
 *   macOS    osascript for apps, windows and keys; cliclick for the pointer
 *   Linux    wmctrl for windows, xdotool for input (X11; XWayland only)
 *
 * Every op reports what actually happened. Where the backing program is not
 * installed, `desktop_capabilities` says so up front and the op fails with the
 * one command that would fix it, rather than a stack trace or a silent no-op.
 *
 * Acting tools are built only when the bridge runs with JARVIS_ALLOW_WRITES=1,
 * the same gate as the browser, the command line and the window manager. Read
 * tools — capabilities, window list, installed apps — exist either way, because
 * looking changes nothing.
 */

import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { createSdkMcpServer, tool } from './mcp.mjs'
import { programPath } from './shell.mjs'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 20_000

/** Linux app entries live in these directories, in priority order. */
const DESKTOP_DIRS = [
  join(homedir(), '.local/share/applications'),
  '/usr/local/share/applications',
  '/usr/share/applications',
  '/var/lib/flatpak/exports/share/applications',
  join(homedir(), '.local/share/flatpak/exports/share/applications'),
  '/var/lib/snapd/desktop/applications',
]

/** macOS app directories. /System/CoreServices holds the built-ins people mean by name. */
const MAC_APP_DIRS = [
  '/Applications',
  '/System/Applications',
  '/System/Applications/Utilities',
  join(homedir(), 'Applications'),
]

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

/** AppleScript needs the key as a character or a hardware key code. */
export function appleScriptKey(key) {
  const codes = {
    return: 36, enter: 36, tab: 48, space: 49, escape: 53, esc: 53, backspace: 51,
    delete: 117, up: 126, down: 125, left: 123, right: 124, home: 115, end: 119,
    pageup: 116, pagedown: 121,
    f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
    f9: 101, f10: 109, f11: 103, f12: 111,
  }
  return codes[key] ?? null
}

/** Escape a string for AppleScript's double-quoted literal. */
export function appleScriptString(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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

/** xdotool wants the combo back as its own syntax, which is close to ours. */
export function xdotoolCombo({ key, modifiers }) {
  return [...modifiers, key].join('+')
}

/** AppleScript "using {…}" clause for the modifiers in a combo. */
export function appleScriptModifiers({ modifiers }) {
  const names = { ctrl: 'control down', shift: 'shift down', alt: 'option down', cmd: 'command down', super: 'command down' }
  const list = modifiers.map((modifier) => names[modifier]).filter(Boolean)
  return list.length ? ` using {${list.join(', ')}}` : ''
}

/**
 * Parse Linux .desktop entries into launchable apps.
 *
 * Reads only the fields a launcher needs, skips hidden entries and anything
 * marked NoDisplay or Terminal — a voice loop should not open a TUI it cannot
 * see — and prefers the localized Name when one is present.
 */
export function parseDesktopEntries(text, { locale = 'en', file = null } = {}) {
  const apps = []
  for (const block of String(text ?? '').split(/\n(?=\[Desktop Entry\])/)) {
    if (!/\[Desktop Entry\]/.test(block)) continue
    const field = (name) => {
      const match = block.match(new RegExp(`^${name}=(.+)$`, 'm'))
      return match ? match[1].trim() : null
    }
    if ((field('Type') ?? 'Application') !== 'Application') continue
    if (field('NoDisplay') === 'true' || field('Hidden') === 'true') continue
    if (field('Terminal') === 'true') continue
    const localized = block.match(new RegExp(`^Name\\[${locale}(_[A-Z]{2})?\\]=(.+)$`, 'm'))
    const name = localized?.[2]?.trim() ?? field('Name')
    const exec = field('Exec')
    if (!name || !exec) continue
    // gtk-launch wants the desktop file's own id (its filename minus .desktop),
    // which is not the same thing as the program it runs.
    apps.push({
      id: file ? basename(file).replace(/\.desktop$/i, '') : basename(exec.split(/\s+/)[0] ?? name),
      name,
      exec: exec.replace(/\s%[fFuUdDnNickvm]/g, '').trim(),
      source: 'desktop',
    })
  }
  return apps
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

/** macOS: a directory listing of *.app bundles is already the app list. */
export function parseMacApps(names) {
  return (Array.isArray(names) ? names : [])
    .filter((name) => /\.app$/i.test(name))
    .map((name) => ({ id: name.replace(/\.app$/i, ''), name: name.replace(/\.app$/i, ''), source: 'applications' }))
}

/** People type "visual studio code"; the bundle is "Visual Studio Code.app". */
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
 * Which platform's control surface is in force, and what it can actually do.
 * `has` is injected so tests can describe a machine without owning one.
 */
export function desktopCapabilities({ platform = process.platform, env = process.env, has = (name) => Boolean(programPath(name)) } = {}) {
  const session = platform === 'win32'
    ? 'windows'
    : platform === 'darwin'
      ? 'aqua'
      : env.WAYLAND_DISPLAY
        ? 'wayland'
        : env.DISPLAY
          ? 'x11'
          : 'headless'
  const gaps = []
  if (platform === 'linux') {
    if (session === 'headless') gaps.push('no DISPLAY or WAYLAND_DISPLAY: there is no desktop session to control')
    if (!has('xdotool')) gaps.push('xdotool is missing: pointer, typing and key combos are unavailable (install it with "sudo apt install xdotool")')
    if (!has('wmctrl')) gaps.push('wmctrl is missing: window listing and window actions are unavailable (install it with "sudo apt install wmctrl")')
    if (session === 'wayland') gaps.push('Wayland session: xdotool/wmctrl only see XWayland windows, so native Wayland apps will not respond')
  }
  if (platform === 'darwin' && !has('cliclick')) {
    gaps.push('cliclick is missing: pointer movement and clicking are unavailable (install it with "brew install cliclick"); typing and app control still work')
  }
  return { platform, session, gaps, pointer: pointerProgram({ platform, has }) }
}

function pointerProgram({ platform, has }) {
  if (platform === 'win32') return 'user32'
  if (platform === 'darwin') return has('cliclick') ? 'cliclick' : null
  return has('xdotool') ? 'xdotool' : null
}

/**
 * Build the process call for one desktop op.
 *
 * Returns `{ file, args, env }` or `{ unsupported: reason }`. Nothing runs
 * here; this is the single place where platform differences are expressed,
 * which is what makes the differences testable.
 */
export function buildDesktopCommand(op, args = {}, { platform = process.platform, has = (name) => Boolean(programPath(name)) } = {}) {
  const require = (program, hint) => {
    if (!has(program)) return { unsupported: `${program} is not installed. ${hint}` }
    return null
  }

  if (op === 'list_windows') {
    if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], env: { JARVIS_DESKTOP_OP: 'list' } }
    if (platform === 'darwin') return { file: 'osascript', args: ['-e', APPLE_LIST_WINDOWS] }
    const missing = require('wmctrl', 'Install it with "sudo apt install wmctrl".')
    return missing ?? { file: 'wmctrl', args: ['-lpG'] }
  }

  if (op === 'list_apps') {
    if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-StartApps | ConvertTo-Json -Compress'], env: {} }
    if (platform === 'darwin') return { file: 'ls', args: ['-1', ...MAC_APP_DIRS] }
    // Callers pass a rendered list of files; the reading happens in the server.
    return { file: null, args: [], env: {} }
  }

  if (op === 'launch') {
    if (platform === 'win32') {
      // A packaged (UWP/MSIX) app is launched through its AppUserModelID;
      // anything else is an ordinary executable or document path.
      const id = String(args.app ?? '')
      const target = id.includes('!') ? `shell:AppsFolder\\${id}` : id
      return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], env: { JARVIS_DESKTOP_OP: 'launch', JARVIS_DESKTOP_TARGET: target } }
    }
    if (platform === 'darwin') return { file: 'open', args: ['-a', String(args.app ?? '')] }
    if (has('gtk-launch')) return { file: 'gtk-launch', args: [String(args.app ?? '')] }
    if (has('gio')) return { file: 'gio', args: ['launch', String(args.desktopPath ?? args.app ?? '')] }
    return { unsupported: 'Neither gtk-launch nor gio is installed, so no .desktop entry can be started.' }
  }

  if (op === 'quit') {
    if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], env: { JARVIS_DESKTOP_OP: 'quit', JARVIS_DESKTOP_TARGET: String(args.app ?? '') } }
    if (platform === 'darwin') return { file: 'osascript', args: ['-e', `tell application "${appleScriptString(args.app)}" to quit`] }
    const missing = require('pkill', 'Install procps, or close the window instead.')
    return missing ?? { file: 'pkill', args: ['-x', String(args.app ?? '')] }
  }

  if (op === 'focus' || op === 'window_action') {
    const target = String(args.title ?? '')
    if (platform === 'win32') {
      return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], env: { JARVIS_DESKTOP_OP: op === 'focus' ? 'focus' : (args.action ?? 'focus'), JARVIS_DESKTOP_TARGET: target, JARVIS_DESKTOP_GEOMETRY: geometryString(args) } }
    }
    if (platform === 'darwin') return { file: 'osascript', args: ['-e', appleScriptWindow(op, args)] }
    const missing = require('wmctrl', 'Install it with "sudo apt install wmctrl".')
    if (missing) return missing
    if (op === 'focus') return { file: 'wmctrl', args: ['-a', target] }
    if (args.action === 'close') return { file: 'wmctrl', args: ['-c', target] }
    if (args.action === 'move' || args.action === 'resize') return { file: 'wmctrl', args: ['-r', target, '-e', `0,${Math.round(args.x ?? 0)},${Math.round(args.y ?? 0)},${Math.round(args.width ?? 0)},${Math.round(args.height ?? 0)}`] }
    if (args.action === 'minimize') return { file: 'wmctrl', args: ['-r', target, '-b', 'add,hidden'] }
    if (args.action === 'maximize') return { file: 'wmctrl', args: ['-r', target, '-b', 'add,maximized_vert,maximized_horz'] }
    if (args.action === 'restore') return { file: 'wmctrl', args: ['-r', target, '-b', 'remove,maximized_vert,maximized_horz,hidden'] }
    return { unsupported: `Unsupported window action "${args.action}".` }
  }

  if (op === 'type_text') {
    const text = String(args.text ?? '')
    if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], env: { JARVIS_DESKTOP_OP: 'type', JARVIS_DESKTOP_TEXT: sendKeysEscape(text) } }
    if (platform === 'darwin') return { file: 'osascript', args: ['-e', `tell application "System Events" to keystroke "${appleScriptString(text)}"`] }
    const missing = require('xdotool', 'Install it with "sudo apt install xdotool".')
    return missing ?? { file: 'xdotool', args: ['type', '--clearmodifiers', '--delay', '12', text] }
  }

  if (op === 'press_keys') {
    const combo = parseKeyCombo(args.keys)
    if (!combo.ok) return { unsupported: combo.reason }
    if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], env: { JARVIS_DESKTOP_OP: 'keys', JARVIS_DESKTOP_TEXT: sendKeysCombo(combo) } }
    if (platform === 'darwin') {
      const code = appleScriptKey(combo.key)
      const action = code === null ? `keystroke "${appleScriptString(combo.key)}"` : `key code ${code}`
      return { file: 'osascript', args: ['-e', `tell application "System Events" to ${action}${appleScriptModifiers(combo)}`] }
    }
    const missing = require('xdotool', 'Install it with "sudo apt install xdotool".')
    return missing ?? { file: 'xdotool', args: ['key', '--clearmodifiers', xdotoolCombo(combo)] }
  }

  if (op === 'move_mouse' || op === 'click' || op === 'scroll') {
    if (platform === 'win32') {
      return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], env: { JARVIS_DESKTOP_OP: op, JARVIS_DESKTOP_TARGET: `${Math.round(args.x ?? -1)},${Math.round(args.y ?? -1)}`, JARVIS_DESKTOP_GEOMETRY: `${args.button ?? 'left'},${Math.max(1, Math.round(args.count ?? 1))},${args.direction ?? 'down'},${Math.round(args.amount ?? 3)}` } }
    }
    if (platform === 'darwin') {
      const missing = require('cliclick', 'Install it with "brew install cliclick".')
      if (missing) return missing
      if (op === 'move_mouse') return { file: 'cliclick', args: [`m:${Math.round(args.x)},${Math.round(args.y)}`] }
      if (op === 'click') {
        const move = Number.isFinite(args.x) && Number.isFinite(args.y) ? `m:${Math.round(args.x)},${Math.round(args.y)} ` : ''
        const verb = (args.button ?? 'left') === 'right' ? 'rc' : 'c'
        const repeat = Math.max(1, Math.round(args.count ?? 1))
        return { file: 'cliclick', args: [`${move}${Array.from({ length: repeat }, () => verb).join(' ')}`] }
      }
      const lines = Math.max(1, Math.round(args.amount ?? 3))
      return { file: 'cliclick', args: [`${(args.direction ?? 'down') === 'up' ? 'su' : 'sd'}:${lines}`] }
    }
    const missing = require('xdotool', 'Install it with "sudo apt install xdotool".')
    if (missing) return missing
    if (op === 'move_mouse') return { file: 'xdotool', args: ['mousemove', String(Math.round(args.x)), String(Math.round(args.y))] }
    if (op === 'click') {
      const button = { left: 1, middle: 2, right: 3 }[args.button ?? 'left'] ?? 1
      const repeat = Math.max(1, Math.round(args.count ?? 1))
      return { file: 'xdotool', args: ['click', '--repeat', String(repeat), String(button)] }
    }
    const button = (args.direction ?? 'down') === 'up' ? 4 : 5
    return { file: 'xdotool', args: ['click', '--repeat', String(Math.max(1, Math.round(args.amount ?? 3))), String(button)] }
  }

  return { unsupported: `Unknown desktop operation "${op}".` }
}

/** Geometry as "x,y,w,h", empty when a move is not part of the action. */
export function geometryString(args = {}) {
  const parts = [args.x, args.y, args.width, args.height].map((value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : ''))
  return parts.some(Boolean) ? parts.join(',') : ''
}

/** AppleScript for window focus and the subset of actions System Events exposes. */
export function appleScriptWindow(op, args = {}) {
  const title = appleScriptString(args.title)
  const find = `set targetWindow to first window of (first process whose name contains "${title}")`
  if (op === 'focus') return `tell application "System Events" to set frontmost of (first process whose name contains "${title}") to true`
  const action = {
    close: 'perform action "AXPress" of (first button whose subrole is "AXCloseButton") of targetWindow',
    minimize: 'set value of attribute "AXMinimized" of targetWindow to true',
    maximize: 'set value of attribute "AXFullScreen" of targetWindow to true',
    restore: 'set value of attribute "AXFullScreen" of targetWindow to false',
    move: `set position of targetWindow to {${Math.round(args.x ?? 0)}, ${Math.round(args.y ?? 0)}}`,
    resize: `set size of targetWindow to {${Math.round(args.width ?? 800)}, ${Math.round(args.height ?? 600)}}`,
  }[args.action]
  if (!action) return 'error "unsupported action"'
  return `tell application "System Events"\n  ${find}\n  ${action}\nend tell`
}

/**
 * The Windows helper, in one PowerShell script driven by environment variables.
 *
 * Environment rather than command-line arguments on purpose: window titles and
 * typed text are user data, and an argv string is one quoting mistake away from
 * becoming script. The script only ever reads its parameters.
 */
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

const APPLE_LIST_WINDOWS = `tell application "System Events"
  set rows to {}
  repeat with p in (every process whose background only is false)
    repeat with w in (every window of p)
      set end of rows to ((name of p) & " | " & (name of w))
    end repeat
  end repeat
  return rows
end tell`

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

/** Read the installed apps for this platform, normalized. */
export async function listInstalledApps({ platform = process.platform, has = (name) => Boolean(programPath(name)) } = {}) {
  if (platform === 'win32') {
    const built = buildDesktopCommand('list_apps', {}, { platform, has })
    const result = await runBuilt(built)
    return result.ok ? { ok: true, apps: parseWindowsApps(result.stdout) } : result
  }
  if (platform === 'darwin') {
    const found = []
    for (const dir of MAC_APP_DIRS) {
      try {
        found.push(...parseMacApps(await readdir(dir)))
      } catch { /* directory may not exist */ }
    }
    const unique = new Map(found.map((app) => [app.id.toLowerCase(), app]))
    return { ok: true, apps: [...unique.values()].sort((a, b) => a.name.localeCompare(b.name)) }
  }
  const apps = []
  for (const dir of DESKTOP_DIRS) {
    let names = []
    try {
      names = await readdir(dir)
    } catch { continue }
    for (const name of names) {
      if (!name.endsWith('.desktop')) continue
      try {
        apps.push(...parseDesktopEntries(await readFile(join(dir, name), 'utf8'), { file: name }))
      } catch { /* unreadable entry */ }
    }
  }
  const unique = new Map(apps.map((app) => [app.name.toLowerCase(), app]))
  return { ok: true, apps: [...unique.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

/** A window list, normalized across platforms. */
export async function listDesktopWindows({ platform = process.platform, has = (name) => Boolean(programPath(name)) } = {}) {
  const built = buildDesktopCommand('list_windows', {}, { platform, has })
  const result = await runBuilt(built)
  if (!result.ok) return result
  if (platform === 'win32') {
    const rows = JSON.parse(result.stdout || '[]')
    const list = Array.isArray(rows) ? rows : [rows]
    return { ok: true, windows: list.map((row) => ({ handle: row.handle, pid: row.pid, title: row.title })) }
  }
  if (platform === 'darwin') {
    const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    return { ok: true, windows: lines.map((line) => { const [process = '', ...rest] = line.split(' | '); return { process, title: rest.join(' | ') } }) }
  }
  const lines = result.stdout.split(/\r?\n/).filter(Boolean)
  return {
    ok: true,
    windows: lines.map((line) => {
      const [id, desktop, pid, x, y, w, h, ...title] = line.split(/\s+/)
      return { id, desktop, pid, x: Number(x), y: Number(y), width: Number(w), height: Number(h), title: title.join(' ') }
    }),
  }
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
      'Read-only. Report which desktop session this host has and which control surface is actually available (xdotool/wmctrl on Linux, cliclick on macOS, user32 on Windows). Check this before promising a GUI action.',
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
      'Read-only. List the applications installed on this machine (Windows Start menu, macOS /Applications, Linux .desktop entries). Launch names come from here.',
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
        'Move, resize, minimize, maximize, restore or close one window by title fragment. Close asks the application to close (WM_CLOSE / AXPress / wmctrl -c) rather than killing it, so unsaved work can still prompt.',
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
        'Launch an installed application by name, as listed by list_apps. On Windows and macOS the name goes to the OS launcher; on Linux the matching .desktop entry is started. No command lines or arguments are accepted — use run_command for those.',
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
        'Send one key combination to whatever has focus, such as "ctrl+shift+t", "cmd+s" or "alt+tab". Use type_text for ordinary prose.',
        { keys: z.string().min(1).max(60).describe('A combo like ctrl+shift+t, cmd+s, alt+tab or return.') },
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
    `Host session: ${caps.platform}/${caps.session}.`,
    caps.gaps.length ? `Known limits: ${caps.gaps.join('; ')}.` : 'All control surfaces are installed.',
    allowWrites
      ? 'Focus or launch the window before typing, and prefer the app\'s own window over the pointer wherever possible. Say in one sentence what you are about to do when it changes something, and never claim an action succeeded unless the tool said so.'
      : 'Acting tools are withheld until the bridge is restarted with JARVIS_ALLOW_WRITES=1; only listing and capability checks are available, so do not claim to have clicked, typed or launched anything.',
  ].join(' ')

  return createSdkMcpServer({ name: 'jarvis_desktop', version: '1.0.0', instructions: instruction, tools })
}
