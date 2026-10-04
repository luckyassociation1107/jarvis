/**
 * JARVIS Multi-Agent System — multiple AI agents working together.
 *
 * Not one AI. A TEAM of specialized AI agents:
 *   - Research Agent — finds information
 *   - Code Agent — writes and reviews code
 *   - Creative Agent — generates content
 *   - Analysis Agent — analyzes data
 *   - Planning Agent — creates plans and schedules
 *   - Communication Agent — handles messages
 *   - Execution Agent — runs tasks
 *   - Quality Agent — reviews and improves output
 *
 * Each agent is specialized. They collaborate. They delegate.
 * Complex tasks get broken down and distributed.
 *
 * "One AI is smart. A TEAM of AIs is unstoppable."
 */

import { complete } from './local-llm.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Agent Definitions ──────────────────────────── */

const AGENTS = {
  researcher: {
    id: 'researcher',
    name: 'Research Agent',
    role: 'Finds information, verifies sources, synthesizes findings',
    skills: ['search', 'verify', 'synthesize', 'cite'],
    tools: ['web_search', 'page_fetch', 'document_read'],
  },
  coder: {
    id: 'coder',
    name: 'Code Agent',
    role: 'Writes, reviews, debugs, and optimizes code',
    skills: ['code', 'debug', 'review', 'optimize', 'test'],
    tools: ['file_read', 'file_write', 'terminal', 'git'],
  },
  creative: {
    id: 'creative',
    name: 'Creative Agent',
    role: 'Generates content, ideas, designs, and stories',
    skills: ['write', 'brainstorm', 'design', 'storytell'],
    tools: ['image_generate', 'document_write'],
  },
  analyst: {
    id: 'analyst',
    name: 'Analysis Agent',
    role: 'Analyzes data, finds patterns, generates insights',
    skills: ['analyze', 'compare', 'calculate', 'visualize'],
    tools: ['data_read', 'chart_generate'],
  },
  planner: {
    id: 'planner',
    name: 'Planning Agent',
    role: 'Creates plans, schedules, and strategies',
    skills: ['plan', 'schedule', 'prioritize', 'estimate'],
    tools: ['calendar', 'task_manager'],
  },
  communicator: {
    id: 'communicator',
    name: 'Communication Agent',
    role: 'Handles messages, emails, and social interactions',
    skills: ['message', 'email', 'social', 'translate'],
    tools: ['social_bridge', 'email', 'translator'],
  },
  executor: {
    id: 'executor',
    name: 'Execution Agent',
    role: 'Runs tasks, automates workflows, executes plans',
    skills: ['execute', 'automate', 'monitor', 'report'],
    tools: ['shell', 'browser', 'workflow'],
  },
  reviewer: {
    id: 'reviewer',
    name: 'Quality Agent',
    role: 'Reviews output, finds errors, suggests improvements',
    skills: ['review', 'validate', 'improve', 'test'],
    tools: ['file_read', 'terminal'],
  },
}

/* ──────────────── Multi-Agent System ──────────────────────────── */

class MultiAgentSystem {
  constructor() {
    this.agents = new Map()          // agentId → agent instance
    this.activeTeams = new Map()     // teamId → team working on task
    this.taskQueue = []              // tasks waiting for agents
    this.completedTasks = []         // finished tasks
    this.collaborationHistory = []   // agent interactions

    // Initialize agents
    for (const [id, config] of Object.entries(AGENTS)) {
      this.agents.set(id, { ...config, status: 'idle', currentTask: null })
    }
  }

  /**
   * Solve a complex task using multiple agents.
   */
  async solve(task, { strategy = 'auto', llm = complete } = {}) {
    const startTime = Date.now()

    // Step 1: Analyze the task — which agents are needed?
    const plan = await this._createPlan(task, { strategy, llm })

    // Step 2: Assemble team
    const team = this._assembleTeam(plan.requiredAgents)

    // Step 3: Execute plan — agents work in sequence/parallel
    const results = await this._executePlan(plan, team, { llm })

    // Step 4: Review — quality agent checks output
    const review = await this._reviewOutput(results, { llm })

    // Step 5: Compile final result
    const finalResult = {
      ok: true,
      task,
      strategy: plan.strategy,
      agentsUsed: plan.requiredAgents,
      steps: results,
      review,
      totalTimeMs: Date.now() - startTime,
    }

    this.completedTasks.push(finalResult)
    return finalResult
  }

  /**
   * Create a plan for solving the task.
   */
  async _createPlan(task, { strategy, llm }) {
    const response = await llm('reason', [
      { role: 'system', content: `You are a task planning agent. Break down this task into steps and assign each to the right specialist agent.

Available agents:
${Object.values(AGENTS).map((a) => `- ${a.id}: ${a.role}`).join('\n')}

For each step:
1. Which agent handles it
2. What exactly they need to do
3. Dependencies (what must finish first)
4. Can it run in parallel with other steps?

Strategies:
- sequential: one step at a time (most reliable)
- parallel: independent steps simultaneously (fastest)
- hybrid: parallel where possible, sequential where needed (balanced)

Respond in JSON:
{
  "strategy": "hybrid",
  "requiredAgents": ["agent1", "agent2"],
  "steps": [
    {
      "id": "step1",
      "agent": "researcher",
      "action": "what to do",
      "dependencies": [],
      "parallel": true
    }
  ],
  "estimatedTime": "2 minutes"
}` },
      { role: 'user', content: `Task: ${task}\nStrategy preference: ${strategy}\n\nPlan:` },
    ], { maxTokens: 600 })

    try {
      const start = response.indexOf('{')
      const end = response.lastIndexOf('}')
      return JSON.parse(response.slice(start, end + 1))
    } catch {
      return {
        strategy: 'sequential',
        requiredAgents: ['researcher', 'executor'],
        steps: [{ id: 'step1', agent: 'executor', action: task, dependencies: [], parallel: false }],
      }
    }
  }

  /**
   * Assemble a team of agents.
   */
  _assembleTeam(requiredAgents) {
    const team = []
    for (const agentId of requiredAgents) {
      const agent = this.agents.get(agentId)
      if (agent) {
        agent.status = 'working'
        team.push(agent)
      }
    }
    return team
  }

  /**
   * Execute the plan — agents work on their steps.
   */
  async _executePlan(plan, team, { llm }) {
    const results = []
    const completedSteps = new Set()

    // Group steps by dependency level
    const levels = this._groupByLevel(plan.steps)

    for (const level of levels) {
      // Execute all steps in this level in parallel
      const levelPromises = level.map(async (step) => {
        const agent = this.agents.get(step.agent)
        if (!agent) return { step: step.id, error: 'Agent not found' }

        const result = await this._executeStep(step, agent, { llm })
        completedSteps.add(step.id)
        return result
      })

      const levelResults = await Promise.all(levelPromises)
      results.push(...levelResults)
    }

    // Reset agent statuses
    for (const agent of team) {
      agent.status = 'idle'
      agent.currentTask = null
    }

    return results
  }

  /**
   * Execute a single step.
   */
  async _executeStep(step, agent, { llm }) {
    const response = await llm('reason', [
      { role: 'system', content: `You are the ${agent.name}. ${agent.role}

Your skills: ${agent.skills.join(', ')}
Your tools: ${agent.tools.join(', ')}

Execute this task thoroughly. Provide specific, actionable output.
Be precise. Include details. Don't be vague.` },
      { role: 'user', content: `Task: ${step.action}\n\nResult:` },
    ], { maxTokens: 800 })

    return {
      step: step.id,
      agent: agent.id,
      agentName: agent.name,
      action: step.action,
      result: response,
      completedAt: new Date().toISOString(),
    }
  }

  /**
   * Group steps by dependency level for parallel execution.
   */
  _groupByLevel(steps) {
    const levels = []
    const assigned = new Set()

    let remaining = [...steps]
    while (remaining.length > 0) {
      const level = remaining.filter((s) =>
        (s.dependencies || []).every((d) => assigned.has(d))
      )
      if (level.length === 0) break // Prevent infinite loop

      for (const step of level) {
        assigned.add(step.id)
      }
      levels.push(level)
      remaining = remaining.filter((s) => !assigned.has(s.id))
    }

    return levels
  }

  /**
   * Review output — quality check.
   */
  async _reviewOutput(results, { llm }) {
    const response = await llm('reason', [
      { role: 'system', content: `Review the quality of these results.

Check for:
1. Completeness — was everything addressed?
2. Accuracy — is the information correct?
3. Consistency — do results align with each other?
4. Quality — is the output good enough?
5. Issues — any problems or gaps?

Score: 1-10
Verdict: pass, needs_improvement, or fail` },
      { role: 'user', content: `Results:\n${results.map((r) => `[${r.agentName}] ${r.action}: ${(r.result || '').slice(0, 200)}`).join('\n')}\n\nReview:` },
    ], { maxTokens: 400 })

    return response
  }

  /**
   * Get agent status.
   */
  getAgentStatus() {
    return Array.from(this.agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      currentTask: a.currentTask,
    }))
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      agents: this.agents.size,
      activeTeams: this.activeTeams.size,
      completedTasks: this.completedTasks.length,
      queuedTasks: this.taskQueue.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const multiAgentSystem = new MultiAgentSystem()

export { multiAgentSystem, MultiAgentSystem, AGENTS }
export default multiAgentSystem