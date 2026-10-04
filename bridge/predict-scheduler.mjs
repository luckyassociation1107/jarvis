/**
 * JARVIS Predictive Scheduler — knows what you need BEFORE you do.
 *
 * Not scheduling. PRE-SCHEDULING.
 *
 * Learns your patterns:
 *   - 9 AM: coffee, check email, standup meeting
 *   - 12 PM: lunch, walk
 *   - 3 PM: energy dip, need a break
 *   - 6 PM: wrap up, commute
 *   - 10 PM: wind down
 *
 * Then PREPARES things before you ask:
 *   - Opens email at 8:55
 *   - Suggests lunch places at 11:45
 *   - Dims lights at 9:30 PM
 *   - Pre-loads your evening playlist
 *
 * "You're about to start your day. I've already organized your tasks
 *  by priority, checked traffic, and your coffee is ordered."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Pattern learning ──────────────────────────── */

class PredictiveScheduler {
  constructor() {
    this.routines = new Map()     // routineName → {time, actions, frequency}
    this.patterns = []            // learned behavior patterns
    this.predictions = []         // upcoming predictions
    this.habits = new Map()       // action → {count, times[], contexts[]}
    this.calendar = []            // scheduled events
  }

  /**
   * Record a habitual action.
   */
  recordAction(action, { time = new Date(), context = '' } = {}) {
    const hour = time.getHours()
    const day = time.toLocaleDateString('en-US', { weekday: 'long' })

    const existing = this.habits.get(action) || { count: 0, times: [], days: [], contexts: [] }
    existing.count++
    existing.times.push(hour)
    existing.days.push(day)
    if (context) existing.contexts.push(context)
    this.habits.set(action, existing)

    // Detect routine if repeated enough
    if (existing.count >= 3) {
      this._detectRoutine(action, existing)
    }
  }

  /**
   * Detect a routine from repeated actions.
   */
  _detectRoutine(action, data) {
    // Find most common hour
    const hourFreq = {}
    data.times.forEach((h) => { hourFreq[h] = (hourFreq[h] || 0) + 1 })
    const commonHour = Object.entries(hourFreq).sort((a, b) => b[1] - a[1])[0]

    if (commonHour && commonHour[1] >= 3) {
      this.routines.set(action, {
        action,
        typicalTime: `${commonHour[0]}:00`,
        confidence: Math.min(0.95, commonHour[1] / data.count),
        frequency: data.count,
        mostCommonDay: this._getMode(data.days),
      })
    }
  }

  _getMode(arr) {
    const freq = {}
    arr.forEach((v) => { freq[v] = (freq[v] || 0) + 1 })
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0]
  }

  /**
   * Generate predictions for the current time.
   */
  predict({ currentTime = new Date() } = {}) {
    const hour = currentTime.getHours()
    const day = currentTime.toLocaleDateString('en-US', { weekday: 'long' })
    const predictions = []

    // Check routines
    for (const [action, routine] of this.routines) {
      const routineHour = parseInt(routine.typicalTime)
      const hoursUntil = routineHour - hour

      if (hoursUntil >= 0 && hoursUntil <= 2) {
        predictions.push({
          action,
          time: routine.typicalTime,
          hoursUntil,
          confidence: routine.confidence,
          type: 'routine',
          suggestion: hoursUntil === 0 ? `Time for: ${action}` : `Coming up in ${hoursUntil}h: ${action}`,
        })
      }
    }

    // Check calendar
    const today = currentTime.toISOString().split('T')[0]
    const upcomingEvents = this.calendar.filter((e) => e.date === today && parseInt(e.time) >= hour)
    for (const event of upcomingEvents.slice(0, 3)) {
      predictions.push({
        action: event.title,
        time: event.time,
        hoursUntil: parseInt(event.time) - hour,
        confidence: 1.0,
        type: 'calendar',
        suggestion: `Scheduled: ${event.title} at ${event.time}`,
      })
    }

    this.predictions = predictions.sort((a, b) => a.hoursUntil - b.hoursUntil)
    return predictions
  }

  /**
   * Prepare for an upcoming event.
   */
  async prepareFor(event, { llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `The user has an upcoming event. Prepare everything they might need.

Consider:
- What information they'll need
- What documents/files to prepare
- What reminders to set
- What to pre-load or warm up
- Common things people forget

Respond in JSON:
{
  "preparations": [
    { "action": "...", "priority": "high|medium|low", "automated": true }
  ],
  "reminder": "what to remind them",
  "tips": ["tip 1", "tip 2"],
  "estimated_prep_time": "X minutes"
}` },
      { role: 'user', content: `Upcoming event: ${event}\n\nWhat should I prepare?` },
    ], { maxTokens: 500 })

    try {
      const start = response.indexOf('{')
      const end = response.lastIndexOf('}')
      return { ok: true, preparation: JSON.parse(response.slice(start, end + 1)) }
    } catch {
      return { ok: false, raw: response }
    }
  }

  /**
   * Add to calendar.
   */
  addEvent(title, date, time, { duration = '1h', description = '' } = {}) {
    this.calendar.push({ title, date, time, duration, description, added: new Date().toISOString() })
    return { ok: true, event: { title, date, time } }
  }

  /**
   * Get a daily briefing.
   */
  async getDailyBriefing({ currentTime = new Date(), llm = complete } = {}) {
    const predictions = this.predict({ currentTime })
    const today = currentTime.toISOString().split('T')[0]
    const todaysEvents = this.calendar.filter((e) => e.date === today)

    const response = await llm('chat', [
      { role: 'system', content: `Generate a concise daily briefing. Be helpful, not verbose. Like a smart personal assistant.` },
      { role: 'user', content: `Today: ${currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\nPredicted routines: ${predictions.map((p) => p.suggestion).join(', ')}\nCalendar: ${todaysEvents.map((e) => `${e.time} ${e.title}`).join(', ') || 'clear'}\n\nDaily briefing:` },
    ], { maxTokens: 300 })

    return response
  }

  /**
   * Get scheduler stats.
   */
  getStats() {
    return {
      routines: this.routines.size,
      habits: this.habits.size,
      predictions: this.predictions.length,
      calendar: this.calendar.length,
    }
  }
}

export { PredictiveScheduler }
export default { PredictiveScheduler }