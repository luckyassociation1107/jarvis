/**
 * JARVIS Digital Twin — a model of YOU.
 *
 * Learns your:
 *   - Communication style (formal/casual, language mix)
 *   - Work patterns (when you code, when you rest)
 *   - Preferences (music, food, apps, websites)
 *   - Knowledge (what you know, what you're learning)
 *   - Relationships (who matters to you)
 *   - Goals (what you're working toward)
 *
 * Then acts as your digital representative:
 *   - Replies in YOUR style
 *   - Makes decisions YOU would make
 *   - Prioritizes what YOU care about
 *   - Learns continuously from every interaction
 */

import { allFacts, allPreferences, allPeople, getRoutines, store, recall } from './memory.mjs'
import { complete } from './local-llm.mjs'

/* ──────────────── Twin profile ──────────────────────────── */

/**
 * Build a complete profile of the user.
 */
export function buildProfile() {
  const facts = allFacts({ limit: 50 })
  const preferences = allPreferences()
  const people = allPeople()
  const routines = getRoutines({ minFrequency: 2 })

  // Group preferences by category
  const prefsByCategory = {}
  for (const p of preferences) {
    if (!prefsByCategory[p.category]) prefsByCategory[p.category] = []
    prefsByCategory[p.category].push(`${p.key}: ${p.value}`)
  }

  return {
    facts: facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`),
    preferences: prefsByCategory,
    people: people.map((p) => `${p.name} (${p.relationship ?? 'known'})${p.details ? ` — ${p.details}` : ''}`),
    routines: routines.map((r) => `${r.pattern}${r.time_hint ? ` at ${r.time_hint}` : ''} (seen ${r.frequency}x)`),
    style: detectCommunicationStyle(),
  }
}

/**
 * Detect the user's communication style from history.
 */
function detectCommunicationStyle() {
  const recent = recall('', { topK: 20, type: 'conversation' })
  if (!recent.length) return { language: 'en', formality: 'casual', emoji: false, codeSwitching: false }

  // Detect language mixing
  const hasTelugu = recent.some((m) => /[అ-్]/.test(m.content) || /cheyyu|chestunna|undi|kavali|emi/i.test(m.content))
  const hasHindi = recent.some((m) => /[क-्]/.test(m.content))
  const hasEnglish = recent.some((m) => /[a-zA-Z]{3,}/.test(m.content))

  return {
    primaryLanguage: hasTelugu ? 'te' : hasHindi ? 'hi' : 'en',
    codeSwitching: hasTelugu && hasEnglish,
    formality: recent.some((m) => /please|kindly|sir|madam/i.test(m.content)) ? 'formal' : 'casual',
    usesEmoji: recent.some((m) => /[\u{1F600}-\u{1F64F}]/u.test(m.content)),
    avgMessageLength: recent.reduce((sum, m) => sum + m.content.length, 0) / recent.length,
  }
}

/* ──────────────── Twin reasoning ──────────────────────────── */

/**
 * Get how the user would respond to a situation.
 */
export async function predictUserResponse(situation) {
  const profile = buildProfile()

  const response = await complete('chat', [
    { role: 'system', content: `You are the user's digital twin. Respond AS the user, in their style.

User profile:
${JSON.stringify(profile, null, 2)}

Rules:
- Use the user's communication style (language, formality, emoji)
- Make the decision the user would make
- Reference the user's preferences and knowledge
- If the user code-switches (Telugu+English), do the same
- Be brief if the user is typically brief
- Be detailed if the user is typically detailed` },
    { role: 'user', content: `Situation: ${situation}\n\nHow would you (the user) respond?` },
  ], { maxTokens: 300 })

  return response
}

/**
 * Get a personalized response — JARVIS speaking as JARVIS but
 * adapted to this user's style.
 */
export function getPersonalizedSystemPrompt() {
  const profile = buildProfile()
  const lines = []

  lines.push('You are JARVIS, a personal AI assistant.')
  lines.push('')

  if (profile.style.codeSwitching) {
    lines.push('The user mixes Telugu and English. You can do the same naturally.')
    lines.push('Use Telugu for casual conversation, English for technical topics.')
  }
  if (profile.style.formality === 'casual') {
    lines.push('The user prefers casual, friendly communication. Be warm, not robotic.')
  }
  if (profile.preferences.likes) {
    lines.push(`User likes: ${profile.preferences.likes.join(', ')}`)
  }
  if (profile.preferences.dislikes) {
    lines.push(`User dislikes: ${profile.preferences.dislikes.join(', ')}`)
  }
  if (profile.people.length) {
    lines.push(`Known people: ${profile.people.join('; ')}`)
  }
  if (profile.routines.length) {
    lines.push(`Known routines: ${profile.routines.join('; ')}`)
  }

  return lines.join('\n')
}

export default { buildProfile, predictUserResponse, getPersonalizedSystemPrompt }