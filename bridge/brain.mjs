/**
 * JARVIS Brain — the central orchestrator that ties EVERYTHING together.
 *
 * This is the SINGLE entry point for all JARVIS operations.
 * It:
 *   - Boots up all modules in the right order
 *   - Routes requests to the right module
 *   - Manages the event bus
 *   - Monitors health
 *   - Handles errors gracefully
 *   - Reports status
 *
 * "I am not 93 modules. I am ONE brain with 93 capabilities."
 */

import { eventBus, EVENTS } from './event-bus.mjs'
import registry from './registry.mjs'
import executor from './executor.mjs'
import healthMonitor from './health-monitor.mjs'
import { HW, PROFILE, MEMORY_BUDGET } from './hardware-profile.mjs'

/* ──────────────── Brain ──────────────────────────── */

class Brain {
  constructor() {
    this.status = 'offline'
    this.bootTime = null
    this.interactionCount = 0
    this.lastInteraction = null
  }

  /**
   * Boot JARVIS — load all modules, start monitoring.
   */
  async boot() {
    console.log('')
    console.log('╔══════════════════════════════════════════════════════════╗')
    console.log('║                    J.A.R.V.I.S.                         ║')
    console.log('║              Booting Digital Civilization                ║')
    console.log('╚══════════════════════════════════════════════════════════╝')
    console.log('')

    const startTime = Date.now()
    this.status = 'booting'

    // Step 1: Hardware
    console.log(`  🖥️  Hardware: ${HW.cpu.model} | ${HW.ram.total}GB RAM | GPU: ${HW.gpu.available ? HW.gpu.name : 'NONE'}`)
    console.log(`  ⚡ Tier: ${PROFILE.tier} | Threads: ${PROFILE.ollama.numThreads}`)
    console.log('')

    // Step 2: Load modules
    console.log('  📦 Loading modules...')
    const regStats = await registry.loadAll()
    console.log(`     ✅ Loaded: ${regStats.loaded} | ⚠️ Failed: ${regStats.failed} | ⏭️ Skipped: ${regStats.skipped}`)
    console.log('')

    // Step 3: Start event bus
    console.log('  🔌 Event bus: ACTIVE')
    console.log('')

    // Step 4: Start health monitor
    healthMonitor.start()
    console.log('  🏥 Health monitor: ACTIVE')
    console.log('')

    // Step 5: Register event handlers
    this._registerHandlers()
    console.log('  🎯 Event handlers: REGISTERED')
    console.log('')

    this.status = 'online'
    this.bootTime = Date.now() - startTime

    console.log(`  🚀 JARVIS ONLINE in ${this.bootTime}ms`)
    console.log('')

    await eventBus.emit(EVENTS.SYSTEM_STARTUP, {
      bootTime: this.bootTime,
      modules: regStats.loaded,
      hardware: HW,
    })

    return {
      ok: true,
      bootTime: this.bootTime,
      modules: regStats,
      hardware: HW,
      profile: PROFILE,
    }
  }

  /**
   * Register core event handlers.
   */
  _registerHandlers() {
    // Track interactions
    eventBus.on(EVENTS.USER_MESSAGE, (data) => {
      this.interactionCount++
      this.lastInteraction = new Date().toISOString()
    }, { module: 'brain' })

    // Log errors
    eventBus.on(EVENTS.AI_ERROR, (data) => {
      console.error(`[brain] AI Error: ${data.error}`)
    }, { module: 'brain' })

    // Log task completions
    eventBus.on(EVENTS.TASK_COMPLETED, (data) => {
      console.log(`[brain] Task completed: ${data.taskId} (${data.duration}ms)`)
    }, { module: 'brain' })

    // Handle system alerts
    eventBus.on(EVENTS.SYSTEM_ALERT, (data) => {
      console.warn(`[brain] ALERT: ${data.message}`)
    }, { module: 'brain' })
  }

  /**
   * Process a user message — the main entry point.
   */
  async processMessage(message, context = {}) {
    this.interactionCount++
    this.lastInteraction = new Date().toISOString()

    await eventBus.emit(EVENTS.USER_MESSAGE, { message, context })

    try {
      // Execute through the executor
      const result = await executor.execute(message, { context })
      return result
    } catch (err) {
      await eventBus.emit(EVENTS.AI_ERROR, { error: err.message })
      return { ok: false, error: err.message }
    }
  }

  /**
   * Get brain status.
   */
  getStatus() {
    return {
      status: this.status,
      bootTime: this.bootTime,
      uptime: this.bootTime ? Date.now() - (Date.now() - this.bootTime) : 0,
      interactions: this.interactionCount,
      lastInteraction: this.lastInteraction,
      modules: registry.getStats(),
      executor: executor.getStats(),
      health: healthMonitor.getSummary(),
      eventBus: eventBus.getStats(),
      hardware: {
        cpu: HW.cpu.model,
        ram: `${HW.ram.total}GB`,
        gpu: HW.gpu.available ? HW.gpu.name : 'NONE',
        tier: PROFILE.tier,
      },
    }
  }

  /**
   * Shutdown gracefully.
   */
  async shutdown() {
    console.log('[brain] Shutting down...')
    this.status = 'shutting_down'
    healthMonitor.stop()
    await eventBus.emit(EVENTS.SYSTEM_SHUTDOWN, {})
    this.status = 'offline'
    console.log('[brain] Shutdown complete.')
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const brain = new Brain()

export { brain, Brain }
export default brain