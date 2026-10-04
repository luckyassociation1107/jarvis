/**
 * JARVIS Contextual Awareness — knows WHERE you are, WHAT you're doing.
 *
 * Adapts behavior based on:
 *   - Active application (coding? browsing? watching?)
 *   - Time of day (morning? afternoon? night?)
 *   - Day of week (weekday? weekend?)
 *   - User state (focused? idle? away?)
 *   - Recent activity pattern
 */

import { execSync } from 'node:child_process'
import { platform } from 'node:os'

const plat = platform()
function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }

/* ──────────────── Context detection ──────────────────────────── */

/**
 * Get the full context of what the user is doing right now.
 */
export function getContext() {
  const now = new Date()
  const hour = now.getHours()
  const day = now.getDay() // 0=Sun
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]
  const isWeekend = day === 0 || day === 6
  const timeOfDay = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night'

  // Active application
  let app = 'unknown'
  let appCategory = 'other'
  if (plat === 'linux') app = sh('xdotool getactivewindow getwindowname 2>/dev/null') ?? 'unknown'
  else if (plat === 'darwin') app = sh('osascript -e \'tell app "System Events" to name of first process whose frontmost is true\'') ?? 'unknown'

  // Categorize the app
  if (/code|vscode|intellij|pycharm|webstorm|vim|nvim|emacs/i.test(app)) appCategory = 'coding'
  else if (/chrome|firefox|edge|brave|safari|opera|browser/i.test(app)) appCategory = 'browsing'
  else if (/youtube|netflix|spotify|vlc|mpv|media|player|music/i.test(app)) appCategory = 'media'
  else if (/terminal|cmd|powershell|konsole|alacritty|kitty|shell/i.test(app)) appCategory = 'terminal'
  else if (/slack|discord|teams|zoom|meet|telegram|whatsapp|signal/i.test(app)) appCategory = 'communication'
  else if (/gmail|outlook|thunderbird|mail/i.test(app)) appCategory = 'email'
  else if (/word|excel|powerpoint|docs|sheets|slides|libreoffice/i.test(app)) appCategory = 'office'
  else if (/photoshop|gimp|figma|sketch|canva|illustrator/i.test(app)) appCategory = 'design'
  else if (/file|nautilus|thunar|dolphin|finder|explorer/i.test(app)) appCategory = 'files'

  // System state
  let idle = false
  if (plat === 'linux') {
    const idleSec = sh('xprintidle 2>/dev/null')
    if (idleSec) idle = Number(idleSec) > 300_000 // 5 minutes
  }

  return {
    timestamp: now.toISOString(),
    hour,
    day: dayName,
    isWeekend,
    timeOfDay,
    activeApp: app,
    appCategory,
    isIdle: idle,
    platform: plat,
  }
}

/* ──────────────── Behavior adaptation ──────────────────────────── */

/**
 * Get JARVIS behavior settings based on context.
 *
 * Different contexts → different response styles, verbosity, tone.
 */
export function getBehaviorForContext(ctx) {
  const behavior = {
    verbosity: 'normal',    // brief | normal | detailed
    tone: 'casual',         // casual | professional | friendly | quiet
    proactive: true,        // should JARVIS suggest things?
    interrupt: false,       // should JARVIS interrupt?
    ttsEnabled: true,       // should JARVIS speak?
    responseLanguage: null, // null = auto-detect
  }

  // Coding → technical, brief
  if (ctx.appCategory === 'coding') {
    behavior.verbosity = 'brief'
    behavior.tone = 'professional'
    behavior.proactive = false // don't interrupt coding
  }

  // Terminal → very brief, technical
  if (ctx.appCategory === 'terminal') {
    behavior.verbosity = 'brief'
    behavior.tone = 'professional'
    behavior.proactive = false
  }

  // Media → casual, quiet
  if (ctx.appCategory === 'media') {
    behavior.verbosity = 'brief'
    behavior.tone = 'casual'
    behavior.interrupt = false
    behavior.ttsEnabled = false // don't talk over media
  }

  // Communication → helpful, brief
  if (ctx.appCategory === 'communication') {
    behavior.verbosity = 'brief'
    behavior.tone = 'helpful'
  }

  // Night → quiet mode
  if (ctx.timeOfDay === 'night') {
    behavior.ttsEnabled = false
    behavior.proactive = false
    behavior.verbosity = 'brief'
  }

  // Morning → proactive, friendly
  if (ctx.timeOfDay === 'morning') {
    behavior.proactive = true
    behavior.tone = 'friendly'
  }

  // Weekend → casual
  if (ctx.isWeekend) {
    behavior.tone = 'casual'
    behavior.proactive = true
  }

  // Idle → proactive suggestions
  if (ctx.isIdle) {
    behavior.proactive = true
  }

  return behavior
}

/**
 * Get a context-aware system prompt addition.
 */
export function getContextPrompt(ctx) {
  const behavior = getBehaviorForContext(ctx)
  const lines = []

  lines.push(`[CONTEXT: User is ${ctx.appCategory} in "${ctx.activeApp}" at ${ctx.timeOfDay} on ${ctx.day}]`)
  lines.push(`[BEHAVIOR: ${behavior.verbosity} responses, ${behavior.tone} tone${behavior.ttsEnabled ? ', voice enabled' : ', text only'}]`)

  if (ctx.appCategory === 'coding') {
    lines.push('[HINT: User is coding. Be technical, concise. Offer code suggestions. Don\'t ask unnecessary questions.]')
  }
  if (ctx.appCategory === 'media') {
    lines.push('[HINT: User is watching/listening. Keep responses very brief. Use commands, not conversation.]')
  }
  if (ctx.timeOfDay === 'night') {
    lines.push('[HINT: It\'s late. Keep responses brief. Don\'t suggest activities.]')
  }

  return lines.join('\n')
}

export default { getContext, getBehaviorForContext, getContextPrompt }