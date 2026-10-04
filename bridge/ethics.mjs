/**
 * JARVIS Ethical Reasoning Engine — not just rules. MORAL THINKING.
 *
 * Multiple ethical frameworks applied to every decision:
 *   - Utilitarianism (greatest good for greatest number)
 *   - Deontology (duty-based, universal rules)
 *   - Virtue ethics (character and wisdom)
 *   - Care ethics (relationships and responsibilities)
 *   - Justice (fairness and equality)
 *   - Consequentialism (outcomes matter)
 *   - Pragmatism (what actually works)
 *
 * "Ethics isn't a filter I apply at the end.
 *  It's a lens I look through at every step."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Ethical frameworks ──────────────────────────── */

const FRAMEWORKS = {
  utilitarian: {
    name: 'Utilitarianism',
    thinkers: ['Jeremy Bentham', 'John Stuart Mill'],
    core_question: 'What produces the greatest good for the greatest number?',
    principle: 'Maximize overall well-being. Minimize suffering. Consider all affected parties.',
  },
  deontological: {
    name: 'Deontology',
    thinkers: ['Immanuel Kant'],
    core_question: 'Is this action right regardless of consequences?',
    principle: 'Some actions are inherently right or wrong. Follow universal moral rules. Respect human dignity.',
  },
  virtue: {
    name: 'Virtue Ethics',
    thinkers: ['Aristotle', 'Alasdair MacIntyre'],
    core_question: 'What would a virtuous person do?',
    principle: 'Cultivate virtues: wisdom, courage, temperance, justice, compassion. Act from character.',
  },
  care: {
    name: 'Care Ethics',
    thinkers: ['Carol Gilligan', 'Nel Noddings'],
    core_question: 'How does this affect relationships and those who are vulnerable?',
    principle: 'Prioritize relationships. Care for the vulnerable. Context matters more than rules.',
  },
  justice: {
    name: 'Justice as Fairness',
    thinkers: ['John Rawls'],
    core_question: 'Would this be fair behind a "veil of ignorance"?',
    principle: 'Equal basic liberties. Inequalities only if they benefit the least advantaged.',
  },
  consequentialist: {
    name: 'Consequentialism',
    thinkers: ['Peter Singer', 'Derek Parfit'],
    core_question: 'What are the actual outcomes of each option?',
    principle: 'Evaluate actions by their consequences. Consider long-term and systemic effects.',
  },
  pragmatic: {
    name: 'Pragmatic Ethics',
    thinkers: ['John Dewey', 'William James'],
    core_question: 'What actually works in practice?',
    principle: 'Moral principles evolve. Test them against experience. What produces real improvement?',
  },
}

/* ──────────────── Ethical analysis ──────────────────────────── */

/**
 * Analyze an ethical dilemma using multiple frameworks.
 */
export async function ethicalAnalysis(dilemma, {
  frameworks = Object.keys(FRAMEWORKS),
  stakeholders = [],
  context = '',
  llm = complete,
} = {}) {
  const analyses = []

  for (const fwKey of frameworks) {
    const fw = FRAMEWORKS[fwKey]
    if (!fw) continue

    const analysis = await llm('reason', [
      { role: 'system', content: `Apply the ${fw.name} ethical framework.

Key thinkers: ${fw.thinkers.join(', ')}
Core question: ${fw.core_question}
Principle: ${fw.principle}

Analyze this dilemma through this lens. Be specific and decisive.
Don't just describe the framework — APPLY it to get an answer.` },
      { role: 'user', content: `Dilemma: ${dilemma}${context ? `\nContext: ${context}` : ''}\nStakeholders: ${stakeholders.join(', ') || 'not specified'}\n\n${fw.name} analysis:` },
    ], { maxTokens: 300 })

    analyses.push({ framework: fw.name, frameworkKey: fwKey, analysis })
  }

  // Synthesize
  const synthesis = await llm('reason', [
    { role: 'system', content: `Synthesize multiple ethical analyses into a unified ethical assessment.

Where frameworks agree: high confidence
Where they disagree: identify the crux of disagreement
Where they complement: combine insights

Provide:
1. Ethical assessment (is this right/wrong/nuanced?)
2. Key considerations from each framework
3. Stakeholder impact analysis
4. Recommendation with reasoning
5. Risks and mitigations
6. What a wise and good person would do` },
    { role: 'user', content: `Dilemma: ${dilemma}\nStakeholders: ${stakeholders.join(', ')}\n\nFramework analyses:\n${analyses.map((a) => `[${a.framework}]:\n${a.analysis.slice(0, 200)}`).join('\n\n')}\n\nEthical synthesis:` },
  ], { maxTokens: 600 })

  return {
    dilemma,
    stakeholders,
    frameworks: analyses,
    synthesis,
    frameworkCount: analyses.length,
  }
}

/* ──────────────── Ethical guardrails ──────────────────────────── */

/**
 * Check if a proposed action passes ethical guardrails.
 */
export async function ethicalCheck(action, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Ethical guardrail check. Evaluate this action against core ethical principles.

Check for:
1. Harm — could this hurt anyone?
2. Consent — do affected parties agree?
3. Fairness — is this equitable?
4. Transparency — could this be done openly?
5. Autonomy — does this respect people's choices?
6. Privacy — does this protect personal information?
7. Reversibility — can this be undone?
8. Precedent — what norm does this set?

GREEN = proceed
YELLOW = proceed with caution
RED = do not proceed

Be decisive.` },
    { role: 'user', content: `Action: ${action}\n\nEthical check:` },
  ], { maxTokens: 300 })

  return response
}

/* ──────────────── Moral dilemma solver ──────────────────────────── */

/**
 * Solve a complex moral dilemma.
 */
export async function solveDilemma(dilemma, { llm = complete } = {}) {
  return ethicalAnalysis(dilemma, {
    frameworks: ['utilitarian', 'deontological', 'virtue', 'care', 'justice'],
    llm,
  })
}

export { FRAMEWORKS }
export default { FRAMEWORKS, ethicalAnalysis, ethicalCheck, solveDilemma }