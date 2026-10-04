/**
 * JARVIS Self-Improvement — learns to be better from every interaction.
 *
 * After each conversation, JARVIS:
 *   1. Analyzes what went well and what didn't
 *   2. Updates its prompts based on success/failure
 *   3. Refines its tool selection patterns
 *   4. Improves response quality over time
 *   5. Learns new vocabulary and patterns
 */

import { store, recall, learn, setPreference } from './memory.mjs'
import { complete } from './local-llm.mjs'

/* ──────────────── Conversation analysis ──────────────────────────── */

/**
 * Analyze a completed conversation for learning opportunities.
 */
export async function analyzeConversation(userMessages, assistantResponses, { onLog = () => {} } = {}) {
  const conversation = userMessages.map((m, i) =>
    `User: ${m}\nAssistant: ${assistantResponses[i] ?? '(no response)'}`,
  ).join('\n\n')

  const response = await complete('chat', [
    { role: 'system', content: `Analyze this conversation for learning opportunities. Identify:
1. What the user wanted vs what was delivered
2. Any misunderstandings or corrections
3. New vocabulary or patterns the user used
4. Preferences expressed (likes, dislikes, style)
5. Facts mentioned (names, dates, places)
6. What could be improved next time

Respond in JSON:
{
  "success_rating": 0.0-1.0,
  "misunderstandings": ["what went wrong"],
  "corrections": [{"wrong": "what was wrong", "right": "what user wanted"}],
  "new_vocabulary": ["words/phrases learned"],
  "preferences": [{"category": "...", "key": "...", "value": "..."}],
  "facts": [{"subject": "...", "predicate": "...", "object": "..."}],
  "improvements": ["what to do better next time"]
}` },
    { role: 'user', content: conversation.slice(0, 4000) },
  ], { maxTokens: 800 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    const analysis = JSON.parse(response.slice(start, end + 1))

    // Store learnings
    for (const pref of analysis.preferences ?? []) {
      setPreference(pref.category, pref.key, pref.value, { confidence: 0.6 })
    }
    for (const fact of analysis.facts ?? []) {
      learn(fact.subject, fact.predicate, fact.object, { confidence: 0.6, source: 'conversation_analysis' })
    }
    for (const improvement of analysis.improvements ?? []) {
      store(improvement, { type: 'improvement', importance: 0.7, source: 'self_analysis' })
    }

    return { ok: true, analysis }
  } catch {
    return { ok: false, error: 'Could not parse analysis' }
  }
}

/* ──────────────── Prompt refinement ──────────────────────────── */

/**
 * Refine a system prompt based on recent failures.
 */
export async function refinePrompt(currentPrompt, recentFailures) {
  const response = await complete('reason', [
    { role: 'system', content: 'You are a prompt engineering expert. Improve the system prompt to avoid the listed failures while keeping all existing capabilities.' },
    { role: 'user', content: `Current prompt:\n${currentPrompt}\n\nRecent failures:\n${recentFailures.join('\n')}\n\nImproved prompt:` },
  ], { maxTokens: 1500 })

  return response
}

/* ──────────────── Vocabulary learning ──────────────────────────── */

/**
 * Learn new words and phrases from user input.
 */
export function learnVocabulary(text) {
  const words = String(text ?? '').toLowerCase().split(/\s+/)
  const known = recall('', { topK: 100, type: 'vocabulary' }).map((m) => m.content)

  const newWords = words.filter((w) => w.length > 3 && !known.includes(w))
  for (const word of newWords.slice(0, 5)) {
    store(word, { type: 'vocabulary', importance: 0.3, source: 'user_input' })
  }

  return { learned: newWords.length, words: newWords.slice(0, 5) }
}

/* ──────────────── Performance tracking ──────────────────────────── */

/**
 * Track performance metrics over time.
 */
export function trackPerformance({ taskType, success, duration, retries }) {
  store(JSON.stringify({
    task: taskType,
    success,
    duration,
    retries,
    timestamp: new Date().toISOString(),
  }), { type: 'performance', importance: 0.5, source: 'system' })
}

/**
 * Get performance stats.
 */
export function getPerformanceStats() {
  const records = recall('', { topK: 50, type: 'performance' })
  const successes = records.filter((r) => {
    try { return JSON.parse(r.content).success } catch { return false }
  }).length
  const total = records.length

  return {
    totalTasks: total,
    successRate: total ? (successes / total * 100).toFixed(1) + '%' : 'N/A',
    recentTasks: records.slice(0, 5).map((r) => {
      try { return JSON.parse(r.content) } catch { return null }
    }).filter(Boolean),
  }
}

export default { analyzeConversation, refinePrompt, learnVocabulary, trackPerformance, getPerformanceStats }