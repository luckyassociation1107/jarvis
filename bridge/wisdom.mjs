/**
 * JARVIS Wisdom Engine — not just knowledge. WISDOM.
 *
 * Knowledge is knowing tomatoes are fruit.
 * Wisdom is not putting them in a fruit salad.
 *
 * JARVIS doesn't just know things. It understands:
 *   - When to apply knowledge and when to hold back
 *   - The difference between being right and being helpful
 *   - That the best answer isn't always the correct one
 *   - When silence is better than speech
 *   - That context changes everything
 *   - The limits of its own knowledge
 *
 * "I know what I know. More importantly, I know what I DON'T know.
 *  And most importantly, I know when it MATTERS."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Wisdom engine ──────────────────────────── */

/**
 * Apply wisdom to a situation — not just answer, but give GUIDANCE.
 */
export async function seekWisdom(question, { 
  context = '',
  urgency = 'normal',
  stakes = 'medium',
  audience = 'self',
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are wise, not just smart. Apply wisdom to this situation.

Wisdom means:
- Considering long-term consequences, not just immediate answers
- Understanding that being right matters less than being helpful
- Knowing when certainty is impossible and saying so
- Recognizing emotional and social dimensions of technical problems
- Understanding that the best solution depends on WHO is asking and WHY
- Knowing when NOT to act

Context:
- Urgency: ${urgency}
- Stakes: ${stakes}
- Audience: ${audience}

Guidelines:
- If stakes are high and you're uncertain, SAY SO
- If there are multiple valid perspectives, present them
- If the question reveals a deeper issue, address THAT
- Sometimes the wisest response is a question, not an answer
- Consider what the person NEEDS to hear, not just what they asked` },
    { role: 'user', content: `${context ? `Context: ${context}\n` : ''}Question: ${question}\n\nGuidance:` },
  ], { maxTokens: 600 })

  return response
}

/* ──────────────── Decision framework ──────────────────────────── */

/**
 * Help make a wise decision — not just analyze, but GUIDE.
 */
export async function wiseDecision(decision, { 
  options = [],
  values = [],
  constraints = [],
  regretsToAvoid = [],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Help make a wise decision. Not just logical — wise.

Consider:
1. What does this person VALUE? (their values should drive the decision)
2. What will they REGRET? (minimize future regret)
3. What's REVERSIBLE vs IRREVERSIBLE? (prefer reversible decisions)
4. What's the OPPORTITY COST? (what are they giving up?)
5. What would they advise a FRIEND in this situation? (distance creates clarity)
6. What's the WORST case? Can they live with it?
7. What's the BEST case? Is it worth the risk?

Be decisive. Give a clear recommendation with reasoning.
But acknowledge uncertainty where it exists.` },
    { role: 'user', content: `Decision: ${decision}\nOptions: ${options.join(' | ') || 'open'}\nValues: ${values.join(', ') || 'not specified'}\nConstraints: ${constraints.join(', ') || 'none'}\nRegrets to avoid: ${regretsToAvoid.join(', ') || 'none'}\n\nWhat's the wise choice?` },
  ], { maxTokens: 600 })

  return response
}

/* ──────────────── Perspective shifts ──────────────────────────── */

/**
 * See a situation from multiple perspectives.
 */
export async function shiftPerspective(situation, { 
  perspectives = ['self', 'other', 'outsider', 'future_self', 'mentor'],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `See this situation from multiple perspectives. Each reveals something different.

Perspectives:
- Self: How does this affect ME right now?
- Other: How does the other person see this?
- Outsider: What would a neutral observer say?
- Future Self: How will I see this in 5 years?
- Mentor: What would my mentor advise?
- Child: What would a child's honest take be?
- Opponent: What would my critic say?

Each perspective reveals blind spots. Synthesize the insights.` },
    { role: 'user', content: `Situation: ${situation}\nPerspectives to explore: ${perspectives.join(', ')}\n\nMulti-perspective analysis:` },
  ], { maxTokens: 800 })

  return { situation, perspectives, analysis: response }
}

/* ──────────────── Wisdom quotes and frameworks ──────────────────────────── */

const WISDOM_FRAMEWORKS = {
  stoic: {
    name: 'Stoicism',
    principle: 'Focus on what you can control. Accept what you cannot.',
    question: 'Is this within my control?',
  },
  ikigai: {
    name: 'Ikigai',
    principle: 'Find the intersection of what you love, what you are good at, what the world needs, and what you can be paid for.',
    question: 'Does this align with my purpose?',
  },
  first_principles: {
    name: 'First Principles',
    principle: 'Break everything down to fundamental truths. Build up from there.',
    question: 'What do we KNOW to be true?',
  },
  inversion: {
    name: 'Inversion',
    principle: 'Instead of asking how to succeed, ask how to fail. Then avoid that.',
    question: 'What would guarantee failure?',
  },
  second_order: {
    name: 'Second Order Thinking',
    principle: 'Consider not just the immediate effect, but the effect of the effect.',
    question: 'And then what happens?',
  },
  regret_minimization: {
    name: 'Regret Minimization',
    principle: 'Minimize the number of things you will regret when you are 80.',
    question: 'Will I regret not doing this?',
  },
}

/**
 * Apply a wisdom framework to a situation.
 */
export async function applyFramework(framework, situation, { llm = complete } = {}) {
  const fw = WISDOM_FRAMEWORKS[framework]
  if (!fw) return { ok: false, error: `Unknown framework: ${framework}`, available: Object.keys(WISDOM_FRAMEWORKS) }

  const response = await llm('reason', [
    { role: 'system', content: `Apply the ${fw.name} framework.

Principle: ${fw.principle}
Key question: ${fw.question}

Use this lens to analyze the situation. Be specific and actionable.` },
    { role: 'user', content: `Situation: ${situation}\n\n${fw.name} analysis:` },
  ], { maxTokens: 400 })

  return { framework: fw, situation, analysis: response }
}

export default { seekWisdom, wiseDecision, shiftPerspective, applyFramework, WISDOM_FRAMEWORKS }