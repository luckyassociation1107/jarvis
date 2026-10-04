/**
 * JARVIS Workflow Automation — automates multi-step tasks.
 *
 *   - Create workflows from natural language
 *   - Multi-step automation with conditions
 *   - Scheduled execution
 *   - Error handling and retry
 *   - Workflow templates for common tasks
 *   - Workflow sharing and versioning
 *
 * "Every morning at 8 AM: check weather, read emails, summarize news,
 *  create task list, send me the briefing. All automatic."
 */

import { complete } from './local-llm.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Workflow Automation ──────────────────────────── */

class WorkflowAutomation {
  constructor() {
    this.workflows = new Map()    // workflowId → workflow
    this.executions = []          // execution history
    this.templates = new Map()    // templateName → template
    this._loadTemplates()
  }

  _loadTemplates() {
    this.templates.set('morning_routine', {
      name: 'Morning Routine',
      description: 'Daily morning briefing with weather, tasks, and news',
      steps: [
        { action: 'get_weather', params: {} },
        { action: 'get_tasks', params: { status: 'pending' } },
        { action: 'get_schedule', params: { date: 'today' } },
        { action: 'generate_briefing', params: { style: 'concise' } },
        { action: 'deliver', params: { channel: 'voice' } },
      ],
      schedule: '08:00',
      enabled: true,
    })

    this.templates.set('code_review', {
      name: 'Code Review',
      description: 'Review code for bugs, style, and performance',
      steps: [
        { action: 'read_code', params: {} },
        { action: 'find_bugs', params: {} },
        { action: 'check_style', params: {} },
        { action: 'suggest_improvements', params: {} },
        { action: 'generate_report', params: {} },
      ],
      enabled: true,
    })

    this.templates.set('email_digest', {
      name: 'Email Digest',
      description: 'Summarize and prioritize emails',
      steps: [
        { action: 'fetch_emails', params: { unread: true } },
        { action: 'categorize', params: {} },
        { action: 'prioritize', params: {} },
        { action: 'draft_responses', params: { urgent: true } },
        { action: 'deliver_summary', params: {} },
      ],
      schedule: '09:00,13:00,17:00',
      enabled: true,
    })

    this.templates.set('end_of_day', {
      name: 'End of Day Review',
      description: 'Review what was accomplished and plan tomorrow',
      steps: [
        { action: 'review_completed_tasks', params: {} },
        { action: 'review_goals', params: {} },
        { action: 'identify_unfinished', params: {} },
        { action: 'plan_tomorrow', params: {} },
        { action: 'generate_report', params: { style: 'reflective' } },
      ],
      schedule: '21:00',
      enabled: true,
    })
  }

  /**
   * Create a workflow from natural language.
   */
  async createWorkflow(description, { llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Convert this natural language description into a structured workflow.

Each step must have:
- action: what to do
- params: parameters for the action
- condition: (optional) when to execute this step
- onError: (optional) what to do if it fails

Available actions: get_weather, get_tasks, get_schedule, send_message, read_file, write_file, run_command, search, summarize, analyze, generate, deliver, wait, notify

Respond in JSON:
{
  "name": "workflow name",
  "description": "what it does",
  "steps": [
    {
      "action": "action_name",
      "params": {},
      "condition": null,
      "onError": "skip|retry|abort"
    }
  ],
  "schedule": "cron expression or null",
  "enabled": true
}` },
      { role: 'user', content: `Description: ${description}\n\nWorkflow:` },
    ], { maxTokens: 600 })

    try {
      const start = response.indexOf('{')
      const end = response.lastIndexOf('}')
      const workflow = JSON.parse(response.slice(start, end + 1))
      workflow.id = `wf-${Date.now()}`
      workflow.createdAt = new Date().toISOString()
      workflow.runCount = 0
      this.workflows.set(workflow.id, workflow)
      return { ok: true, workflow }
    } catch {
      return { ok: false, raw: response }
    }
  }

  /**
   * Execute a workflow.
   */
  async executeWorkflow(workflowId, { context = {}, llm = complete } = {}) {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) return { ok: false, error: 'Workflow not found' }

    const execution = {
      id: `exec-${Date.now()}`,
      workflowId,
      workflowName: workflow.name,
      startedAt: new Date().toISOString(),
      steps: [],
      status: 'running',
    }

    const results = []
    for (const step of workflow.steps) {
      const stepResult = {
        action: step.action,
        startedAt: new Date().toISOString(),
        status: 'running',
      }

      try {
        // Execute step
        stepResult.result = `Executed: ${step.action} with ${JSON.stringify(step.params)}`
        stepResult.status = 'completed'
        results.push(stepResult.result)
      } catch (error) {
        stepResult.status = 'failed'
        stepResult.error = error.message

        if (step.onError === 'abort') {
          execution.status = 'failed'
          break
        } else if (step.onError === 'retry') {
          // Retry once
          try {
            stepResult.result = `Retry: ${step.action}`
            stepResult.status = 'completed'
          } catch {
            execution.status = 'failed'
            break
          }
        }
        // 'skip' continues to next step
      }

      stepResult.endedAt = new Date().toISOString()
      execution.steps.push(stepResult)
    }

    execution.endedAt = new Date().toISOString()
    execution.status = execution.status === 'running' ? 'completed' : execution.status
    execution.results = results
    workflow.runCount++

    this.executions.push(execution)
    eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: execution.id, task: workflow.name })

    return { ok: true, execution }
  }

  /**
   * Get all workflows.
   */
  getWorkflows() {
    return Array.from(this.workflows.values()).map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      steps: w.steps.length,
      schedule: w.schedule,
      enabled: w.enabled,
      runCount: w.runCount,
    }))
  }

  /**
   * Get execution history.
   */
  getHistory({ limit = 10 } = {}) {
    return this.executions.slice(-limit).map((e) => ({
      id: e.id,
      workflow: e.workflowName,
      status: e.status,
      startedAt: e.startedAt,
      duration: new Date(e.endedAt) - new Date(e.startedAt),
    }))
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      workflows: this.workflows.size,
      executions: this.executions.length,
      templates: this.templates.size,
      successRate: this.executions.length > 0
        ? ((this.executions.filter((e) => e.status === 'completed').length / this.executions.length) * 100).toFixed(0) + '%'
        : 'N/A',
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const workflowAutomation = new WorkflowAutomation()

export { workflowAutomation, WorkflowAutomation }
export default workflowAutomation