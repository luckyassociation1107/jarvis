/**
 * JARVIS Knowledge Base — stores and retrieves personal knowledge.
 *
 *   - Store notes, ideas, references
 *   - Full-text search
 *   - Tag-based organization
 *   - Smart connections between notes
 *   - Knowledge graph building
 *   - Quick retrieval
 *
 * "I stored that article you mentioned last week.
 *  It was about React performance optimization.
 *  Here's the key takeaway: use React.memo for expensive components."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Knowledge Base ──────────────────────────── */

class KnowledgeBase {
  constructor() {
    this.notes = []
    this.tags = new Map()         // tag → [noteIds]
    this.collections = new Map()  // collectionName → [noteIds]
    this.maxNotes = 5000
  }

  /**
   * Store a note.
   */
  store(content, { title = '', tags = [], collection = '', source = '', importance = 5 } = {}) {
    const note = {
      id: `kb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title || content.slice(0, 80),
      content,
      tags,
      collection,
      source,
      importance,
      createdAt: new Date().toISOString(),
      accessCount: 0,
      lastAccessed: null,
    }

    this.notes.push(note)
    if (this.notes.length > this.maxNotes) this.notes.shift()

    // Index by tags
    for (const tag of tags) {
      const existing = this.tags.get(tag) || []
      existing.push(note.id)
      this.tags.set(tag, existing)
    }

    // Index by collection
    if (collection) {
      const existing = this.collections.get(collection) || []
      existing.push(note.id)
      this.collections.set(collection, existing)
    }

    return note
  }

  /**
   * Search notes.
   */
  search(query, { tags = [], collection = '', limit = 10 } = {}) {
    let candidates = [...this.notes]

    // Filter by tags
    if (tags.length > 0) {
      const tagNoteIds = new Set()
      for (const tag of tags) {
        for (const id of this.tags.get(tag) || []) {
          tagNoteIds.add(id)
        }
      }
      candidates = candidates.filter((n) => tagNoteIds.has(n.id))
    }

    // Filter by collection
    if (collection) {
      const collectionIds = new Set(this.collections.get(collection) || [])
      candidates = candidates.filter((n) => collectionIds.has(n.id))
    }

    // Full-text search
    const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    const scored = candidates.map((note) => {
      let score = 0
      const lowerContent = note.content.toLowerCase()
      const lowerTitle = note.title.toLowerCase()

      for (const kw of keywords) {
        if (lowerTitle.includes(kw)) score += 3
        if (lowerContent.includes(kw)) score += 1
      }
      score += note.importance / 10

      return { ...note, score }
    })

    return scored
      .filter((n) => n.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((n) => {
        // Update access stats
        const original = this.notes.find((note) => note.id === n.id)
        if (original) {
          original.accessCount++
          original.lastAccessed = new Date().toISOString()
        }
        return n
      })
  }

  /**
   * Find related notes.
   */
  findRelated(noteId, { limit = 5 } = {}) {
    const note = this.notes.find((n) => n.id === noteId)
    if (!note) return []

    const keywords = note.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)

    return this.notes
      .filter((n) => n.id !== noteId)
      .map((n) => {
        let score = 0
        const lowerContent = n.content.toLowerCase()
        for (const kw of keywords) {
          if (lowerContent.includes(kw)) score++
        }
        // Bonus for same tags
        const sharedTags = note.tags.filter((t) => n.tags.includes(t))
        score += sharedTags.length * 2
        // Bonus for same collection
        if (note.collection && note.collection === n.collection) score += 3

        return { ...n, score }
      })
      .filter((n) => n.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * Get all tags.
   */
  getTags() {
    return Array.from(this.tags.entries()).map(([tag, ids]) => ({
      tag,
      count: ids.length,
    })).sort((a, b) => b.count - a.count)
  }

  /**
   * Get all collections.
   */
  getCollections() {
    return Array.from(this.collections.entries()).map(([name, ids]) => ({
      name,
      count: ids.length,
    })).sort((a, b) => b.count - a.count)
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      notes: this.notes.length,
      tags: this.tags.size,
      collections: this.collections.size,
      totalAccesses: this.notes.reduce((sum, n) => sum + n.accessCount, 0),
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const knowledgeBase = new KnowledgeBase()

export { knowledgeBase, KnowledgeBase }
export default knowledgeBase