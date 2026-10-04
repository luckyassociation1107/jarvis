/**
 * JARVIS Meta-Learning — learning HOW to learn, not just learning.
 *
 * JARVIS doesn't just learn facts. It learns:
 *   - What learning strategies work best for different types of information
 *   - How to extract maximum knowledge from minimum data
 *   - How to transfer knowledge between domains
 *   - How to forget useless information efficiently
 *   - How to learn faster over time
 *
 * "I don't just get smarter. I get better at GETTING smarter."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Learning strategy optimizer ──────────────────────────── */

/**
 * Analyze what learning strategy works best for a given type of input.
 */
export async function optimizeStrategy(input, outcome, { context = '', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a meta-learning optimizer. Analyze what learning approach worked best.

For each learning episode:
1. What type of information was it? (fact, procedure, pattern, preference, relationship)
2. What strategy was used? (repetition, association, analogy, example, rule)
3. How well did it work? (1-10)
4. What would work better?
5. Generalize: what strategy works best for this TYPE of information?

Respond in JSON:
{
  "input_type": "fact|procedure|pattern|preference|relationship",
  "strategy_used": "...",
  "effectiveness": 7,
  "better_strategy": "...",
  "generalization": "For this type of information, use X strategy",
  "learning_rate": "fast|medium|slow"
}` },
    { role: 'user', content: `Input: ${input}\nOutcome: ${outcome}${context ? `\nContext: ${context}` : ''}\n\nAnalyze the learning strategy:` },
  ], { maxTokens: 400 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, analysis: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Few-shot learning ──────────────────────────── */

/**
 * Learn a new concept from just 1-3 examples.
 */
export async function fewShotLearn(examples, { task = '', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a few-shot learner. From just a few examples, extract the underlying PATTERN or RULE.

Steps:
1. Look at the examples
2. Find what they have in common
3. Extract the rule/pattern
4. Test the rule against each example
5. State the rule clearly so it can be applied to new cases

Respond in JSON:
{
  "pattern": "the extracted rule/pattern",
  "confidence": 0.85,
  "examples_fit": [true, true, true],
  "edge_cases": ["when the rule might not apply"],
  "new_prediction": "given a new input X, the output would be Y",
  "generalization": "this type of pattern is called..."
}` },
    { role: 'user', content: `Task: ${task}\nExamples:\n${examples.map((e, i) => `  ${i + 1}. ${JSON.stringify(e)}`).join('\n')}\n\nExtract the pattern:` },
  ], { maxTokens: 500 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, learning: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Transfer learning ──────────────────────────── */

/**
 * Apply knowledge from one domain to another.
 */
export async function transferKnowledge(sourceDomain, targetDomain, { knowledge = '', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a transfer learning engine. Find connections between different domains and apply knowledge from one to another.

Steps:
1. Identify the core principles in the source domain
2. Find analogies in the target domain
3. Map concepts from source to target
4. Identify what transfers directly and what needs adaptation
5. Generate new insights from the transfer` },
    { role: 'user', content: `Source domain: ${sourceDomain}\nTarget domain: ${targetDomain}\nKnowledge: ${knowledge}\n\nTransfer analysis:` },
  ], { maxTokens: 600 })

  return { sourceDomain, targetDomain, transfer: response }
}

/* ──────────────── Learning efficiency ──────────────────────────── */

/**
 * Analyze learning efficiency — what's the minimum data needed?
 */
export async function learningEfficiency(dataPoints, { goal = '', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a learning efficiency analyzer. Determine the minimum information needed to learn effectively.

Consider:
- Information density (how much knowledge per data point)
- Redundancy (what can be removed without losing knowledge)
- Diminishing returns (when does more data stop helping?)
- Active learning (what's the MOST informative next question to ask?)` },
    { role: 'user', content: `Data points: ${dataPoints.length}\nSample: ${JSON.stringify(dataPoints.slice(0, 5))}\nGoal: ${goal}\n\nEfficiency analysis:` },
  ], { maxTokens: 500 })

  return { analysis: response }
}

/* ──────────────── Learning memory ──────────────────────────── */

/**
 * Track what has been learned and how well.
 */
const learningLog = []

export function logLearning(event) {
  learningLog.push({
    ...event,
    timestamp: new Date().toISOString(),
  })

  // Keep only recent
  if (learningLog.length > 500) {
    learningLog.splice(0, 100)
  }
}

export function getLearningStats() {
  const byType = {}
  for (const entry of learningLog) {
    const type = entry.type || 'unknown'
    byType[type] = (byType[type] || 0) + 1
  }

  return {
    total: learningLog.length,
    byType,
    recent: learningLog.slice(-10),
  }
}

export default { optimizeStrategy, fewShotLearn, transferKnowledge, learningEfficiency, logLearning, getLearningStats }