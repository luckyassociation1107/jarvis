/**
 * JARVIS Voice Replica — LOW LATENCY digital twin.
 *
 * Pre-learned style in memory. Fast model for replies.
 * Streaming text generation — starts sending before full response.
 * Parallel processing — text + voice params simultaneously.
 *
 * LATENCY TARGETS:
 *   Style lookup:       <1ms  (in-memory)
 *   Reply generation:   <500ms (fast model, streaming)
 *   Voice params:       <5ms  (pre-computed)
 *   Total:              <800ms (message → reply ready)
 */

import { voiceCloneEngine } from './voice-clone.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

/* ──────────────── Constants ──────────────────────────── */

const REPLICA_DIR = join(process.cwd(), 'data', 'replica')
const STYLE_FILE = join(REPLICA_DIR, 'messaging-style.json')
const CONVERSATIONS_DIR = join(REPLICA_DIR, 'conversations')
const REPLY_CACHE_MAX = 200

/* ──────────────── Reply Cache ──────────────────────────── */

class ReplyCache {
  constructor(maxSize = REPLY_CACHE_MAX) {
    this.cache = new Map()  // key → {reply, timestamp}
    this.maxSize = maxSize
  }

  get(contact, messageHash) {
    const key = `${contact}:${messageHash}`
    const entry = this.cache.get(key)
    if (entry && Date.now() - entry.timestamp < 600000) { // 10 min TTL
      return entry.reply
    }
    this.cache.delete(key)
    return null
  }

  set(contact, messageHash, reply) {
    const key = `${contact}:${messageHash}`
    this.cache.set(key, { reply, timestamp: Date.now() })
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value
      this.cache.delete(oldest)
    }
  }

  invalidate(contact) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${contact}:`)) this.cache.delete(key)
    }
  }
}

/* ──────────────── Voice Replica (Low Latency) ──────────────────────────── */

class VoiceReplica {
  constructor() {
    // In-memory — zero disk I/O on hot path
    this.messagingStyle = null
    this.conversations = new Map()    // contact → [messages]
    this.contacts = new Map()         // name → contact info
    this.replyCache = new ReplyCache()

    // Pre-computed style fragments — instant assembly
    this.styleFragments = {
      greetings: [],
      signoffs: [],
      emojis: { frequent: [], occasional: [] },
      vocabulary: [],
      slang: [],
    }

    // Reply templates — pre-computed for common patterns
    this.replyTemplates = new Map()  // pattern → template

    this.ready = false
    this._initPromise = null
  }

  /**
   * Initialize — load everything into memory at startup.
   */
  async init() {
    if (this.ready) return
    if (this._initPromise) return this._initPromise

    this._initPromise = this._doInit()
    return this._initPromise
  }

  async _doInit() {
    try {
      if (!existsSync(REPLICA_DIR)) await mkdir(REPLICA_DIR, { recursive: true })
      if (!existsSync(CONVERSATIONS_DIR)) await mkdir(CONVERSATIONS_DIR, { recursive: true })

      if (existsSync(STYLE_FILE)) {
        this.messagingStyle = JSON.parse(await readFile(STYLE_FILE, 'utf-8'))
        this._precomputeStyleFragments()
      }

      this.ready = true
    } catch {
      this.ready = true
    }
  }

  /**
   * Pre-compute style fragments for instant reply assembly.
   */
  _precomputeStyleFragments() {
    if (!this.messagingStyle) return

    const s = this.messagingStyle
    this.styleFragments = {
      greetings: s.greeting_patterns || ['hey', 'yo'],
      signoffs: s.signoff_patterns || ['bye', 'tc'],
      emojis: s.emojis || { frequent: ['😂'], occasional: [] },
      vocabulary: s.vocabulary || [],
      slang: (s.vocabulary || []).filter((w) => w.length <= 4),
      sentenceStyle: s.sentence_style || 'short',
      tone: s.tone || 'casual',
      languageMix: s.language_mix || 'English',
      typicalLength: s.typical_length || '1-2 sentences',
      uniqueTraits: s.unique_traits || '',
    }
  }

  /**
   * Learn messaging style from past conversations.
   */
  async learnStyle(messages, { contactName = 'general' } = {}) {
    await this.init()

    const myMessages = messages.filter((m) => m.sender === 'me')
    if (myMessages.length < 5) {
      return { ok: false, error: 'Need at least 5 messages to learn style' }
    }

    // Fast style extraction — no LLM call for basic patterns
    const style = this._extractStyleFast(myMessages)

    this.messagingStyle = {
      ...style,
      learnedFrom: myMessages.length,
      contactName,
      learnedAt: new Date().toISOString(),
    }

    this._precomputeStyleFragments()

    // Persist async — non-blocking
    writeFile(STYLE_FILE, JSON.stringify(this.messagingStyle, null, 2)).catch(() => {})

    return { ok: true, style: this.messagingStyle }
  }

  /**
   * Fast style extraction — O(n), no LLM call.
   * Analyzes message patterns directly.
   */
  _extractStyleFast(messages) {
    const wordFreq = {}
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu
    const allEmojis = []
    let totalLength = 0
    let teluguCount = 0
    let englishCount = 0
    const greetings = []
    const signoffs = []
    const slangWords = []

    for (const msg of messages) {
      const text = msg.text || ''
      totalLength += text.length

      // Word frequency
      const words = text.toLowerCase().split(/\s+/)
      for (const w of words) {
        if (w.length > 2) wordFreq[w] = (wordFreq[w] || 0) + 1
      }

      // Emojis
      const emojis = text.match(emojiRegex) || []
      allEmojis.push(...emojis)

      // Language detection
      const teluguChars = (text.match(/[\u0C00-\u0C7F]/g) || []).length
      const englishChars = (text.match(/[a-zA-Z]/g) || []).length
      teluguCount += teluguChars
      englishCount += englishChars

      // Greetings (first message patterns)
      if (messages.indexOf(msg) < 3) {
        greetings.push(words[0])
      }

      // Short words as slang
      for (const w of words) {
        if (w.length <= 3 && w.length > 1 && !['the', 'and', 'for', 'you'].includes(w)) {
          slangWords.push(w)
        }
      }
    }

    // Sort word frequency
    const topWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([w]) => w)

    // Emoji frequency
    const emojiFreq = {}
    for (const e of allEmojis) emojiFreq[e] = (emojiFreq[e] || 0) + 1
    const topEmojis = Object.entries(emojiFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    const avgLength = totalLength / messages.length
    const totalLang = teluguCount + englishCount || 1

    return {
      vocabulary: topWords,
      sentence_style: avgLength < 30 ? 'short and punchy' : avgLength < 80 ? 'medium' : 'detailed',
      emojis: {
        frequent: topEmojis.slice(0, 5).map(([e]) => e),
        occasional: topEmojis.slice(5).map(([e]) => e),
      },
      punctuation: 'minimal',
      tone: 'casual friendly',
      humor: 'natural',
      greeting_patterns: [...new Set(greetings)].slice(0, 5),
      signoff_patterns: ['bye', 'tc', 'ok'],
      response_speed: 'fast',
      language_mix: `${Math.round((englishCount / totalLang) * 100)}% English, ${Math.round((teluguCount / totalLang) * 100)}% Telugu`,
      typical_length: avgLength < 30 ? '1-2 sentences' : '2-4 sentences',
      unique_traits: `uses ${topEmojis[0]?.[0] || '😂'} a lot, ${avgLength < 30 ? 'short' : 'medium'} replies`,
      slang: [...new Set(slangWords)].slice(0, 15),
    }
  }

  /**
   * Import conversation history.
   */
  async importConversation(contactName, messages) {
    await this.init()

    this.conversations.set(contactName, messages)
    this.replyCache.invalidate(contactName)

    // Persist async — non-blocking
    const filePath = join(CONVERSATIONS_DIR, `${contactName.replace(/[^a-zA-Z0-9]/g, '_')}.json`)
    writeFile(filePath, JSON.stringify({
      contact: contactName,
      messages,
      importedAt: new Date().toISOString(),
    }, null, 2)).catch(() => {})

    return { ok: true, messageCount: messages.length }
  }

  /**
   * Generate reply in your style. LOW LATENCY.
   * Uses fast model + pre-computed style fragments.
   */
  async generateReply(contactName, incomingMessage, { context = '', medium = 'text', llm = null } = {}) {
    await this.init()

    // Check reply cache first — instant
    const msgHash = this._hashText(incomingMessage)
    const cached = this.replyCache.get(contactName, msgHash)
    if (cached) return cached

    // Get conversation history — in-memory, instant
    const history = this.conversations.get(contactName) || []
    const recentHistory = history.slice(-5)  // Only last 5 — reduces prompt size

    // Get style fragments — pre-computed, instant
    const sf = this.styleFragments

    // Build minimal prompt for fast model — reduces latency
    const prompt = this._buildFastPrompt(contactName, incomingMessage, recentHistory, sf, context, medium)

    // Use fast model if llm provided, otherwise return prompt for external call
    if (llm) {
      const response = await llm('reason', [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ], { maxTokens: 100 })  // Short max — fast response

      const reply = this._cleanReply(response)

      // Cache the reply
      this.replyCache.set(contactName, msgHash, reply)

      // Add to conversation history
      history.push({ sender: 'me', text: reply, timestamp: new Date().toISOString() })

      return reply
    }

    return prompt
  }

  /**
   * Build minimal prompt — reduces token count → faster response.
   */
  _buildFastPrompt(contactName, incoming, history, sf, context, medium) {
    // Minimal system prompt — only essential style rules
    const system = `Reply as user. Style: ${sf.sentenceStyle}, ${sf.tone}, ${sf.languageMix}. Emojis: ${sf.emojis.frequent.join('')}. ${sf.uniqueTraits}. Max 2 sentences. ${medium === 'voice' ? 'Spoken style.' : ''}`

    // Minimal conversation context
    const histStr = history.length > 0
      ? history.slice(-3).map((m) => `${m.sender === 'me' ? 'Me' : contactName}: ${m.text}`).join('\n')
      : ''

    const user = `${context ? `Ctx: ${context}\n` : ''}${histStr}\n${contactName}: ${incoming}\nMe:`

    return { system, user }
  }

  /**
   * Clean reply — remove AI artifacts.
   */
  _cleanReply(text) {
    return text
      .replace(/^(Me:|Reply:|Response:)\s*/i, '')
      .replace(/\n.*$/s, '')  // Take only first line
      .trim()
      .slice(0, 200)  // Max 200 chars
  }

  /**
   * Simple text hash for cache key.
   */
  _hashText(text) {
    let hash = 0
    const str = text.toLowerCase().slice(0, 50)
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash |= 0
    }
    return hash.toString(36)
  }

  /**
   * Generate voice message. Parallel — text + voice params simultaneously.
   */
  async generateVoiceMessage(contactName, incomingMessage, { context = '' } = {}) {
    // Run text generation and voice param lookup in parallel
    const [text, voiceParams] = await Promise.all([
      this.generateReply(contactName, incomingMessage, { context, medium: 'voice' }),
      Promise.resolve(voiceCloneEngine.getTTSParams()),
    ])

    return {
      ok: true,
      text,
      voice: { tts_params: voiceParams, profile: voiceCloneEngine.activeProfile },
      contactName,
    }
  }

  /**
   * Set contact info. Instant — in-memory.
   */
  setContact(name, { relationship = '', platform = '', notes = '' } = {}) {
    this.contacts.set(name, { relationship, platform, notes, updatedAt: new Date().toISOString() })
  }

  /**
   * Get style summary. Instant.
   */
  getStyleSummary() {
    if (!this.messagingStyle) return { learned: false }
    return {
      learned: true,
      fragments: this.styleFragments,
      conversationsStored: this.conversations.size,
      contactsKnown: this.contacts.size,
      cacheSize: this.replyCache.cache.size,
    }
  }

  /**
   * Get stats. Instant.
   */
  getStats() {
    return {
      styleLearned: !!this.messagingStyle,
      conversations: this.conversations.size,
      contacts: this.contacts.size,
      replyCacheSize: this.replyCache.cache.size,
      styleFragmentsReady: Object.keys(this.styleFragments).length > 0,
      ready: this.ready,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const voiceReplica = new VoiceReplica()

export { voiceReplica, VoiceReplica }
export default voiceReplica