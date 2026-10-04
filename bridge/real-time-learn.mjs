/**
 * JARVIS Real-Time Learning — learns DURING conversation, not after.
 *
 * Every sentence the user says is a learning opportunity:
 *   - New facts about the user
 *   - Preferences and patterns
 *   - Vocabulary and slang
 *   - Corrections to previous understanding
 *   - Emotional patterns
 *   - Communication style
 *
 * This isn't memory storage. This is ACTIVE LEARNING —
 * extracting knowledge from every interaction in real-time.
 *
 * "Every word you say teaches me something. I never stop learning."
 */

import { complete } from './local-llm.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Real-time learner ──────────────────────────── */

class RealTimeLearner {
  constructor() {
    this.learnings = []
    this.patterns = new Map()    // pattern → {count, examples, confidence}
    this.corrections = []        // things user corrected
    this.vocabulary = new Map()  // word → meaning/context
    this.preferences = new Map() // category → preference
    this.maxLearnings = 1000
  }

  /**
   * Learn from a single message in real-time.
   */
  async learn(message, { role = 'user', context = '', llm = complete } = {}) {
    if (role !== 'user') return null

    const response = await llm('reason', [
      { role: 'system', content: `Extract ALL learnable knowledge from this message. Be aggressive — every detail matters.

Extract:
1. FACTS — things stated as fact (names, dates, preferences, relationships)
2. PREFERENCES — things they like/dislike/want
3. CORRECTIONS — did they correct something I said?
4. VOCABULARY — new words, slang, abbreviations they use
5. PATTERNS — recurring themes or behaviors
6. EMOTION — current emotional state
7. INTENT — what they're trying to achieve
8. CONTEXT — what this tells us about their situation

Respond in JSON:
{
  "facts": ["fact 1", "fact 2"],
  "preferences": { "likes": [], "dislikes": [], "wants": [] },
  "corrections": ["correction 1"],
  "vocabulary": { "word": "meaning" },
  "patterns": ["pattern 1"],
  "emotion": "neutral|happy|sad|frustrated|excited|tired|urgent",
  "intent": "what they want",
  "context": "what this tells us"
}` },
      { role: 'user', content: `Message: "${message}"\n${context ? `Context: ${context}` : ''}\n\nExtract all learnable knowledge:` },
    ], { maxTokens: 500 })

    try {
      const start = response.indexOf('{')
      const end = response.lastIndexOf('}')
      const extracted = JSON.parse(response.slice(start, end + 1))

      // Store learnings
      const learning = {
        message: message.slice(0, 200),
        extracted,
        timestamp: new Date().toISOString(),
      }
      this.learnings.push(learning)
      if (this.learnings.length > this.maxLearnings) this.learnings.shift()

      // Update patterns
      for (const pattern of extracted.patterns || []) {
        const existing = this.patterns.get(pattern) || { count: 0, examples: [] }
        existing.count++
        existing.examples.push(message.slice(0, 100))
        if (existing.examples.length > 5) existing.examples.shift()
        this.patterns.set(pattern, existing)
      }

      // Update vocabulary
      for (const [word, meaning] of Object.entries(extracted.vocabulary || {})) {
        this.vocabulary.set(word.toLowerCase(), { meaning, learnedAt: new Date().toISOString() })
      }

      // Update preferences
      for (const like of extracted.preferences?.likes || []) {
        this.preferences.set(`like:${like}`, { value: like, type: 'like', timestamp: new Date().toISOString() })
      }
      for (const dislike of extracted.preferences?.dislikes || []) {
        this.preferences.set(`dislike:${dislike}`, { value: dislike, type: 'dislike', timestamp: new Date().toISOString() })
      }

      // Store corrections
      for (const correction of extracted.corrections || []) {
        this.corrections.push({ correction, timestamp: new Date().toISOString() })
      }

      // Emit learning event
      await eventBus.emit('learning:new', { learning: extracted })

      return extracted
    } catch {
      return null
    }
  }

  /**
   * Get what we've learned about the user.
   */
  getProfile() {
    const facts = this.learnings
      .flatMap((l) => l.extracted?.facts || [])
      .filter((f, i, arr) => arr.indexOf(f) === i)
      .slice(-20)

    const topPatterns = [...this.patterns.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([pattern, data]) => ({ pattern, count: data.count }))

    const recentEmotions = this.learnings
      .filter((l) => l.extracted?.emotion)
      .slice(-10)
      .map((l) => l.extracted.emotion)

    return {
      facts,
      topPatterns,
      recentEmotions,
      vocabularySize: this.vocabulary.size,
      preferencesSize: this.preferences.size,
      correctionsCount: this.corrections.length,
      totalLearnings: this.learnings.length,
    }
  }

  /**
   * Get context for the current conversation.
   */
  getContext() {
    const recent = this.learnings.slice(-5)
    const recentFacts = recent.flatMap((l) => l.extracted?.facts || []).slice(0, 5)
    const recentPrefs = [...this.preferences.values()].slice(-5)
    const currentEmotion = this.learnings[this.learnings.length - 1]?.extracted?.emotion || 'neutral'

    return {
      recentFacts,
      recentPreferences: recentPrefs,
      currentEmotion,
      knownVocabulary: [...this.vocabulary.keys()].slice(-10),
    }
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      learnings: this.learnings.length,
      patterns: this.patterns.size,
      vocabulary: this.vocabulary.size,
      preferences: this.preferences.size,
      corrections: this.corrections.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const realTimeLearner = new RealTimeLearner()

export { realTimeLearner, RealTimeLearner }
export default realTimeLearner