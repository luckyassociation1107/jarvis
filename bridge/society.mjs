/**
 * JARVIS Social Dynamics Engine — models ENTIRE SOCIETIES.
 *
 * Not just understanding individuals. Understanding GROUPS:
 *   - Social network analysis (who influences whom)
 *   - Group dynamics (how groups make decisions)
 *   - Cultural evolution (how norms change over time)
 *   - Social movements (what triggers collective action)
 *   - Opinion dynamics (how ideas spread)
 *   - Institutional analysis (how organizations behave)
 *   - Conflict dynamics (how disputes escalate/de-escalate)
 *
 * "One person is a story. A thousand people is a PATTERN."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Social network analysis ──────────────────────────── */

/**
 * Analyze a social network — who influences whom.
 */
export async function analyzeNetwork(people, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze this social network.

Map:
1. Nodes — key individuals and their roles
2. Edges — relationships (strength, type, direction of influence)
3. Clusters — subgroups and their cohesion
4. Bridges — people who connect different groups
5. Influencers — who has outsized impact
6. Isolates — who is disconnected
7. Information flow — how ideas travel
8. Power dynamics — formal vs informal power

Identify network vulnerabilities and opportunities.` },
    { role: 'user', content: `People:\n${people.map((p) => `- ${typeof p === 'string' ? p : JSON.stringify(p)}`).join('\n')}\n\nNetwork analysis:` },
  ], { maxTokens: 800 })

  return response
}

/* ──────────────── Group dynamics ──────────────────────────── */

/**
 * Analyze how a group makes decisions.
 */
export async function analyzeGroup(group, { situation = '', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze group dynamics and decision-making.

Consider:
1. Group composition (roles, personalities, expertise)
2. Decision process (how they decide)
3. Power structure (formal hierarchy vs informal influence)
4. Communication patterns (who talks to whom)
5. Groupthink risk (is dissent suppressed?)
6. Conflict level (healthy debate vs dysfunction)
7. Cohesion (united vs fragmented)
8. Effectiveness (are they achieving their goals?)

Provide actionable insights for improving group function.` },
    { role: 'user', content: `Group: ${typeof group === 'string' ? group : JSON.stringify(group)}\n${situation ? `Situation: ${situation}` : ''}\n\nGroup dynamics analysis:` },
  ], { maxTokens: 600 })

  return response
}

/* ──────────────── Opinion dynamics ──────────────────────────── */

/**
 * Model how opinions spread and change in a population.
 */
export async function modelOpinions(topic, { 
  initialDistribution = null,
  influencers = [],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Model opinion dynamics for this topic.

Consider:
1. Initial opinion distribution (who thinks what)
2. Influence mechanisms (media, peers, authority, experience)
3. Resistance factors (identity, values, incentives)
4. Tipping points (when does opinion shift en masse?)
5. Polarization dynamics (do opinions converge or diverge?)
6. Echo chambers (who only hears agreeable观点?)
7. Persuasion pathways (what changes minds?)

Simulate how opinions would evolve over time.` },
    { role: 'user', content: `Topic: ${topic}\n${initialDistribution ? `Initial distribution: ${JSON.stringify(initialDistribution)}` : ''}\n${influencers.length ? `Key influencers: ${influencers.join(', ')}` : ''}\n\nOpinion dynamics model:` },
  ], { maxTokens: 800 })

  return response
}

/* ──────────────── Social movement analysis ──────────────────────────── */

/**
 * Analyze what triggers social movements.
 */
export async function analyzeMovement(cause, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze the potential for a social movement around this cause.

Framework (McAdam's Political Process Model):
1. Political opportunities — is the environment receptive?
2. Mobilizing structures — are there organizations to channel action?
3. Framing — is the narrative compelling and actionable?
4. Trigger events — what could catalyze action?
5. Resource mobilization — money, people, media access
6. Repression risk — what opposition will they face?
7. Success probability — realistic assessment

Also consider: Granovetter's threshold model, network effects, and viral dynamics.` },
    { role: 'user', content: `Cause: ${cause}\n\nMovement analysis:` },
  ], { maxTokens: 800 })

  return response
}

/* ──────────────── Institutional analysis ──────────────────────────── */

/**
 * Analyze how an organization actually works (vs how it says it works).
 */
export async function analyzeInstitution(org, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze this institution's real dynamics.

Look at:
1. Formal structure (org chart, rules, processes)
2. Informal structure (who actually has influence)
3. Culture (unwritten rules, taboos, heroes)
4. Incentives (what actually gets rewarded)
5. Decision-making (how decisions really get made)
6. Power dynamics (who holds real power and why)
7. Dysfunctions (what's broken and why it persists)
8. Change capacity (can this org adapt?)

Be honest about the gap between stated values and actual behavior.` },
    { role: 'user', content: `Organization: ${typeof org === 'string' ? org : JSON.stringify(org)}\n\nInstitutional analysis:` },
  ], { maxTokens: 800 })

  return response
}

/* ──────────────── Conflict dynamics ──────────────────────────── */

/**
 * Analyze and de-escalate conflicts.
 */
export async function analyzeConflict(conflict, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze this conflict and recommend de-escalation.

Levels of conflict (Friedrich Glasl):
1. Hardening — positions become rigid
2. Debate — arguments sharpen
3. Actions over words — strategic moves
4. Coalitions — us vs them
5. Loss of face — public humiliation
6. Strategic threats — credible coercion
7. Limited destruction — small-scale attacks
8. Fragmentation — destroying opponent
9. Together into the abyss — mutual destruction

Identify:
- Current level
- Escalation triggers
- De-escalation strategies
- Win-win possibilities
- BATNA (best alternative to negotiated agreement) for each party` },
    { role: 'user', content: `Conflict: ${typeof conflict === 'string' ? conflict : JSON.stringify(conflict)}\n\nConflict analysis and de-escalation:` },
  ], { maxTokens: 800 })

  return response
}

export default { analyzeNetwork, analyzeGroup, modelOpinions, analyzeMovement, analyzeInstitution, analyzeConflict }