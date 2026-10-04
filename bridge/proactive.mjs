/**
 * JARVIS Proactive Intelligence — watches, learns, suggests.
 *
 * Doesn't wait to be asked. Detects patterns, monitors state,
 * and suggests actions before you think of them.
 */

import { store, recall, recordRoutine, getRoutines, getPreferences, setPreference } from './memory.mjs'
import { captureScreen } from './vision-controller.mjs'
import { execSync } from 'node:child_process'
import { platform } from 'node:os'
import process from 'node:process'

const plat = platform()
function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }

/* ──────────────── State monitoring ──────────────────────────── */

/**
 * Get current system state: battery, wifi, volume, active app, time.
 */
export function getSystemState() {
  const now = new Date()
  const hour = now.getHours()
  const day = now.toLocaleDateString('en-US', { weekday: 'long' })
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  let battery = null
  if (plat === 'linux') {
    const bat = sh('cat /sys/class/power_supply/BAT0/capacity 2>/dev/null')
    const status = sh('cat /sys/class/power_supply/BAT0/status 2>/dev/null')
    if (bat) battery = { level: Number(bat), charging: status === 'Charging' }
  } else if (plat === 'darwin') {
    const out = sh('pmset -g batt')
    const match = out?.match(/(\d+)%/)
    if (match) battery = { level: Number(match[1]), charging: /charging/i.test(out) }
  }

  let activeWindow = 'unknown'
  if (plat === 'linux') activeWindow = sh('xdotool getactivewindow getwindowname 2>/dev/null') ?? 'unknown'
  else if (plat === 'darwin') activeWindow = sh('osascript -e \'tell app "System Events" to name of first process whose frontmost is true\'') ?? 'unknown'

  let volume = null
  if (plat === 'linux') {
    const vol = sh("amixer get Master 2>/dev/null | grep -oP '\\d+%' | head -1")
    if (vol) volume = Number(vol.replace('%', ''))
  }

  return { hour, day, time, battery, activeWindow, volume, platform: plat }
}

/* ──────────────── Pattern detection ──────────────────────────── */

/**
 * Detect what the user is doing and suggest proactive actions.
 */
export function detectAndSuggest(state) {
  const suggestions = []
  const { hour, day, battery, activeWindow, volume } = state

  // Battery warnings
  if (battery && battery.level <= 20 && !battery.charging) {
    suggestions.push({
      type: 'warning',
      priority: 'high',
      message: `Battery ${battery.level}% undi. Charger pettuko. ippudu ${state.time} ki meeting unda check cheyyali.`,
      messageEn: `Battery at ${battery.level}%. Plug in the charger.`,
      action: 'battery_low',
    })
  }

  // Time-based suggestions
  if (hour >= 7 && hour <= 8) {
    suggestions.push({
      type: 'routine',
      priority: 'medium',
      message: 'Good morning! Gmail check cheyyamantaava? Weather choodamantaava?',
      action: 'morning_routine',
    })
  }

  if (hour >= 12 && hour <= 13) {
    suggestions.push({
      type: 'health',
      priority: 'low',
      message: 'Lunch time ayyindi. Break teesuko!',
      action: 'lunch_reminder',
    })
  }

  if (hour >= 17 && hour <= 18) {
    suggestions.push({
      type: 'routine',
      priority: 'medium',
      message: 'Office hours ayyayi. Traffic check cheyyamantaava?',
      action: 'evening_routine',
    })
  }

  // App-based suggestions
  if (/youtube/i.test(activeWindow)) {
    suggestions.push({
      type: 'context',
      priority: 'low',
      message: 'YouTube lo unnav. Playlist create cheyyamantaava?',
      action: 'youtube_context',
    })
  }

  if (/code|vscode|visual studio/i.test(activeWindow)) {
    suggestions.push({
      type: 'context',
      priority: 'low',
      message: 'Code chestunnav. Git status check cheyyamantaava?',
      action: 'coding_context',
    })
  }

  // Weekend suggestions
  if (['Saturday', 'Sunday'].includes(day)) {
    suggestions.push({
      type: 'context',
      priority: 'low',
      message: 'Weekend! Movie choodamantaava? Netflix open cheyyamantaava?',
      action: 'weekend',
    })
  }

  return suggestions
}

/* ──────────────── Learning ──────────────────────────── */

/**
 * Learn from user interactions.
 *
 * Extracts preferences, facts, and patterns from conversations.
 */
export function learnFromInteraction(userMessage, aiResponse) {
  const lower = userMessage.toLowerCase()

  // Learn preferences
  if (/i (like|love|prefer|enjoy)/i.test(lower) || /na?aku? (istam|preference|ishtam)/i.test(lower)) {
    const match = lower.match(/(?:i (?:like|love|prefer|enjoy)|na?aku? (?:istam|preference|ishtam))\s+(.+)/i)
    if (match) setPreference('likes', match[1].trim(), 'true', { confidence: 0.7 })
  }

  if (/i (hate|dislike|don't like)/i.test(lower) || /na?aku? (nacchadu|istam ledu)/i.test(lower)) {
    const match = lower.match(/(?:i (?:hate|dislike|don't like)|na?aku? (?:nacchadu|istam ledu))\s+(.+)/i)
    if (match) setPreference('dislikes', match[1].trim(), 'true', { confidence: 0.7 })
  }

  // Learn names
  if (/my name is|i'm|naa peru|na peru/i.test(lower)) {
    const match = lower.match(/(?:my name is|i'm|naa peru|na peru)\s+(\w+)/i)
    if (match) {
      const { learn } = require('./memory.mjs')
      learn('user', 'name', match[1], { confidence: 1.0 })
    }
  }

  // Learn relationships
  if (/my (friend|brother|sister|mother|father|wife|husband|colleague)/i.test(lower)) {
    const match = lower.match(/my (friend|brother|sister|mother|father|wife|husband|colleague)\s+(\w+)/i)
    if (match) {
      const { rememberPerson } = require('./memory.mjs')
      rememberPerson(match[2], { relationship: match[1] })
    }
  }

  // Detect routine patterns
  const timeMatch = lower.match(/(?:every|roju|daily|prathi)\s+(?:day\s+)?(\d{1,2})\s*(?::|am|pm)/i)
  if (timeMatch) {
    recordRoutine(userMessage.slice(0, 100), { timeHint: timeMatch[0] })
  }

  // Store the conversation
  store(userMessage, { type: 'conversation', source: 'user' })
  store(aiResponse, { type: 'conversation', source: 'assistant' })
}

/* ──────────────── Monitoring loop ──────────────────────────── */

let monitorInterval = null

export function startProactiveMonitor({ onSuggestion = () => {}, intervalMs = 60_000 } = {}) {
  if (monitorInterval) return

  monitorInterval = setInterval(() => {
    const state = getSystemState()
    const suggestions = detectAndSuggest(state)
    for (const s of suggestions) {
      if (s.priority === 'high') onSuggestion(s)
    }
  }, intervalMs)
}

export function stopProactiveMonitor() {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null }
}

export default { getSystemState, detectAndSuggest, learnFromInteraction, startProactiveMonitor, stopProactiveMonitor }