/**
 * JARVIS Collective Intelligence — wisdom of the crowd, AI-amplified.
 *
 * Not one perspective. ALL perspectives:
 *   - Aggregate opinions from multiple sources
 *   - Detect consensus and disagreement
 *   - Weight by expertise and track record
 *   - Find the signal in the noise
 *   - Predict crowd behavior
 *   - Generate "what everyone thinks" summaries
 *
 * "One expert can be wrong. A thousand experts, properly weighted, rarely are."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Collective opinion ──────────────────────────── */

/**
 * Generate multiple expert perspectives and synthesize.
 */
export async function collectOpinions(topic, { 
  expertCount = 5,
  domains = [],
  llm = complete,
} = {}) {
  // Generate diverse expert perspectives
  const experts = []
  const domainList = domains.length ? domains : [
    'technical', 'business', 'user_experience', 'ethical', 'creative',
    'scientific', 'economic', 'social', 'environmental', 'legal',
  ]

  const selectedDomains = domainList.sort(() => Math.random() - 0.5).slice(0, expertCount)

  for (const domain of selectedDomains) {
    const opinion = await llm('chat', [
      { role: 'system', content: `You are a ${domain} expert. Give your honest, informed opinion on this topic.

Be specific. Use your domain knowledge. Don't hedge excessively.
State your confidence level (low/medium/high).
Identify what other experts might disagree with.` },
      { role: 'user', content: `Topic: ${topic}\n\nYour expert ${domain} opinion:` },
    ], { maxTokens: 300 })

    experts.push({ domain, opinion })
  }

  // Synthesize
  const synthesis = await llm('reason', [
    { role: 'system', content: `Synthesize multiple expert opinions into a collective intelligence output.

Identify:
1. Points of CONSENSUS (experts agree)
2. Points of DISAGREEMENT (experts diverge)
3. Unique INSIGHTS (only one expert noticed)
4. Weighted recommendation (based on domain relevance)
5. Confidence level (how certain is the collective?)
6. Key uncertainty (what could change the conclusion?)` },
    { role: 'user', content: `Topic: ${topic}\n\nExpert opinions:\n${experts.map((e) => `[${e.domain}]: ${e.opinion.slice(0, 200)}`).join('\n\n')}\n\nCollective synthesis:` },
  ], { maxTokens: 600 })

  return {
    topic,
    experts,
    synthesis,
    consensus: 'See synthesis',
    expertCount: experts.length,
  }
}

/* ──────────────── Delphi method ──────────────────────────── */

/**
 * Run a Delphi-style consensus building exercise.
 */
export async function delphiMethod(question, { rounds = 3, llm = complete } = {}) {
  let currentRound = []
  
  for (let round = 0; round < rounds; round++) {
    const roundResponse = await llm('reason', [
      { role: 'system', content: `Delphi Method - Round ${round + 1} of ${rounds}.

${round === 0 
  ? 'Provide your initial estimate/answer with reasoning.'
  : 'Review the previous round responses. Update your estimate based on others input. Explain what changed your mind (if anything).'}

Be specific with numbers where possible.
State your confidence interval.` },
      { role: 'user', content: `Question: ${question}\n${currentRound.length ? `\nPrevious round responses:\n${currentRound.map((r, i) => `Expert ${i + 1}: ${r}`).join('\n')}` : ''}\n\nYour response (Round ${round + 1}):` },
    ], { maxTokens: 400 })

    currentRound.push(roundResponse)
  }

  // Final consensus
  const consensus = await llm('reason', [
    { role: 'system', content: `After ${rounds} rounds of Delphi method, what is the consensus?

Report:
1. Final consensus estimate
2. Confidence level
3. Remaining disagreements
4. Key assumptions
5. What could change the conclusion` },
    { role: 'user', content: `Question: ${question}\n\nAll rounds:\n${currentRound.map((r, i) => `Round ${i + 1}: ${r.slice(0, 200)}`).join('\n')}\n\nFinal consensus:` },
  ], { maxTokens: 400 })

  return { question, rounds: currentRound, consensus }
}

/* ──────────────── Crowd prediction ──────────────────────────── */

/**
 * Aggregate predictions from multiple models/perspectives.
 */
export async function crowdPredict(event, { models = 5, llm = complete } = {}) {
  const predictions = []

  for (let i = 0; i < models; i++) {
    const prediction = await llm('reason', [
      { role: 'system', content: `Model ${i + 1} of ${models}. Predict the outcome of this event.

Consider different factors:
- Model ${i + 1}: Focus on historical patterns
- Consider base rates
- Account for recent trends
- Factor in known catalysts

Give a probability estimate (0-100%) with confidence interval.` },
      { role: 'user', content: `Event: ${event}\n\nPrediction:` },
    ], { maxTokens: 200 })

    predictions.push(prediction)
  }

  // Aggregate
  const aggregate = await llm('reason', [
    { role: 'system', content: `Aggregate multiple predictions using wisdom of crowds.

Methods:
1. Simple average
2. Trimmed average (remove outliers)
3. Weighted by confidence
4. Consider prediction diversity

Report the aggregated prediction and the spread (agreement level).` },
    { role: 'user', content: `Event: ${event}\nPredictions:\n${predictions.map((p, i) => `Model ${i + 1}: ${p.slice(0, 100)}`).join('\n')}\n\nAggregated prediction:` },
  ], { maxTokens: 300 })

  return { event, predictions, aggregate }
}

export default { collectOpinions, delphiMethod, crowdPredict }