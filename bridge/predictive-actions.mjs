/**
 * JARVIS Predictive Actions — acts BEFORE you ask.
 *
 * Learns your patterns and anticipates your needs:
 *   - Morning: weather, tasks, news — ready before you ask
 *   - Commute: traffic, route — checked automatically
 *   - Work: emails prioritized, meetings prepped
 *   - Evening: tomorrow's schedule, reminders
 *   - Patterns: "Every Monday you ask about X" → ready it
 *
 * "You didn't ask for the weather. I already checked.
 *  28°C, no rain. You have 3 meetings today.
 *  Your first email is from your boss — marked urgent."
 */

import { complete } from './local-llm.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Predictive Actions ──────────────────────────── */

class PredictiveActions {
  constructor() {
    // Pattern storage
    this.patterns = new Map()      // patternId → {trigger, action, count, lastRun}
    this.routines = new Map()      // time → [actions]
    this.predictions = []          // current predictions
    this.executedActions = []      // what was executed

    // User behavior tracking
    this.behaviorLog = []          // [{action, context, timestamp}]
    this.maxLog = 500

    // Pre-computed predictions for common times
    this.timeSlots = {
      morning:   { start: 6, end: 10, predictions: [] },
      midday:    { start: 11, end: 14, predictions: [] },
      afternoon: { start: 14, end: 18, predictions: [] },
      evening:   { start: 18, end: 22, predictions: [] },
      night:     { start: 22, end: 6, predictions: [] },
    }
  }

  /**
   * Learn from user behavior.
   */
  learn(action, context = {}) {
    const entry = {
      action,
      context: {
        hour: new Date().getHours(),
        day: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
        ...context,
      },
      timestamp: new Date().toISOString(),
    }

    this.behaviorLog.push(entry)
    if (this.behaviorLog.length > this.maxLog) this.behaviorLog.shift()

    // Detect patterns
    this._detectPatterns()
  }

  /**
   * Detect patterns from behavior log.
   */
  _detectPatterns() {
    const now = new Date()
    const hour = now.getHours()
    const day = now.toLocaleDateString('en-US', { weekday: 'long' })

    // Find actions that happen at this time
    const timeMatches = this.behaviorLog.filter((e) =>
      Math.abs(e.context.hour - hour) <= 1
    )

    // Count action frequencies
    const freq = {}
    for (const match of timeMatches) {
      freq[match.action] = (freq[match.action] || 0) + 1
    }

    // Update predictions
    this.predictions = Object.entries(freq)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([action, count]) => ({
        action,
        confidence: Math.min(0.9, count / 10),
        source: 'time_pattern',
        reason: `You usually do "${action}" around ${hour}:00`,
      }))
  }

  /**
   * Get predictions for current time.
   */
  getPredictions() {
    const hour = new Date().getHours()
    let slot = 'morning'
    if (hour >= 11 && hour < 14) slot = 'midday'
    else if (hour >= 14 && hour < 18) slot = 'afternoon'
    else if (hour >= 18 && hour < 22) slot = 'evening'
    else if (hour >= 22 || hour < 6) slot = 'night'

    return {
      slot,
      time: new Date().toISOString(),
      predictions: this.predictions,
      autoActions: this._getAutoActions(slot),
    }
  }

  /**
   * Get automatic actions for a time slot.
   */
  _getAutoActions(slot) {
    const autoActions = {
      morning: [
        { action: 'morning_briefing', description: 'Weather, tasks, news summary' },
        { action: 'email_check', description: 'Priority emails from overnight' },
        { action: 'calendar_review', description: 'Today\'s schedule and meetings' },
      ],
      midday: [
        { action: 'lunch_reminder', description: 'Take a break, eat something' },
        { action: 'task_progress', description: 'Check morning task progress' },
      ],
      afternoon: [
        { action: 'energy_check', description: 'How are you feeling?' },
        { action: 'meeting_prep', description: 'Prepare for upcoming meetings' },
      ],
      evening: [
        { action: 'day_review', description: 'What was accomplished today' },
        { action: 'tomorrow_prep', description: 'Tomorrow\'s schedule and tasks' },
      ],
      night: [
        { action: 'wind_down', description: 'Relax, no more work' },
        { action: 'reminder_set', description: 'Set reminders for tomorrow' },
      ],
    }

    return autoActions[slot] || []
  }

  /**
   * Execute a predicted action.
   */
  async executeAction(action, { llm = complete } = {}) {
    const startTime = Date.now()

    const result = await llm('reason', [
      { role: 'system', content: `Execute this predictive action. Provide the information or perform the task.

Be proactive — don't wait to be asked more.
Provide complete, useful information immediately.
Be brief but thorough.` },
      { role: 'user', content: `Action: ${action.action}\nDescription: ${action.description}\n\nExecute:` },
    ], { maxTokens: 400 })

    const executed = {
      action: action.action,
      result,
      executedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
    }

    this.executedActions.push(executed)
    return executed
  }

  /**
   * Set a routine — things that happen automatically.
   */
  setRoutine(time, actions) {
    this.routines.set(time, actions)
  }

  /**
   * Get routine for current time.
   */
  getCurrentRoutine() {
    const hour = new Date().getHours()
    const timeStr = `${String(hour).padStart(2, '0')}:00`
    return this.routines.get(timeStr) || null
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      patterns: this.patterns.size,
      routines: this.routines.size,
      predictions: this.predictions.length,
      executedActions: this.executedActions.length,
      behaviorLog: this.behaviorLog.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const predictiveActions = new PredictiveActions()

export { predictiveActions, PredictiveActions }
export default predictiveActions