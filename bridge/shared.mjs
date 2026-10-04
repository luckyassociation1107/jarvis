/**
 * JARVIS Shared Infrastructure — logger, config, cache, error handler.
 * ONE module that all other modules use instead of duplicating logic.
 */

import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

/* ═══════════════════════════════════════════════════════════
 *  LOGGER — centralized logging
 * ═══════════════════════════════════════════════════════════ */

class Logger {
  constructor() {
    this.logs = []
    this.maxLogs = 2000
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 }
    this.minLevel = 'info'
  }

  _log(level, module, message, data = null) {
    if (this.levels[level] < this.levels[this.minLevel]) return

    const entry = {
      level,
      module,
      message,
      data: data ? JSON.stringify(data).slice(0, 500) : null,
      timestamp: new Date().toISOString(),
    }

    this.logs.push(entry)
    if (this.logs.length > this.maxLogs) this.logs.shift()

    // Console output for errors
    if (level === 'error') {
      console.error(`[${module}] ERROR: ${message}`)
    }

    return entry
  }

  debug(module, message, data) { return this._log('debug', module, message, data) }
  info(module, message, data) { return this._log('info', module, message, data) }
  warn(module, message, data) { return this._log('warn', module, message, data) }
  error(module, message, data) { return this._log('error', module, message, data) }

  getLogs({ level = null, module = null, limit = 50 } = {}) {
    let filtered = this.logs
    if (level) filtered = filtered.filter((l) => l.level === level)
    if (module) filtered = filtered.filter((l) => l.module === module)
    return filtered.slice(-limit)
  }

  getStats() {
    const byLevel = {}
    for (const l of this.logs) {
      byLevel[l.level] = (byLevel[l.level] || 0) + 1
    }
    return { total: this.logs.length, byLevel }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  CONFIG — centralized configuration
 * ═══════════════════════════════════════════════════════════ */

class Config {
  constructor() {
    this.config = new Map()
    this.defaults = new Map()
    this._loadDefaults()
  }

  _loadDefaults() {
    // LLM settings
    this.set('llm.model', 'dolphin3:8b', 'default LLM model')
    this.set('llm.temperature', 0.6, 'LLM temperature')
    this.set('llm.maxTokens', 1000, 'default max tokens')

    // Performance
    this.set('cache.maxSize', 200, 'default cache size')
    this.set('cache.ttl', 300000, 'cache TTL in ms (5 min)')
    this.set('rateLimit.maxPerMinute', 60, 'max requests per minute')

    // Voice
    this.set('voice.defaultProfile', null, 'default voice profile')
    this.set('voice.defaultLanguage', 'en', 'default language')

    // UI
    this.set('ui.theme', 'dark', 'UI theme')
    this.set('ui.language', 'en', 'UI language')

    // System
    this.set('system.debug', false, 'debug mode')
    this.set('system.logLevel', 'info', 'log level')
  }

  set(key, value, description = '') {
    this.config.set(key, { value, description, updatedAt: new Date().toISOString() })
  }

  get(key, fallback = null) {
    const entry = this.config.get(key)
    return entry ? entry.value : fallback
  }

  has(key) {
    return this.config.has(key)
  }

  getAll() {
    const result = {}
    for (const [key, entry] of this.config) {
      result[key] = entry.value
    }
    return result
  }
}

/* ═══════════════════════════════════════════════════════════
 *  CACHE — shared LRU cache with TTL
 * ═══════════════════════════════════════════════════════════ */

class SharedCache {
  constructor(maxSize = 200, ttl = 300000) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.defaultTTL = ttl
    this.hits = 0
    this.misses = 0
  }

  get(key) {
    const entry = this.cache.get(key)
    if (!entry) { this.misses++; return null }

    if (Date.now() - entry.createdAt > entry.ttl) {
      this.cache.delete(key)
      this.misses++
      return null
    }

    // Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, entry)
    this.hits++
    return entry.value
  }

  set(key, value, ttl = null) {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      this.cache.delete(oldest)
    }

    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      ttl: ttl || this.defaultTTL,
    })
  }

  has(key) {
    return this.get(key) !== null
  }

  delete(key) {
    return this.cache.delete(key)
  }

  clear() {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  getStats() {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : 'N/A',
    }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  ERROR HANDLER — centralized error handling
 * ═══════════════════════════════════════════════════════════ */

class ErrorHandler {
  constructor() {
    this.errors = []
    this.maxErrors = 500
  }

  handle(module, error, { context = '', recoverable = true } = {}) {
    const entry = {
      module,
      message: error?.message || String(error),
      stack: error?.stack?.slice(0, 500) || null,
      context,
      recoverable,
      timestamp: new Date().toISOString(),
    }

    this.errors.push(entry)
    if (this.errors.length > this.maxErrors) this.errors.shift()

    logger.error(module, entry.message, { context, recoverable })

    return entry
  }

  getErrors({ module = null, limit = 20 } = {}) {
    let filtered = this.errors
    if (module) filtered = filtered.filter((e) => e.module === module)
    return filtered.slice(-limit)
  }

  getStats() {
    return {
      total: this.errors.length,
      recent: this.errors.slice(-5),
    }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  RATE LIMITER — per-module rate limiting
 * ═══════════════════════════════════════════════════════════ */

class RateLimiter {
  constructor() {
    this.limits = new Map()  // module → {count, resetTime}
  }

  check(module, maxPerMinute = 60) {
    const now = Date.now()
    let entry = this.limits.get(module)

    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + 60000 }
      this.limits.set(module, entry)
    }

    entry.count++
    return {
      allowed: entry.count <= maxPerMinute,
      remaining: Math.max(0, maxPerMinute - entry.count),
      resetIn: Math.max(0, entry.resetTime - now),
    }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  LANGUAGE DETECTOR — shared language detection
 * ═══════════════════════════════════════════════════════════ */

class LanguageDetector {
  detect(text) {
    const charRanges = [
      { lang: 'te', regex: /[\u0C00-\u0C7F]/ },
      { lang: 'hi', regex: /[\u0900-\u097F]/ },
      { lang: 'ta', regex: /[\u0B80-\u0BFF]/ },
      { lang: 'kn', regex: /[\u0C80-\u0CFF]/ },
      { lang: 'ml', regex: /[\u0D00-\u0D7F]/ },
      { lang: 'bn', regex: /[\u0980-\u09FF]/ },
      { lang: 'gu', regex: /[\u0A80-\u0AFF]/ },
      { lang: 'pa', regex: /[\u0A00-\u0A7F]/ },
      { lang: 'ur', regex: /[\u0600-\u06FF]/ },
      { lang: 'ar', regex: /[\u0600-\u06FF]/ },
      { lang: 'ja', regex: /[\u3040-\u309F\u30A0-\u30FF]/ },
      { lang: 'ko', regex: /[\uAC00-\uD7AF]/ },
      { lang: 'zh', regex: /[\u4E00-\u9FFF]/ },
      { lang: 'th', regex: /[\u0E00-\u0E7F]/ },
      { lang: 'ru', regex: /[\u0400-\u04FF]/ },
    ]

    for (const { lang, regex } of charRanges) {
      const matches = (text.match(new RegExp(regex.source, 'g')) || []).length
      if (matches / (text.length || 1) > 0.3) return lang
    }

    return 'en'
  }
}

/* ──────────────── Singletons ──────────────────────────── */

const logger = new Logger()
const config = new Config()
const cache = new SharedCache()
const errorHandler = new ErrorHandler()
const rateLimiter = new RateLimiter()
const languageDetector = new LanguageDetector()

export { logger, config, cache, errorHandler, rateLimiter, languageDetector }
export default { logger, config, cache, errorHandler, rateLimiter, languageDetector }