/**
 * Universal application launcher for JARVIS.
 *
 * Opens any application on the system through voice commands.
 * Works on Linux, macOS, and Windows.
 *
 * Features:
 *   - Launch by name: "open chrome", "open vscode", "open terminal"
 *   - Launch by command: "open firefox", "run code"
 *   - Fuzzy matching: "open visual studio" → finds "code"
 *   - Install missing apps: "install vlc"
 *   - Kill apps: "kill chrome"
 *   - List installed apps
 *   - Recent apps
 *
 * The launcher knows common apps on every platform and falls back to
 * OS-native discovery (which on Linux, Spotlight on macOS, Start menu
 * on Windows).
 */

import { execSync, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { platform, homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const plat = platform()

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/* ──────────────── Known applications ──────────────────────── */

/**
 * Map of common app names → their launch commands per platform.
 * The key is what the user says, the value is what we run.
 */
const APP_MAP = {
  // ── Browsers ──
  chrome:          { linux: 'google-chrome',      darwin: 'open -a "Google Chrome"', win32: 'start chrome' },
  'google chrome': { linux: 'google-chrome',      darwin: 'open -a "Google Chrome"', win32: 'start chrome' },
  firefox:         { linux: 'firefox',            darwin: 'open -a Firefox',         win32: 'start firefox' },
  edge:            { linux: 'microsoft-edge',     darwin: 'open -a "Microsoft Edge"', win32: 'start msedge' },
  'brave':         { linux: 'brave-browser',      darwin: 'open -a "Brave Browser"', win32: 'start brave' },
  opera:           { linux: 'opera',              darwin: 'open -a Opera',           win32: 'start opera' },
  safari:          { linux: null,                 darwin: 'open -a Safari',          win32: null },
  vivaldi:         { linux: 'vivaldi',            darwin: 'open -a Vivaldi',         win32: 'start vivaldi' },

  // ── Code editors / IDEs ──
  'vscode':        { linux: 'code',               darwin: 'open -a "Visual Studio Code"', win32: 'start code' },
  'visual studio code': { linux: 'code',          darwin: 'open -a "Visual Studio Code"', win32: 'start code' },
  code:            { linux: 'code',               darwin: 'open -a "Visual Studio Code"', win32: 'start code' },
  'sublime':       { linux: 'subl',               darwin: 'open -a "Sublime Text"',  win32: 'start subl' },
  'sublime text':  { linux: 'subl',               darwin: 'open -a "Sublime Text"',  win32: 'start subl' },
  atom:            { linux: 'atom',               darwin: 'open -a Atom',            win32: 'start atom' },
  vim:             { linux: 'x-terminal-emulator -e vim', darwin: 'open -a Terminal -e vim', win32: 'start vim' },
  neovim:          { linux: 'x-terminal-emulator -e nvim', darwin: 'open -a Terminal -e nvim', win32: 'start nvim' },
  nano:            { linux: 'x-terminal-emulator -e nano', darwin: 'open -a Terminal -e nano', win32: 'start nano' },
  intellij:        { linux: 'idea',               darwin: 'open -a "IntelliJ IDEA"', win32: 'start idea' },
  pycharm:         { linux: 'pycharm',            darwin: 'open -a "PyCharm"',       win32: 'start pycharm' },
  webstorm:        { linux: 'webstorm',           darwin: 'open -a "WebStorm"',      win32: 'start webstorm' },
  android:         { linux: 'android-studio',     darwin: 'open -a "Android Studio"', win32: 'start studio64' },
  'android studio': { linux: 'android-studio',    darwin: 'open -a "Android Studio"', win32: 'start studio64' },

  // ── Terminals ──
  terminal:        { linux: 'x-terminal-emulator', darwin: 'open -a Terminal',        win32: 'start cmd' },
  'command prompt': { linux: 'x-terminal-emulator', darwin: 'open -a Terminal',       win32: 'start cmd' },
  cmd:             { linux: 'x-terminal-emulator', darwin: 'open -a Terminal',        win32: 'start cmd' },
  powershell:      { linux: 'x-terminal-emulator', darwin: 'open -a Terminal',        win32: 'start powershell' },
  'windows terminal': { linux: null,              darwin: null,                       win32: 'start wt' },
  kitty:           { linux: 'kitty',              darwin: 'open -a kitty',            win32: null },
  alacritty:       { linux: 'alacritty',          darwin: 'open -a Alacritty',        win32: 'start alacritty' },
  wezterm:         { linux: 'wezterm',            darwin: 'open -a WezTerm',          win32: 'start wezterm' },
  konsole:         { linux: 'konsole',            darwin: null,                       win32: null },
  gnome:           { linux: 'gnome-terminal',     darwin: null,                       win32: null },
  'gnome terminal': { linux: 'gnome-terminal',    darwin: null,                       win32: null },
  xfce:            { linux: 'xfce4-terminal',     darwin: null,                       win32: null },

  // ── File managers ──
  files:           { linux: 'xdg-open .',         darwin: 'open .',                   win32: 'start .' },
  'file manager':  { linux: 'nautilus',           darwin: 'open .',                   win32: 'start .' },
  nautilus:        { linux: 'nautilus',           darwin: 'open -a Finder',           win32: 'start explorer' },
  thunar:          { linux: 'thunar',             darwin: null,                       win32: null },
  dolphin:         { linux: 'dolphin',            darwin: null,                       win32: null },
  ranger:          { linux: 'x-terminal-emulator -e ranger', darwin: 'open -a Terminal -e ranger', win32: null },
  mc:              { linux: 'x-terminal-emulator -e mc', darwin: 'open -a Terminal -e mc', win32: null },

  // ── System tools ──
  calculator:      { linux: 'gnome-calculator',   darwin: 'open -a Calculator',       win32: 'start calc' },
  calc:            { linux: 'gnome-calculator',   darwin: 'open -a Calculator',       win32: 'start calc' },
  settings:        { linux: 'gnome-control-center', darwin: 'open -a "System Preferences"', win32: 'start ms-settings:' },
  'system settings': { linux: 'gnome-control-center', darwin: 'open -a "System Settings"', win32: 'start ms-settings:' },
  preferences:     { linux: 'gnome-control-center', darwin: 'open -a "System Preferences"', win32: 'start ms-settings:' },
  screenshot:      { linux: 'gnome-screenshot',   darwin: 'open -a "Screenshot"',     win32: 'start snippingtool' },
  'snipping tool': { linux: 'gnome-screenshot',   darwin: 'open -a "Screenshot"',     win32: 'start snippingtool' },
  camera:          { linux: 'cheese',             darwin: 'open -a "Photo Booth"',    win32: 'start microsoft.windows.camera:' },
  'photo booth':   { linux: 'cheese',             darwin: 'open -a "Photo Booth"',    win32: null },
  monitor:         { linux: 'gnome-system-monitor', darwin: 'open -a "Activity Monitor"', win32: 'start taskmgr' },
  'task manager':  { linux: 'gnome-system-monitor', darwin: 'open -a "Activity Monitor"', win32: 'start taskmgr' },
  'activity monitor': { linux: 'gnome-system-monitor', darwin: 'open -a "Activity Monitor"', win32: 'start taskmgr' },
  disk:            { linux: 'gnome-disks',        darwin: 'open -a "Disk Utility"',   win32: 'start diskmgmt' },
  'disk utility':  { linux: 'gnome-disks',        darwin: 'open -a "Disk Utility"',   win32: 'start diskmgmt' },
  bluetooth:       { linux: 'bluetoothctl',       darwin: 'open "x-apple.systempreferences:com.apple.preference.Bluetooth"', win32: 'start ms-settings:bluetooth' },
  wifi:            { linux: 'nm-connection-editor', darwin: 'open "x-apple.systempreferences:com.apple.preference.network"', win32: 'start ms-settings:network-wifi' },
  printer:         { linux: 'system-config-printer', darwin: 'open -a "System Preferences"', win32: 'start control printers' },

  // ── Media ──
  vlc:             { linux: 'vlc',                darwin: 'open -a VLC',              win32: 'start vlc' },
  spotify:         { linux: 'spotify',            darwin: 'open -a Spotify',          win32: 'start spotify' },
  'mpv':           { linux: 'mpv',                darwin: 'open -a mpv',              win32: 'start mpv' },
  rhythmbox:       { linux: 'rhythmbox',          darwin: null,                       win32: null },
  audacity:        { linux: 'audacity',           darwin: 'open -a Audacity',         win32: 'start audacity' },
  obs:             { linux: 'obs',                darwin: 'open -a "OBS Studio"',     win32: 'start obs64' },
  'obs studio':    { linux: 'obs',                darwin: 'open -a "OBS Studio"',     win32: 'start obs64' },
  gimp:            { linux: 'gimp',               darwin: 'open -a GIMP',             win32: 'start gimp' },
  inkscape:        { linux: 'inkscape',           darwin: 'open -a Inkscape',         win32: 'start inkscape' },
  blender:         { linux: 'blender',            darwin: 'open -a Blender',          win32: 'start blender' },

  // ── Communication ──
  discord:         { linux: 'discord',            darwin: 'open -a Discord',          win32: 'start discord' },
  slack:           { linux: 'slack',              darwin: 'open -a Slack',            win32: 'start slack' },
  teams:           { linux: 'teams',              darwin: 'open -a "Microsoft Teams"', win32: 'start msteams' },
  zoom:            { linux: 'zoom',               darwin: 'open -a zoom.us',          win32: 'start zoom' },
  telegram:        { linux: 'telegram-desktop',   darwin: 'open -a Telegram',         win32: 'start telegram' },
  signal:          { linux: 'signal-desktop',     darwin: 'open -a Signal',           win32: 'start signal' },
  thunderbird:     { linux: 'thunderbird',        darwin: 'open -a Thunderbird',      win32: 'start thunderbird' },

  // ── Office ──
  'word':          { linux: 'libreoffice --writer', darwin: 'open -a "Microsoft Word"', win32: 'start winword' },
  'excel':         { linux: 'libreoffice --calc',   darwin: 'open -a "Microsoft Excel"', win32: 'start excel' },
  'powerpoint':    { linux: 'libreoffice --impress', darwin: 'open -a "Microsoft PowerPoint"', win32: 'start powerpnt' },
  'libreoffice':   { linux: 'libreoffice',        darwin: 'open -a "LibreOffice"',    win32: 'start soffice' },
  writer:          { linux: 'libreoffice --writer', darwin: 'open -a "LibreOffice"',  win32: 'start soffice' },
  calc:            { linux: 'gnome-calculator',   darwin: 'open -a Calculator',       win32: 'start calc' },
  notepad:         { linux: 'gedit',              darwin: 'open -a TextEdit',         win32: 'start notepad' },
  'text editor':   { linux: 'gedit',              darwin: 'open -a TextEdit',         win32: 'start notepad' },
  gedit:           { linux: 'gedit',              darwin: 'open -a TextEdit',         win32: 'start notepad' },

  // ── Dev tools ──
  docker:          { linux: 'docker',             darwin: 'open -a Docker',           win32: 'start docker' },
  postman:         { linux: 'postman',            darwin: 'open -a Postman',          win32: 'start postman' },
  dbeaver:         { linux: 'dbeaver',            darwin: 'open -a DBeaver',          win32: 'start dbeaver' },
  git:             { linux: 'x-terminal-emulator -e git', darwin: 'open -a Terminal -e git', win32: 'start git' },

  // ── Misc ──
  'google drive':  { linux: 'xdg-open https://drive.google.com', darwin: 'open https://drive.google.com', win32: 'start https://drive.google.com' },
  'google docs':   { linux: 'xdg-open https://docs.google.com',  darwin: 'open https://docs.google.com',  win32: 'start https://docs.google.com' },
  'google sheets': { linux: 'xdg-open https://sheets.google.com', darwin: 'open https://sheets.google.com', win32: 'start https://sheets.google.com' },
  chatgpt:         { linux: 'xdg-open https://chat.openai.com',  darwin: 'open https://chat.openai.com',  win32: 'start https://chat.openai.com' },
  claude:          { linux: 'xdg-open https://claude.ai',        darwin: 'open https://claude.ai',        win32: 'start https://claude.ai' },
}

/* ──────────────── Fuzzy matching ──────────────────────────── */

/**
 * Find the best matching app for a user's voice input.
 *
 * Tries:
 *   1. Exact match
 *   2. Starts-with match
 *   3. Contains match
 *   4. Levenshtein distance (typo tolerance)
 */
export function findApp(query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return null

  // Exact match
  if (APP_MAP[q]) return { name: q, entry: APP_MAP[q], confidence: 1.0 }

  // Starts-with
  for (const [name, entry] of Object.entries(APP_MAP)) {
    if (name.startsWith(q)) return { name, entry, confidence: 0.9 }
  }

  // Contains
  for (const [name, entry] of Object.entries(APP_MAP)) {
    if (name.includes(q) || q.includes(name)) return { name, entry, confidence: 0.8 }
  }

  // Fuzzy (Levenshtein ≤ 2)
  let bestMatch = null
  let bestDist = 3
  for (const [name, entry] of Object.entries(APP_MAP)) {
    const dist = levenshtein(q, name)
    if (dist < bestDist) {
      bestDist = dist
      bestMatch = { name, entry, confidence: Math.max(0.3, 1 - dist / Math.max(q.length, name.length)) }
    }
  }
  if (bestMatch) return bestMatch

  // Try as a raw command
  return { name: q, entry: { [plat]: q }, confidence: 0.4, raw: true }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return dp[m][n]
}

/* ──────────────── Launch ──────────────────────────────────── */

/**
 * Open an application by name.
 *
 * @param {string} appName - The app name from voice command
 * @returns {{ ok: boolean, message: string, command?: string }}
 */
export function openApp(appName) {
  const found = findApp(appName)
  if (!found) return { ok: false, message: `Could not find "${appName}"` }

  const { name, entry, confidence, raw } = found
  const cmd = entry[plat]

  if (!cmd && !raw) {
    return { ok: false, message: `"${name}" is not available on ${plat}` }
  }

  const command = cmd ?? name

  try {
    // Detach the process so it doesn't block
    const child = spawn('sh', ['-c', command], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()

    return {
      ok: true,
      message: `Opening ${name}`,
      command,
      confidence,
    }
  } catch (error) {
    // Try alternative: maybe it's a URL
    if (name.includes('.') && !name.includes(' ')) {
      try {
        const urlCmd = plat === 'darwin' ? `open https://${name}` : plat === 'win32' ? `start https://${name}` : `xdg-open https://${name}`
        spawn('sh', ['-c', urlCmd], { detached: true, stdio: 'ignore' }).unref()
        return { ok: true, message: `Opening https://${name}`, command: urlCmd, confidence: 0.5 }
      } catch { /* ignore */ }
    }

    return { ok: false, message: `Failed to open ${name}: ${error.message}` }
  }
}

/* ──────────────── Install ──────────────────────────────────── */

/**
 * Install an application.
 *
 * Detects the package manager and installs.
 */
export function installApp(appName) {
  const q = String(appName ?? '').trim().toLowerCase()

  // Detect package manager
  const managers = [
    { check: 'apt-get', cmd: (pkg) => `sudo apt-get install -y ${pkg}` },
    { check: 'dnf',     cmd: (pkg) => `sudo dnf install -y ${pkg}` },
    { check: 'yum',     cmd: (pkg) => `sudo yum install -y ${pkg}` },
    { check: 'pacman',  cmd: (pkg) => `sudo pacman -S --noconfirm ${pkg}` },
    { check: 'brew',    cmd: (pkg) => `brew install ${pkg}` },
    { check: 'snap',    cmd: (pkg) => `sudo snap install ${pkg}` },
    { check: 'flatpak', cmd: (pkg) => `flatpak install -y ${pkg}` },
  ]

  let pm = null
  for (const m of managers) {
    if (sh(`which ${m.check}`)) { pm = m; break }
  }

  if (!pm) return { ok: false, message: 'No package manager found' }

  // Map common names to package names
  const packageMap = {
    chrome: 'google-chrome-stable',
    'google chrome': 'google-chrome-stable',
    firefox: 'firefox',
    vlc: 'vlc',
    gimp: 'gimp',
    spotify: 'spotify-client',
    discord: 'discord',
    slack: 'slack',
    code: 'code',
    vscode: 'code',
    'visual studio code': 'code',
    docker: 'docker.io',
    node: 'nodejs',
    python: 'python3',
    git: 'git',
    curl: 'curl',
    wget: 'wget',
    htop: 'htop',
    vim: 'vim',
    nano: 'nano',
  }

  const pkg = packageMap[q] ?? q
  const command = pm.cmd(pkg)

  try {
    const output = sh(command)
    return { ok: true, message: `Installed ${pkg}`, command, output }
  } catch (error) {
    return { ok: false, message: `Failed to install ${pkg}: ${error.message}`, command }
  }
}

/* ──────────────── Kill ──────────────────────────────────── */

/**
 * Kill an application by name.
 */
export function killApp(appName) {
  const q = String(appName ?? '').trim().toLowerCase()

  // Map to process names
  const processMap = {
    chrome: ['chrome', 'google-chrome', 'Google Chrome'],
    firefox: ['firefox'],
    code: ['code', 'electron'], // VS Code is Electron
    vscode: ['code'],
    terminal: ['gnome-terminal', 'konsole', 'xfce4-terminal', 'alacritty', 'kitty'],
    discord: ['Discord'],
    slack: ['slack'],
    spotify: ['spotify'],
    zoom: ['zoom'],
    teams: ['teams', 'ms-teams'],
  }

  const processes = processMap[q] ?? [q]
  let killed = false

  for (const proc of processes) {
    try {
      if (plat === 'win32') {
        sh(`taskkill /IM ${proc}.exe /F`)
      } else {
        sh(`pkill -f "${proc}"`)
      }
      killed = true
    } catch { /* not running */ }
  }

  return killed
    ? { ok: true, message: `Closed ${appName}` }
    : { ok: false, message: `${appName} is not running` }
}

/* ──────────────── List ──────────────────────────────────── */

/**
 * List installed applications.
 */
export function listApps() {
  if (plat === 'linux') {
    // List .desktop files
    const dirs = [
      '/usr/share/applications',
      join(homedir(), '.local/share/applications'),
    ]
    const apps = []
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      try {
        for (const file of readdirSync(dir)) {
          if (file.endsWith('.desktop')) {
            const name = file.replace('.desktop', '').replace(/-/g, ' ')
            apps.push(name)
          }
        }
      } catch { /* permission denied */ }
    }
    return [...new Set(apps)].sort()
  }

  if (plat === 'darwin') {
    const out = sh('ls /Applications/')
    return out ? out.split('\n').map((a) => a.replace('.app', '')).sort() : []
  }

  if (plat === 'win32') {
    const out = sh('wmic product get name 2>nul')
    return out ? out.split('\n').filter(Boolean).map((a) => a.trim()).sort() : []
  }

  return []
}

/* ──────────────── Recent apps ──────────────────────────── */

/**
 * Get recently used applications.
 */
export function recentApps() {
  if (plat === 'linux') {
    const out = sh('journalctl --user -u app --since "1 hour ago" --no-pager 2>/dev/null | grep -oP "(?<=application\\[)[^\\]]+" | sort -u | tail -10')
    if (out) return out.split('\n').filter(Boolean)
    // Fallback: check recent files
    const recent = sh('ls -lt ~/.local/share/recently-used.xbel 2>/dev/null')
    return recent ? ['recent files available'] : []
  }

  if (plat === 'darwin') {
    return sh('mdls -name kMDItemLastUsedDate /Applications/*.app 2>/dev/null | head -10')?.split('\n') ?? []
  }

  return []
}

/* ──────────────── All available apps for autocomplete ──────────────────── */

export function allKnownApps() {
  return [...new Set(Object.keys(APP_MAP))].sort()
}

export default {
  findApp,
  openApp,
  installApp,
  killApp,
  listApps,
  recentApps,
  allKnownApps,
  APP_MAP,
}