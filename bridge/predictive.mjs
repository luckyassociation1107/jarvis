/**
 * JARVIS Predictive Actions — anticipates what you'll do next.
 *
 * Learns from patterns:
 *   - Time-based: "Every morning at 8, user checks email"
 *   - Sequence-based: "After opening Chrome, user usually opens Gmail"
 *   - Day-based: "On Fridays, user watches Netflix at 9 PM"
 *   - Context-based: "When coding Python, user often needs docs"
 */

import { getRoutines, recent, recall } from './memory.mjs'

/* ──────────────── Prediction engine ──────────────────────────── */

/**
 * Predict what the user will do next based on:
 *   1. Current time and day
 *   2. Detected routines
 *   3. Recent activity
 *   4. Historical patterns
 */
export function predict({ hour = new Date().getHours(), day = new Date().getDay(), lastAction = null } = {}) {
  const predictions = []
  const isWeekend = day === 0 || day === 6

  // Time-based predictions
  const timePredictions = getTimePredictions(hour, isWeekend)
  predictions.push(...timePredictions)

  // Routine-based predictions
  const routines = getRoutines({ minFrequency: 2 })
  for (const r of routines) {
    if (r.time_hint && matchesTime(r.time_hint, hour)) {
      predictions.push({
        type: 'routine',
        action: r.action ?? r.pattern,
        confidence: Math.min(0.9, r.frequency * 0.1),
        source: 'detected_routine',
      })
    }
  }

  // Sequence-based predictions
  if (lastAction) {
    const seqPredictions = getSequencePredictions(lastAction)
    predictions.push(...seqPredictions)
  }

  return predictions.sort((a, b) => b.confidence - a.confidence).slice(0, 5)
}

function getTimePredictions(hour, isWeekend) {
  const preds = []

  if (hour >= 6 && hour <= 8 && !isWeekend) {
    preds.push({ type: 'time', action: 'Check email and calendar', confidence: 0.7, reason: 'morning routine' })
    preds.push({ type: 'time', action: 'Check traffic to office', confidence: 0.6, reason: 'weekday morning' })
  }
  if (hour >= 8 && hour <= 9 && !isWeekend) {
    preds.push({ type: 'time', action: 'Start coding / work', confidence: 0.7, reason: 'work hours' })
  }
  if (hour >= 12 && hour <= 13) {
    preds.push({ type: 'time', action: 'Lunch break', confidence: 0.6, reason: 'lunch time' })
  }
  if (hour >= 17 && hour <= 18 && !isWeekend) {
    preds.push({ type: 'time', action: 'Check traffic home', confidence: 0.6, reason: 'evening' })
  }
  if (hour >= 19 && hour <= 20) {
    preds.push({ type: 'time', action: 'Watch YouTube / Netflix', confidence: 0.5, reason: 'evening relaxation' })
  }
  if (hour >= 21 && hour <= 23) {
    preds.push({ type: 'time', action: 'Music / social media', confidence: 0.5, reason: 'night' })
  }
  if (isWeekend && hour >= 10 && hour <= 12) {
    preds.push({ type: 'time', action: 'Relaxed browsing / shopping', confidence: 0.5, reason: 'weekend morning' })
  }

  return preds
}

function getSequencePredictions(lastAction) {
  const sequences = {
    'open_chrome': ['Check Gmail', 'Open YouTube', 'Search Google'],
    'open_vscode': ['Check Git status', 'Open terminal', 'Run tests'],
    'open_youtube': ['Search for music', 'Check subscriptions', 'Watch saved videos'],
    'open_spotify': ['Play playlist', 'Search artist', 'Check new releases'],
    'open_terminal': ['Run git commands', 'Check Docker', 'Run scripts'],
    'open_slack': ['Check messages', 'Join standup', 'Reply to mentions'],
    'open_gmail': ['Check inbox', 'Compose email', 'Check calendar'],
    'search_google': ['Click first result', 'Refine search', 'Open in new tab'],
  }

  const predictions = []
  const matches = sequences[lastAction] ?? []
  for (const action of matches) {
    predictions.push({
      type: 'sequence',
      action,
      confidence: 0.5,
      reason: `after ${lastAction}`,
    })
  }
  return predictions
}

function matchesTime(timeHint, hour) {
  const match = String(timeHint).match(/(\d{1,2})\s*(?::|am|pm)/i)
  if (!match) return false
  let h = Number(match[1])
  if (/pm/i.test(timeHint) && h < 12) h += 12
  if (/am/i.test(timeHint) && h === 12) h = 0
  return Math.abs(h - hour) <= 1
}

/* ──────────────── Traffic & weather (offline-friendly) ──────────────────── */

/**
 * Get traffic estimate (offline: based on time patterns).
 */
export function getTrafficEstimate() {
  const hour = new Date().getHours()
  const day = new Date().getDay()
  const isWeekend = day === 0 || day === 6

  if (isWeekend) return { status: 'light', minutes: 20, advice: 'Weekend traffic is light.' }
  if (hour >= 8 && hour <= 10) return { status: 'heavy', minutes: 45, advice: 'Morning rush hour. Leave early or take the toll road.' }
  if (hour >= 17 && hour <= 19) return { status: 'heavy', minutes: 50, advice: 'Evening rush hour. Consider waiting 30 minutes.' }
  if (hour >= 12 && hour <= 14) return { status: 'moderate', minutes: 30, advice: 'Lunch traffic is moderate.' }
  return { status: 'light', minutes: 20, advice: 'Traffic is light right now.' }
}

export default { predict, getTrafficEstimate }