/**
 * JARVIS Executor — the real task execution engine.
 *
 * Takes a task from the orchestrator and ACTUALLY does it.
 * Not just planning — EXECUTING.
 *
 *   1. Parse the task
 *   2. Find the right module(s)
 *   3. Execute with error handling
 *   4. Retry on failure
 *   5. Report results
 *   6. Learn from the outcome
 *
 * "Planning is important. Execution is everything."
 */

import { eventBus, EVENTS } from './event-bus.mjs'
import registry from './registry.mjs'

/* ──────────────── Task executor ──────────────────────────── */

class Executor {
  constructor() {
    this.taskQueue = []
    this.activeTasks = new Map()
    this.completedTasks = []
    this.maxConcurrent = 1  // CPU-only: one task at a time
    this.maxRetries = 3
    this.running = false
  }

  /**
   * Execute a task — the main entry point.
   */
  async execute(task, { priority = 'normal', context = {}, retries = 0 } = {}) {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const startTime = Date.now()

    const taskEntry = {
      id: taskId,
      task,
      priority,
      context,
      status: 'running',
      startedAt: new Date().toISOString(),
      retries,
      steps: [],
    }

    this.activeTasks.set(taskId, taskEntry)
    await eventBus.emit(EVENTS.TASK_STARTED, { taskId, task })

    try {
      // Step 1: Parse the task
      const parsed = this._parseTask(task)
      taskEntry.steps.push({ step: 'parse', result: parsed, time: Date.now() - startTime })

      // Step 2: Find the right module
      const module = this._findModule(parsed)
      taskEntry.steps.push({ step: 'resolve', module: module?.name || 'none', time: Date.now() - startTime })

      // Step 3: Execute
      let result
      if (module && module.fn) {
        result = await this._executeModule(module, parsed, context)
      } else {
        result = await this._executeFallback(parsed, context)
      }

      taskEntry.status = 'completed'
      taskEntry.result = result
      taskEntry.completedAt = new Date().toISOString()
      taskEntry.duration = Date.now() - startTime

      this.activeTasks.delete(taskId)
      this.completedTasks.push(taskEntry)
      if (this.completedTasks.length > 100) this.completedTasks.shift()

      await eventBus.emit(EVENTS.TASK_COMPLETED, { taskId, result, duration: taskEntry.duration })
      return { ok: true, taskId, result, duration: taskEntry.duration }

    } catch (err) {
      // Retry logic
      if (retries < this.maxRetries) {
        taskEntry.steps.push({ step: 'retry', attempt: retries + 1, error: err.message })
        await eventBus.emit(EVENTS.TASK_PROGRESS, { taskId, status: 'retrying', attempt: retries + 1 })
        return this.execute(task, { priority, context, retries: retries + 1 })
      }

      taskEntry.status = 'failed'
      taskEntry.error = err.message
      taskEntry.completedAt = new Date().toISOString()
      taskEntry.duration = Date.now() - startTime

      this.activeTasks.delete(taskId)
      this.completedTasks.push(taskEntry)

      await eventBus.emit(EVENTS.TASK_FAILED, { taskId, error: err.message, duration: taskEntry.duration })
      return { ok: false, taskId, error: err.message, duration: taskEntry.duration }
    }
  }

  /**
   * Parse a task description into structured data.
   */
  _parseTask(task) {
    const text = typeof task === 'string' ? task : task.description || task.task || ''

    // Detect task type
    let type = 'general'
    if (/code|program|function|script|debug/i.test(text)) type = 'coding'
    else if (/research|search|find|look up|investigate/i.test(text)) type = 'research'
    else if (/write|story|poem|article|essay/i.test(text)) type = 'writing'
    else if (/translate|convert language/i.test(text)) type = 'translation'
    else if (/calculate|math|number|compute/i.test(text)) type = 'computation'
    else if (/plan|schedule|organize|workflow/i.test(text)) type = 'planning'
    else if (/analyze|data|chart|graph|statistics/i.test(text)) type = 'analysis'
    else if (/health|symptom|wellness|exercise/i.test(text)) type = 'health'
    else if (/music|song|melody|compose/i.test(text)) type = 'music'
    else if (/image|picture|photo|screen/i.test(text)) type = 'vision'
    else if (/email|message|send|notify/i.test(text)) type = 'communication'
    else if (/learn|teach|study|explain/i.test(text)) type = 'education'
    else if (/negotiate|mediate|diplomacy/i.test(text)) type = 'diplomacy'
    else if (/ethics|moral|right|wrong/i.test(text)) type = 'ethics'
    else if (/simulate|model|predict/i.test(text)) type = 'simulation'

    return { text, type, original: task }
  }

  /**
   * Find the best module for a parsed task.
   */
  _findModule(parsed) {
    const typeToModule = {
      coding:        { name: 'autonomous-coder', fn: 'buildApp' },
      research:      { name: 'research', fn: 'researchTopic' },
      writing:       { name: 'creative-writer', fn: 'writeStory' },
      translation:   { name: 'universal-translator', fn: 'translate' },
      computation:   { name: 'quantum', fn: 'quantumOptimize' },
      planning:      { name: 'workflow-auto', fn: 'createWorkflow' },
      analysis:      { name: 'documents', fn: 'summarize' },
      health:        { name: 'health', fn: 'analyzeSymptoms' },
      music:         { name: 'music-studio', fn: 'compose' },
      vision:        { name: 'vision-ai', fn: 'processCommand' },
      communication: { name: 'devices', fn: 'sendNotification' },
      education:     { name: 'education', fn: 'socraticTeach' },
      diplomacy:     { name: 'diplomacy', fn: 'prepareNegotiation' },
      ethics:        { name: 'ethics', fn: 'ethicalAnalysis' },
      simulation:    { name: 'simulation', fn: 'simulate' },
      general:       { name: null, fn: null },
    }

    const mapping = typeToModule[parsed.type] || typeToModule.general
    if (!mapping.name) return null

    const mod = registry.get(mapping.name)
    if (!mod) return null

    return {
      name: mapping.name,
      module: mod,
      fn: mod[mapping.fn] || null,
    }
  }

  /**
   * Execute a module function.
   */
  async _executeModule(moduleInfo, parsed, context) {
    const { name, fn } = moduleInfo
    if (!fn) throw new Error(`Module ${name} has no callable function`)

    await eventBus.emit(EVENTS.TASK_PROGRESS, {
      taskId: context.taskId,
      status: 'executing',
      module: name,
    })

    // Call with the task text as first argument
    const result = await fn(parsed.text, context)
    return result
  }

  /**
   * Fallback: use the LLM directly.
   */
  async _executeFallback(parsed, context) {
    // Import the LLM module dynamically
    const llm = registry.get('local-llm')
    if (!llm || !llm.complete) {
      throw new Error('No module found and LLM unavailable')
    }

    const response = await llm.complete('chat', [
      { role: 'system', content: 'You are JARVIS. Execute this task thoroughly and provide a complete answer.' },
      { role: 'user', content: parsed.text },
    ], { maxTokens: 1024 })

    return response
  }

  /**
   * Get executor stats.
   */
  getStats() {
    return {
      active: this.activeTasks.size,
      completed: this.completedTasks.length,
      queue: this.taskQueue.length,
      recentTasks: this.completedTasks.slice(-5).map((t) => ({
        id: t.id,
        task: t.task?.slice?.(0, 60) || 'complex',
        status: t.status,
        duration: t.duration,
      })),
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const executor = new Executor()

export { executor, Executor }
export default executor