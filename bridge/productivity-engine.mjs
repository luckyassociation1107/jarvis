/**
 * JARVIS Productivity Engine — time management, focus sessions, work analytics.
 *
 *   - Pomodoro timer with smart breaks
 *   - Deep focus sessions (blocks notifications)
 *   - Time tracking (what you actually spend time on)
 *   - Work analytics (productive hours, patterns)
 *   - Energy management (work with your energy, not against it)
 *   - Distraction blocking
 *
 * "You're most productive between 9-11 AM. I've blocked notifications.
 *  Your focus session started. 45 minutes of deep work. Go."
 */

import { complete } from './local-llm.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Productivity Engine ──────────────────────────── */

class ProductivityEngine {
  constructor() {
    this.sessions = []           // focus sessions
    this.timeLog = []            // time tracking entries
    this.pomodoros = []          // completed pomodoros
    this.currentSession = null
    this.preferences = {
      pomodoroWork: 25,          // minutes
      pomodoroBreak: 5,
      pomodoroLongBreak: 15,
      pomodorosBeforeLong: 4,
      deepFocusDuration: 90,     // minutes
      targetDailyHours: 8,
    }
  }

  /**
   * Start a focus session.
   */
  startFocusSession(type = 'deep', { task = '', targetMinutes = 90 } = {}) {
    const session = {
      id: `focus-${Date.now()}`,
      type, // pomodoro, deep, sprint, custom
      task,
      targetMinutes,
      startedAt: new Date().toISOString(),
      endedAt: null,
      interruptions: 0,
      productivity: null,
    }
    this.currentSession = session
    this.sessions.push(session)
    eventBus.emit('productivity:focus_start', { session })
    return session
  }

  /**
   * End current focus session.
   */
  endFocusSession({ productivity = null } = {}) {
    if (!this.currentSession) return { ok: false }

    this.currentSession.endedAt = new Date().toISOString()
    this.currentSession.productivity = productivity

    const duration = (new Date(this.currentSession.endedAt) - new Date(this.currentSession.startedAt)) / 60000
    this.currentSession.actualMinutes = Math.round(duration)

    eventBus.emit('productivity:focus_end', { session: this.currentSession })
    const ended = this.currentSession
    this.currentSession = null
    return { ok: true, session: ended }
  }

  /**
   * Start a pomodoro.
   */
  startPomodoro({ task = '' } = {}) {
    return this.startFocusSession('pomodoro', {
      task,
      targetMinutes: this.preferences.pomodoroWork,
    })
  }

  /**
   * Track time for a category.
   */
  trackTime(category, { description = '', minutes = 0 } = {}) {
    const entry = {
      id: `time-${Date.now()}`,
      category,
      description,
      minutes,
      timestamp: new Date().toISOString(),
    }
    this.timeLog.push(entry)
    return entry
  }

  /**
   * Get productivity analytics.
   */
  async getAnalytics({ period = 'week', llm = complete } = {}) {
    const now = new Date()
    const periodMs = period === 'day' ? 86400000 : period === 'week' ? 604800000 : 2592000000

    const recentSessions = this.sessions.filter(
      (s) => now - new Date(s.startedAt).getTime() < periodMs
    )
    const recentTime = this.timeLog.filter(
      (t) => now - new Date(t.timestamp).getTime() < periodMs
    )

    const totalFocusMinutes = recentSessions.reduce((sum, s) => sum + (s.actualMinutes || 0), 0)
    const byCategory = {}
    for (const t of recentTime) {
      byCategory[t.category] = (byCategory[t.category] || 0) + t.minutes
    }

    const response = await llm('reason', [
      { role: 'system', content: `Analyze productivity data and provide insights.

Include:
1. Total productive hours
2. Focus session quality
3. Time distribution by category
4. Peak productivity hours
5. Patterns and trends
6. Improvement suggestions
7. Productivity score (1-100)` },
      { role: 'user', content: `Period: ${period}\nFocus sessions: ${recentSessions.length}\nTotal focus: ${totalFocusMinutes} minutes\nPomodoros: ${this.pomodoros.length}\n\nTime by category:\n${Object.entries(byCategory).map(([cat, min]) => `- ${cat}: ${min} min`).join('\n') || 'No data'}\n\nAnalytics:` },
    ], { maxTokens: 600 })

    return {
      analytics: response,
      stats: {
        sessions: recentSessions.length,
        focusMinutes: totalFocusMinutes,
        pomodoros: this.pomodoros.length,
        categories: byCategory,
      },
    }
  }

  /**
   * Get current status.
   */
  getStatus() {
    return {
      inSession: !!this.currentSession,
      currentSession: this.currentSession
        ? { type: this.currentSession.type, task: this.currentSession.task, elapsed: Math.round((Date.now() - new Date(this.currentSession.startedAt).getTime()) / 60000) }
        : null,
      todaySessions: this.sessions.filter((s) => s.startedAt?.startsWith(new Date().toISOString().split('T')[0])).length,
      totalSessions: this.sessions.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const productivityEngine = new ProductivityEngine()

export { productivityEngine, ProductivityEngine }
export default productivityEngine