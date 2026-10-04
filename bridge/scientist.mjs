/**
 * JARVIS Scientist — not just answering questions. DISCOVERING answers.
 *
 * The scientific method, automated:
 *   - Observe → Hypothesize → Experiment → Analyze → Conclude
 *   - Literature review and synthesis
 *   - Experimental design
 *   - Data analysis and statistics
 *   - Peer review simulation
 *   - Research paper generation
 *
 * "I don't just search for answers. I discover them."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Scientific method ──────────────────────────── */

/**
 * Run a full scientific investigation.
 */
export async function investigate(question, { 
  field = 'general',
  depth = 'thorough',
  llm = complete,
} = {}) {
  // Step 1: Literature review
  const litReview = await llm('reason', [
    { role: 'system', content: `You are a research scientist conducting a literature review on: "${question}"

Field: ${field}

Summarize what is currently known:
1. Key findings from existing research
2. Consensus views
3. Open questions and debates
4. Methodological approaches used
5. Gaps in current knowledge` },
    { role: 'user', content: `Research question: ${question}\n\nLiterature review:` },
  ], { maxTokens: 800 })

  // Step 2: Hypothesis generation
  const hypotheses = await llm('reason', [
    { role: 'system', content: `Based on the literature review, generate testable hypotheses.

For each hypothesis:
1. Clear statement
2. Rationale (why this might be true)
3. How to test it
4. What would confirm/refute it
5. Feasibility assessment` },
    { role: 'user', content: `Question: ${question}\nLiterature:\n${litReview.slice(0, 500)}\n\nGenerate hypotheses:` },
  ], { maxTokens: 600 })

  // Step 3: Experimental design
  const experiment = await llm('reason', [
    { role: 'system', content: `Design an experiment to test the hypotheses.

Include:
1. Variables (independent, dependent, controlled)
2. Methodology
3. Sample size considerations
4. Controls
5. Potential confounds
6. Statistical tests to use
7. Success criteria` },
    { role: 'user', content: `Question: ${question}\nHypotheses:\n${hypotheses.slice(0, 500)}\n\nExperimental design:` },
  ], { maxTokens: 600 })

  // Step 4: Analysis framework
  const analysis = await llm('reason', [
    { role: 'system', content: `Create a data analysis plan.

Include:
1. What data to collect
2. How to clean/process it
3. Statistical tests and why
4. How to interpret results
5. What would be significant vs not
6. Alternative explanations to consider` },
    { role: 'user', content: `Question: ${question}\nExperiment:\n${experiment.slice(0, 500)}\n\nAnalysis plan:` },
  ], { maxTokens: 500 })

  return {
    question,
    field,
    investigation: {
      literatureReview: litReview,
      hypotheses,
      experimentalDesign: experiment,
      analysisPlan: analysis,
    },
  }
}

/* ──────────────── Peer review ──────────────────────────── */

/**
 * Simulate peer review of a research claim.
 */
export async function peerReview(claim, { field = 'general', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a peer reviewer. Evaluate this research claim critically.

Check:
1. Is the claim specific and testable?
2. Is the evidence sufficient?
3. Are there methodological flaws?
4. Are alternative explanations considered?
5. Is the logic sound?
6. Are the conclusions justified by the data?
7. What would strengthen the claim?

Be fair but rigorous. If it's good, acknowledge it.` },
    { role: 'user', content: `Claim: ${claim}\nField: ${field}\n\nPeer review:` },
  ], { maxTokens: 600 })

  return { claim, review: response }
}

/* ──────────────── Data analysis ──────────────────────────── */

/**
 * Analyze data and provide statistical insights.
 */
export async function analyzeData(data, { question = '', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze this data scientifically.

Steps:
1. Descriptive statistics (mean, median, mode, std dev, range)
2. Distribution analysis (normal, skewed, bimodal?)
3. Outlier detection
4. Correlation analysis (if multiple variables)
5. Trend identification
6. Statistical significance (if applicable)
7. Key findings
8. Limitations
9. Recommendations for further analysis` },
    { role: 'user', content: `Data:\n${JSON.stringify(data).slice(0, 1500)}\n${question ? `Question: ${question}` : ''}\n\nAnalysis:` },
  ], { maxTokens: 800 })

  return response
}

/* ──────────────── Research paper generator ──────────────────────────── */

/**
 * Generate a research paper structure.
 */
export async function generatePaper(topic, { 
  findings = '',
  field = 'general',
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Generate a research paper in academic style.

Structure:
1. Title
2. Abstract (150-200 words)
3. Introduction (background, gap, objective)
4. Literature Review
5. Methodology
6. Results/Findings
7. Discussion (interpretation, implications, limitations)
8. Conclusion
9. References (suggest real papers to look up)

Style: formal academic, passive voice OK, precise language.
Field: ${field}` },
    { role: 'user', content: `Topic: ${topic}\n${findings ? `Key findings: ${findings}` : ''}\n\nResearch paper:` },
  ], { maxTokens: 3000 })

  return { topic, field, paper: response }
}

export default { investigate, peerReview, analyzeData, generatePaper }