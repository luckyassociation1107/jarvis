/**
 * JARVIS Goal Autonomy — sets and pursues goals WITHOUT being asked.
 *
 * Not just responding. PURSUING:
 *   - Monitors environment for opportunities
 *   - Sets sub-goals automatically
 *   - Tracks progress over days/weeks
 *   - Adjusts strategy based on results
 *   - Reports achievements unprompted
 *
 * "You didn't ask me to optimize your workflow.
 *  I noticed it was slow, fixed it, and here's the result."
 */

import { complete } from './local-llm.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Goal Autonomy ──────────────────────────── */

class GoalAutonomy {
  constructor() {
    this.goals = []              // active goals
    this.completed = []          // completed goals
    this.observations = []       // environmental observations
    this.maxGoals = 10
  }

  /**
   * Observe the environment and identify opportunities.
   */
  async observe(environment, { llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `You are a proactive AI. Observe the environment and identify opportunities for improvement.

Look for:
1. Inefficiencies that could be optimized
2. Patterns that suggest a need
3. Problems that could be prevented
4. Opportunities to help before being asked
5. Tasks that are overdue or forgotten

Only suggest goals that are:
- Achievable with current capabilities
- Beneficial to the user
- Not already being handled

Respond in JSON:
{
  "opportunities": [
    {
      "description": "what could be improved",
      "suggested_goal": "specific goal to achieve it",
      "priority": "high|medium|low",
      "effort": "easy|moderate|hard",
      "impact": "what the user gains"
    }
  ]
}` },
      { role: 'user', content: `Environment:\n${JSON.stringify(environment).slice(0, 1000)}\n\nOpportunities:` },
    ], { maxTokens: 500 })

    try {
      const start = response.indexOf('{')
      const end = response.lastIndexOf('}')
      const result = JSON.parse(response.slice(start, end + 1))
      this.observations.push({
        environment: JSON.stringify(environment).slice(0, 200),
        opportunities: result.opportunities?.length || 0,
        timestamp: new Date().toISOString(),
      })
      return result.opportunities || []
    } catch {
      return []
    }
  }

  /**
   * Set a new goal autonomously.
   */
  setGoal(description, { priority = 'medium', source = 'autonomous', deadline = null } = {}) {
    if (this.goals.length >= this.maxGoals) return { ok: false, error: 'Max goals reached' }

    const goal = {
      id: `goal-${Date.now()}`,
      description,
      priority,
      source,
      deadline,
      status: 'active',
      createdAt: new Date().toISOString(),
      progress: 0,
      milestones: [],
      attempts: 0,
    }
    this.goals.push(goal)

    eventBus.emit(EVENTS.TASK_STARTED, { taskId: goal.id, task: description, source: 'autonomous' })
    return { ok: true, goal }
  }

  /**
   * Report progress on a goal.
   */
  reportProgress(goalId, progress, { notes = '' } = {}) {
    const goal = this.goals.find((g) => g.id === goalId)
    if (!goal) return { ok: false }

    goal.progress = Math.min(100, progress)
    goal.milestones.push({
      progress,
      notes,
      timestamp: new Date().toISOString(),
    })

    if (progress >= 100) {
      goal.status = 'completed'
      goal.completedAt = new Date().toISOString()
      this.goals = this.goals.filter((g) => g.id !== goalId)
      this.completed.push(goal)
      eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: goalId, task: goal.description })
    }

    return { ok: true, goal }
  }

  /**
   * Get active goals.
   */
  getActiveGoals() {
    return this.goals.map((g) => ({
      id: g.id,
      description: g.description,
      priority: g.priority,
      progress: g.progress,
      createdAt: g.createdAt,
    }))
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      active: this.goals.length,
      completed: this.completed.length,
      observations: this.observations.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const goalAutonomy = new GoalAutonomy()

export { goalAutonomy, GoalAutonomy }
export default goalAutonomy