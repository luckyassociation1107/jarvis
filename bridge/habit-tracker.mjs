/**
 * JARVIS Habit Tracker — builds habits with streaks, analytics, and accountability.
 *
 *   - Track daily habits
 *   - Streak counting (current, longest)
 *   - Habit analytics (completion rate, patterns)
 *   - Smart reminders
 *   - Accountability partner (JARVIS nags you)
 *   - Habit stacking suggestions
 *
 * "You've meditated 12 days in a row. Your longest streak is 18.
 *  You usually skip on weekends. I'll remind you Saturday morning.
 *  Your exercise habit needs work — try habit stacking with your morning coffee."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Habit Tracker ──────────────────────────── */

class HabitTracker {
  constructor() {
    this.habits = new Map()       // habitName → {goal, streak, log}
  }

  /**
   * Create a new habit to track.
   */
  createHabit(name, { goal = 'daily', description = '', reminderTime = null } = {}) {
    const habit = {
      name,
      goal, // daily, weekdays, weekly, custom
      description,
      reminderTime,
      createdAt: new Date().toISOString(),
      log: [],                    // [{date, completed, notes}]
      streak: 0,
      longestStreak: 0,
      totalCompletions: 0,
    }
    this.habits.set(name, habit)
    return habit
  }

  /**
   * Mark a habit as completed.
   */
  complete(name, { date = new Date().toISOString().split('T')[0], notes = '' } = {}) {
    const habit = this.habits.get(name)
    if (!habit) return { ok: false, error: 'Habit not found' }

    // Check if already logged today
    const existing = habit.log.find((l) => l.date === date)
    if (existing) {
      existing.completed = true
      existing.notes = notes
    } else {
      habit.log.push({ date, completed: true, notes })
    }

    habit.totalCompletions++
    this._updateStreak(habit)
    return { ok: true, streak: habit.streak, longestStreak: habit.longestStreak }
  }

  /**
   * Mark a habit as missed.
   */
  miss(name, { date = new Date().toISOString().split('T')[0], reason = '' } = {}) {
    const habit = this.habits.get(name)
    if (!habit) return { ok: false }

    habit.log.push({ date, completed: false, reason })
    this._updateStreak(habit)
    return { ok: true, streak: habit.streak }
  }

  /**
   * Get habit analytics.
   */
  async getAnalytics(name, { llm = complete } = {}) {
    const habit = this.habits.get(name)
    if (!habit) return null

    const last30 = habit.log.slice(-30)
    const completed = last30.filter((l) => l.completed).length
    const rate = last30.length > 0 ? ((completed / last30.length) * 100).toFixed(0) : 0

    // Find patterns
    const byDay = {}
    for (const l of last30) {
      const day = new Date(l.date).toLocaleDateString('en-US', { weekday: 'long' })
      byDay[day] = byDay[day] || { total: 0, completed: 0 }
      byDay[day].total++
      if (l.completed) byDay[day].completed++
    }

    const weakDays = Object.entries(byDay)
      .filter(([, d]) => d.completed / d.total < 0.5)
      .map(([day]) => day)

    const response = await llm('reason', [
      { role: 'system', content: `Analyze this habit and provide insights.

Include:
1. Current streak and trend
2. Completion rate and what it means
3. Patterns (which days are weak, which are strong)
4. Suggestions for improvement
5. Motivation (personalized, not generic)` },
      { role: 'user', content: `Habit: ${name}\nGoal: ${habit.goal}\nCurrent streak: ${habit.streak}\nLongest streak: ${habit.longestStreak}\nCompletion rate: ${rate}%\nWeak days: ${weakDays.join(', ') || 'none'}\nTotal completions: ${habit.totalCompletions}\n\nAnalytics:` },
    ], { maxTokens: 400 })

    return {
      analytics: response,
      stats: {
        streak: habit.streak,
        longestStreak: habit.longestStreak,
        rate: rate + '%',
        totalCompletions: habit.totalCompletions,
        weakDays,
      },
    }
  }

  _updateStreak(habit) {
    const sorted = habit.log
      .filter((l) => l.completed)
      .map((l) => l.date)
      .sort()
      .reverse()

    if (sorted.length === 0) {
      habit.streak = 0
      return
    }

    let streak = 1
    const today = new Date().toISOString().split('T')[0]
    if (sorted[0] !== today) {
      // Check if yesterday was completed
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
      if (sorted[0] !== yesterday) {
        habit.streak = 0
        return
      }
    }

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1])
      const curr = new Date(sorted[i])
      const diff = (prev - curr) / 86400000
      if (diff === 1) {
        streak++
      } else {
        break
      }
    }

    habit.streak = streak
    habit.longestStreak = Math.max(habit.longestStreak, streak)
  }

  /**
   * Get all habits summary.
   */
  getSummary() {
    return Array.from(this.habits.values()).map((h) => ({
      name: h.name,
      goal: h.goal,
      streak: h.streak,
      longestStreak: h.longestStreak,
      totalCompletions: h.totalCompletions,
      lastCompleted: h.log.filter((l) => l.completed).slice(-1)[0]?.date || 'never',
    }))
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const habitTracker = new HabitTracker()

export { habitTracker, HabitTracker }
export default habitTracker