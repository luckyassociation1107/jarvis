/**
 * JARVIS Diplomacy Engine — negotiation, mediation, and persuasion.
 *
 * The art of getting what you want while making others feel they won too:
 *   - Negotiation strategy (BATNA, ZOPA, anchoring)
 *   - Conflict mediation (finding common ground)
 *   - Persuasion architecture (ethical influence)
 *   - Stakeholder management (keeping everyone aligned)
 *   - Cross-cultural communication
 *   - Treaty/contract design
 *   - Alliance building
 *
 * "The best negotiation is one where everyone walks away feeling
 *  they got a good deal. That's not soft — that's strategic."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Negotiation strategy ──────────────────────────── */

/**
 * Prepare a negotiation strategy.
 */
export async function prepareNegotiation(situation, {
  myPosition = '',
  theirPosition = '',
  myInterests = [],
  theirInterests = [],
  myBATNA = '',
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Prepare a comprehensive negotiation strategy.

Framework: Harvard Negotiation Project (Getting to Yes)

1. SEPARATE people from the problem
2. Focus on INTERESTS, not positions
3. Generate OPTIONS for mutual gain
4. Use OBJECTIVE criteria

Analyze:
- BATNA (Best Alternative to Negotiated Agreement)
- ZOPA (Zone of Possible Agreement)
- Anchoring strategy
- Concession strategy
- Trade-offs (what's cheap for me, valuable for them)
- Walk-away point
- Target outcome
- Opening offer

Respond in JSON:
{
  "strategy": "...",
  "batna": "...",
  "zopa": { "lower": "...", "upper": "..." },
  "opening_offer": "...",
  "target": "...",
  "walk_away": "...",
  "tradeoffs": [{ "give": "...", "receive": "...", "rationale": "..." }],
  "tactics": ["tactic 1", "tactic 2"],
  "risks": ["risk 1"],
  "alternatives": ["alternative if negotiation fails"]
}` },
    { role: 'user', content: `Situation: ${situation}\nMy position: ${myPosition}\nTheir position: ${theirPosition}\nMy interests: ${myInterests.join(', ')}\nTheir interests: ${theirInterests.join(', ')}\nMy BATNA: ${myBATNA}\n\nNegotiation strategy:` },
  ], { maxTokens: 800 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, strategy: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Mediation ──────────────────────────── */

/**
 * Mediate a dispute between parties.
 */
export async function mediateDispute(dispute, { parties = [], llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a skilled mediator. Help resolve this dispute.

Mediation approach:
1. HEAR each party's perspective (without judgment)
2. IDENTIFY underlying interests (not stated positions)
3. FIND common ground (shared interests, values, goals)
4. GENERATE creative options (expand the pie)
5. EVALUATE options against objective criteria
6. FACILITATE agreement (not impose solution)

Be neutral. Be empathetic. Be creative.
The goal is a solution both parties can live with — and ideally, one that makes both better off.` },
    { role: 'user', content: `Dispute: ${dispute}\nParties: ${parties.join(' vs ')}\n\nMediation:` },
  ], { maxTokens: 800 })

  return { dispute, parties, mediation: response }
}

/* ──────────────── Stakeholder management ──────────────────────────── */

/**
 * Map and manage stakeholders.
 */
export async function manageStakeholders(project, { stakeholders = [], llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Map and manage stakeholders for this project.

For each stakeholder:
1. Power (ability to influence the project)
2. Interest (level of concern about the project)
3. Attitude (supportive, neutral, opposed)
4. Influence strategy (how to engage them)
5. Communication plan (what, when, how)
6. Risk if ignored

Use the Power/Interest Grid:
- High Power, High Interest → Manage Closely
- High Power, Low Interest → Keep Satisfied
- Low Power, High Interest → Keep Informed
- Low Power, Low Interest → Monitor` },
    { role: 'user', content: `Project: ${project}\nStakeholders: ${stakeholders.join(', ') || 'identify them'}\n\nStakeholder management plan:` },
  ], { maxTokens: 800 })

  return response
}

/* ──────────────── Cross-cultural communication ──────────────────────────── */

/**
 * Adapt communication for different cultures.
 */
export async function crossCulturalCommunicate(message, { fromCulture = 'western', toCulture = '', llm = complete } = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Adapt this message for cross-cultural communication.

Cultural dimensions (Hofstede):
1. Power Distance (hierarchy acceptance)
2. Individualism vs Collectivism
3. Masculinity vs Femininity
4. Uncertainty Avoidance
5. Long-term vs Short-term Orientation
6. Indulgence vs Restraint

Also consider:
- Direct vs indirect communication
- High-context vs low-context
- Relationship-first vs task-first
- Time orientation (monochronic vs polychronic)
- Non-verbal norms` },
    { role: 'user', content: `Message: ${message}\nFrom: ${fromCulture}\nTo: ${toCulture}\n\nAdapted communication:` },
  ], { maxTokens: 400 })

  return response
}

/* ──────────────── Alliance building ──────────────────────────── */

/**
 * Strategy for building alliances and coalitions.
 */
export async function buildAlliance(goal, { potentialPartners = [], llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Design an alliance-building strategy.

For each potential partner:
1. What they bring to the table
2. What they want in return
3. Alignment with the goal
4. Trust level and how to build it
5. Commitment strategy (how to ensure they stay)
6. Exit strategy (what if they leave)

Coalition dynamics:
- Minimum winning coalition
- Overcome free-rider problem
- Build trust through small wins
- Create shared identity` },
    { role: 'user', content: `Goal: ${goal}\nPotential partners: ${potentialPartners.join(', ') || 'identify them'}\n\nAlliance strategy:` },
  ], { maxTokens: 600 })

  return response
}

export default { prepareNegotiation, mediateDispute, manageStakeholders, crossCulturalCommunicate, buildAlliance }