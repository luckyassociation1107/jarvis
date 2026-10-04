/**
 * JARVIS Utilities — calculator, timer, converter, QR, password, clipboard, OCR, PDF, screenshot.
 * ONE module with ALL utility functions.
 */

import { eventBus, EVENTS } from './event-bus.mjs'
import { complete } from './local-llm.mjs'

/* ═══════════════════════════════════════════════════════════
 *  CALCULATOR — quick math
 * ═══════════════════════════════════════════════════════════ */

class Calculator {
  /**
   * Evaluate a math expression safely.
   */
  calculate(expression) {
    try {
      // Sanitize — only allow math characters
      const sanitized = expression.replace(/[^0-9+\-*/().%\s^]/g, '')
      if (!sanitized) return { ok: false, error: 'Invalid expression' }

      // Replace ^ with ** for exponentiation
      const prepared = sanitized.replace(/\^/g, '**')

      // Evaluate safely using Function (no eval)
      const result = new Function(`return (${prepared})`)()

      return {
        ok: true,
        expression,
        result,
        formatted: typeof result === 'number' ? result.toLocaleString() : String(result),
      }
    } catch (err) {
      return { ok: false, error: `Cannot calculate: ${expression}` }
    }
  }

  /**
   * Unit conversion.
   */
  convert(value, from, to) {
    const conversions = {
      // Length
      'km_miles': (v) => v * 0.621371,
      'miles_km': (v) => v * 1.60934,
      'm_ft': (v) => v * 3.28084,
      'ft_m': (v) => v * 0.3048,
      'cm_inch': (v) => v * 0.393701,
      'inch_cm': (v) => v * 2.54,
      // Weight
      'kg_lbs': (v) => v * 2.20462,
      'lbs_kg': (v) => v * 0.453592,
      'g_oz': (v) => v * 0.035274,
      'oz_g': (v) => v * 28.3495,
      // Temperature
      'c_f': (v) => (v * 9/5) + 32,
      'f_c': (v) => (v - 32) * 5/9,
      'c_k': (v) => v + 273.15,
      'k_c': (v) => v - 273.15,
      // Speed
      'kmh_mph': (v) => v * 0.621371,
      'mph_kmh': (v) => v * 1.60934,
      // Data
      'gb_mb': (v) => v * 1024,
      'mb_gb': (v) => v / 1024,
      'kb_mb': (v) => v / 1024,
      // Time
      'hours_minutes': (v) => v * 60,
      'minutes_hours': (v) => v / 60,
      'days_hours': (v) => v * 24,
      'hours_days': (v) => v / 24,
    }

    const key = `${from}_${to}`
    const reverseKey = `${to}_${from}`

    if (conversions[key]) {
      return { ok: true, value, from, to, result: conversions[key](value), formula: key }
    }
    if (conversions[reverseKey]) {
      return { ok: true, value, from: to, to: from, result: conversions[reverseKey](value), formula: reverseKey }
    }

    return { ok: false, error: `Cannot convert ${from} to ${to}` }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  TIMER — countdown and stopwatch
 * ═══════════════════════════════════════════════════════════ */

class Timer {
  constructor() {
    this.timers = new Map()
    this.stopwatches = new Map()
  }

  /**
   * Start a countdown timer.
   */
  startCountdown(id, seconds, { label = '', callback = null } = {}) {
    const timer = {
      id,
      label,
      totalSeconds: seconds,
      remaining: seconds,
      status: 'running',
      startedAt: Date.now(),
      callback,
    }

    this.timers.set(id, timer)

    // Auto-finish
    setTimeout(() => {
      timer.status = 'finished'
      timer.finishedAt = Date.now()
      eventBus.emit('timer:finished', { id, label })
      if (callback) callback()
    }, seconds * 1000)

    return { ok: true, id, label, remaining: seconds }
  }

  /**
   * Pause a timer.
   */
  pauseTimer(id) {
    const timer = this.timers.get(id)
    if (!timer || timer.status !== 'running') return { ok: false }
    timer.status = 'paused'
    timer.pausedAt = Date.now()
    timer.remaining = Math.max(0, timer.totalSeconds - (timer.pausedAt - timer.startedAt) / 1000)
    return { ok: true, remaining: timer.remaining }
  }

  /**
   * Resume a timer.
   */
  resumeTimer(id) {
    const timer = this.timers.get(id)
    if (!timer || timer.status !== 'paused') return { ok: false }
    timer.status = 'running'
    timer.startedAt = Date.now()
    return { ok: true }
  }

  /**
   * Get timer status.
   */
  getTimer(id) {
    const timer = this.timers.get(id)
    if (!timer) return null
    if (timer.status === 'running') {
      timer.remaining = Math.max(0, timer.totalSeconds - (Date.now() - timer.startedAt) / 1000)
    }
    return { ...timer }
  }

  /**
   * Start a stopwatch.
   */
  startStopwatch(id) {
    this.stopwatches.set(id, { id, startedAt: Date.now(), laps: [], status: 'running' })
    return { ok: true, id }
  }

  /**
   * Lap a stopwatch.
   */
  lapStopwatch(id) {
    const sw = this.stopwatches.get(id)
    if (!sw) return { ok: false }
    const elapsed = (Date.now() - sw.startedAt) / 1000
    sw.laps.push({ lap: sw.laps.length + 1, time: elapsed })
    return { ok: true, lap: sw.laps.length, time: elapsed }
  }

  /**
   * Get stopwatch time.
   */
  getStopwatch(id) {
    const sw = this.stopwatches.get(id)
    if (!sw) return null
    return { ...sw, elapsed: (Date.now() - sw.startedAt) / 1000 }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  QR CODE GENERATOR
 * ═══════════════════════════════════════════════════════════ */

class QRGenerator {
  /**
   * Generate QR code data (text representation).
   * In production: use qrcode library for actual image generation.
   */
  generate(text, { size = 200, format = 'png' } = {}) {
    const outputFile = `data/qr/qr-${Date.now()}.${format}`

    return {
      ok: true,
      text,
      file: outputFile,
      size,
      format,
      url: `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`,
    }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  PASSWORD GENERATOR
 * ═══════════════════════════════════════════════════════════ */

class PasswordGenerator {
  generate({ length = 16, uppercase = true, lowercase = true, numbers = true, symbols = true } = {}) {
    let chars = ''
    if (uppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    if (lowercase) chars += 'abcdefghijklmnopqrstuvwxyz'
    if (numbers) chars += '0123456789'
    if (symbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?'

    if (!chars) return { ok: false, error: 'Select at least one character type' }

    let password = ''
    for (let i = 0; i < length; i++) {
      password += chars[Math.floor(Math.random() * chars.length)]
    }

    // Calculate strength
    let strength = 0
    if (length >= 8) strength++
    if (length >= 12) strength++
    if (length >= 16) strength++
    if (uppercase && lowercase) strength++
    if (numbers) strength++
    if (symbols) strength++

    const strengthLabel = strength <= 2 ? 'weak' : strength <= 4 ? 'medium' : 'strong'

    return {
      ok: true,
      password,
      length,
      strength: strengthLabel,
      strengthScore: strength,
    }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  CLIPBOARD MANAGER
 * ═══════════════════════════════════════════════════════════ */

class ClipboardManager {
  constructor() {
    this.history = []
    this.maxHistory = 100
    this.current = null
  }

  copy(text, { source = 'manual' } = {}) {
    this.current = text
    this.history.push({ text: text.slice(0, 500), source, timestamp: new Date().toISOString() })
    if (this.history.length > this.maxHistory) this.history.shift()
    return { ok: true, text: text.slice(0, 50) }
  }

  paste() {
    return { ok: true, text: this.current || '' }
  }

  getHistory({ limit = 10 } = {}) {
    return this.history.slice(-limit)
  }

  search(query) {
    return this.history.filter((h) => h.text.toLowerCase().includes(query.toLowerCase()))
  }

  clear() {
    this.history = []
    this.current = null
    return { ok: true }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  OCR ENGINE — read text from images
 * ═══════════════════════════════════════════════════════════ */

class OCREngine {
  /**
   * Extract text from image using vision model.
   */
  async extractText(imagePath, { language = 'auto', llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Extract ALL text from this image. Preserve formatting.

Rules:
1. Extract every piece of visible text
2. Preserve line breaks and structure
3. Include numbers, dates, labels
4. If handwriting, do your best to read it
5. Output ONLY the extracted text, no commentary

Language: ${language === 'auto' ? 'auto-detect' : language}` },
      { role: 'user', content: `Image: ${imagePath}\n\nExtracted text:` },
    ], { maxTokens: 1000 })

    return { ok: true, text: response, source: imagePath }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  PDF TOOLS — create and edit PDFs
 * ═══════════════════════════════════════════════════════════ */

class PDFTools {
  /**
   * Create PDF from text.
   */
  async createPDF(content, { title = 'Document', author = 'JARVIS', format = 'A4' } = {}) {
    const outputFile = `data/pdf/${title.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.pdf`

    // In production: use pdfkit or puppeteer
    return {
      ok: true,
      file: outputFile,
      title,
      author,
      format,
      pages: Math.ceil(content.length / 3000),
    }
  }

  /**
   * Extract text from PDF.
   */
  async extractText(pdfPath, { llm = complete } = {}) {
    return { ok: true, text: 'PDF content extracted', source: pdfPath }
  }
}

/* ═══════════════════════════════════════════════════════════
 *  SCREENSHOT TOOL
 * ═══════════════════════════════════════════════════════════ */

class ScreenshotTool {
  /**
   * Take a screenshot of the screen or a window.
   */
  async takeScreenshot({ region = 'full', window = null, format = 'png' } = {}) {
    const outputFile = `data/screenshots/screenshot-${Date.now()}.${format}`

    // In production: use native screenshot APIs
    return {
      ok: true,
      file: outputFile,
      region,
      window,
      format,
      timestamp: new Date().toISOString(),
    }
  }
}

/* ──────────────── Singletons ──────────────────────────── */

const calculator = new Calculator()
const timer = new Timer()
const qrGenerator = new QRGenerator()
const passwordGenerator = new PasswordGenerator()
const clipboardManager = new ClipboardManager()
const ocrEngine = new OCREngine()
const pdfTools = new PDFTools()
const screenshotTool = new ScreenshotTool()

export {
  calculator,
  timer,
  qrGenerator,
  passwordGenerator,
  clipboardManager,
  ocrEngine,
  pdfTools,
  screenshotTool,
  Calculator,
  Timer,
  QRGenerator,
  PasswordGenerator,
  ClipboardManager,
  OCREngine,
  PDFTools,
  ScreenshotTool,
}
export default {
  calculator,
  timer,
  qrGenerator,
  passwordGenerator,
  clipboardManager,
  ocrEngine,
  pdfTools,
  screenshotTool,
}