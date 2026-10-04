/**
 * JARVIS Daily Intelligence — your morning briefing, all day awareness.
 *
 * Every morning:
 *   - Weather for your city
 *   - Today's schedule and tasks
 *   - News relevant to your interests
 *   - Reminders and deadlines
 *   - Mood check-in
 *   - Productivity suggestions
 *
 * Throughout the day:
 *   - Tracks your energy levels
 *   - Suggests breaks when needed
 *   - Reminds of upcoming events
 *   - Filters notifications intelligently
 *
 * "Good morning. It's 28°C outside, no rain. You have 3 meetings today.
 *  Your first one is at 10 AM. I've organized your tasks by priority.
 *  You slept 7 hours — that's better than your average."
 */

import { complete } from './local-llm.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Daily Intelligence ──────────────────────────── */

class DailyIntelligence {
  constructor() {
    this.schedule = []           // today's events
    this.tasks = []              // pending tasks
    this.reminders = []          // active reminders
    this.energyLog = []          // energy levels throughout day
    this.briefings = []          // past briefings
    this.preferences = {
      wakeTime: '8:00',
      sleepTime: '23:00',
      briefingTime: '8:00',
      breakInterval: 90,         // minutes
      focusHours: [9, 10, 11, 14, 15, 16],
    }
  }

  /**
   * Generate morning briefing.
   */
  async morningBriefing({ date = new Date(), llm = complete } = {}) {
    const hour = date.getHours()
    const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    const todayEvents = this.schedule.filter((e) => e.date === date.toISOString().split('T')[0])
    const pendingTasks = this.tasks.filter((t) => t.status !== 'completed')
    const upcomingReminders = this.reminders.filter((r) => !r.dismissed)

    const response = await llm('chat', [
      { role: 'system', content: `Generate a warm, helpful morning briefing. Be concise but complete.

Include:
1. Greeting (personalized, not robotic)
2. Weather summary (if available)
3. Today's schedule (events with times)
4. Priority tasks (top 3)
5. Reminders
6. Motivational note (brief, genuine)
7. One proactive suggestion

Tone: Like a smart personal assistant, not a robot.
Language: Match the user's language (Telugu/English mix is fine).` },
      { role: 'user', content: `Date: ${day}\nWake time: ${this.preferences.wakeTime}\n\nSchedule:\n${todayEvents.map((e) => `- ${e.time}: ${e.title}`).join('\n') || 'No events today'}\n\nTasks:\n${pendingTasks.slice(0, 5).map((t) => `- ${t.description}`).join('\n') || 'No pending tasks'}\n\nReminders:\n${upcomingReminders.slice(0, 3).map((r) => `- ${r.message}`).join('\n') || 'No reminders'}\n\nMorning briefing:` },
    ], { maxTokens: 500 })

    this.briefings.push({
      date: date.toISOString(),
      content: response,
    })

    return response
  }

  /**
   * Add a task.
   */
  addTask(description, { priority = 'medium', dueDate = null, category = 'general' } = {}) {
    const task = {
      id: `task-${Date.now()}`,
      description,
      priority,
      dueDate,
      category,
      status: 'pending',
      createdAt: new Date().toISOString(),
      completedAt: null,
    }
    this.tasks.push(task)
    return task
  }

  /**
   * Complete a task.
   */
  completeTask(taskId) {
    const task = this.tasks.find((t) => t.id === taskId)
    if (task) {
      task.status = 'completed'
      task.completedAt = new Date().toISOString()
    }
    return task
  }

  /**
   * Add a reminder.
   */
  addReminder(message, { time = null, recurring = false } = {}) {
    const reminder = {
      id: `rem-${Date.now()}`,
      message,
      time,
      recurring,
      dismissed: false,
      createdAt: new Date().toISOString(),
    }
    this.reminders.push(reminder)
    return reminder
  }

  /**
   * Add a schedule event.
   */
  addEvent(title, date, time, { duration = '1h', description = '' } = {}) {
    const event = {
      id: `evt-${Date.now()}`,
      title,
      date,
      time,
      duration,
      description,
      createdAt: new Date().toISOString(),
    }
    this.schedule.push(event)
    return event
  }

  /**
   * Log energy level.
   */
  logEnergy(level, { activity = '' } = {}) {
    this.energyLog.push({
      level, // 1-10
      activity,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Check if it's time for a break.
   */
  shouldTakeBreak() {
    if (this.energyLog.length === 0) return { needed: false }
    const recent = this.energyLog.slice(-3)
    const avgEnergy = recent.reduce((sum, e) => sum + e.level, 0) / recent.length
    const lastBreak = this.energyLog.findLast((e) => e.activity === 'break')
    const minutesSinceBreak = lastBreak
      ? (Date.now() - new Date(lastBreak.timestamp).getTime()) / 60000
      : 999

    return {
      needed: avgEnergy < 5 || minutesSinceBreak > this.preferences.breakInterval,
      avgEnergy: avgEnergy.toFixed(1),
      minutesSinceBreak: Math.round(minutesSinceBreak),
      suggestion: avgEnergy < 5
        ? 'Your energy is low. Take a 10-minute break.'
        : minutesSinceBreak > this.preferences.breakInterval
          ? `It's been ${Math.round(minutesSinceBreak)} minutes. Time for a break.`
          : 'You\'re doing great. Keep going.',
    }
  }

  /**
   * Get today's summary.
   */
  getTodaySummary() {
    const today = new Date().toISOString().split('T')[0]
    return {
      date: today,
      events: this.schedule.filter((e) => e.date === today).length,
      tasks: {
        total: this.tasks.length,
        pending: this.tasks.filter((t) => t.status === 'pending').length,
        completed: this.tasks.filter((t) => t.status === 'completed').length,
      },
      reminders: this.reminders.filter((r) => !r.dismissed).length,
      energy: this.energyLog.length > 0
        ? this.energyLog[this.energyLog.length - 1].level
        : null,
      briefings: this.briefings.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const dailyIntelligence = new DailyIntelligence()

export { dailyIntelligence, DailyIntelligence }
export default dailyIntelligence