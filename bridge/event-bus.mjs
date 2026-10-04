/**
 * JARVIS Event Bus — inter-module communication.
 *
 * 93 modules need to talk to each other.
 * They do it through events:
 *
 *   Module A emits → Event Bus → Module B receives
 *
 * No direct imports between heavy modules.
 * Loose coupling. High cohesion.
 *
 * Events:
 *   user:message     — user said something
 *   user:image       — user sent an image
 *   ai:response      — AI responded
 *   ai:tool_call     — AI wants to use a tool
 *   ai:error         — something went wrong
 *   memory:new       — new memory stored
 *   memory:query     — memory lookup
 *   emotion:detected — emotion detected
 *   task:started     — task began
 *   task:completed   — task finished
 *   task:failed      — task failed
 *   model:switch     — model changed
 *   system:health    — health check
 *   system:alert     — something needs attention
 */

/* ──────────────── Event Bus ──────────────────────────── */

class EventBus {
  constructor() {
    this.listeners = new Map()   // event → Set of handlers
    this.history = []            // recent events for debugging
    this.maxHistory = 200
    this.stats = { emitted: 0, handled: 0, errors: 0 }
  }

  /**
   * Subscribe to an event.
   */
  on(event, handler, { module = 'unknown', priority = 0 } = {}) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event).add({ handler, module, priority })
    return () => this.off(event, handler)
  }

  /**
   * Subscribe once.
   */
  once(event, handler, opts = {}) {
    const wrapped = (data) => {
      this.off(event, wrapped)
      handler(data)
    }
    return this.on(event, wrapped, opts)
  }

  /**
   * Unsubscribe.
   */
  off(event, handler) {
    const set = this.listeners.get(event)
    if (!set) return
    for (const entry of set) {
      if (entry.handler === handler) {
        set.delete(entry)
        break
      }
    }
  }

  /**
   * Emit an event.
   */
  async emit(event, data = {}) {
    this.stats.emitted++

    // Record in history
    this.history.push({
      event,
      data: typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : String(data).slice(0, 200),
      timestamp: Date.now(),
    })
    if (this.history.length > this.maxHistory) this.history.shift()

    // Get listeners sorted by priority (higher first)
    const set = this.listeners.get(event)
    if (!set || set.size === 0) return

    const sorted = [...set].sort((a, b) => b.priority - a.priority)

    for (const { handler, module } of sorted) {
      try {
        await handler(data)
        this.stats.handled++
      } catch (err) {
        this.stats.errors++
        console.error(`[event-bus] Handler error in ${module} for ${event}: ${err.message}`)
      }
    }
  }

  /**
   * Get all registered events.
   */
  getEvents() {
    return Array.from(this.listeners.entries()).map(([event, set]) => ({
      event,
      listeners: [...set].map((s) => s.module),
    }))
  }

  /**
   * Get recent history.
   */
  getHistory(limit = 20) {
    return this.history.slice(-limit)
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      ...this.stats,
      events: this.listeners.size,
      totalListeners: Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0),
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const eventBus = new EventBus()

// ═══ Standard events ═══
export const EVENTS = {
  // User input
  USER_MESSAGE:    'user:message',
  USER_IMAGE:      'user:image',
  USER_VOICE:      'user:voice',
  USER_COMMAND:    'user:command',

  // AI output
  AI_RESPONSE:     'ai:response',
  AI_STREAM:       'ai:stream',
  AI_TOOL_CALL:    'ai:tool_call',
  AI_TOOL_RESULT:  'ai:tool_result',
  AI_ERROR:        'ai:error',

  // Memory
  MEMORY_NEW:      'memory:new',
  MEMORY_QUERY:    'memory:query',
  MEMORY_RESULT:   'memory:result',

  // Emotion
  EMOTION_DETECTED: 'emotion:detected',
  EMOTION_SHIFT:    'emotion:shift',

  // Tasks
  TASK_STARTED:    'task:started',
  TASK_PROGRESS:   'task:progress',
  TASK_COMPLETED:  'task:completed',
  TASK_FAILED:     'task:failed',

  // Models
  MODEL_SWITCH:    'model:switch',
  MODEL_LOADED:    'model:loaded',
  MODEL_UNLOADED:  'model:unloaded',

  // System
  SYSTEM_HEALTH:   'system:health',
  SYSTEM_ALERT:    'system:alert',
  SYSTEM_STARTUP:  'system:startup',
  SYSTEM_SHUTDOWN: 'system:shutdown',

  // Proactive
  PROACTIVE_SUGGESTION: 'proactive:suggestion',
  PROACTIVE_ALERT:      'proactive:alert',
}

export { eventBus, EventBus }
export default eventBus