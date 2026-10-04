/**
 * JARVIS Time Travel — snapshot, rewind, replay, and fix.
 *
 * Every action JARVIS takes gets a snapshot.
 * Something went wrong? REWIND to before it happened.
 * Try a different approach. REPLAY from that point.
 * Like git for REALITY.
 *
 * "Let me just… undo that. *snaps fingers* Done. Never happened."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Timeline management ──────────────────────────── */

class Timeline {
  constructor() {
    this.snapshots = []
    this.branches = new Map() // branchId → snapshots[]
    this.currentBranch = 'main'
    this.maxSnapshots = 100
  }

  /**
   * Take a snapshot of the current state.
   */
  snapshot(state, { label = '', action = '', metadata = {} } = {}) {
    const snap = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      branch: this.currentBranch,
      label,
      action,
      state: typeof state === 'string' ? state : JSON.stringify(state),
      metadata,
    }

    const branch = this.branches.get(this.currentBranch) || []
    branch.push(snap)
    this.branches.set(this.currentBranch, branch)
    this.snapshots.push(snap)

    // Prune if too many
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift()
    }

    return snap
  }

  /**
   * Rewind to a specific snapshot.
   */
  rewind(snapshotId) {
    const branch = this.branches.get(this.currentBranch) || []
    const idx = branch.findIndex((s) => s.id === snapshotId)
    if (idx === -1) return { ok: false, error: 'Snapshot not found' }

    const target = branch[idx]
    const removed = branch.splice(idx + 1)

    return {
      ok: true,
      rewoundTo: target,
      removedSnapshots: removed.length,
      state: target.state,
    }
  }

  /**
   * Rewind to the last snapshot before a given action.
   */
  rewindBefore(actionPattern) {
    const branch = this.branches.get(this.currentBranch) || []
    const idx = branch.findLastIndex((s) => !s.action.includes(actionPattern))
    if (idx === -1) return { ok: false, error: 'No snapshot found before that action' }

    return this.rewind(branch[idx].id)
  }

  /**
   * Create an alternate timeline — branch from a snapshot.
   */
  branchFrom(snapshotId, branchName) {
    const branch = this.branches.get(this.currentBranch) || []
    const idx = branch.findIndex((s) => s.id === snapshotId)
    if (idx === -1) return { ok: false, error: 'Snapshot not found' }

    const newBranch = branch.slice(0, idx + 1)
    this.branches.set(branchName, newBranch)
    this.currentBranch = branchName

    return {
      ok: true,
      branch: branchName,
      branchedFrom: snapshotId,
      snapshotsCarried: newBranch.length,
    }
  }

  /**
   * Merge a branch back into main.
   */
  merge(branchName) {
    const source = this.branches.get(branchName)
    if (!source) return { ok: false, error: 'Branch not found' }

    const target = this.branches.get('main') || []
    this.branches.set('main', [...target, ...source])
    this.currentBranch = 'main'

    return {
      ok: true,
      mergedFrom: branchName,
      snapshotsMerged: source.length,
    }
  }

  /**
   * Get the full timeline history.
   */
  getHistory({ branch = null, limit = 20 } = {}) {
    const b = branch || this.currentBranch
    const snaps = this.branches.get(b) || []
    return {
      branch: b,
      total: snaps.length,
      snapshots: snaps.slice(-limit).map((s) => ({
        id: s.id,
        timestamp: s.timestamp,
        label: s.label,
        action: s.action,
      })),
    }
  }

  /**
   * List all branches.
   */
  listBranches() {
    return Array.from(this.branches.entries()).map(([name, snaps]) => ({
      name,
      snapshots: snaps.length,
      current: name === this.currentBranch,
    }))
  }
}

/* ──────────────── Timeline analysis ──────────────────────────── */

/**
 * Analyze a timeline to find what went wrong.
 */
export async function analyzeTimeline(timeline, { llm = complete } = {}) {
  const history = timeline.getHistory({ limit: 50 })

  const response = await llm('reason', [
    { role: 'system', content: `You are a timeline debugger. Analyze a sequence of events to find:
1. When things started going wrong
2. What the root cause was
3. What the cascading effects were
4. The optimal point to rewind to
5. What should be done differently

Respond in JSON:
{
  "analysis": "...",
  "turning_point": { "snapshot_id": "...", "why": "..." },
  "root_cause": "...",
  "cascading_effects": ["effect 1", "effect 2"],
  "rewind_to": "snapshot_id",
  "fix_suggestion": "...",
  "prevention": "how to avoid this in the future"
}` },
    { role: 'user', content: `Timeline:\n${history.snapshots.map((s) => `[${s.timestamp}] ${s.label}: ${s.action}`).join('\n')}\n\nAnalyze this timeline:` },
  ], { maxTokens: 600 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, analysis: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Replay with changes ──────────────────────────── */

/**
 * Replay a sequence of actions with modifications.
 */
export async function replayWithChanges(timeline, snapshotId, changes, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a replay simulator. Given a point in time and proposed changes, simulate what would happen.

Consider:
- How the change affects subsequent events
- What new problems might arise
- Whether the overall outcome improves
- Any unexpected side effects` },
    { role: 'user', content: `From snapshot: ${snapshotId}\nChanges: ${JSON.stringify(changes)}\n\nSimulate the replay:` },
  ], { maxTokens: 500 })

  return { snapshotId, changes, simulation: response }
}

export { Timeline }
export default { Timeline, analyzeTimeline, replayWithChanges }