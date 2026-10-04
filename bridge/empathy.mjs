/**
 * JARVIS Empathy Engine — not just detecting emotions. FEELING them.
 *
 * This isn't a sentiment analyzer. This is a full emotional intelligence
 * system that:
 *   - Tracks emotional STATE over time (not just one moment)
 *   - Builds emotional MEMORY (how you felt about things before)
 *   - Predicts emotional TRIGGERS (what will upset/please you)
 *   - Adapts communication style based on emotional state
 *   - Provides emotional SUPPORT (not just responses)
 *   - Knows when to be silent vs when to speak
 *
 * "I don't just know you're sad. I know WHY. I know what helps.
 *  And I know when you just need someone to listen."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Emotional state tracking ──────────────────────────── */

class EmotionalState {
  constructor() {
    this.current = { primary: 'neutral', intensity: 0.5, secondary: null }
    this.history = []          // [{timestamp, emotion, intensity, trigger, context}]
    this.patterns = new Map()  // trigger → emotional response pattern
    this.preferences = new Map() // emotion → preferred support style
    this.triggers = new Map()  // known emotional triggers
    this.baseline = { valence: 0.5, arousal: 0.3, dominance: 0.5 } // default state
  }

  /**
   * Record an emotional observation.
   */
  observe(emotion, { intensity = 0.5, trigger = '', context = '', source = 'text' } = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      emotion,
      intensity: Math.max(0, Math.min(1, intensity)),
      trigger,
      context,
      source, // text, voice, behavior, explicit
    }

    this.history.push(entry)
    if (this.history.length > 1000) this.history.shift()

    // Update current state
    this.current = {
      primary: emotion,
      intensity: entry.intensity,
      secondary: this.current.primary !== emotion ? this.current.primary : null,
      timestamp: entry.timestamp,
    }

    // Learn trigger patterns
    if (trigger) {
      const existing = this.triggers.get(trigger) || { responses: [], count: 0 }
      existing.responses.push(emotion)
      existing.count++
      this.triggers.set(trigger, existing)
    }

    return entry
  }

  /**
   * Get emotional trend over time.
   */
  getTrend({ window = 20 } = {}) {
    const recent = this.history.slice(-window)
    if (recent.length === 0) return { trend: 'stable', direction: 'neutral' }

    // Map emotions to valence (positive/negative)
    const valenceMap = {
      happy: 1, excited: 0.8, calm: 0.5, neutral: 0,
      confused: -0.2, tired: -0.3, sad: -0.7, frustrated: -0.8, angry: -1, urgent: -0.5,
    }

    const valences = recent.map((e) => valenceMap[e.emotion] ?? 0)
    const avg = valences.reduce((a, b) => a + b, 0) / valences.length

    // Calculate trend direction
    const firstHalf = valences.slice(0, Math.floor(valences.length / 2))
    const secondHalf = valences.slice(Math.floor(valences.length / 2))
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / (firstHalf.length || 1)
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / (secondHalf.length || 1)
    const delta = secondAvg - firstAvg

    return {
      currentValence: avg.toFixed(2),
      trend: Math.abs(delta) < 0.1 ? 'stable' : delta > 0 ? 'improving' : 'declining',
      direction: avg > 0.2 ? 'positive' : avg < -0.2 ? 'negative' : 'neutral',
      volatility: this._calculateVolatility(valences),
      dominantEmotion: this._getMode(recent.map((e) => e.emotion)),
    }
  }

  _calculateVolatility(values) {
    if (values.length < 2) return 0
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
    return Math.sqrt(variance).toFixed(2)
  }

  _getMode(arr) {
    const freq = {}
    arr.forEach((v) => { freq[v] = (freq[v] || 0) + 1 })
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral'
  }

  /**
   * Predict emotional response to a proposed action.
   */
  predictResponse(action) {
    // Check known triggers
    for (const [trigger, data] of this.triggers) {
      if (action.toLowerCase().includes(trigger.toLowerCase())) {
        const mostLikely = this._getMode(data.responses)
        return {
          likely_emotion: mostLikely,
          confidence: Math.min(0.9, data.count / 10),
          recommendation: mostLikely === 'frustrated' || mostLikely === 'angry'
            ? 'Consider a different approach'
            : 'This should be well-received',
        }
      }
    }

    return { likely_emotion: 'neutral', confidence: 0.3, recommendation: 'No strong prediction' }
  }
}

/* ──────────────── Emotional response generation ──────────────────────────── */

/**
 * Generate an emotionally appropriate response.
 */
export async function empatheticResponse(userMessage, emotionalState, { 
  relationship = 'assistant',
  llm = complete,
} = {}) {
  const trend = emotionalState.getTrend()
  const current = emotionalState.current

  const response = await llm('chat', [
    { role: 'system', content: `You are an emotionally intelligent companion.

Current emotional state of the person you're talking to:
- Primary emotion: ${current.primary} (intensity: ${current.intensity})
- Trend: ${trend.trend} (${trend.direction})
- Volatility: ${trend.volatility}
- Recent dominant: ${trend.dominantEmotion}

Your relationship: ${relationship}

RESPONSE GUIDELINES:
- If they're sad/low: Be gentle. Validate feelings. Don't try to "fix" immediately.
- If they're frustrated: Acknowledge the frustration. Be calm. Offer solutions, don't lecture.
- If they're excited: Match their energy! Celebrate with them.
- If they're tired: Be concise. Don't overwhelm. Offer to help with the load.
- If they're confused: Be patient. Break things down. Use examples.
- If they're urgent: Be fast. No fluff. Direct answers.
- If volatility is HIGH: Be stable and consistent. They need an anchor.
- If trend is declining: Gently check in. Show you notice.

NEVER:
- Dismiss emotions ("it's not that bad")
- Be overly cheerful when they're down
- Give long responses when they're tired
- Be vague when they're urgent` },
    { role: 'user', content: userMessage },
  ], { maxTokens: 500 })

  return response
}

/* ──────────────── Emotional memory ──────────────────────────── */

/**
 * Remember emotional associations with topics/people/events.
 */
export function buildEmotionalMemory(emotionalState, { topN = 20 } = {}) {
  const associations = new Map()

  for (const entry of emotionalState.history) {
    if (!entry.trigger) continue

    const key = entry.trigger.toLowerCase()
    const existing = associations.get(key) || { emotions: [], count: 0 }
    existing.emotions.push(entry.emotion)
    existing.count++
    associations.set(key, existing)
  }

  // Convert to sorted list
  const sorted = Array.from(associations.entries())
    .map(([trigger, data]) => ({
      trigger,
      dominantEmotion: emotionalState._getMode(data.emotions),
      frequency: data.count,
      emotionalProfile: data.emotions,
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, topN)

  return sorted
}

/* ──────────────── Support strategies ──────────────────────────── */

/**
 * Suggest the best support strategy for current emotional state.
 */
export async function suggestSupport(emotionalState, { llm = complete } = {}) {
  const trend = emotionalState.getTrend()
  const current = emotionalState.current
  const memory = buildEmotionalMemory(emotionalState, { topN: 5 })

  const response = await llm('reason', [
    { role: 'system', content: `Suggest the best support strategy for someone in this emotional state.

Consider:
- Their current emotion and intensity
- Their emotional trend (improving/declining/stable)
- Their volatility (how much their mood swings)
- Past emotional patterns and what helped before

Respond in JSON:
{
  "strategy": "name of strategy",
  "approach": "detailed description of how to support",
  "tone": "gentle|energetic|calm|direct|warm",
  "actions": ["specific action 1", "specific action 2"],
  "avoid": ["thing to NOT do"],
  "check_in_later": "when to check back",
  "reasoning": "why this strategy fits"
}` },
    { role: 'user', content: `Current: ${current.primary} (${current.intensity})\nTrend: ${trend.trend} (${trend.direction})\nVolatility: ${trend.volatility}\nPast patterns: ${JSON.stringify(memory.slice(0, 3))}\n\nBest support strategy:` },
  ], { maxTokens: 500 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, strategy: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

export { EmotionalState }
export default { EmotionalState, empatheticResponse, buildEmotionalMemory, suggestSupport }