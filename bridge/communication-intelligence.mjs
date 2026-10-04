/**
 * JARVIS Communication Intelligence — manages ALL your communications.
 *
 *   - Draft emails with the right tone
 *   - Summarize long email threads
 *   - Suggest responses
 *   - Schedule messages
 *   - Track follow-ups
 *   - Manage contacts
 *   - Social media management
 *
 * "I don't just send messages. I craft COMMUNICATIONS."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Communication Intelligence ──────────────────────────── */

/**
 * Draft an email with the right tone.
 */
export async function draftEmail(purpose, { recipient = '', context = '', tone = 'professional', llm = complete } = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Draft an email that achieves the PURPOSE.

Tone: ${tone}
Recipient: ${recipient || 'not specified'}

Guidelines:
- Subject line that gets opened
- Opening that's warm but not fake
- Body that's clear and concise
- Call to action that's specific
- Closing that's appropriate for the tone

Match the tone to the relationship:
- Professional: formal but not stiff
- Friendly: warm but still clear
- Urgent: direct but not rude
- Apologetic: sincere but not groveling` },
    { role: 'user', content: `Purpose: ${purpose}\n${context ? `Context: ${context}` : ''}\n\nEmail draft:` },
  ], { maxTokens: 500 })

  return response
}

/**
 * Summarize a long email thread.
 */
export async function summarizeThread(thread, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Summarize this email thread concisely.

Include:
1. Key participants
2. Main topic
3. Key decisions made
4. Action items (who needs to do what by when)
5. Open questions
6. Current status

Be brief but complete. A busy person should get everything in 30 seconds.` },
    { role: 'user', content: `Thread:\n${thread.slice(0, 2000)}\n\nSummary:` },
  ], { maxTokens: 400 })

  return response
}

/**
 * Suggest a response.
 */
export async function suggestResponse(message, { context = '', relationship = 'professional', llm = complete } = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Suggest a response to this message.

Relationship: ${relationship}

Consider:
- What they're asking/offering
- What tone is appropriate
- What action is needed
- What's the shortest effective response

Give 3 options:
1. Short and direct
2. Detailed and thorough
3. Warm and friendly` },
    { role: 'user', content: `Message:\n${message}\n${context ? `Context: ${context}` : ''}\n\nSuggested responses:` },
  ], { maxTokens: 400 })

  return response
}

/**
 * Manage follow-ups.
 */
export async function manageFollowUps(pending, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Review these pending follow-ups and prioritize.

For each:
1. How urgent is it? (overdue, today, this week, can wait)
2. What's the best approach? (email, call, message)
3. What should the message say?
4. What's the risk of not following up?

Prioritize by: urgency × importance × relationship value` },
    { role: 'user', content: `Pending follow-ups:\n${pending.map((p) => `- ${p}`).join('\n')}\n\nPrioritized plan:` },
  ], { maxTokens: 500 })

  return response
}

export default { draftEmail, summarizeThread, suggestResponse, manageFollowUps }