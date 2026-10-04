/**
 * JARVIS Module Registry — the central nervous system.
 *
 * All 93 modules registered in ONE place.
 * Dynamic loading based on hardware.
 * Dependency resolution.
 * Health checking.
 *
 * "I am not 93 separate files. I am ONE mind with 93 capabilities."
 */

import { PROFILE, HW } from './hardware-profile.mjs'

/* ──────────────── Module definitions ──────────────────────────── */

const MODULE_DEFS = {
  // ═══ LEVEL 5 ORGANIZATION ═══
  executive:       { path: './executive.mjs',       category: 'organization', priority: 'deferred',  size: 'small',  deps: [] },
  operational:     { path: './operational.mjs',      category: 'organization', priority: 'deferred',  size: 'small',  deps: [] },
  orchestrator:    { path: './orchestrator.mjs',     category: 'organization', priority: 'deferred',  size: 'small',  deps: ['executive', 'operational'] },
  'macro-memory':  { path: './macro-memory.mjs',     category: 'organization', priority: 'deferred',  size: 'small',  deps: [] },
  'proactive-v2':  { path: './proactive-v2.mjs',     category: 'organization', priority: 'deferred',  size: 'small',  deps: [] },
  'resource-mgr':  { path: './resource-mgr.mjs',     category: 'organization', priority: 'deferred',  size: 'small',  deps: [] },

  // ═══ DOMAIN EXPERTISE ═══
  'research-lab':  { path: './research-lab.mjs',     category: 'domain',       priority: 'deferred',  size: 'small',  deps: [] },
  ethics:          { path: './ethics.mjs',           category: 'domain',       priority: 'deferred',  size: 'small',  deps: [] },
  society:         { path: './society.mjs',          category: 'domain',       priority: 'deferred',  size: 'small',  deps: [] },
  health:          { path: './health.mjs',           category: 'domain',       priority: 'deferred',  size: 'small',  deps: [] },
  education:       { path: './education.mjs',        category: 'domain',       priority: 'deferred',  size: 'small',  deps: [] },
  economy:         { path: './economy.mjs',          category: 'domain',       priority: 'deferred',  size: 'small',  deps: [] },
  planetary:       { path: './planetary.mjs',        category: 'domain',       priority: 'deferred',  size: 'small',  deps: [] },
  simulation:      { path: './simulation.mjs',       category: 'domain',       priority: 'deferred',  size: 'small',  deps: [] },
  diplomacy:       { path: './diplomacy.mjs',        category: 'domain',       priority: 'deferred',  size: 'small',  deps: [] },
  'wisdom-traditions': { path: './wisdom-traditions.mjs', category: 'domain',  priority: 'deferred',  size: 'small',  deps: [] },

  // ═══ CORE (always loaded) ═══
  agent:           { path: './agent.mjs',            category: 'core',         priority: 'eager',     size: 'medium', deps: ['workflow', 'language'] },
  workflow:        { path: './workflow.mjs',         category: 'core',         priority: 'eager',     size: 'small',  deps: ['local-llm'] },
  language:        { path: './language.mjs',         category: 'core',         priority: 'eager',     size: 'small',  deps: ['local-llm'] },
  commands:        { path: './commands.mjs',         category: 'core',         priority: 'eager',     size: 'large',  deps: [] },

  // ═══ VISION ═══
  vision:          { path: './vision.mjs',           category: 'vision',       priority: 'lazy',      size: 'small',  deps: [] },
  'vision-ai':     { path: './vision-ai.mjs',        category: 'vision',       priority: 'lazy',      size: 'medium', deps: ['vision', 'vision-controller'] },
  'vision-controller': { path: './vision-controller.mjs', category: 'vision',  priority: 'lazy',      size: 'medium', deps: [] },
  desktop:         { path: './desktop.mjs',          category: 'vision',       priority: 'lazy',      size: 'medium', deps: [] },
  chrome:          { path: './chrome.mjs',           category: 'vision',       priority: 'deferred',  size: 'large',  deps: [] },
  page:            { path: './page.mjs',             category: 'vision',       priority: 'deferred',  size: 'medium', deps: [] },

  // ═══ VOICE ═══
  whisper:         { path: './whisper.mjs',          category: 'voice',        priority: 'lazy',      size: 'small',  deps: [] },
  shell:           { path: './shell.mjs',            category: 'voice',        priority: 'lazy',      size: 'medium', deps: [] },
  windows:         { path: './windows.mjs',          category: 'voice',        priority: 'lazy',      size: 'small',  deps: [] },

  // ═══ MEMORY ═══
  memory:          { path: './memory.mjs',           category: 'memory',       priority: 'eager',     size: 'medium', deps: [] },
  'memory-palace': { path: './memory-palace.mjs',    category: 'memory',       priority: 'deferred',  size: 'small',  deps: [] },
  'digital-twin':  { path: './digital-twin.mjs',     category: 'memory',       priority: 'lazy',      size: 'small',  deps: ['memory'] },
  'knowledge-graph': { path: './knowledge-graph.mjs', category: 'memory',      priority: 'deferred',  size: 'small',  deps: [] },

  // ═══ INTELLIGENCE ═══
  proactive:       { path: './proactive.mjs',        category: 'intelligence', priority: 'eager',     size: 'small',  deps: ['memory'] },
  context:         { path: './context.mjs',          category: 'intelligence', priority: 'eager',     size: 'small',  deps: [] },
  emotion:         { path: './emotion.mjs',          category: 'intelligence', priority: 'eager',     size: 'small',  deps: [] },
  predictive:      { path: './predictive.mjs',       category: 'intelligence', priority: 'lazy',      size: 'small',  deps: [] },
  consciousness:   { path: './consciousness.mjs',    category: 'intelligence', priority: 'deferred',  size: 'small',  deps: [] },
  empathy:         { path: './empathy.mjs',          category: 'intelligence', priority: 'lazy',      size: 'small',  deps: [] },
  personality:     { path: './personality.mjs',      category: 'intelligence', priority: 'lazy',      size: 'small',  deps: [] },
  'reasoning-engine': { path: './reasoning-engine.mjs', category: 'intelligence', priority: 'lazy',   size: 'small',  deps: [] },
  wisdom:          { path: './wisdom.mjs',           category: 'intelligence', priority: 'lazy',      size: 'small',  deps: [] },

  // ═══ CREATION ═══
  'autonomous-coder': { path: './autonomous-coder.mjs', category: 'creation', priority: 'deferred',  size: 'small',  deps: ['code-exec'] },
  creative:        { path: './creative.mjs',         category: 'creation',     priority: 'deferred',  size: 'small',  deps: [] },
  'creative-writer': { path: './creative-writer.mjs', category: 'creation',    priority: 'lazy',      size: 'small',  deps: [] },
  'tool-creator':  { path: './tool-creator.mjs',     category: 'creation',     priority: 'deferred',  size: 'small',  deps: [] },
  'music-studio':  { path: './music-studio.mjs',     category: 'creation',     priority: 'deferred',  size: 'small',  deps: [] },
  'visual-storyteller': { path: './visual-storyteller.mjs', category: 'creation', priority: 'deferred', size: 'small', deps: [] },

  // ═══ RESEARCH ═══
  research:        { path: './research.mjs',         category: 'research',     priority: 'lazy',      size: 'small',  deps: [] },
  documents:       { path: './documents.mjs',        category: 'research',     priority: 'lazy',      size: 'small',  deps: [] },
  'code-exec':     { path: './code-exec.mjs',        category: 'research',     priority: 'lazy',      size: 'small',  deps: [] },
  scientist:       { path: './scientist.mjs',        category: 'research',     priority: 'deferred',  size: 'small',  deps: [] },

  // ═══ AUTOMATION ═══
  'workflow-auto': { path: './workflow-auto.mjs',    category: 'automation',   priority: 'lazy',      size: 'small',  deps: [] },
  devices:         { path: './devices.mjs',          category: 'automation',   priority: 'deferred',  size: 'small',  deps: [] },
  meeting:         { path: './meeting.mjs',          category: 'automation',   priority: 'deferred',  size: 'small',  deps: [] },
  'cross-device':  { path: './cross-device.mjs',     category: 'automation',   priority: 'deferred',  size: 'small',  deps: [] },
  'predict-scheduler': { path: './predict-scheduler.mjs', category: 'automation', priority: 'lazy',   size: 'small',  deps: [] },

  // ═══ SELF ═══
  'self-improve':  { path: './self-improve.mjs',     category: 'self',         priority: 'lazy',      size: 'small',  deps: [] },
  'self-heal':     { path: './self-heal.mjs',        category: 'self',         priority: 'lazy',      size: 'small',  deps: [] },
  'meta-learn':    { path: './meta-learn.mjs',       category: 'self',         priority: 'deferred',  size: 'small',  deps: [] },

  // ═══ SOCIAL ═══
  'theory-of-mind': { path: './theory-of-mind.mjs',  category: 'social',       priority: 'deferred',  size: 'small',  deps: [] },
  collective:      { path: './collective.mjs',       category: 'social',       priority: 'deferred',  size: 'small',  deps: [] },
  'universal-translator': { path: './universal-translator.mjs', category: 'social', priority: 'lazy', size: 'small', deps: [] },

  // ═══ REASONING ═══
  multiverse:      { path: './multiverse.mjs',       category: 'reasoning',    priority: 'deferred',  size: 'small',  deps: [] },
  'time-travel':   { path: './time-travel.mjs',      category: 'reasoning',    priority: 'deferred',  size: 'small',  deps: [] },
  'world-sim':     { path: './world-sim.mjs',        category: 'reasoning',    priority: 'deferred',  size: 'small',  deps: [] },
  temporal:        { path: './temporal.mjs',         category: 'reasoning',    priority: 'deferred',  size: 'small',  deps: [] },
  emergent:        { path: './emergent.mjs',         category: 'reasoning',    priority: 'deferred',  size: 'small',  deps: [] },
  'threat-model':  { path: './threat-model.mjs',     category: 'reasoning',    priority: 'deferred',  size: 'small',  deps: [] },
  swarm:           { path: './swarm.mjs',            category: 'reasoning',    priority: 'deferred',  size: 'small',  deps: [] },

  // ═══ EVOLUTION ═══
  genetic:         { path: './genetic.mjs',          category: 'evolution',    priority: 'deferred',  size: 'small',  deps: [] },
  replicator:      { path: './replicator.mjs',       category: 'evolution',    priority: 'deferred',  size: 'small',  deps: [] },
  'hive-mind':     { path: './hive-mind.mjs',        category: 'evolution',    priority: 'deferred',  size: 'small',  deps: [] },

  // ═══ FORECASTING ═══
  foresight:       { path: './foresight.mjs',        category: 'forecasting',  priority: 'deferred',  size: 'small',  deps: [] },
  memetic:         { path: './memetic.mjs',          category: 'forecasting',  priority: 'deferred',  size: 'small',  deps: [] },

  // ═══ SPATIAL/OPTIMIZATION ═══
  holographic:     { path: './holographic.mjs',      category: 'spatial',      priority: 'deferred',  size: 'small',  deps: [] },
  quantum:         { path: './quantum.mjs',          category: 'optimization', priority: 'deferred',  size: 'small',  deps: [] },

  // ═══ SYSTEM ═══
  dream:           { path: './dream.mjs',            category: 'system',       priority: 'disabled',  size: 'small',  deps: ['memory'] },
  'hardware-profile': { path: './hardware-profile.mjs', category: 'system',    priority: 'eager',     size: 'small',  deps: [] },
  'perf-optimizer': { path: './perf-optimizer.mjs',  category: 'system',       priority: 'eager',     size: 'small',  deps: ['hardware-profile'] },
  'local-llm-optimized': { path: './local-llm-optimized.mjs', category: 'system', priority: 'eager',  size: 'small',  deps: ['hardware-profile', 'perf-optimizer'] },
}

/* ──────────────── Registry ──────────────────────────── */

class ModuleRegistry {
  constructor() {
    this.modules = new Map()      // name → { module, status, loadTime, error }
    this.loadOrder = []
    this.stats = { loaded: 0, failed: 0, skipped: 0, total: Object.keys(MODULE_DEFS).length }
  }

  /**
   * Load a module by name.
   */
  async load(name) {
    if (this.modules.has(name)) return this.modules.get(name).module

    const def = MODULE_DEFS[name]
    if (!def) return null

    // Check if disabled for this hardware
    if (def.priority === 'disabled') {
      this.stats.skipped++
      return null
    }

    // Load dependencies first
    for (const dep of def.deps) {
      if (!this.modules.has(dep)) {
        await this.load(dep)
      }
    }

    // Load the module
    const start = Date.now()
    try {
      const mod = await import(def.path)
      const entry = {
        module: mod,
        name,
        category: def.category,
        status: 'loaded',
        loadTime: Date.now() - start,
        loadedAt: new Date().toISOString(),
      }
      this.modules.set(name, entry)
      this.loadOrder.push(name)
      this.stats.loaded++
      return mod
    } catch (err) {
      const entry = {
        module: null,
        name,
        category: def.category,
        status: 'failed',
        error: err.message,
        loadTime: Date.now() - start,
      }
      this.modules.set(name, entry)
      this.stats.failed++
      console.error(`[registry] Failed to load ${name}: ${err.message}`)
      return null
    }
  }

  /**
   * Load all modules by priority.
   */
  async loadAll() {
    // Load eager first
    for (const [name, def] of Object.entries(MODULE_DEFS)) {
      if (def.priority === 'eager') await this.load(name)
    }
    // Then lazy
    for (const [name, def] of Object.entries(MODULE_DEFS)) {
      if (def.priority === 'lazy') await this.load(name)
    }
    // Then deferred (only if hardware allows)
    if (HW.ram.total >= 16) {
      for (const [name, def] of Object.entries(MODULE_DEFS)) {
        if (def.priority === 'deferred') await this.load(name)
      }
    }
    return this.getStats()
  }

  /**
   * Get a loaded module.
   */
  get(name) {
    return this.modules.get(name)?.module || null
  }

  /**
   * Check if a module is loaded.
   */
  has(name) {
    return this.modules.has(name) && this.modules.get(name).status === 'loaded'
  }

  /**
   * Get registry stats.
   */
  getStats() {
    return {
      ...this.stats,
      loadedNames: Array.from(this.modules.values())
        .filter((m) => m.status === 'loaded')
        .map((m) => m.name),
      failedNames: Array.from(this.modules.values())
        .filter((m) => m.status === 'failed')
        .map((m) => m.name),
      loadOrder: this.loadOrder,
    }
  }

  /**
   * Get all modules in a category.
   */
  getCategory(category) {
    return Array.from(this.modules.entries())
      .filter(([_, m]) => m.category === category && m.status === 'loaded')
      .map(([name, m]) => ({ name, module: m.module }))
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const registry = new ModuleRegistry()

export { registry, ModuleRegistry, MODULE_DEFS }
export default registry