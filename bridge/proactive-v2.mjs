/**
 * JARVIS Level 5 — Proactive Intelligence v2
 *
 * Level 5 proactivity isn't "I noticed your battery is low."
 * It's "I've been monitoring the market for 3 months. Your competitor
 *  just launched a similar feature. I've already drafted a response
 *  strategy, allocated budget for counter-development, and scheduled
 *  a meeting with the engineering team."
 *
 * This module:
 *   - Continuously monitors the environment
 *   - Identifies problems BEFORE they become problems
 *   - Creates self-initiated projects
 *   - Takes autonomous action within boundaries
 *   - Reports results to the executive layer
 *
 * "I don't wait for problems. I prevent them."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Environment monitoring ──────────────────────────── */

class ProactiveEngine {
  constructor() {
    this.watchlist = new Map()       // domain → {signals, thresholds, actions}
    this.observations = []           // detected signals
    this.initiatives = []            // self-started projects
    this.actionLog = []              // autonomous actions taken
    this.boundaries = {              // what it can/cannot do autonomously
      canDo: ['research', 'analyze', 'plan', 'alert', 'draft', 'suggest'],
      requiresApproval: ['spend', 'deploy', 'communicate_externally', 'delete', 'modify_critical'],
      forbidden: ['share_pii', 'break_law', 'violate_policy'],
    }
  }

  /**
   * Add a domain to watch.
   */
  addWatch(domain, { signals = [], thresholds = {}, autoActions = [] } = {}) {
    this.watchlist.set(domain, {
      domain,
      signals,
      thresholds,
      autoActions,
      lastChecked: null,
      alerts: [],
    })
  }

  /**
   * Scan the environment and identify issues/opportunities.
   */
  async scanEnvironment({ llm = complete } = {}) {
    const domains = Array.from(this.watchlist.keys())
    if (domains.length === 0) return { ok: false, error: 'No domains to watch' }

    const findings = []

    for (const domain of domains) {
      const watch = this.watchlist.get(domain)

      const analysis = await llm('reason', [
        { role: 'system', content: `You are a proactive intelligence agent monitoring: ${domain}

Signals to watch: ${watch.signals.join(', ')}
Thresholds: ${JSON.stringify(watch.thresholds)}

Identify:
1. Current state — what's happening now
2. Trends — what direction things are moving
3. Anomalies — anything unusual or concerning
4. Opportunities — things we should act on
5. Threats — things we should prepare for

Be specific and actionable. If nothing notable, say so briefly.` },
        { role: 'user', content: `Domain: ${domain}\nLast check: ${watch.lastChecked || 'first scan'}\n\nScan results:` },
      ], { maxTokens: 400 })

      watch.lastChecked = new Date().toISOString()

      findings.push({
        domain,
        analysis,
        timestamp: new Date().toISOString(),
      })

      this.observations.push({
        domain,
        analysis: analysis.slice(0, 500),
        timestamp: new Date().toISOString(),
      })
    }

    // Identify initiatives
    const initiativeResponse = await llm('reason', [
      { role: 'system', content: `Based on the environment scan, identify proactive initiatives.

For each initiative:
1. What to do
2. Why (which finding triggered it)
3. Expected impact
4. Resources needed
5. Whether it needs approval or can be done autonomously

Boundaries — can do without approval: ${this.boundaries.canDo.join(', ')}
Requires approval: ${this.boundaries.requiresApproval.join(', ')}` },
      { role: 'user', content: `Scan findings:\n${findings.map((f) => `[${f.domain}]:\n${f.analysis.slice(0, 200)}`).join('\n\n')}\n\nProactive initiatives:` },
    ], { maxTokens: 600 })

    return {
      findings,
      initiatives: initiativeResponse,
      domainsScanned: domains.length,
    }
  }

  /**
   * Take autonomous action within boundaries.
   */
  async takeAction(action, { type = 'research', requiresApproval = false } = {}) {
    if (this.boundaries.forbidden.includes(type)) {
      return { ok: false, error: `Action type "${type}" is forbidden` }
    }

    if (this.boundaries.requiresApproval.includes(type) || requiresApproval) {
      return {
        ok: true,
        queued: true,
        message: `Action queued for approval: ${action}`,
        type,
      }
    }

    this.actionLog.push({
      action,
      type,
      timestamp: new Date().toISOString(),
      autonomous: true,
    })

    return { ok: true, executed: true, action }
  }

  /**
   * Generate a proactive report — what JARVIS noticed and did on its own.
   */
  async generateReport({ llm = complete } = {}) {
    const recentObservations = this.observations.slice(-20)
    const recentActions = this.actionLog.slice(-10)

    const report = await llm('chat', [
      { role: 'system', content: `Generate a proactive intelligence report. Summary of what was monitored, what was found, and what was done autonomously.

Format: executive summary, key findings, actions taken, items needing attention.` },
      { role: 'user', content: `Observations:\n${recentObservations.map((o) => `- [${o.domain}] ${o.analysis.slice(0, 100)}`).join('\n') || 'none'}\n\nAutonomous actions:\n${recentActions.map((a) => `- ${a.action}`).join('\n') || 'none'}\n\nReport:` },
    ], { maxTokens: 500 })

    return {
      report,
      observations: recentObservations.length,
      actions: recentActions.length,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Get engine status.
   */
  getStatus() {
    return {
      watchlist: this.watchlist.size,
      observations: this.observations.length,
      initiatives: this.initiatives.length,
      actions: this.actionLog.length,
      boundaries: this.boundaries,
    }
  }
}

export { ProactiveEngine }
export default { ProactiveEngine }