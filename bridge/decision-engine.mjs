/**
 * JARVIS Decision Engine — structured decision-making for complex choices.
 *
 *   - Multi-criteria decision analysis
 *   - Pros/cons with weighted scoring
 *   - Risk assessment
 *   - Scenario planning
 *   - Decision trees
 *   - Regret minimization
 *
 * "You're torn between two options. Let me break it down:
 *  Option A scores 7.2/10, Option B scores 6.8/10.
 *  But Option B has lower risk. Here's the analysis..."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Decision Engine ──────────────────────────── */

/**
 * Structured decision analysis.
 */
export async function analyzeDecision(options, { criteria = [], context = '', riskTolerance = 'moderate', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Perform a structured decision analysis.

Steps:
1. Clarify the decision to be made
2. List all options (including creative alternatives)
3. Define criteria (what matters most)
4. Score each option against each criterion (1-10)
5. Weight criteria by importance
6. Calculate weighted scores
7. Assess risks for each option
8. Consider second-order effects
9. Apply regret minimization
10. Recommend with confidence level

Risk tolerance: ${riskTolerance}
Be analytical but accessible. Use tables for scoring.` },
    { role: 'user', content: `Decision: ${options.join(' vs ')}\n${criteria.length ? `Criteria: ${criteria.join(', ')}` : 'No criteria specified — suggest important ones'}\n${context ? `Context: ${context}` : ''}\n\nDecision analysis:` },
  ], { maxTokens: 1000 })

  return response
}

/**
 * Scenario planning — what could go right and wrong.
 */
export async function scenarioPlan(decision, { scenarios = 3, llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Create ${scenarios} scenarios for this decision.

For each scenario:
1. Name and description
2. Probability (how likely)
3. Impact (what happens)
4. Early warning signs (how to know it's happening)
5. Mitigation strategy (what to do if it happens)
6. Opportunity (what to do if it goes better than expected)

Include: best case, worst case, and most likely case.` },
    { role: 'user', content: `Decision: ${decision}\n\nScenario plan:` },
  ], { maxTokens: 800 })

  return response
}

/**
 * Decision journal — track decisions and outcomes.
 */
export async function decisionJournal(entry, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Create a decision journal entry.

Include:
1. The decision made
2. The reasoning at the time
3. Expected outcome
4. Confidence level (1-10)
5. Key assumptions
6. What would make this wrong
7. Review date (when to check outcome)

This creates accountability and learning from decisions.` },
    { role: 'user', content: `Decision: ${entry}\n\nJournal entry:` },
  ], { maxTokens: 400 })

  return response
}

/**
 * Quick decision helper for everyday choices.
 */
export async function quickDecision(question, { options = [], timeLimit = '', llm = complete } = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Help make this quick decision. Be decisive, not wishy-washy.

Give:
1. Clear recommendation (pick ONE)
2. Key reason (one sentence)
3. What you'd miss (trade-off)
4. Confidence (high/medium/low)

Don't overthink it. Sometimes a good decision now beats a perfect decision later.` },
    { role: 'user', content: `Question: ${question}\n${options.length ? `Options: ${options.join(', ')}` : ''}\n${timeLimit ? `Need to decide by: ${timeLimit}` : ''}\n\nQuick decision:` },
  ], { maxTokens: 200 })

  return response
}

export default { analyzeDecision, scenarioPlan, decisionJournal, quickDecision }