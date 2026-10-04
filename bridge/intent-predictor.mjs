/**
 * JARVIS Intent Predictor — knows what you want BEFORE you say it.
 *
 * Based on:
 *   - Time of day (routines)
 *   - Recent conversation (context)
 *   - Emotional state (mood)
 *   - Historical patterns (learned behavior)
 *   - Current app/screen (environment)
 *   - Day of week (schedule)
 *
 * "You're about to ask me to check the weather. I already did.
 *  28°C, partly cloudy, no rain today."
 */

import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Intent Predictor ──────────────────────────── */

class IntentPredictor {
  constructor() {
    this.history = []          // [{timestamp, intent, context, outcome}]
    this.routines = new Map()  // time → [likely intents]
    this.contextPatterns = []  // [{preceding, following, count}]
    this.predictions = []
    this.maxHistory = 500
  }

  /**
   * Record an interaction for pattern learning.
   */
  record(intent, context = {}) {
    const entry = {
      intent,
      context: {
        hour: new Date().getHours(),
        day: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
        app: context.app || null,
        emotion: context.emotion || null,
        preceding: context.preceding || null,
      },
      timestamp: new Date().toISOString(),
    }
    this.history.push(entry)
    if (this.history.length > this.maxHistory) this.history.shift()

    // Learn time-based patterns
    const timeKey = `${entry.context.day}-${entry.context.hour}`
    const existing = this.routines.get(timeKey) || []
    existing.push(intent)
    if (existing.length > 20) existing.shift()
    this.routines.set(timeKey, existing)

    // Learn sequence patterns
    if (context.preceding) {
      const seqKey = `${context.preceding}→${intent}`
      const seq = this.contextPatterns.find((p) => p.key === seqKey)
      if (seq) {
        seq.count++
      } else {
        this.contextPatterns.push({ key: seqKey, preceding: context.preceding, following: intent, count: 1 })
      }
    }
  }

  /**
   * Predict what the user will want next.
   */
  predict({ currentTime = new Date(), context = {} } = {}) {
    const hour = currentTime.getHours()
    const day = currentTime.toLocaleDateString('en-US', { weekday: 'long' })
    const timeKey = `${day}-${hour}`

    const predictions = []

    // Time-based predictions
    const timeIntents = this.routines.get(timeKey) || []
    if (timeIntents.length > 0) {
      const freq = {}
      timeIntents.forEach((i) => { freq[i] = (freq[i] || 0) + 1 })
      const mostLikely = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]
      if (mostLikely) {
        predictions.push({
          intent: mostLikely[0],
          confidence: Math.min(0.9, mostLikely[1] / timeIntents.length),
          source: 'time_pattern',
          reason: `You usually ask about "${mostLikely[0]}" around ${hour}:00 on ${day}s`,
        })
      }
    }

    // Sequence-based predictions
    if (context.lastIntent) {
      const seqMatches = this.contextPatterns
        .filter((p) => p.preceding === context.lastIntent)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)

      for (const match of seqMatches) {
        predictions.push({
          intent: match.following,
          confidence: Math.min(0.8, match.count / 10),
          source: 'sequence_pattern',
          reason: `After "${context.lastIntent}", you usually ask "${match.following}"`,
        })
      }
    }

    // Emotion-based predictions
    if (context.emotion) {
      const emotionIntents = {
        frustrated: ['help', 'fix', 'debug', 'simplify'],
        tired: ['summarize', 'short_answer', 'do_it_for_me'],
        excited: ['tell_me_more', 'creative', 'explore'],
        urgent: ['quick_answer', 'just_do_it', 'skip_explanation'],
      }
      const likely = emotionIntents[context.emotion] || []
      for (const intent of likely.slice(0, 2)) {
        predictions.push({
          intent,
          confidence: 0.4,
          source: 'emotion_pattern',
          reason: `When you're ${context.emotion}, you usually want "${intent}"`,
        })
      }
    }

    this.predictions = predictions.sort((a, b) => b.confidence - a.confidence)
    return this.predictions
  }

  /**
   * Get predictor stats.
   */
  getStats() {
    return {
      history: this.history.length,
      routines: this.routines.size,
      patterns: this.contextPatterns.length,
      predictions: this.predictions.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const intentPredictor = new IntentPredictor()

export { intentPredictor, IntentPredictor }
export default intentPredictor