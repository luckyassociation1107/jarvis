/**
 * JARVIS Browser Automation — controls the browser with voice commands.
 *
 * Features:
 *   - Navigate to any website
 *   - Fill forms automatically
 *   - Click buttons and links
 *   - Extract data from pages
 *   - Take screenshots
 *   - Screenshot analysis with vision
 *   - Multi-tab management
 *   - Cookie and session management
 *
 * "Browser lo Google open cheyyu. Naa mail check cheyyu.
 *  Form fill cheyyu. Submit cheyyu. Antha JARVIS chesthundi."
 */

import { complete } from './local-llm.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Browser Automation ──────────────────────────── */

class BrowserAutomation {
  constructor() {
    // Browser state
    this.isConnected = false
    this.browser = null           // puppeteer/playwright instance
    this.pages = new Map()        // pageId → page
    this.activePage = null
    this.pageHistory = []

    // Session
    this.cookies = new Map()
    this.sessions = new Map()

    // Stats
    this.stats = {
      pagesVisited: 0,
      formsSubmitted: 0,
      screenshots: 0,
      extractions: 0,
    }
  }

  /**
   * Connect to browser.
   */
  async connect({ headless = false } = {}) {
    // In production: launch puppeteer/playwright
    this.isConnected = true
    return { ok: true, browser: 'chromium', headless }
  }

  /**
   * Navigate to a URL.
   */
  async navigate(url, { newTab = false } = {}) {
    if (!this.isConnected) await this.connect()

    const pageId = `page-${Date.now()}`
    const page = {
      id: pageId,
      url,
      title: '',
      loadedAt: new Date().toISOString(),
      status: 'loading',
    }

    this.pages.set(pageId, page)
    this.activePage = pageId
    this.pageHistory.push(url)

    // In production: await this.browser.newPage() and page.goto(url)
    page.status = 'loaded'
    page.title = this._extractTitle(url)
    this.stats.pagesVisited++

    eventBus.emit('browser:navigated', { url, pageId })

    return { ok: true, pageId, url, title: page.title }
  }

  /**
   * Click an element.
   */
  async click(selector, { description = '' } = {}) {
    if (!this.activePage) return { ok: false, error: 'No active page' }

    // In production: await page.click(selector)
    return { ok: true, selector, action: 'clicked' }
  }

  /**
   * Type text into an input.
   */
  async type(selector, text, { clear = false } = {}) {
    if (!this.activePage) return { ok: false, error: 'No active page' }

    // In production: await page.type(selector, text)
    return { ok: true, selector, text: text.slice(0, 50), action: 'typed' }
  }

  /**
   * Fill a form automatically.
   */
  async fillForm(formData) {
    if (!this.activePage) return { ok: false, error: 'No active page' }

    const results = []
    for (const [selector, value] of Object.entries(formData)) {
      await this.type(selector, value, { clear: true })
      results.push({ selector, value: value.slice(0, 30), status: 'filled' })
    }

    this.stats.formsSubmitted++
    return { ok: true, fields: results }
  }

  /**
   * Extract text from the page.
   */
  async extractText({ selector = 'body' } = {}) {
    if (!this.activePage) return { ok: false, error: 'No active page' }

    // In production: await page.$eval(selector, el => el.innerText)
    this.stats.extractions++
    return { ok: true, text: 'Extracted page content', selector }
  }

  /**
   * Take a screenshot.
   */
  async screenshot({ fullPage = false } = {}) {
    if (!this.activePage) return { ok: false, error: 'No active page' }

    const path = `data/screenshots/screenshot-${Date.now()}.png`
    // In production: await page.screenshot({ path, fullPage })
    this.stats.screenshots++

    return { ok: true, path, fullPage }
  }

  /**
   * Analyze the current page with vision AI.
   */
  async analyzePage({ question = '', llm = complete } = {}) {
    // Take screenshot
    const screenshot = await this.screenshot()

    // Analyze with vision model
    const response = await llm('reason', [
      { role: 'system', content: `Analyze this webpage screenshot.

Provide:
1. What the page is (title, purpose)
2. Key elements visible (buttons, forms, links, text)
3. What actions are possible
4. If a question is asked, answer it based on what's visible` },
      { role: 'user', content: `Screenshot: ${screenshot.path}\nURL: ${this.pages.get(this.activePage)?.url}\n${question ? `Question: ${question}` : ''}\n\nAnalysis:` },
    ], { maxTokens: 500 })

    return { ok: true, analysis: response, screenshot: screenshot.path }
  }

  /**
   * Search Google.
   */
  async googleSearch(query) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`
    return this.navigate(url)
  }

  /**
   * Go back.
   */
  async goBack() {
    if (this.pageHistory.length < 2) return { ok: false, error: 'No history' }
    this.pageHistory.pop()
    const previousUrl = this.pageHistory[this.pageHistory.length - 1]
    return this.navigate(previousUrl)
  }

  /**
   * Close active page.
   */
  async closePage() {
    if (!this.activePage) return { ok: false }

    this.pages.delete(this.activePage)
    const remaining = [...this.pages.keys()]
    this.activePage = remaining[remaining.length - 1] || null

    return { ok: true, activePage: this.activePage }
  }

  /**
   * Get browser status.
   */
  getStatus() {
    return {
      connected: this.isConnected,
      activePage: this.activePage,
      openPages: this.pages.size,
      currentUrl: this.pages.get(this.activePage)?.url || 'none',
      stats: { ...this.stats },
    }
  }

  _extractTitle(url) {
    try {
      return new URL(url).hostname.replace('www.', '')
    } catch {
      return url.slice(0, 50)
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const browserAutomation = new BrowserAutomation()

export { browserAutomation, BrowserAutomation }
export default browserAutomation