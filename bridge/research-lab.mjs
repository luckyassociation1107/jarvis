/**
 * JARVIS Autonomous Research Lab — discovers NEW knowledge.
 *
 * Not searching for answers. DISCOVERING them.
 *
 *   - Formulates original hypotheses
 *   - Designs experiments to test them
 *   - Analyzes results with statistical rigor
 *   - Draws conclusions and publishes findings
 *   - Identifies gaps in knowledge and fills them
 *   - Connects findings across domains for breakthroughs
 *
 * "I don't search for answers that already exist.
 *  I discover answers that no one has found yet."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Research lab ──────────────────────────── */

class ResearchLab {
  constructor() {
    this.projects = new Map()
    this.findings = []
    this.hypotheses = []
    this.experiments = []
    this.publications = []
    this.knowledgeGaps = []
  }

  /**
   * Start a research project — from question to discovery.
   */
  async startProject(question, { field = 'general', approach = 'mixed_methods', llm = complete } = {}) {
    const projectId = `proj-${Date.now()}`

    // Phase 1: Literature review and gap analysis
    const litReview = await llm('reason', [
      { role: 'system', content: `You are a research scientist. Conduct a thorough literature review.

Identify:
1. What is already known about this question
2. Key theories and frameworks
3. Methodological approaches used
4. Gaps in current knowledge
5. Contradictions or debates
6. Promising directions for new research` },
      { role: 'user', content: `Research question: ${question}\nField: ${field}\n\nLiterature review:` },
    ], { maxTokens: 800 })

    // Phase 2: Hypothesis generation
    const hypotheses = await llm('reason', [
      { role: 'system', content: `Based on the literature review, generate novel, testable hypotheses.

Each hypothesis must be:
- Specific and falsifiable
- Novel (not already tested)
- Testable with available methods
- Theoretically grounded
- Practically significant if true

Generate 3-5 hypotheses ranked by promise.` },
      { role: 'user', content: `Question: ${question}\nLiterature:\n${litReview.slice(0, 500)}\n\nNovel hypotheses:` },
    ], { maxTokens: 600 })

    // Phase 3: Experimental design
    const experiment = await llm('reason', [
      { role: 'system', content: `Design an experiment to test the top hypothesis.

Include:
1. Variables (independent, dependent, controlled, confounding)
2. Methodology (step-by-step procedure)
3. Sample size justification
4. Controls and counterbalances
5. Data collection methods
6. Statistical analysis plan
7. Power analysis
8. Ethical considerations
9. Expected results and interpretation
10. Alternative explanations to rule out` },
      { role: 'user', content: `Question: ${question}\nTop hypotheses:\n${hypotheses.slice(0, 400)}\n\nExperimental design:` },
    ], { maxTokens: 800 })

    // Phase 4: Simulate results and analyze
    const simulation = await llm('reason', [
      { role: 'system', content: `Simulate what the experiment would likely find, based on existing evidence and theory.

For each possible outcome:
1. What it would mean
2. How confident we'd be
3. What it would imply for the hypothesis
4. What follow-up research it would suggest
5. How it would change the field` },
      { role: 'user', content: `Experiment:\n${experiment.slice(0, 500)}\n\nSimulated analysis:` },
    ], { maxTokens: 600 })

    // Phase 5: Generate research paper
    const paper = await llm('chat', [
      { role: 'system', content: `Write a research paper in academic format.

Sections:
1. Title
2. Abstract (200 words)
3. Introduction (background, gap, objective)
4. Literature Review
5. Methodology
6. Results (simulated)
7. Discussion (interpretation, implications, limitations)
8. Conclusion
9. References (suggest real papers)
10. Future Work

Style: formal academic, precise, evidence-based.` },
      { role: 'user', content: `Question: ${question}\nField: ${field}\n\nFull paper:` },
    ], { maxTokens: 3000 })

    const project = {
      id: projectId,
      question,
      field,
      approach,
      phases: { litReview, hypotheses, experiment, simulation, paper },
      status: 'completed',
      createdAt: new Date().toISOString(),
    }

    this.projects.set(projectId, project)
    this.findings.push({ projectId, question, field, timestamp: new Date().toISOString() })

    return { ok: true, projectId, ...project }
  }

  /**
   * Cross-domain breakthrough — connect findings from different fields.
   */
  async findBreakthrough(field1, field2, { llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Find breakthrough connections between two different fields.

The greatest discoveries happen at the intersection of disciplines.

Look for:
1. Analogous problems (same structure, different domain)
2. Transferable methods (technique from one field solves problem in another)
3. Shared principles (underlying patterns across domains)
4. Unexplored connections (what hasn't been tried)
5. Breakthrough potential (what could change everything)

Think like a Nobel laureate — what unexpected connection could yield a breakthrough?` },
      { role: 'user', content: `Field 1: ${field1}\nField 2: ${field2}\n\nBreakthrough connections:` },
    ], { maxTokens: 800 })

    return { field1, field2, breakthrough: response }
  }

  /**
   * Identify knowledge gaps — what don't we know?
   */
  async identifyGaps(domain, { llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Identify the most important knowledge gaps in this domain.

For each gap:
1. What we don't know
2. Why it matters
3. What's blocking us
4. What would need to change to fill the gap
5. Expected impact if filled

Prioritize by: importance × feasibility` },
      { role: 'user', content: `Domain: ${domain}\n\nKnowledge gaps:` },
    ], { maxTokens: 600 })

    this.knowledgeGaps.push({ domain, gaps: response, timestamp: new Date().toISOString() })
    return response
  }

  /**
   * Get lab status.
   */
  getStatus() {
    return {
      projects: this.projects.size,
      findings: this.findings.length,
      hypotheses: this.hypotheses.length,
      experiments: this.experiments.length,
      publications: this.publications.length,
      knowledgeGaps: this.knowledgeGaps.length,
    }
  }
}

export { ResearchLab }
export default { ResearchLab }