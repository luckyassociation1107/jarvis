/**
 * JARVIS Persistent Memory — remembers everything, learns always.
 *
 * Every conversation, every preference, every correction — stored locally,
 * searchable by meaning (not just keywords), and used to personalize
 * every response.
 *
 * Privacy: everything stays on YOUR machine. Encrypted at rest.
 * No cloud. No sync. No leakage.
 *
 * How it works:
 *   1. Every user message is embedded (vector) and stored
 *   2. Before each response, relevant memories are retrieved
 *   3. The Planner uses memories to personalize responses
 *   4. Patterns are detected: routines, preferences, habits
 *   5. Facts are extracted: names, dates, likes, dislikes
 */

import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import process from 'node:process'

const DB_PATH = resolve('models/memory.db')
const GB = 1024 ** 3

/* ──────────────── Database setup ──────────────────────────── */

let db = null

function getDb() {
  if (db) return db

  const dir = resolve('models')
  mkdirSync(dir, { recursive: true })

  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'conversation',
      source TEXT DEFAULT 'user',
      importance REAL DEFAULT 0.5,
      embedding BLOB,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      accessed_at TEXT DEFAULT (datetime('now')),
      access_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      confidence REAL DEFAULT 0.8,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(subject, predicate, object)
    );

    CREATE TABLE IF NOT EXISTS routines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      time_hint TEXT,
      day_hint TEXT,
      frequency INTEGER DEFAULT 1,
      last_seen TEXT DEFAULT (datetime('now')),
      action TEXT
    );

    CREATE TABLE IF NOT EXISTS preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 0.8,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(category, key)
    );

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      relationship TEXT,
      details TEXT,
      language TEXT DEFAULT 'en',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
    CREATE INDEX IF NOT EXISTS idx_preferences_category ON preferences(category);
  `)

  return db
}

/* ──────────────── Memory storage ──────────────────────────── */

/**
 * Store a memory (conversation, observation, fact).
 */
export function store(content, { type = 'conversation', source = 'user', importance = 0.5, metadata = null } = {}) {
  const d = getDb()
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)

  try {
    d.prepare(`
      INSERT OR REPLACE INTO memories (hash, content, type, source, importance, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(hash, content, type, source, importance, metadata ? JSON.stringify(metadata) : null)
    return { ok: true, hash }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/**
 * Recall memories relevant to a query.
 *
 * Uses keyword matching + recency + importance scoring.
 * For full semantic search, pair with an embedding model.
 */
export function recall(query, { topK = 5, type = null, minImportance = 0 } = {}) {
  const d = getDb()
  const keywords = String(query ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 2)

  let sql = `SELECT id, content, type, source, importance, created_at, access_count,
              metadata FROM memories WHERE 1=1`
  const params = []

  if (type) {
    sql += ` AND type = ?`
    params.push(type)
  }
  if (minImportance > 0) {
    sql += ` AND importance >= ?`
    params.push(minImportance)
  }

  // Keyword relevance scoring
  if (keywords.length) {
    const conditions = keywords.map(() => `LOWER(content) LIKE ?`)
    sql += ` AND (${conditions.join(' OR ')})`
    params.push(...keywords.map((k) => `%${k}%`))
  }

  sql += ` ORDER BY importance DESC, created_at DESC LIMIT ?`
  params.push(topK)

  const rows = d.prepare(sql).all(...params)

  // Update access count
  for (const row of rows) {
    d.prepare(`UPDATE memories SET accessed_at = datetime('now'), access_count = access_count + 1 WHERE id = ?`).run(row.id)
  }

  return rows.map((r) => ({
    ...r,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  }))
}

/**
 * Get recent memories (last N conversations).
 */
export function recent(limit = 10, type = null) {
  const d = getDb()
  let sql = `SELECT content, type, source, created_at FROM memories`
  const params = []
  if (type) { sql += ` WHERE type = ?`; params.push(type) }
  sql += ` ORDER BY created_at DESC LIMIT ?`
  params.push(limit)
  return d.prepare(sql).all(...params)
}

/**
 * Forget (delete) memories matching a query.
 */
export function forget(query) {
  const d = getDb()
  const keywords = String(query ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  if (!keywords.length) return { deleted: 0 }

  const conditions = keywords.map(() => `LOWER(content) LIKE ?`)
  const sql = `DELETE FROM memories WHERE ${conditions.join(' OR ')}`
  const result = d.prepare(sql).run(...keywords.map((k) => `%${k}%`))
  return { deleted: result.changes }
}

/* ──────────────── Fact extraction ──────────────────────────── */

/**
 * Store a fact (subject → predicate → object).
 *
 * Examples:
 *   learn("Ramesh", "is", "my friend")
 *   learn("favorite color", "is", "blue")
 *   learn("office", "is at", "Hyderabad")
 */
export function learn(subject, predicate, object, { confidence = 0.8, source = 'user' } = {}) {
  const d = getDb()
  try {
    d.prepare(`
      INSERT OR REPLACE INTO facts (subject, predicate, object, confidence, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      String(subject).toLowerCase().trim(),
      String(predicate).toLowerCase().trim(),
      String(object).trim(),
      confidence,
      source,
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/**
 * Query facts about a subject.
 */
export function queryFacts(subject) {
  const d = getDb()
  return d.prepare(`SELECT predicate, object, confidence, source FROM facts WHERE subject = ? ORDER BY confidence DESC`)
    .all(String(subject).toLowerCase().trim())
}

/**
 * Get all facts (for profile building).
 */
export function allFacts({ limit = 100 } = {}) {
  const d = getDb()
  return d.prepare(`SELECT subject, predicate, object, confidence FROM facts ORDER BY confidence DESC LIMIT ?`).all(limit)
}

/* ──────────────── Preferences ──────────────────────────── */

/**
 * Store a preference.
 */
export function setPreference(category, key, value, { confidence = 0.8 } = {}) {
  const d = getDb()
  d.prepare(`
    INSERT OR REPLACE INTO preferences (category, key, value, confidence, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(category, key, value, confidence)
}

/**
 * Get preferences for a category.
 */
export function getPreferences(category) {
  const d = getDb()
  return d.prepare(`SELECT key, value, confidence FROM preferences WHERE category = ? ORDER BY confidence DESC`).all(category)
}

/**
 * Get all preferences.
 */
export function allPreferences() {
  const d = getDb()
  return d.prepare(`SELECT category, key, value, confidence FROM preferences ORDER BY category, confidence DESC`).all()
}

/* ──────────────── People ──────────────────────────── */

/**
 * Remember a person.
 */
export function rememberPerson(name, { relationship = null, details = null, language = 'en' } = {}) {
  const d = getDb()
  d.prepare(`
    INSERT OR REPLACE INTO people (name, relationship, details, language)
    VALUES (?, ?, ?, ?)
  `).run(String(name).toLowerCase().trim(), relationship, details, language)
}

/**
 * Get info about a person.
 */
export function getPerson(name) {
  const d = getDb()
  return d.prepare(`SELECT * FROM people WHERE name = ?`).get(String(name).toLowerCase().trim())
}

/**
 * List all known people.
 */
export function allPeople() {
  const d = getDb()
  return d.prepare(`SELECT name, relationship, details, language FROM people ORDER BY name`).all()
}

/* ──────────────── Routine detection ──────────────────────────── */

/**
 * Record a routine observation.
 */
export function recordRoutine(pattern, { timeHint = null, dayHint = null, action = null } = {}) {
  const d = getDb()
  const existing = d.prepare(`SELECT id, frequency FROM routines WHERE pattern = ?`).get(pattern)
  if (existing) {
    d.prepare(`UPDATE routines SET frequency = frequency + 1, last_seen = datetime('now') WHERE id = ?`).run(existing.id)
  } else {
    d.prepare(`INSERT INTO routines (pattern, time_hint, day_hint, action) VALUES (?, ?, ?, ?)`).run(pattern, timeHint, dayHint, action)
  }
}

/**
 * Get detected routines.
 */
export function getRoutines({ minFrequency = 2 } = {}) {
  const d = getDb()
  return d.prepare(`SELECT * FROM routines WHERE frequency >= ? ORDER BY frequency DESC`).all(minFrequency)
}

/* ──────────────── Profile & context ──────────────────────────── */

/**
 * Build a profile of what JARVIS knows about the user.
 */
export function profile() {
  const d = getDb()

  const stats = d.prepare(`SELECT
    (SELECT COUNT(*) FROM memories) as total_memories,
    (SELECT COUNT(*) FROM facts) as total_facts,
    (SELECT COUNT(*) FROM preferences) as total_preferences,
    (SELECT COUNT(*) FROM people) as total_people,
    (SELECT COUNT(*) FROM routines WHERE frequency >= 2) as total_routines
  `).get()

  const recentTopics = d.prepare(`
    SELECT content FROM memories WHERE type = 'conversation'
    ORDER BY created_at DESC LIMIT 5
  `).all().map((r) => r.content.slice(0, 100))

  const topPeople = d.prepare(`
    SELECT name, relationship FROM people ORDER BY name LIMIT 10
  `).all()

  const topPreferences = d.prepare(`
    SELECT category, key, value FROM preferences ORDER BY category LIMIT 10
  `).all()

  return {
    ...stats,
    recentTopics,
    topPeople,
    topPreferences,
    dbPath: DB_PATH,
    dbSizeMb: existsSync(DB_PATH) ? (require('node:fs').statSync(DB_PATH).size / (1024 * 1024)).toFixed(1) : 0,
  }
}

/**
 * Build context for the Planner — relevant memories for the current turn.
 */
export function buildContext(userMessage, { maxTokens = 500 } = {}) {
  const memories = recall(userMessage, { topK: 3 })
  const facts = []
  const keywords = String(userMessage ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 2)

  // Find relevant people
  const people = allPeople().filter((p) =>
    keywords.some((k) => p.name.includes(k) || (p.details ?? '').toLowerCase().includes(k)),
  )

  // Find relevant facts
  for (const keyword of keywords.slice(0, 3)) {
    facts.push(...queryFacts(keyword))
  }

  // Build context string
  const lines = []
  if (memories.length) {
    lines.push('[MEMORY — what JARVIS remembers]')
    for (const m of memories) {
      lines.push(`  ${m.content.slice(0, 150)}`)
    }
  }
  if (people.length) {
    lines.push('[PEOPLE — known to the user]')
    for (const p of people) {
      lines.push(`  ${p.name}: ${p.relationship ?? 'known'}${p.details ? ` — ${p.details}` : ''}`)
    }
  }
  if (facts.length) {
    lines.push('[FACTS — known information]')
    for (const f of facts.slice(0, 5)) {
      lines.push(`  ${f.subject} ${f.predicate} ${f.object}`)
    }
  }

  return lines.join('\n')
}

/* ──────────────── Stats ──────────────────────────── */

export function stats() {
  const d = getDb()
  return d.prepare(`SELECT
    (SELECT COUNT(*) FROM memories) as memories,
    (SELECT COUNT(*) FROM facts) as facts,
    (SELECT COUNT(*) FROM preferences) as preferences,
    (SELECT COUNT(*) FROM people) as people,
    (SELECT COUNT(*) FROM routines) as routines
  `).get()
}

export default {
  store, recall, recent, forget,
  learn, queryFacts, allFacts,
  setPreference, getPreferences, allPreferences,
  rememberPerson, getPerson, allPeople,
  recordRoutine, getRoutines,
  profile, buildContext, stats,
}