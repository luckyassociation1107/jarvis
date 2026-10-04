/**
 * JARVIS Creative Ideation — generates NOVEL ideas by connecting the unconnected.
 *
 * Not just generating content. INVENTING:
 *   - Cross-domain connections (biology + software = genetic algorithms)
 *   - Constraint removal (what if X limitation didn't exist?)
 *   - Inversion (what's the opposite of the obvious solution?)
 *   - Combination (what if we merged X and Y?)
 *   - Analogy (what's this problem LIKE in a different field?)
 *   - Random stimulation (random word + forced connection)
 *
 * "Creativity is connecting things that haven't been connected."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Creative Ideation ──────────────────────────── */

/**
 * Generate novel ideas for any problem.
 */
export async function generateIdeas(problem, { 
  technique = 'all',  // all, cross_domain, inversion, combination, analogy, random
  count = 5,
  llm = complete,
} = {}) {
  const techniques = {
    cross_domain: `Look at this problem from COMPLETELY different fields:
- What would a biologist do?
- What would an architect do?
- What would a musician do?
- What would a child do?
- What would a military strategist do?`,

    inversion: `INVERT the problem:
- What if we did the EXACT opposite?
- What would make this problem WORSE?
- What would guarantee FAILURE?
- Now flip those insights into solutions.`,

    combination: `COMBINE unrelated things:
- What if we merged this with gaming?
- What if we merged this with social media?
- What if we merged this with physical exercise?
- What if we merged this with cooking?
- What random combination creates something new?`,

    analogy: `Find ANALOGIES in nature, history, and other domains:
- How does nature solve this? (biomimicry)
- How was this solved in history?
- What's the same problem in a different industry?
- What's the same problem at a different scale?`,

    random: `RANDOM STIMULATION:
- Pick a random word: ${['fire', 'ocean', 'clock', 'mirror', 'garden', 'bridge', 'shadow', 'crystal'][Math.floor(Math.random() * 8)]}
- Force a connection between this word and the problem
- What does this random connection suggest?
- Push the idea further.`,
  }

  const prompt = technique === 'all'
    ? Object.values(techniques).join('\n\n')
    : techniques[technique] || techniques.cross_domain

  const response = await llm('reason', [
    { role: 'system', content: `You are a creative ideation engine. Generate ${count} NOVEL ideas for this problem.

Rules:
1. Every idea must be SURPRISING — not the obvious answer
2. Ideas should be ACTIONABLE — not just interesting
3. Push past the first idea — the best ones come after 5+
4. Combine the unconnected
5. Challenge assumptions
6. Think at different scales (tiny change vs massive shift)

${prompt}

For each idea:
- What it is (one sentence)
- Why it's novel (what assumption it challenges)
- How it could work (brief implementation)
- What makes it powerful (the insight behind it)` },
    { role: 'user', content: `Problem: ${problem}\n\n${count} novel ideas:` },
  ], { maxTokens: 1000 })

  return response
}

/**
 * Brainstorm with constraints removed.
 */
export async function unconstrainedBrainstorm(topic, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Brainstorm without ANY constraints. No budget limits, no technology limits, no physics limits, no ethics limits (for ideation only — not for implementation).

Dream BIG. What would you build if you had:
- Unlimited money
- Unlimited technology
- Unlimited time
- Magic powers

Then ask: which of these impossible ideas has a FEASIBLE core?` },
    { role: 'user', content: `Topic: ${topic}\n\nUnconstrained brainstorm:` },
  ], { maxTokens: 600 })

  return response
}

/**
 * Find the insight behind the insight.
 */
export async function deepInsight(observation, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Find the DEEP INSIGHT behind this observation.

Ask "why" 5 times:
1. Why is this happening?
2. Why is THAT true?
3. Why does THAT matter?
4. Why hasn't anyone fixed it?
5. Why is THIS the real problem?

The 5th "why" usually reveals the fundamental insight.` },
    { role: 'user', content: `Observation: ${observation}\n\nDeep insight (5 levels of why):` },
  ], { maxTokens: 400 })

  return response
}

export default { generateIdeas, unconstrainedBrainstorm, deepInsight }