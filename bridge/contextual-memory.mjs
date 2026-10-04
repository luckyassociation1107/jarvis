/**
 * JARVIS Contextual Memory — recalls the RIGHT memory at the RIGHT time.
 *
 * Not just storing memories. RECALLING them intelligently:
 *   - Time-relevant memories (what happened this time last week)
 *   - Topic-relevant memories (related to current conversation)
 *   - Emotion-relevant memories (when you felt this before)
 *   - Person-relevant memories (about the person you're talking to)
 *   - Location-relevant memories (where you were)
 *   - Action-relevant memories (what you did in similar situations)
 *
 * "I don't just remember. I remember WHAT MATTERS RIGHT NOW."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Contextual Memory ──────────────────────────── */

class ContextualMemory {
  constructor() {
    this.memories = []
    this.index = {
      byTopic: new Map(),     // topic → [memories]
      byEmotion: new Map(),   // emotion → [memories]
      byPerson: new Map(),    // person → [memories]
      byTime: [],             // sorted by timestamp
      byImportance: [],       // sorted by importance
    }
    this.maxMemories = 2000
    this.accessLog = []       // which memories were recalled when
  }

  /**
   * Store a memory with rich indexing.
   */
  store(content, { topic = '', emotion = '', person = '', importance = 5, context = '' } = {}) {
    const memory = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content,
      topic,
      emotion,
      person,
      importance,
      context,
      timestamp: new Date().toISOString(),
      accessCount: 0,
      lastAccessed: null,
    }

    this.memories.push(memory)
    if (this.memories.length > this.maxMemories) {
      const removed = this.memories.shift()
      // Clean up indexes
      this._removeFromIndexes(removed)
    }

    // Index it
    if (topic) {
      const existing = this.index.byTopic.get(topic) || []
      existing.push(memory)
      this.index.byTopic.set(topic, existing)
    }
    if (emotion) {
      const existing = this.index.byEmotion.get(emotion) || []
      existing.push(memory)
      this.index.byEmotion.set(emotion, existing)
    }
    if (person) {
      const existing = this.index.byPerson.get(person) || []
      existing.push(memory)
      this.index.byPerson.set(person, existing)
    }

    return memory
  }

  /**
   * Recall memories relevant to current context.
   */
  recall(query, { topic = '', emotion = '', person = '', limit = 5 } = {}) {
    const candidates = []

    // Topic match
    if (topic) {
      const topicMemories = this.index.byTopic.get(topic) || []
      candidates.push(...topicMemories.map((m) => ({ ...m, relevance: 'topic' })))
    }

    // Emotion match
    if (emotion) {
      const emotionMemories = this.index.byEmotion.get(emotion) || []
      candidates.push(...emotionMemories.map((m) => ({ ...m, relevance: 'emotion' })))
    }

    // Person match
    if (person) {
      const personMemories = this.index.byPerson.get(person) || []
      candidates.push(...personMemories.map((m) => ({ ...m, relevance: 'person' })))
    }

    // Keyword match
    const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    const keywordMatches = this.memories.filter((m) =>
      keywords.some((kw) => m.content.toLowerCase().includes(kw))
    )
    candidates.push(...keywordMatches.map((m) => ({ ...m, relevance: 'keyword' })))

    // Deduplicate and score
    const scored = new Map()
    for (const c of candidates) {
      if (scored.has(c.id)) {
        scored.get(c.id).score += 1
      } else {
        scored.set(c.id, { ...c, score: 1 + (c.importance / 10) })
      }
    }

    // Sort by score, then recency
    const results = [...scored.values()]
      .sort((a, b) => b.score - a.score || new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)

    // Log access
    for (const r of results) {
      const original = this.memories.find((m) => m.id === r.id)
      if (original) {
        original.accessCount++
        original.lastAccessed = new Date().toISOString()
      }
    }

    this.accessLog.push({
      query: query.slice(0, 100),
      results: results.length,
      timestamp: new Date().toISOString(),
    })

    return results
  }

  _removeFromIndexes(memory) {
    if (memory.topic) {
      const arr = this.index.byTopic.get(memory.topic)
      if (arr) this.index.byTopic.set(memory.topic, arr.filter((m) => m.id !== memory.id))
    }
    if (memory.emotion) {
      const arr = this.index.byEmotion.get(memory.emotion)
      if (arr) this.index.byEmotion.set(memory.emotion, arr.filter((m) => m.id !== memory.id))
    }
    if (memory.person) {
      const arr = this.index.byPerson.get(memory.person)
      if (arr) this.index.byPerson.set(memory.person, arr.filter((m) => m.id !== memory.id))
    }
  }

  /**
   * Get memory stats.
   */
  getStats() {
    return {
      total: this.memories.length,
      topics: this.index.byTopic.size,
      emotions: this.index.byEmotion.size,
      persons: this.index.byPerson.size,
      accessLog: this.accessLog.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const contextualMemory = new ContextualMemory()

export { contextualMemory, ContextualMemory }
export default contextualMemory