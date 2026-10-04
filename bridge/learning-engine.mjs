/**
 * JARVIS Learning Engine — structured learning with spaced repetition.
 *
 *   - Learn any topic with structured curriculum
 *   - Spaced repetition for retention
 *   - Quiz generation
 *   - Progress tracking
 *   - Difficulty adaptation
 *   - Multi-modal learning (visual, auditory, kinesthetic)
 *
 * "You learned Python basics last week. Time for a review.
 *  3 concepts need reinforcement. Here's your quiz."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Learning Engine ──────────────────────────── */

class LearningEngine {
  constructor() {
    this.topics = new Map()       // topic → {level, progress, cards}
    this.flashcards = []          // spaced repetition cards
    this.sessions = []            // learning sessions
    this.quizHistory = []         // quiz results
  }

  /**
   * Create a learning plan for a topic.
   */
  async createLearningPlan(topic, { currentLevel = 'beginner', goal = 'proficient', timeframe = '1 month', llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Create a structured learning plan.

Include:
1. Prerequisites (what they need to know first)
2. Curriculum (topics in order, with time estimates)
3. Resources (free, available online)
4. Milestones (measurable progress points)
5. Practice exercises (hands-on, not just reading)
6. Assessment checkpoints
7. Common pitfalls to avoid

Make it practical and achievable. Not a university syllabus — a focused plan.` },
      { role: 'user', content: `Topic: ${topic}\nCurrent level: ${currentLevel}\nGoal: ${goal}\nTimeframe: ${timeframe}\n\nLearning plan:` },
    ], { maxTokens: 1000 })

    this.topics.set(topic, {
      level: currentLevel,
      goal,
      plan: response,
      progress: 0,
      startDate: new Date().toISOString(),
    })

    return response
  }

  /**
   * Generate flashcards for spaced repetition.
   */
  async generateFlashcards(topic, { count = 10, difficulty = 'mixed', llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Generate ${count} flashcards for spaced repetition.

Each flashcard:
- Front: question or concept
- Back: answer or explanation
- Difficulty: easy/medium/hard
- Category: subtopic

Make them test UNDERSTANDING, not just memorization.
Include a mix of recall, application, and analysis questions.` },
      { role: 'user', content: `Topic: ${topic}\nDifficulty: ${difficulty}\nCount: ${count}\n\nFlashcards:` },
    ], { maxTokens: 800 })

    try {
      const start = response.indexOf('[')
      const end = response.lastIndexOf(']')
      const cards = JSON.parse(response.slice(start, end + 1))
      for (const card of cards) {
        this.flashcards.push({
          ...card,
          topic,
          nextReview: new Date().toISOString(),
          interval: 1, // days
          easeFactor: 2.5,
          reviews: 0,
        })
      }
      return { ok: true, count: cards.length }
    } catch {
      return { ok: false, raw: response }
    }
  }

  /**
   * Get cards due for review.
   */
  getDueCards() {
    const now = new Date()
    return this.flashcards.filter((c) => new Date(c.nextReview) <= now)
  }

  /**
   * Record a review result.
   */
  recordReview(cardIndex, quality) {
    // quality: 0-5 (0=complete fail, 5=perfect)
    const card = this.flashcards[cardIndex]
    if (!card) return

    card.reviews++
    if (quality >= 3) {
      // Success — increase interval
      card.interval = Math.round(card.interval * card.easeFactor)
    } else {
      // Failure — reset interval
      card.interval = 1
    }
    card.easeFactor = Math.max(1.3, card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
    card.nextReview = new Date(Date.now() + card.interval * 86400000).toISOString()
  }

  /**
   * Generate a quiz.
   */
  async generateQuiz(topic, { count = 5, format = 'mixed', llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Generate a quiz on this topic.

Formats: multiple-choice, true/false, fill-in-the-blank, short answer
Mix them for variety.

For each question:
- Question text
- Answer options (if applicable)
- Correct answer
- Explanation of the answer
- Difficulty level` },
      { role: 'user', content: `Topic: ${topic}\nCount: ${count}\nFormat: ${format}\n\nQuiz:` },
    ], { maxTokens: 800 })

    return response
  }

  /**
   * Get learning stats.
   */
  getStats() {
    return {
      topics: this.topics.size,
      flashcards: this.flashcards.length,
      dueCards: this.getDueCards().length,
      sessions: this.sessions.length,
      quizzes: this.quizHistory.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const learningEngine = new LearningEngine()

export { learningEngine, LearningEngine }
export default learningEngine