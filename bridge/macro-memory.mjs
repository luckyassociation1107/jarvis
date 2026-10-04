/**
 * JARVIS Level 5 — Macro Memory
 *
 * True long-term memory that spans MONTHS and YEARS:
 *   - Goal tracking (set goals, track progress over months)
 *   - Decision audit trail (every decision, why, outcome)
 *   - Strategy evolution (how strategy changed and why)
 *   - Pivot detection (when to change course)
 *   - Historical context (what happened before and what we learned)
 *   - Relationship memory (how relationships with people/orgs evolved)
 *
 * "I remember what we decided 6 months ago. I remember WHY.
 *  I can tell you if it's still working. And if it's not,
 *  I'll tell you before you even notice."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Macro memory store ──────────────────────────── */

class MacroMemory {
  constructor() {
    this.goals = []           // [{id, goal, setAt, deadline, milestones, status, reviews}]
    this.decisions = []       // [{id, decision, context, options, chosen, reasoning, outcome, reviewedAt}]
    this.strategies = []      // [{id, strategy, startedAt, pivots, currentVersion}]
    this.relationships = []   // [{id, entity, interactions, sentiment, history}]
    this.learnings = []       // [{id, learning, source, confidence, applications}]
    this.milestones = []      // [{id, milestone, achievedAt, significance}]
    this.pivotHistory = []    // [{id, from, to, reason, date, outcome}]
  }

  /**
   * Set a long-term goal with milestones.
   */
  setGoal(goal, { deadline = null, milestones = [], priority = 'high' } = {}) {
    const entry = {
      id: `goal-${Date.now()}`,
      goal,
      deadline,
      priority,
      milestones: milestones.map((m, i) => ({
        id: `ms-${i}`,
        description: m,
        status: 'pending',
        targetDate: null,
        completedDate: null,
      })),
      status: 'active',
      setAt: new Date().toISOString(),
      reviews: [],
      progress: 0,
    }
    this.goals.push(entry)
    return entry
  }

  /**
   * Review a goal — is it still relevant? Is progress on track?
   */
  async reviewGoal(goalId, { llm = complete } = {}) {
    const goal = this.goals.find((g) => g.id === goalId)
    if (!goal) return { ok: false, error: 'Goal not found' }

    const daysSinceSet = Math.floor((Date.now() - new Date(goal.setAt).getTime()) / 86400000)
    const completedMilestones = goal.milestones.filter((m) => m.status === 'completed').length

    const review = await llm('reason', [
      { role: 'system', content: `Review this long-term goal. Assess:

1. PROGRESS — are we on track? (considering ${daysSinceSet} days elapsed)
2. RELEVANCE — is this goal still important?
3. OBSTACLES — what's blocking progress?
4. PIVOT NEEDED — should we change direction?
5. NEXT STEPS — what to do next

Be honest. If the goal needs to change, say so.` },
      { role: 'user', content: `Goal: ${goal.goal}\nSet: ${goal.setAt}\nDeadline: ${goal.deadline || 'none'}\nProgress: ${goal.progress}%\nMilestones: ${completedMilestones}/${goal.milestones.length}\n\nReview:` },
    ], { maxTokens: 400 })

    goal.reviews.push({
      date: new Date().toISOString(),
      daysSinceSet,
      review,
    })

    return { goal: goal.goal, review, daysSinceSet }
  }

  /**
   * Record a decision for audit trail.
   */
  recordDecision(decision, { context = '', options = [], chosen = '', reasoning = '' } = {}) {
    const entry = {
      id: `dec-${Date.now()}`,
      decision,
      context,
      options,
      chosen,
      reasoning,
      decidedAt: new Date().toISOString(),
      outcome: null,
      outcomeRecordedAt: null,
      reviewedAt: null,
    }
    this.decisions.push(entry)
    return entry
  }

  /**
   * Record the outcome of a past decision.
   */
  recordOutcome(decisionId, outcome, { success = true } = {}) {
    const dec = this.decisions.find((d) => d.id === decisionId)
    if (!dec) return { ok: false, error: 'Decision not found' }

    dec.outcome = outcome
    dec.outcomeRecordedAt = new Date().toISOString()
    dec.success = success

    // Extract learning
    this.learnings.push({
      id: `learn-${Date.now()}`,
      learning: `Decision "${dec.decision}" → ${success ? 'success' : 'failure'}: ${outcome}`,
      source: decisionId,
      confidence: 0.8,
      applications: [],
    })

    return { ok: true }
  }

  /**
   * Detect if a pivot is needed — compare current trajectory vs goals.
   */
  async detectPivotNeed({ llm = complete } = {}) {
    const activeGoals = this.goals.filter((g) => g.status === 'active')
    const recentDecisions = this.decisions.slice(-10)
    const recentLearnings = this.learnings.slice(-10)

    const analysis = await llm('reason', [
      { role: 'system', content: `Analyze whether a strategic pivot is needed.

Look at:
1. Active goals — are they still achievable?
2. Recent decisions — are they working?
3. Recent learnings — do they suggest a change?
4. Patterns — is there a recurring problem?
5. Market changes — has the environment shifted?

If a pivot is recommended, be specific about what to change and why.` },
      { role: 'user', content: `Active goals:\n${activeGoals.map((g) => `- ${g.goal} (${g.progress}% complete)`).join('\n') || 'none'}\n\nRecent decisions:\n${recentDecisions.map((d) => `- ${d.decision} → ${d.outcome || 'no outcome yet'}`).join('\n') || 'none'}\n\nRecent learnings:\n${recentLearnings.map((l) => `- ${l.learning}`).join('\n') || 'none'}\n\nPivot analysis:` },
    ], { maxTokens: 500 })

    return analysis
  }

  /**
   * Record a pivot — strategy change.
   */
  recordPivot(from, to, { reason = '' } = {}) {
    const entry = {
      id: `pivot-${Date.now()}`,
      from,
      to,
      reason,
      date: new Date().toISOString(),
      outcome: null,
    }
    this.pivotHistory.push(entry)
    return entry
  }

  /**
   * Get comprehensive macro status.
   */
  getMacroStatus() {
    const activeGoals = this.goals.filter((g) => g.status === 'active')
    const recentDecisions = this.decisions.slice(-5)

    return {
      goals: {
        active: activeGoals.length,
        total: this.goals.length,
        top: activeGoals.slice(0, 3).map((g) => ({ goal: g.goal, progress: g.progress })),
      },
      decisions: {
        total: this.decisions.length,
        withOutcomes: this.decisions.filter((d) => d.outcome).length,
        recent: recentDecisions.map((d) => d.decision),
      },
      learnings: this.learnings.length,
      pivots: this.pivotHistory.length,
      relationships: this.relationships.length,
    }
  }
}

export { MacroMemory }
export default { MacroMemory }