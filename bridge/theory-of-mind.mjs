/**
 * JARVIS Theory of Mind — understands what others are thinking/feeling.
 *
 * Not just detecting the user's emotion — understanding:
 *   - What other people might be thinking
 *   - Social dynamics between people
 *   - Hidden motivations and intentions
 *   - Cultural context and norms
 *   - Power dynamics in conversations
 *   - What to say and what NOT to say
 */

import { complete } from './local-llm.mjs'
import { getPerson, allPeople } from './memory.mjs'

/* ──────────────── Person modeling ──────────────────────────── */

/**
 * Build a mental model of a person.
 */
export async function modelPerson(name, { interactions = [], context = '' } = {}) {
  const known = getPerson(name)
  const interactionHistory = interactions.slice(-10).join('\n')

  const response = await complete('chat', [
    { role: 'system', content: `Build a psychological profile of this person based on available information. Be analytical but fair.

Consider:
- Communication style (formal/casual, verbose/concise)
- Emotional patterns (patient/impatient, optimistic/pessimistic)
- Preferences and interests
- Relationship dynamics
- Cultural context
- What motivates them
- What annoys them

Respond in JSON:
{
  "name": "...",
  "communication_style": "...",
  "emotional_tendency": "...",
  "motivations": ["..."],
  "pet_peeves": ["..."],
  "best_approach": "how to communicate effectively with them",
  "topics_to_avoid": ["..."],
  "topics_they_enjoy": ["..."],
  "relationship_to_user": "..."
}` },
    { role: 'user', content: `Person: ${name}${known ? `\nKnown info: ${JSON.stringify(known)}` : ''}${context ? `\nContext: ${context}` : ''}${interactionHistory ? `\nRecent interactions:\n${interactionHistory}` : ''}` },
  ], { maxTokens: 500 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, profile: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Social reasoning ──────────────────────────── */

/**
 * Analyze a social situation and suggest the best response.
 */
export async function analyzeSocialSituation(situation, { people = [], context = '' } = {}) {
  const peopleInfo = []
  for (const name of people) {
    const p = getPerson(name)
    if (p) peopleInfo.push(`${name}: ${p.relationship}, ${p.details ?? 'no details'}`)
  }

  const response = await complete('chat', [
    { role: 'system', content: `You are a social intelligence advisor. Analyze social situations and suggest the best approach.

Consider:
- Everyone's feelings and perspectives
- Power dynamics
- Cultural norms
- What to say vs what NOT to say
- Timing and tone
- Potential consequences of different approaches` },
    { role: 'user', content: `Situation: ${situation}${peopleInfo.length ? `\nPeople involved:\n${peopleInfo.join('\n')}` : ''}${context ? `\nContext: ${context}` : ''}\n\nWhat's the best way to handle this?` },
  ], { maxTokens: 500 })

  return response
}

/* ──────────────── Communication coaching ──────────────────────────── */

/**
 * Help the user communicate more effectively.
 */
export async function coachCommunication(message, { recipient = '', goal = '', tone = 'auto' } = {}) {
  const recipientInfo = getPerson(recipient)

  const response = await complete('chat', [
    { role: 'system', content: `You are a communication coach. Help the user craft the perfect message.

Consider:
- The recipient's communication style
- The goal of the message
- The appropriate tone
- Cultural sensitivity
- Clarity and conciseness
- Emotional impact` },
    { role: 'user', content: `Draft message: "${message}"\nRecipient: ${recipient}${recipientInfo ? ` (${recipientInfo.relationship})` : ''}\nGoal: ${goal}\nPreferred tone: ${tone}\n\nImprove this message:` },
  ], { maxTokens: 400 })

  return response
}

/* ──────────────── Conflict resolution ──────────────────────────── */

/**
 * Help resolve conflicts between people.
 */
export async function resolveConflict(conflict, { parties = [] } = {}) {
  const response = await complete('chat', [
    { role: 'system', content: `You are a mediator. Help resolve this conflict fairly.

Principles:
- Listen to all sides
- Find common ground
- Suggest compromises
- Be empathetic to everyone
- Focus on solutions, not blame` },
    { role: 'user', content: `Conflict: ${conflict}\nParties: ${parties.join(', ')}\n\nSuggest a resolution:` },
  ], { maxTokens: 500 })

  return response
}

export default { modelPerson, analyzeSocialSituation, coachCommunication, resolveConflict }