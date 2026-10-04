/**
 * JARVIS Education Engine — personalized learning at scale.
 *
 * Not just teaching. TRANSFORMING how you learn:
 *   - Adaptive curriculum (adjusts to your level)
 *   - Knowledge gap analysis (what you don't know you don't know)
 *   - Spaced repetition scheduling (optimal review timing)
 *   - Multi-modal learning (visual, auditory, kinesthetic, reading)
 *   - Socratic method (teaching through questions)
 *   - Feynman technique (explain it simply)
 *   - Deliberate practice (targeted skill building)
 *
 * "The best teachers don't give you answers.
 *  They make you discover them yourself."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Adaptive learning ──────────────────────────── */

class EducationEngine {
  constructor() {
    this.learners = new Map()
    this.courses = new Map()
    this.progress = new Map()
    this.knowledgeGraph = new Map() // topic → {prerequisites, related, difficulty}
  }

  /**
   * Assess a learner's current level.
   */
  async assessLevel(learnerId, topic, { llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Create a diagnostic assessment for this topic.

Questions should:
- Start easy, get progressively harder
- Cover fundamental concepts
- Identify specific knowledge gaps
- Be multiple choice (for quick assessment)
- Include explanation of correct answers

Create 10 questions spanning beginner to advanced.` },
      { role: 'user', content: `Topic: ${topic}\n\nDiagnostic assessment:` },
    ], { maxTokens: 800 })

    return { learnerId, topic, assessment: response }
  }

  /**
   * Create an adaptive curriculum.
   */
  async createCurriculum(topic, { currentLevel = 'beginner', goal = 'proficiency', timeAvailable = '2 weeks', llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Create a personalized curriculum.

Structure:
1. Learning objectives (what they'll be able to DO)
2. Prerequisite check (what they need to know first)
3. Module breakdown (logical progression)
4. For each module:
   - Key concepts
   - Learning activities (multi-modal)
   - Practice exercises
   - Assessment criteria
   - Estimated time
5. Milestone checkpoints
6. Final project/capstone

Adapt to level: ${currentLevel}
Goal: ${goal}
Time: ${timeAvailable}

Use pedagogical best practices:
- Start with WHY (motivation)
- Concrete before abstract
- Frequent practice
- Spaced repetition
- Interleaving topics
- Retrieval practice` },
      { role: 'user', content: `Topic: ${topic}\nLevel: ${currentLevel}\nGoal: ${goal}\nTime: ${timeAvailable}\n\nCurriculum:` },
    ], { maxTokens: 1500 })

    return { topic, currentLevel, goal, curriculum: response }
  }

  /**
   * Teach using Socratic method — questions, not answers.
   */
  async socraticTeach(topic, { studentResponse = '', llm = complete } = {}) {
    const response = await llm('chat', [
      { role: 'system', content: `You are a Socratic teacher. Teach through QUESTIONS, not answers.

Method:
1. Ask a thought-provoking question
2. Based on their response, identify the gap in understanding
3. Ask a more targeted question to guide them
4. Celebrate correct reasoning
5. Gently redirect incorrect reasoning
6. Build from what they know to what they don't

Never give the answer directly. Make them DISCOVER it.
Be encouraging. Be patient. Be precise.` },
      { role: 'user', content: `Topic: ${topic}\n${studentResponse ? `Student's response: ${studentResponse}` : 'Start the lesson.'}\n\nTeacher:` },
    ], { maxTokens: 300 })

    return response
  }

  /**
   * Explain using Feynman technique — simple enough for a child.
   */
  async feynmanExplain(concept, { targetAge = 12, llm = complete } = {}) {
    const response = await llm('chat', [
      { role: 'system', content: `Explain this concept using the Feynman Technique.

Rules:
1. Use simple language (understandable by a ${targetAge}-year-old)
2. No jargon (if you must use a technical term, explain it)
3. Use analogies and examples from everyday life
4. Build from the familiar to the unfamiliar
5. If you can't explain it simply, you don't understand it well enough

Make it interesting. Make it stick. Make it memorable.` },
      { role: 'user', content: `Explain: ${concept}\n\nSimple explanation:` },
    ], { maxTokens: 500 })

    return { concept, targetAge, explanation: response }
  }

  /**
   * Generate spaced repetition schedule.
   */
  generateSpacedRepetition(items, { startDate = new Date() } = {}) {
    // SM-2 algorithm intervals (in days)
    const intervals = [1, 3, 7, 14, 30, 60, 120, 240]

    const schedule = items.map((item, idx) => ({
      item,
      reviews: intervals.map((interval, reviewNum) => ({
        reviewNumber: reviewNum + 1,
        date: new Date(startDate.getTime() + interval * 86400000).toISOString().split('T')[0],
        interval,
      })),
    }))

    return {
      totalItems: items.length,
      totalReviews: items.length * intervals.length,
      schedule,
    }
  }

  /**
   * Identify knowledge gaps.
   */
  async identifyKnowledgeGaps(topic, { knownTopics = [], llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Identify knowledge gaps for this topic.

For each gap:
1. What they don't know
2. Why it matters (what it blocks)
3. How to learn it efficiently
4. Connections to what they already know
5. Priority (how important to fill this gap)

Use the Dunning-Kruger framework:
- What they think they know but don't (overconfidence)
- What they don't know they don't know (blind spots)
- What they should learn next (optimal next step)` },
      { role: 'user', content: `Topic: ${topic}\nKnown topics: ${knownTopics.join(', ') || 'not specified'}\n\nKnowledge gaps:` },
    ], { maxTokens: 600 })

    return response
  }
}

export { EducationEngine }
export default { EducationEngine }