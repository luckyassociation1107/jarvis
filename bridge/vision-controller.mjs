/**
 * JARVIS Vision-Driven Controller.
 *
 * This is NOT a predefined command list. This is an AI that:
 *   1. Looks at your screen (screenshot or camera)
 *   2. Understands what you say in ANY language
 *   3. Figures out what to do based on what it SEES
 *   4. Does it — click, type, scroll, drag, anything
 *
 * Predefined commands are just shortcuts (max 100).
 * Vision-driven commands are UNLIMITED — the AI can interact with
 * anything it can see on your screen.
 *
 * Flow:
 *   User: "ahh button press cheyyu" (press that button)
 *   1. Screenshot the screen
 *   2. Vision model: "I see a blue 'Submit' button at coordinates (450, 320)"
 *   3. Chat model: "User wants to click the Submit button"
 *   4. Executor: click at (450, 320)
 *
 *   User: "ahh text field lo ramesh type cheyyu" (type ramesh in that field)
 *   1. Screenshot
 *   2. Vision model: "I see a text input field at (300, 200) labeled 'Username'"
 *   3. Click (300, 200), type "ramesh"
 *
 *   User: "aah dropdown lo india select cheyyu" (select india from that dropdown)
 *   1. Screenshot
 *   2. Vision model: "I see a dropdown at (400, 250) with options including India"
 *   3. Click dropdown, find India, click it
 *
 * This works on ANY screen, ANY application, ANY website — because
 * the AI understands what it sees, not a predefined list.
 */

import { spawn, execSync } from 'node:child_process'
import { platform } from 'node:os'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const plat = platform()

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/* ──────────────── Screen capture ──────────────────────────── */

/**
 * Take a screenshot and return the path.
 *
 * Uses OS-native screenshot tools. Returns a file path the vision
 * model can read.
 */
export async function captureScreen({ region = null } = {}) {
  const dir = resolve('models/screenshots')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `screen-${Date.now()}.png`)

  if (plat === 'linux') {
    // Try gnome-screenshot, then scrot, then import (ImageMagick)
    if (sh('which gnome-screenshot')) {
      sh(`gnome-screenshot -f "${path}"`)
    } else if (sh('which scrot')) {
      sh(`scrot "${path}"`)
    } else if (sh('which import')) {
      sh(`import -window root "${path}"`)
    } else if (sh('which xdg-screencap')) {
      sh(`xdg-screencap "${path}"`)
    } else {
      // Wayland fallback
      sh(`grim "${path}"`)
    }
  } else if (plat === 'darwin') {
    sh(`screencapture -x "${path}"`)
  } else if (plat === 'win32') {
    // PowerShell screenshot
    sh(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $gfx = [System.Drawing.Graphics]::FromImage($bmp); $gfx.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save('${path}') }"`)
  }

  if (existsSync(path)) return path
  return null
}

/**
 * Capture a specific region of the screen.
 */
export async function captureRegion(x, y, width, height) {
  const dir = resolve('models/screenshots')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `region-${Date.now()}.png`)

  if (plat === 'linux') {
    if (sh('which import')) {
      sh(`import -window root -crop ${width}x${height}+${x}+${y} "${path}"`)
    } else if (sh('which grim')) {
      sh(`grim -g "${x},${y} ${width}x${height}" "${path}"`)
    }
  } else if (plat === 'darwin') {
    sh(`screencapture -x -R${x},${y},${width},${height} "${path}"`)
  }

  if (existsSync(path)) return path
  return null
}

/* ──────────────── Mouse control ──────────────────────────── */

/**
 * Click at screen coordinates.
 */
export function clickAt(x, y, { button = 'left', double = false } = {}) {
  const clickType = double ? 'double-click' : 'click'
  const btn = button === 'right' ? '3' : button === 'middle' ? '2' : '1'

  if (plat === 'linux') {
    if (sh('which xdotool')) {
      sh(`xdotool mousemove ${Math.round(x)} ${Math.round(y)}`)
      if (double) {
        sh(`xdotool click --repeat 2 1`)
      } else {
        sh(`xdotool click ${btn}`)
      }
    } else if (sh('which ydotool')) {
      // Wayland
      sh(`ydotool mousemove --absolute -x ${Math.round(x)} -y ${Math.round(y)}`)
      sh(`ydotool click 0xC0`)
    }
  } else if (plat === 'darwin') {
    sh(`osascript -e 'tell application "System Events" to click at {${Math.round(x)}, ${Math.round(y)}}'`)
  } else if (plat === 'win32') {
    sh(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)}); [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')"`)
  }

  return { ok: true, action: clickType, x: Math.round(x), y: Math.round(y), button }
}

/**
 * Right-click at screen coordinates.
 */
export function rightClickAt(x, y) {
  return clickAt(x, y, { button: 'right' })
}

/**
 * Double-click at screen coordinates.
 */
export function doubleClickAt(x, y) {
  return clickAt(x, y, { double: true })
}

/**
 * Long press (hold) at screen coordinates.
 */
export function longPressAt(x, y, durationMs = 1000) {
  if (plat === 'linux' && sh('which xdotool')) {
    sh(`xdotool mousemove ${Math.round(x)} ${Math.round(y)}`)
    sh(`xdotool mousedown 1`)
    setTimeout(() => sh(`xdotool mouseup 1`), durationMs)
  }
  return { ok: true, action: 'long_press', x: Math.round(x), y: Math.round(y), duration: durationMs }
}

/**
 * Drag from one point to another.
 */
export function dragTo(fromX, fromY, toX, toY) {
  if (plat === 'linux' && sh('which xdotool')) {
    sh(`xdotool mousemove ${Math.round(fromX)} ${Math.round(fromY)}`)
    sh(`xdotool mousedown 1`)
    sh(`xdotool mousemove --delay 100 ${Math.round(toX)} ${Math.round(toY)}`)
    sh(`xdotool mouseup 1`)
  }
  return { ok: true, action: 'drag', from: { x: Math.round(fromX), y: Math.round(fromY) }, to: { x: Math.round(toX), y: Math.round(toY) } }
}

/**
 * Move mouse to coordinates (hover).
 */
export function hoverAt(x, y) {
  if (plat === 'linux' && sh('which xdotool')) {
    sh(`xdotool mousemove ${Math.round(x)} ${Math.round(y)}`)
  }
  return { ok: true, action: 'hover', x: Math.round(x), y: Math.round(y) }
}

/* ──────────────── Keyboard control ──────────────────────────── */

/**
 * Type text at the current cursor position.
 */
export function typeText(text) {
  if (plat === 'linux' && sh('which xdotool')) {
    sh(`xdotool type --clearmodifiers "${text.replace(/"/g, '\\"')}"`)
  } else if (plat === 'darwin') {
    sh(`osascript -e 'tell application "System Events" to keystroke "${text.replace(/"/g, '\\"')}"'`)
  } else if (plat === 'win32') {
    sh(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')"`)
  }
  return { ok: true, action: 'type', text }
}

/**
 * Press a key (Enter, Tab, Escape, arrow keys, etc.).
 */
export function pressKey(key) {
  const keyMap = {
    enter: { linux: 'Return', darwin: 'return', win32: '{ENTER}' },
    return: { linux: 'Return', darwin: 'return', win32: '{ENTER}' },
    tab: { linux: 'Tab', darwin: 'tab', win32: '{TAB}' },
    escape: { linux: 'Escape', darwin: 'escape', win32: '{ESC}' },
    esc: { linux: 'Escape', darwin: 'escape', win32: '{ESC}' },
    backspace: { linux: 'BackSpace', darwin: 'delete', win32: '{BACKSPACE}' },
    delete: { linux: 'Delete', darwin: 'forwarddelete', win32: '{DELETE}' },
    space: { linux: 'space', darwin: 'space', win32: ' ' },
    up: { linux: 'Up', darwin: 'up arrow', win32: '{UP}' },
    down: { linux: 'Down', darwin: 'down arrow', win32: '{DOWN}' },
    left: { linux: 'Left', darwin: 'left arrow', win32: '{LEFT}' },
    right: { linux: 'Right', darwin: 'right arrow', win32: '{RIGHT}' },
    home: { linux: 'Home', darwin: 'home', win32: '{HOME}' },
    end: { linux: 'End', darwin: 'end', win32: '{END}' },
    pageup: { linux: 'Page_Up', darwin: 'page up', win32: '{PGUP}' },
    pagedown: { linux: 'Page_Down', darwin: 'page down', win32: '{PGDN}' },
    f1: { linux: 'F1', darwin: 'f1', win32: '{F1}' },
    f2: { linux: 'F2', darwin: 'f2', win32: '{F2}' },
    f3: { linux: 'F3', darwin: 'f3', win32: '{F3}' },
    f4: { linux: 'F4', darwin: 'f4', win32: '{F4}' },
    f5: { linux: 'F5', darwin: 'f5', win32: '{F5}' },
    f6: { linux: 'F6', darwin: 'f6', win32: '{F6}' },
    f7: { linux: 'F7', darwin: 'f7', win32: '{F7}' },
    f8: { linux: 'F8', darwin: 'f8', win32: '{F8}' },
    f9: { linux: 'F9', darwin: 'f9', win32: '{F9}' },
    f10: { linux: 'F10', darwin: 'f10', win32: '{F10}' },
    f11: { linux: 'F11', darwin: 'f11', win32: '{F11}' },
    f12: { linux: 'F12', darwin: 'f12', win32: '{F12}' },
  }

  const k = keyMap[key.toLowerCase()] ?? { linux: key, darwin: key, win32: key }

  if (plat === 'linux' && sh('which xdotool')) {
    sh(`xdotool key ${k.linux}`)
  } else if (plat === 'darwin') {
    sh(`osascript -e 'tell application "System Events" to key code ${k.darwin}'`)
  } else if (plat === 'win32') {
    sh(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${k.win32}')"`)
  }

  return { ok: true, action: 'key', key }
}

/**
 * Press a keyboard shortcut (Ctrl+C, Alt+Tab, etc.).
 */
export function pressShortcut(...keys) {
  const combo = keys.join('+')

  if (plat === 'linux' && sh('which xdotool')) {
    // Convert to xdotool format
    const converted = keys.map((k) => {
      const map = { ctrl: 'ctrl', alt: 'alt', shift: 'shift', super: 'super', meta: 'super', win: 'super' }
      return map[k.toLowerCase()] ?? k
    }).join('+')
    sh(`xdotool key ${converted}`)
  } else if (plat === 'darwin') {
    const converted = keys.map((k) => {
      const map = { ctrl: 'command', alt: 'option', shift: 'shift', super: 'command', meta: 'command', win: 'command' }
      return map[k.toLowerCase()] ?? k
    })
    sh(`osascript -e 'tell application "System Events" to keystroke "${converted.pop()}" using {${converted.map((k) => `${k} down`).join(', ')}}'`)
  } else if (plat === 'win32') {
    const converted = keys.map((k) => {
      const map = { ctrl: '^', alt: '%', shift: '+', super: '^', meta: '^', win: '^' }
      return map[k.toLowerCase()] ?? k
    })
    const last = converted.pop()
    sh(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${converted.join('')}${last}')"`)
  }

  return { ok: true, action: 'shortcut', keys: combo }
}

/* ──────────────── Scroll control ──────────────────────────── */

/**
 * Scroll at current position.
 */
export function scroll(direction, amount = 3) {
  if (plat === 'linux' && sh('which xdotool')) {
    const btn = direction === 'up' ? '4' : '5'
    for (let i = 0; i < amount; i++) sh(`xdotool click ${btn}`)
  } else if (plat === 'darwin') {
    const dir = direction === 'up' ? 'up' : 'down'
    sh(`osascript -e 'tell application "System Events" to key code ${dir === 'up' ? '126' : '125'}'`)
  }
  return { ok: true, action: 'scroll', direction, amount }
}

/* ──────────────── Window management ──────────────────────────── */

/**
 * Get the active window title.
 */
export function getActiveWindow() {
  if (plat === 'linux') {
    return sh('xdotool getactivewindow getwindowname 2>/dev/null') ?? 'unknown'
  }
  if (plat === 'darwin') {
    return sh('osascript -e \'tell application "System Events" to get name of first window of (first process whose frontmost is true)\'') ?? 'unknown'
  }
  return 'unknown'
}

/**
 * Focus a window by title.
 */
export function focusWindow(title) {
  if (plat === 'linux' && sh('which wmctrl')) {
    sh(`wmctrl -a "${title}"`)
  } else if (plat === 'linux' && sh('which xdotool')) {
    sh(`xdotool search --name "${title}" windowactivate`)
  }
  return { ok: true, action: 'focus', title }
}

/* ──────────────── Vision-driven execution ──────────────────────────── */

/**
 * Execute a vision-driven action.
 *
 * This is the core of the unlimited command system. The AI looks at
 * the screen and decides what to do based on what it sees.
 *
 * @param {Object} action - What the AI decided to do
 * @param {string} action.type - click | type | scroll | key | shortcut | drag | hover | long_press
 * @param {Object} action.params - Action-specific parameters
 */
export async function executeVisionAction(action) {
  const { type, params = {} } = action

  switch (type) {
    case 'click':
      if (params.x != null && params.y != null) return clickAt(params.x, params.y)
      if (params.target) return { ok: false, error: 'Need coordinates from vision model' }
      return { ok: false, error: 'No click target specified' }

    case 'double_click':
      return doubleClickAt(params.x, params.y)

    case 'right_click':
      return rightClickAt(params.x, params.y)

    case 'long_press':
      return longPressAt(params.x, params.y, params.duration)

    case 'type':
      return typeText(params.text ?? '')

    case 'key':
      return pressKey(params.key ?? 'Return')

    case 'shortcut':
      return pressShortcut(...(params.keys ?? ['ctrl', 'c']))

    case 'scroll':
      return scroll(params.direction ?? 'down', params.amount ?? 3)

    case 'drag':
      return dragTo(params.fromX, params.fromY, params.toX, params.toY)

    case 'hover':
      return hoverAt(params.x, params.y)

    case 'focus':
      return focusWindow(params.title ?? '')

    case 'wait':
      await new Promise((r) => setTimeout(r, params.ms ?? 1000))
      return { ok: true, action: 'wait', ms: params.ms ?? 1000 }

    default:
      return { ok: false, error: `Unknown action type: ${type}` }
  }
}

export default {
  captureScreen,
  captureRegion,
  clickAt,
  rightClickAt,
  doubleClickAt,
  longPressAt,
  dragTo,
  hoverAt,
  typeText,
  pressKey,
  pressShortcut,
  scroll,
  getActiveWindow,
  focusWindow,
  executeVisionAction,
}