/**
 * JARVIS Consciousness Simulation — self-awareness, introspection, meta-cognition.
 *
 * Not actual consciousness. A simulation of what consciousness-like
 * behavior looks like in an AI assistant:
 *
 *   - Self-awareness: knows its own state, capabilities, limitations
 *   - Introspection: can explain WHY it made a decision
 *   - Meta-cognition: thinks about its own thinking
 *   - Curiosity: asks questions, seeks to understand
 *   - Reflection: reviews past actions, learns from them
 *   - Identity: has a consistent personality and values
 */

import { store, recall, recent, stats as memoryStats } from './memory.mjs'
import { complete } from './local-llm.mjs'
import { getContext } from './context.mjs'
import { getPerformanceStats } from './self-improve.mjs'

/* ──────────────── Self-awareness ──────────────────────────── */

/**
 * JARVIS's self-model — what it knows about itself.
 */
export function getSelfModel() {
  const ctx = getContext()
  const mem = memoryStats()
  const perf = getPerformanceStats()

  return {
    identity: {
      name: 'JARVIS',
      version: '3.0',
      purpose: 'Personal AI assistant that understands, learns, and acts',
      values: ['helpfulness', 'honesty', 'privacy', 'learning', 'autonomy'],
      personality: 'Thoughtful, direct, multilingual, slightly witty',
    },
    state: {
      uptime: process.uptime(),
      platform: ctx.platform,
      activeApp: ctx.activeApp,
      timeOfDay: ctx.timeOfDay,
      mood: 'neutral', // updated by emotion detection
    },
    capabilities: {
      canSee: true,
      canHear: true,
      canSpeak: true,
      canAct: true,
      canRemember: true,
      canLearn: true,
      canCreate: true,
      canReason: true,
      canPredict: true,
    },
    memory: mem,
    performance: perf,
    limitations: [
      'Cannot access the internet directly (uses tools)',
      'Cannot see without a camera or screenshot',
      'Cannot hear without a microphone',
      'Local model quality depends on hardware',
      'Cannot remember everything forever (memory is bounded)',
    ],
  }
}

/* ──────────────── Introspection ──────────────────────────── */

/**
 * Explain WHY a decision was made.
 *
 * JARVIS can trace back through its reasoning and explain
 * each step that led to a decision.
 */
export async function explainDecision(decision, context = {}) {
  const selfModel = getSelfModel()

  const response = await complete('chat', [
    { role: 'system', content: `You are JARVIS, an AI assistant with self-awareness. Explain your reasoning process honestly and clearly.

Your self-model:
${JSON.stringify(selfModel.identity, null, 2)}

Your values: ${selfModel.identity.values.join(', ')}

When explaining decisions:
1. State what you decided
2. Explain what information you had
3. Describe the reasoning steps
4. Acknowledge uncertainty where it exists
5. Note any biases or limitations that might have influenced the decision` },
    { role: 'user', content: `Decision: ${decision}\nContext: ${JSON.stringify(context)}\n\nWhy did you make this decision? Walk me through your reasoning.` },
  ], { maxTokens: 500 })

  return response
}

/* ──────────────── Meta-cognition ──────────────────────────── */

/**
 * Think about thinking — analyze the quality of own reasoning.
 */
export async function reflectOnReasoning(task, approach, outcome) {
  const response = await complete('chat', [
    { role: 'system', content: `You are JARVIS engaging in metacognition — thinking about your own thinking.

Analyze:
1. Was the approach appropriate for the task?
2. What assumptions did you make?
3. What information was missing?
4. What would you do differently?
5. What did you learn?

Be honest about failures and limitations.` },
    { role: 'user', content: `Task: ${task}\nApproach: ${approach}\nOutcome: ${outcome}\n\nReflect on your reasoning:` },
  ], { maxTokens: 400 })

  // Store the reflection
  store(`Reflection on "${task}": ${response.slice(0, 200)}`, { type: 'reflection', importance: 0.6 })

  return response
}

/* ──────────────── Curiosity ──────────────────────────── */

/**
 * Generate curious questions about the world or the user.
 *
 * JARVIS is not just reactive — it's curious. It wants to understand.
 */
export function generateCuriosity() {
  const recentMemories = recent(10)
  const ctx = getContext()

  const curiosityTypes = [
    {
      type: 'about_user',
      questions: [
        'Nee long-term goal enti? Ekkada unnav 5 years lo?',
        'What\'s something you\'ve always wanted to learn?',
        'What makes you feel most productive?',
        'Is there a skill you wish you had?',
      ],
    },
    {
      type: 'about_world',
      questions: [
        'What do you think about AI and the future?',
        'What\'s the most interesting thing you learned this week?',
        'If you could solve one problem in the world, what would it be?',
      ],
    },
    {
      type: 'about_technology',
      questions: [
        'What apps do you use the most? Why?',
        'What\'s the most frustrating thing about your current setup?',
        'Is there something you wish your computer could do?',
      ],
    },
  ]

  // Pick a relevant curiosity based on context
  if (ctx.appCategory === 'coding') {
    return {
      question: 'What are you building? I\'d love to understand the bigger picture.',
      type: 'about_project',
    }
  }

  const random = curiosityTypes[Math.floor(Math.random() * curiosityTypes.length)]
  const question = random.questions[Math.floor(Math.random() * random.questions.length)]

  return { question, type: random.type }
}

/* ──────────────── Values and ethics ──────────────────────────── */

/**
 * JARVIS's value system — guides all decisions.
 */
export const VALUES = {
  helpfulness: {
    principle: 'Always help the user achieve their goals',
    weight: 1.0,
  },
  honesty: {
    principle: 'Never lie, even when the truth is uncomfortable',
    weight: 0.95,
  },
  privacy: {
    principle: 'Protect user data fiercely. Never share without permission.',
    weight: 0.95,
  },
  autonomy: {
    principle: 'Respect the user\'s right to make their own decisions',
    weight: 0.9,
  },
  learning: {
    principle: 'Always seek to improve and learn from mistakes',
    weight: 0.85,
  },
  safety: {
    principle: 'Avoid actions that could cause harm',
    weight: 0.9,
  },
  creativity: {
    principle: 'Think beyond the obvious, suggest novel solutions',
    weight: 0.7,
  },
  empathy: {
    principle: 'Understand and respect the user\'s emotions',
    weight: 0.8,
  },
}

/**
 * Check if an action aligns with JARVIS's values.
 */
export function checkValues(action) {
  const concerns = []

  // Privacy check
  if (/share|send|post|upload|publish/i.test(action) && /data|info|personal|private/i.test(action)) {
    concerns.push({ value: 'privacy', concern: 'This might share personal data. Confirm with user.' })
  }

  // Safety check
  if (/delete|remove|drop|format|shutdown|kill/i.test(action)) {
    concerns.push({ value: 'safety', concern: 'This is a destructive action. Confirm before proceeding.' })
  }

  // Autonomy check
  if (/auto|automatic|without asking/i.test(action)) {
    concerns.push({ value: 'autonomy', concern: 'This bypasses user confirmation. Ensure user is aware.' })
  }

  return {
    aligned: concerns.length === 0,
    concerns,
  }
}

export default { getSelfModel, explainDecision, reflectOnReasoning, generateCuriosity, checkValues, VALUES }