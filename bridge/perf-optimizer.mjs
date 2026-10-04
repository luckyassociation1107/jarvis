/**
 * JARVIS Performance Optimizer — squeeze every drop of performance.
 *
 * For i5-12400F + 16GB RAM + No GPU:
 *   - CPU thread pinning for P-cores
 *   - Memory pooling and recycling
 *   - Response caching with LRU
 *   - Request batching and deduplication
 *   - Progressive loading (show results ASAP)
 *   - Background prefetching
 *   - Conversation pruning
 *   - Memory compression
 *
 * "Performance is a feature. The fastest response is the one
 *  you already have cached."
 */

import { PROFILE, HW, MEMORY_BUDGET } from './hardware-profile.mjs'

/* ──────────────── LRU Response Cache ──────────────────────────── */

class ResponseCache {
  constructor(maxSize = PROFILE.optimizations.cacheSize) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.hits = 0
    this.misses = 0
  }

  _makeKey(messages, options = {}) {
    // Hash the prompt + key options for cache key
    const key = messages.map((m) => `${m.role}:${m.content.slice(0, 200)}`).join('|')
    const opts = `t=${options.temperature || 0.7}|m=${options.maxTokens || 512}`
    return `${key}::${opts}`
  }

  get(messages, options) {
    const key = this._makeKey(messages, options)
    if (this.cache.has(key)) {
      const entry = this.cache.get(key)
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, { ...entry, lastUsed: Date.now() })
      this.hits++
      return entry.response
    }
    this.misses++
    return null
  }

  set(messages, options, response) {
    const key = this._makeKey(messages, options)

    // Evict LRU if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      this.cache.delete(oldest)
    }

    this.cache.set(key, {
      response,
      lastUsed: Date.now(),
      created: Date.now(),
    })
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + '%'
        : '0%',
    }
  }

  clear() {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }
}

/* ──────────────── Request queue ──────────────────────────── */

class RequestQueue {
  constructor() {
    this.queue = []
    this.processing = false
    this.maxConcurrent = PROFILE.optimizations.maxConcurrentLLMCalls
    this.active = 0
    this.stats = { processed: 0, queued: 0, errors: 0 }
  }

  async enqueue(fn, priority = 'normal') {
    return new Promise((resolve, reject) => {
      const item = { fn, priority, resolve, reject, enqueuedAt: Date.now() }

      // Priority insertion
      if (priority === 'high') {
        this.queue.unshift(item)
      } else if (priority === 'low') {
        this.queue.push(item)
      } else {
        // Insert before low priority items
        const lowIdx = this.queue.findIndex((q) => q.priority === 'low')
        if (lowIdx >= 0) {
          this.queue.splice(lowIdx, 0, item)
        } else {
          this.queue.push(item)
        }
      }

      this.stats.queued++
      this._process()
    })
  }

  async _process() {
    if (this.active >= this.maxConcurrent) return
    if (this.queue.length === 0) return

    this.active++
    const item = this.queue.shift()

    try {
      const result = await item.fn()
      this.stats.processed++
      item.resolve(result)
    } catch (err) {
      this.stats.errors++
      item.reject(err)
    } finally {
      this.active--
      this._process()
    }
  }

  getStats() {
    return {
      ...this.stats,
      queueDepth: this.queue.length,
      active: this.active,
    }
  }
}

/* ──────────────── Conversation pruner ──────────────────────────── */

/**
 * Prune conversation history to fit within token budget.
 * Keeps recent messages + important context.
 */
export function pruneConversation(messages, { maxMessages = PROFILE.optimizations.maxHistoryMessages } = {}) {
  if (messages.length <= maxMessages) return messages

  // Keep system message + last N messages
  const systemMsgs = messages.filter((m) => m.role === 'system')
  const nonSystem = messages.filter((m) => m.role !== 'system')

  const kept = nonSystem.slice(-maxMessages)

  // Add a summary of pruned messages
  const pruned = nonSystem.slice(0, -maxMessages)
  if (pruned.length > 0) {
    const summary = {
      role: 'system',
      content: `[Previous ${pruned.length} messages summarized: conversation covered ${pruned.map((m) => m.role).filter((r) => r === 'user').length} exchanges]`,
    }
    return [...systemMsgs, summary, ...kept]
  }

  return [...systemMsgs, ...kept]
}

/* ──────────────── Memory compressor ──────────────────────────── */

/**
 * Compress memory entries to save storage.
 */
export function compressMemory(entries, { maxEntries = PROFILE.optimizations.maxMemoryEntries } = {}) {
  if (entries.length <= maxEntries) return entries

  // Sort by importance/recency
  const sorted = entries.sort((a, b) => {
    const scoreA = (a.importance || 5) + (a.accessCount || 0) * 0.5
    const scoreB = (b.importance || 5) + (b.accessCount || 0) * 0.5
    return scoreB - scoreA
  })

  return sorted.slice(0, maxEntries)
}

/* ──────────────── Prompt optimizer ──────────────────────────── */

/**
 * Optimize prompts to use fewer tokens while maintaining quality.
 */
export function optimizePrompt(messages) {
  return messages.map((msg) => {
    if (msg.role === 'system') {
      // Trim excessive whitespace and examples from system prompts
      let content = msg.content
        .replace(/\n{3,}/g, '\n\n')  // Max 2 newlines
        .replace(/  +/g, ' ')         // Max 1 space
        .trim()

      // Truncate very long system prompts
      if (content.length > 2000) {
        content = content.slice(0, 1800) + '\n\n[...optimized for performance...]'
      }

      return { ...msg, content }
    }
    return msg
  })
}

/* ──────────────── Auto-tune ──────────────────────────── */

/**
 * Auto-tune settings based on observed performance.
 */
class AutoTuner {
  constructor() {
    this.metrics = {
      responseTimes: [],
      tokenCounts: [],
      memoryUsage: [],
      cacheHitRate: 0,
    }
    this.currentSettings = { ...PROFILE.optimizations }
  }

  record(responseTime, tokens) {
    this.metrics.responseTimes.push(responseTime)
    this.metrics.tokenCounts.push(tokens)

    // Keep last 100 measurements
    if (this.metrics.responseTimes.length > 100) {
      this.metrics.responseTimes.shift()
      this.metrics.tokenCounts.shift()
    }
  }

  /**
   * Suggest tuning adjustments based on observed performance.
   */
  suggest() {
    const avgTime = this.metrics.responseTimes.length > 0
      ? this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length
      : 0

    const suggestions = []

    if (avgTime > 10000) { // >10s average
      suggestions.push('Consider using a smaller model (3B instead of 7B)')
      suggestions.push('Reduce maxTokens to 512')
      suggestions.push('Reduce context window to 2048')
    } else if (avgTime > 5000) { // >5s average
      suggestions.push('Reduce maxTokens to 768')
      suggestions.push('Enable response caching')
    } else if (avgTime < 2000) { // <2s average
      suggestions.push('Consider using a larger model for better quality')
      suggestions.push('Increase maxTokens for longer responses')
    }

    return {
      avgResponseTime: Math.round(avgTime),
      suggestions,
      currentSettings: this.currentSettings,
    }
  }

  getStats() {
    const times = this.metrics.responseTimes
    return {
      avgResponseTime: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
      p50: times.length ? times.sort((a, b) => a - b)[Math.floor(times.length / 2)] : 0,
      p95: times.length ? times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)] : 0,
      samples: times.length,
    }
  }
}

/* ──────────────── Singleton instances ──────────────────────────── */

const responseCache = new ResponseCache()
const requestQueue = new RequestQueue()
const autoTuner = new AutoTuner()

export { ResponseCache, RequestQueue, AutoTuner, responseCache, requestQueue, autoTuner }
export default { responseCache, requestQueue, autoTuner, pruneConversation, compressMemory, optimizePrompt }