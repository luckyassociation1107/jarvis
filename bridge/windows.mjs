import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { z } from 'zod'
import { createSdkMcpServer, tool } from './mcp.mjs'

const execFileAsync = promisify(execFile)
const WINDOW_ACTIONS = new Set(['focus', 'minimize', 'maximize', 'restore', 'close'])
const APP_ALIASES = Object.freeze({
  notepad: 'notepad.exe',
  calculator: 'calc.exe',
  paint: 'mspaint.exe',
  explorer: 'explorer.exe',
  settings: 'ms-settings:',
})

const POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$action = $env:JARVIS_WIN_ACTION
$query = $env:JARVIS_WIN_QUERY
$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class JarvisWin {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  public static string Title(IntPtr hwnd) {
    StringBuilder text = new StringBuilder(1024);
    GetWindowText(hwnd, text, text.Capacity);
    return text.ToString();
  }
  public static object[] VisibleWindows() {
    List<object> rows = new List<object>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
      if (!IsWindowVisible(hwnd)) return true;
      string title = Title(hwnd);
      if (String.IsNullOrWhiteSpace(title)) return true;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      string process = "unknown";
      try { process = Process.GetProcessById((int)pid).ProcessName; } catch { }
      rows.Add(new Dictionary<string, object> { { "handle", hwnd.ToInt64() }, { "pid", (int)pid }, { "process", process }, { "title", title } });
      return true;
    }, IntPtr.Zero);
    return rows.ToArray();
  }
  public static bool Act(long handle, string action) {
    IntPtr hwnd = new IntPtr(handle);
    if (action == "focus") { ShowWindow(hwnd, 9); return SetForegroundWindow(hwnd); }
    if (action == "restore") { ShowWindow(hwnd, 9); return true; }
    if (action == "minimize") { ShowWindow(hwnd, 6); return true; }
    if (action == "maximize") { ShowWindow(hwnd, 3); return true; }
    if (action == "close") return PostMessage(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
    return false;
  }
}
'@
Add-Type -TypeDefinition $source
if ($action -eq 'launch') {
  Start-Process -FilePath $env:JARVIS_WIN_APP | Out-Null
  @{ ok = $true; app = $env:JARVIS_WIN_ALIAS } | ConvertTo-Json -Compress
  exit
}
$all = @([JarvisWin]::VisibleWindows())
if ($action -eq 'list') {
  ConvertTo-Json -InputObject @($all) -Compress -Depth 4
  exit
}
$matches = @($all | Where-Object { $_.title.IndexOf($query, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
if ($matches.Count -eq 0) {
  @{ ok = $false; error = 'No visible window title contains that text.' } | ConvertTo-Json -Compress
  exit
}
if ($matches.Count -gt 1) {
  @{ ok = $false; error = 'More than one window matches; use a more specific title.'; matches = @($matches | ForEach-Object { $_.title }) } | ConvertTo-Json -Compress -Depth 4
  exit
}
$window = $matches[0]
$ok = [JarvisWin]::Act([long]$window.handle, $action)
@{ ok = $ok; action = $action; title = $window.title; pid = $window.pid } | ConvertTo-Json -Compress
`

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function powershellPath() {
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

async function runWindows(action, query = '', appAlias = '') {
  if (process.platform !== 'win32') {
    return { ok: false, error: `Windows desktop controls are unavailable on ${process.platform}.` }
  }
  const env = {
    ...process.env,
    JARVIS_WIN_ACTION: action,
    JARVIS_WIN_QUERY: query,
    JARVIS_WIN_ALIAS: appAlias,
    JARVIS_WIN_APP: APP_ALIASES[appAlias] ?? '',
  }
  try {
    const { stdout } = await execFileAsync(powershellPath(), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodePowerShell(POWERSHELL),
    ], { env, timeout: 12_000, windowsHide: true, maxBuffer: 1024 * 1024 })
    const text = stdout.trim()
    if (!text) return { ok: false, error: 'PowerShell returned no window data.' }
    return JSON.parse(text)
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 400) }
  }
}

const textResult = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(value?.ok === false ? { isError: true } : {}),
})

export function windowsServer({ allowWrites = false } = {}) {
  const tools = [
    tool(
      'list_windows',
      'Read-only. List real visible Windows application windows with title, process name and PID. This reports live host data, never an estimate.',
      {},
      async () => textResult(await runWindows('list')),
    ),
  ]

  if (allowWrites) {
    const titleSchema = { title_contains: z.string().min(1).max(160).describe('A distinctive fragment of the visible window title.') }
    for (const action of WINDOW_ACTIONS) {
      tools.push(tool(
        `${action}_window`,
        `Windows desktop action. Match exactly one visible window by title fragment, then ${action} it. Ambiguous matches are refused. Close sends WM_CLOSE so the application can prompt about unsaved work; it does not force-kill a process. Requires JARVIS_ALLOW_WRITES=1.`,
        titleSchema,
        async ({ title_contains }) => textResult(await runWindows(action, title_contains)),
      ))
    }
    tools.push(tool(
      'launch_window_app',
      'Launch one allowlisted Windows app by alias. No arbitrary command lines or arguments are accepted. Requires JARVIS_ALLOW_WRITES=1.',
      { app: z.enum(Object.keys(APP_ALIASES)).describe('Allowlisted app: notepad, calculator, paint, explorer, or settings.') },
      async ({ app }) => textResult(await runWindows('launch', '', app)),
    ))
  }

  const instruction = allowWrites
    ? 'List windows freely. Window actions are enabled only because JARVIS_ALLOW_WRITES=1; choose a unique title and report the actual result.'
    : 'Read-only Windows window listing is enabled. Focus, resize, close and app-launch actions are withheld until the bridge is restarted with JARVIS_ALLOW_WRITES=1.'

  return createSdkMcpServer({ name: 'jarvis_windows', version: '1.0.0', instructions: instruction, tools })
}
