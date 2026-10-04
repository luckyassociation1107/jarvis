/**
 * JARVIS Level 5 — Orchestrator
 *
 * The BRAIN of the organization. Coordinates everything:
 *   - Decomposes complex goals into tasks
 *   - Assigns tasks to the right department/agent
 *   - Manages dependencies and sequencing
 *   - Resolves conflicts between agents
 *   - Monitors progress and adjusts
 *   - Ensures quality through peer review
 *   - Escalates to executive layer when needed
 *
 * "I don't do the work. I make sure the RIGHT work gets done
 *  by the RIGHT agents at the RIGHT time."
 */

import { complete } from './local-llm.mjs'
import { DEPARTMENTS } from './operational.mjs'
import { C_SUITE } from './executive.mjs'

/* ──────────────── Orchestrator core ──────────────────────────── */

class Orchestrator {
  constructor() {
    this.projects = new Map()    // projectId → project
    this.activeGoals = []        // long-term goals
    this.completedTasks = []     // audit trail
    this.escalationQueue = []   // items needing executive attention
    this.performanceMetrics = new Map() // dept → metrics
  }

  /**
   * Set a strategic goal — decompose into projects and tasks.
   */
  async setGoal(goal, { priority = 'high', timeframe = '3 months', llm = complete } = {}) {
    const decomposition = await llm('reason', [
      { role: 'system', content: `You are the Orchestrator. Decompose this strategic goal into actionable projects and tasks.

For each project:
1. Name and description
2. Department responsible
3. Dependencies on other projects
4. Estimated effort
5. Success criteria
6. Priority (critical/high/medium/low)

Consider:
- What can be done in parallel vs sequentially?
- What are the critical path items?
- What are the highest-risk items?
- What quick wins exist?

Respond in JSON:
{
  "goal": "...",
  "priority": "...",
  "timeframe": "...",
  "projects": [
    {
      "id": "P1",
      "name": "...",
      "description": "...",
      "department": "engineering|legal|finance|marketing|research|security|quality|data",
      "tasks": [
        { "id": "T1", "description": "...", "effort": "hours|days|weeks", "dependencies": [] }
      ],
      "dependencies": [],
      "priority": "critical|high|medium|low",
      "success_criteria": "..."
    }
  ],
  "critical_path": ["P1", "P3", "P5"],
  "quick_wins": ["T2", "T7"],
  "risks": ["risk 1"]
}` },
      { role: 'user', content: `Goal: ${goal}\nPriority: ${priority}\nTimeframe: ${timeframe}\n\nDecomposition:` },
    ], { maxTokens: 2000 })

    let parsed
    try {
      const start = decomposition.indexOf('{')
      const end = decomposition.lastIndexOf('}')
      parsed = JSON.parse(decomposition.slice(start, end + 1))
    } catch {
      parsed = { goal, projects: [{ id: 'P1', name: goal, department: 'engineering', tasks: [{ id: 'T1', description: goal }] }] }
    }

    const projectId = `goal-${Date.now()}`
    this.projects.set(projectId, {
      id: projectId,
      ...parsed,
      status: 'active',
      createdAt: new Date().toISOString(),
      progress: 0,
    })

    this.activeGoals.push({
      id: projectId,
      goal,
      priority,
      timeframe,
      projectCount: parsed.projects?.length || 0,
    })

    return { ok: true, projectId, ...parsed }
  }

  /**
   * Assign a task to the best agent/department.
   */
  async assignTask(task, { preferredDept = null, llm = complete } = {}) {
    // Find best department
    let bestDept = preferredDept

    if (!bestDept) {
      const assignment = await llm('reason', [
        { role: 'system', content: `Assign this task to the best department.

Available departments:
${Object.entries(DEPARTMENTS).map(([id, d]) => `- ${id}: ${d.capabilities.join(', ')}`).join('\n')}

Choose based on: task requirements, department capabilities, current workload.
Respond with just the department ID.` },
        { role: 'user', content: `Task: ${task}\n\nBest department:` },
      ], { maxTokens: 50 })

      bestDept = assignment.trim().toLowerCase().replace(/[^a-z]/g, '')
      if (!DEPARTMENTS[bestDept]) bestDept = 'engineering' // fallback
    }

    return {
      task,
      assignedTo: bestDept,
      department: DEPARTMENTS[bestDept]?.name || bestDept,
      assignedAt: new Date().toISOString(),
    }
  }

  /**
   * Run peer review — another department reviews work.
   */
  async peerReview(work, { producingDept = 'engineering', llm = complete } = {}) {
    // Determine reviewer(s)
    const reviewerMap = {
      engineering: ['security', 'quality'],
      legal: ['finance', 'engineering'],
      finance: ['legal', 'data'],
      marketing: ['data', 'research'],
      research: ['data', 'marketing'],
      security: ['engineering', 'quality'],
      quality: ['engineering', 'security'],
      data: ['quality', 'research'],
    }

    const reviewers = reviewerMap[producingDept] || ['quality']
    const reviews = []

    for (const reviewerId of reviewers) {
      const reviewer = DEPARTMENTS[reviewerId]
      if (!reviewer) continue

      const review = await llm('reason', [
        { role: 'system', content: `${reviewer.systemPrompt}\n\nYou are reviewing work produced by the ${DEPARTMENTS[producingDept]?.name} department.
Check for issues from YOUR domain expertise.
Be constructive but thorough. Flag any concerns.` },
        { role: 'user', content: `Work to review:\n${typeof work === 'string' ? work.slice(0, 1500) : JSON.stringify(work).slice(0, 1500)}\n\nYour review:` },
      ], { maxTokens: 400 })

      reviews.push({
        reviewer: reviewer.name,
        reviewerId,
        review,
      })
    }

    return {
      producingDept: DEPARTMENTS[producingDept]?.name,
      reviewers: reviews.map((r) => r.reviewer),
      reviews,
      allApproved: true, // In production, parse reviews for approval
    }
  }

  /**
   * Escalate to executive layer.
   */
  escalate(issue, { reason = '', urgency = 'high' } = {}) {
    this.escalationQueue.push({
      issue,
      reason,
      urgency,
      escalatedAt: new Date().toISOString(),
      status: 'pending',
    })

    return { ok: true, queuePosition: this.escalationQueue.length }
  }

  /**
   * Get status of all active goals and projects.
   */
  getStatus() {
    return {
      activeGoals: this.activeGoals.length,
      activeProjects: Array.from(this.projects.values()).filter((p) => p.status === 'active').length,
      completedTasks: this.completedTasks.length,
      escalationQueue: this.escalationQueue.filter((e) => e.status === 'pending').length,
      departments: Object.keys(DEPARTMENTS).length,
      executives: Object.keys(C_SUITE).length,
    }
  }
}

export { Orchestrator }
export default { Orchestrator }