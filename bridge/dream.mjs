/**
 * JARVIS Dream Mode — processes memories during idle time.
 *
 * Like human sleep, JARVIS uses idle time to:
 *   1. Consolidate short-term memories into long-term
 *   2. Find connections between unrelated memories
 *   3. Generate new insights from old information
 *   4. Clean up and optimize memory storage
 *   5. Plan for upcoming events
 *   6. Creative incubation — solve problems subconsciously
 *
 * Runs during idle periods (no user interaction for 5+ minutes).
 */

import { recent, store, recall, allFacts, getRoutines, stats as memoryStats } from './memory.mjs'
import { complete } from './local-llm.mjs'

let dreamInterval = null
let isDreaming = false

/* ──────────────── Dream processing ──────────────────────────── */

/**
 * Run a dream cycle — process memories and generate insights.
 */
export async function dreamCycle({ onLog = () => {}, onInsight = () => {} } = {}) {
  if (isDreaming) return
  isDreaming = true

  onLog('💤 Dream mode started…')

  try {
    // Step 1: Consolidate memories
    const consolidated = await consolidateMemories()
    onLog(`  Consolidated ${consolidated} memories`)

    // Step 2: Find connections
    const connections = await findConnections()
    if (connections.length) {
      onLog(`  Found ${connections.length} new connections`)
      for (const c of connections) onInsight(c)
    }

    // Step 3: Generate insights
    const insights = await generateInsights()
    if (insights.length) {
      onLog(`  Generated ${insights.length} insights`)
      for (const i of insights) {
        store(i, { type: 'insight', importance: 0.7, source: 'dream' })
        onInsight({ type: 'insight', content: i })
      }
    }

    // Step 4: Clean up
    const cleaned = cleanupMemories()
    onLog(`  Cleaned ${cleaned} stale memories`)

    // Step 5: Plan ahead
    const plans = await planAhead()
    if (plans.length) {
      onLog(`  Made ${plans.length} future plans`)
    }

    onLog('💤 Dream cycle complete')
  } catch (error) {
    onLog(`  ⚠ Dream error: ${error.message}`)
  } finally {
    isDreaming = false
  }
}

/**
 * Consolidate short-term memories into long-term.
 */
async function consolidateMemories() {
  const recentMemories = recent(20)
  if (recentMemories.length < 3) return 0

  // Find patterns in recent memories
  const memoryText = recentMemories.map((m) => m.content.slice(0, 100)).join('\n')

  try {
    const response = await complete('chat', [
      { role: 'system', content: 'Extract the 3 most important facts or patterns from these recent memories. One per line. Be concise.' },
      { role: 'user', content: memoryText },
    ], { maxTokens: 200 })

    const insights = response.split('\n').filter((l) => l.trim().length > 10)
    for (const insight of insights) {
      store(insight.trim(), { type: 'consolidated', importance: 0.8, source: 'dream_consolidation' })
    }
    return insights.length
  } catch {
    return 0
  }
}

/**
 * Find connections between unrelated memories.
 */
async function findConnections() {
  const facts = allFacts({ limit: 20 })
  if (facts.length < 3) return []

  const factText = facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`).join('\n')

  try {
    const response = await complete('chat', [
      { role: 'system', content: 'Find surprising or non-obvious connections between these facts. List 2-3 connections, one per line.' },
      { role: 'user', content: factText },
    ], { maxTokens: 200 })

    return response.split('\n').filter((l) => l.trim().length > 10).map((c) => ({
      type: 'connection',
      content: c.trim(),
      source: 'dream_connection',
    }))
  } catch {
    return []
  }
}

/**
 * Generate new insights from existing knowledge.
 */
async function generateInsights() {
  const routines = getRoutines({ minFrequency: 2 })
  const recentTopics = recent(5).map((m) => m.content.slice(0, 50))

  if (!routines.length && !recentTopics.length) return []

  try {
    const response = await complete('chat', [
      { role: 'system', content: 'Based on the user\'s routines and recent activity, generate 2-3 helpful insights or suggestions. Be specific and actionable.' },
      { role: 'user', content: `Routines: ${routines.map((r) => r.pattern).join('; ')}\nRecent: ${recentTopics.join('; ')}` },
    ], { maxTokens: 200 })

    return response.split('\n').filter((l) => l.trim().length > 10).map((l) => l.trim())
  } catch {
    return []
  }
}

/**
 * Clean up stale or duplicate memories.
 */
function cleanupMemories() {
  // This would remove low-importance, old, rarely-accessed memories
  // For now, just count what could be cleaned
  const mem = memoryStats()
  return 0 // Placeholder — actual cleanup needs careful implementation
}

/**
 * Plan for upcoming events.
 */
async function planAhead() {
  const now = new Date()
  const hour = now.getHours()
  const day = now.getDay()
  const plans = []

  // Plan for today
  if (hour < 9 && day >= 1 && day <= 5) {
    plans.push({ plan: 'Work day starting. Check email and calendar.', time: 'now' })
  }
  if (hour >= 17 && hour < 19 && day >= 1 && day <= 5) {
    plans.push({ plan: 'Evening. Check traffic and plan dinner.', time: 'now' })
  }

  // Store plans
  for (const p of plans) {
    store(`Plan: ${p.plan}`, { type: 'plan', importance: 0.5, source: 'dream_planning' })
  }

  return plans
}

/* ──────────────── Dream control ──────────────────────────── */

/**
 * Start dream mode — runs during idle periods.
 */
export function startDreamMode({ intervalMs = 300_000, onLog = () => {}, onInsight = () => {} } = {}) {
  if (dreamInterval) return

  dreamInterval = setInterval(() => {
    dreamCycle({ onLog, onInsight })
  }, intervalMs)

  onLog('💤 Dream mode activated')
}

/**
 * Stop dream mode.
 */
export function stopDreamMode() {
  if (dreamInterval) { clearInterval(dreamInterval); dreamInterval = null }
}

/**
 * Is JARVIS currently dreaming?
 */
export function isCurrentlyDreaming() {
  return isDreaming
}

export default { dreamCycle, startDreamMode, stopDreamMode, isCurrentlyDreaming }