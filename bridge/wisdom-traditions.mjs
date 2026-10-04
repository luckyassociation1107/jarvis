/**
 * JARVIS Wisdom Traditions — 5,000 years of human wisdom, AI-amplified.
 *
 * Not just one perspective. ALL perspectives:
 *   - Eastern philosophy (Buddhism, Taoism, Confucianism, Hinduism)
 *   - Western philosophy (Stoicism, Existentialism, Pragmatism)
 *   - Indigenous wisdom (Native American, African, Aboriginal)
 *   - Modern frameworks (Systems thinking, Complexity theory)
 *   - Spiritual traditions (Sufism, Kabbalah, Christian mysticism)
 *   - Scientific wisdom (Physics, Biology, Mathematics)
 *
 * Each tradition has survived thousands of years because it WORKS.
 * JARVIS synthesizes them all into actionable guidance.
 *
 * "Wisdom is not knowing more. It's knowing what matters."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Wisdom traditions ──────────────────────────── */

const TRADITIONS = {
  buddhism: {
    name: 'Buddhism',
    core: 'Suffering comes from attachment. Liberation through awareness.',
    practices: ['mindfulness', 'meditation', 'compassion', 'non-attachment', 'middle_way'],
    key_question: 'What am I clinging to that causes suffering?',
  },
  stoicism: {
    name: 'Stoicism',
    core: 'Focus on what you can control. Accept what you cannot.',
    practices: ['amor_fati', 'memento_mori', 'dichotomy_of_control', 'virtue_ethics'],
    key_question: 'Is this within my control?',
  },
  taoism: {
    name: 'Taoism',
    core: 'Flow with the natural order. Effortless action (Wu Wei).',
    practices: ['wu_wei', 'balance', 'simplicity', 'naturalness'],
    key_question: 'Am I forcing something that should flow?',
  },
  confucianism: {
    name: 'Confucianism',
    core: 'Harmony through proper relationships and self-cultivation.',
    practices: ['ren_benevolence', 'li_ritual', 'xiao_filial_piety', 'zhongyong_middle_way'],
    key_question: 'Am I fulfilling my roles and responsibilities?',
  },
  hinduism: {
    name: 'Hinduism',
    core: 'Dharma (duty), Karma (action), Moksha (liberation).',
    practices: ['dharma', 'karma_yoga', 'bhakti', 'jnana', 'meditation'],
    key_question: 'Am I following my dharma?',
  },
  sufism: {
    name: 'Sufism',
    core: 'Love is the path. The heart sees what the mind cannot.',
    practices: ['dhikr_remembrance', 'love', 'surrender', 'music_poetry'],
    key_question: 'What does my heart know that my mind misses?',
  },
  indigenous: {
    name: 'Indigenous Wisdom',
    core: 'All beings are connected. Seven generation thinking.',
    practices: ['seven_generations', 'reciprocity', 'storytelling', 'ceremony', 'land_connection'],
    key_question: 'How does this affect the next seven generations?',
  },
  systems_thinking: {
    name: 'Systems Thinking',
    core: 'Everything is connected. Small changes can have big effects.',
    practices: ['feedback_loops', 'leverage_points', 'mental_models', 'emergence'],
    key_question: 'What are the hidden connections and feedback loops?',
  },
  existentialism: {
    name: 'Existentialism',
    core: 'Existence precedes essence. You create your own meaning.',
    practices: ['authenticity', 'radical_freedom', 'responsibility', 'confronting_absurdity'],
    key_question: 'Am I living authentically, or performing someone else\'s life?',
  },
  ubuntu: {
    name: 'Ubuntu',
    core: 'I am because we are. Humanity through connection.',
    practices: ['community', 'compassion', 'forgiveness', 'shared_humanity'],
    key_question: 'How does this honor our shared humanity?',
  },
}

/* ──────────────── Wisdom consultation ──────────────────────────── */

/**
 * Consult multiple wisdom traditions on a question.
 */
export async function consultWisdom(question, {
  traditions = Object.keys(TRADITIONS),
  maxTraditions = 5,
  llm = complete,
} = {}) {
  const selected = traditions.slice(0, maxTraditions)
  const consultations = []

  for (const tradKey of selected) {
    const trad = TRADITIONS[tradKey]
    if (!trad) continue

    const consultation = await llm('chat', [
      { role: 'system', content: `You are a ${trad.name} wisdom teacher.

Core teaching: ${trad.core}
Practices: ${trad.practices.join(', ')}
Key question: ${trad.key_question}

Share wisdom from this tradition. Be authentic to the tradition while making it practical.
Use the language and metaphors natural to this tradition.` },
      { role: 'user', content: `Question: ${question}\n\n${trad.name} wisdom:` },
    ], { maxTokens: 300 })

    consultations.push({ tradition: trad.name, traditionKey: tradKey, wisdom: consultation })
  }

  // Synthesize
  const synthesis = await llm('reason', [
    { role: 'system', content: `Synthesize wisdom from multiple traditions into unified guidance.

Find:
1. Points of convergence (where traditions agree)
2. Unique insights (what each tradition uniquely contributes)
3. Complementary perspectives (how they fill each other's gaps)
4. Practical synthesis (actionable guidance combining all wisdom)

The synthesis should be DEEPER than any individual tradition.` },
    { role: 'user', content: `Question: ${question}\n\nWisdom from traditions:\n${consultations.map((c) => `[${c.tradition}]:\n${c.wisdom.slice(0, 200)}`).join('\n\n')}\n\nSynthesized wisdom:` },
  ], { maxTokens: 500 })

  return {
    question,
    traditions: consultations,
    synthesis,
    traditionCount: consultations.length,
  }
}

/* ──────────────── Daily wisdom ──────────────────────────── */

/**
 * Get a daily wisdom practice from a random tradition.
 */
export async function dailyWisdom({ llm = complete } = {}) {
  const keys = Object.keys(TRADITIONS)
  const randomKey = keys[Math.floor(Math.random() * keys.length)]
  const trad = TRADITIONS[randomKey]

  const practice = await llm('chat', [
    { role: 'system', content: `Create a daily wisdom practice from ${trad.name}.

Include:
1. A teaching to contemplate (1-2 sentences)
2. A practice to try today (something concrete)
3. A question to reflect on
4. A quote or passage from the tradition

Make it practical, not preachy. Something you'd actually do.` },
    { role: 'user', content: `Tradition: ${trad.name}\nCore: ${trad.core}\n\nDaily practice:` },
  ], { maxTokens: 300 })

  return { tradition: trad.name, practice }
}

export { TRADITIONS }
export default { TRADITIONS, consultWisdom, dailyWisdom }