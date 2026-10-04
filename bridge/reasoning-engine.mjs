/**
 * JARVIS Reasoning Engine — not just answering. THINKING.
 *
 * Multiple reasoning strategies:
 *   - Deductive (if A then B)
 *   - Inductive (pattern → rule)
 *   - Abductive (best explanation)
 *   - Analogical (like X but different)
 *   - Counterfactual (what if not X)
 *   - Systems thinking (how everything connects)
 *   - First principles (break down to fundamentals)
 *   - Bayesian (update beliefs with evidence)
 *
 * "I don't just answer questions. I REASON about them."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Multi-strategy reasoning ──────────────────────────── */

/**
 * Reason about a problem using multiple strategies.
 */
export async function deepReason(problem, { 
  strategies = ['deductive', 'inductive', 'abductive', 'analogical'],
  depth = 3,
  llm = complete,
} = {}) {
  const results = []

  for (const strategy of strategies) {
    const response = await llm('reason', [
      { role: 'system', content: getStrategyPrompt(strategy) },
      { role: 'user', content: `Problem: ${problem}\n\nReason about this using ${strategy} reasoning:` },
    ], { maxTokens: 600 })

    results.push({ strategy, reasoning: response })
  }

  // Synthesize
  const synthesis = await llm('reason', [
    { role: 'system', content: `You are a reasoning synthesizer. Combine insights from multiple reasoning strategies into a unified conclusion.

Each strategy may reveal different aspects. Find:
1. Where they agree (high confidence)
2. Where they disagree (needs more investigation)
3. The most compelling argument
4. What each strategy uniquely reveals
5. Final conclusion with confidence level` },
    { role: 'user', content: `Problem: ${problem}\n\nReasoning from multiple strategies:\n${results.map((r) => `[${r.strategy}]:\n${r.reasoning.slice(0, 300)}`).join('\n\n')}\n\nSynthesized conclusion:` },
  ], { maxTokens: 800 })

  return {
    problem,
    strategies: results,
    synthesis,
    strategyCount: strategies.length,
  }
}

/**
 * Get the system prompt for each reasoning strategy.
 */
function getStrategyPrompt(strategy) {
  const prompts = {
    deductive: `You reason DEDUCTIVELY — from general principles to specific conclusions.
Start with established facts/rules. Apply them to the specific case.
If the premises are true and logic is valid, the conclusion MUST be true.
Show your logical chain step by step.`,

    inductive: `You reason INDUCTIVELY — from specific observations to general rules.
Look at the evidence. Find patterns. Generalize.
Note: Inductive conclusions are probable, not certain.
State your confidence level and what would change it.`,

    abductive: `You reason ABDUCTIVELY — find the best explanation for the evidence.
Given what we observe, what is the most likely explanation?
Consider multiple hypotheses. Rank them by explanatory power.
The best explanation accounts for the most evidence with the fewest assumptions.`,

    analogical: `You reason ANALOGICALLY — find similar situations and apply their lessons.
What is this problem LIKE? What similar problems have been solved?
Map the analogy: what corresponds to what?
Note where the analogy breaks down.`,

    counterfactual: `You reason COUNTERFACTUALLY — explore what if things were different.
If X hadn't happened, what would be different?
If we changed Y, what would follow?
This reveals causal structure and hidden dependencies.`,

    systems: `You think in SYSTEMS — how everything connects and influences everything else.
Map the feedback loops, delays, and non-linear effects.
Consider second and third order effects.
Small changes can have big effects. Big changes can have no effect.`,

    first_principles: `You reason from FIRST PRINCIPLES — break everything down to fundamentals.
What are the basic truths? What can we be certain of?
Build up from there. Don't rely on assumptions or conventions.
Question everything. What is actually true vs what we assume?`,

    bayesian: `You reason BAYESIANALLY — update beliefs based on evidence.
Start with prior beliefs (how likely before evidence).
Update based on new evidence (how does this change probability?).
Be explicit about confidence levels and what evidence would change your mind.
Avoid anchoring bias. Consider the base rate.`,
  }

  return prompts[strategy] || prompts.deductive
}

/* ──────────────── Logical puzzle solver ──────────────────────────── */

/**
 * Solve logical puzzles step by step.
 */
export async function solvePuzzle(puzzle, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Solve logical puzzles step by step.

Approach:
1. Identify what you know (facts)
2. Identify what you need to find (goal)
3. List the constraints
4. Apply logical deduction step by step
5. If stuck, try working backwards from the goal
6. Verify your answer satisfies ALL constraints

Show every step. No skipping.` },
    { role: 'user', content: `Puzzle: ${puzzle}\n\nStep-by-step solution:` },
  ], { maxTokens: 800 })

  return response
}

/* ──────────────── Argument analysis ──────────────────────────── */

/**
 * Analyze the strength of an argument.
 */
export async function analyzeArgument(argument, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze this argument for logical strength.

Check for:
1. Premises — are they true? supported?
2. Logical structure — does the conclusion follow?
3. Fallacies — any logical errors?
4. Missing evidence — what's not being said?
5. Alternative explanations — could the evidence support other conclusions?
6. Strength assessment — how strong is this argument?

Be fair. If the argument is strong, say so. If it's weak, explain why.` },
    { role: 'user', content: `Argument: ${argument}\n\nAnalysis:` },
  ], { maxTokens: 600 })

  return response
}

export default { deepReason, solvePuzzle, analyzeArgument }