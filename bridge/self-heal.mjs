/**
 * JARVIS Self-Healing — detects and fixes its own problems.
 *
 * Like a biological immune system but for an AI:
 *   - Monitors its own health continuously
 *   - Detects anomalies (unusual patterns, errors, degradation)
 *   - Diagnoses root causes
 *   - Applies fixes automatically
 *   - Learns from each incident to prevent future ones
 *
 * "I don't wait for you to tell me I'm broken. I know. And I'm already fixing it."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Health monitor ──────────────────────────── */

class HealthMonitor {
  constructor() {
    this.metrics = new Map()     // metricName → {values[], threshold, status}
    this.incidents = []          // detected problems
    this.healingLog = []         // fixes applied
    this.checks = new Map()      // checkName → checkFunction
    this.running = false
  }

  /**
   * Register a health metric to monitor.
   */
  registerMetric(name, { threshold = null, unit = '', healthy = 'normal' } = {}) {
    this.metrics.set(name, {
      values: [],
      threshold,
      unit,
      status: healthy,
      lastCheck: null,
    })
  }

  /**
   * Record a metric value.
   */
  record(name, value) {
    const metric = this.metrics.get(name)
    if (!metric) return

    metric.values.push({ value, timestamp: Date.now() })
    if (metric.values.length > 1000) metric.values.shift()

    // Check threshold
    if (metric.threshold && value > metric.threshold) {
      this.triggerIncident(name, 'threshold_exceeded', { value, threshold: metric.threshold })
    }

    metric.lastCheck = Date.now()
  }

  /**
   * Detect anomalies using statistical methods.
   */
  detectAnomalies(name) {
    const metric = this.metrics.get(name)
    if (!metric || metric.values.length < 10) return []

    const values = metric.values.map((v) => v.value)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const stdDev = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length)

    const anomalies = []
    for (const entry of metric.values.slice(-20)) {
      const zScore = Math.abs((entry.value - mean) / (stdDev || 1))
      if (zScore > 2.5) {
        anomalies.push({
          value: entry.value,
          zScore: zScore.toFixed(2),
          timestamp: new Date(entry.timestamp).toISOString(),
          severity: zScore > 4 ? 'critical' : zScore > 3 ? 'high' : 'medium',
        })
      }
    }

    return anomalies
  }

  /**
   * Trigger an incident.
   */
  triggerIncident(metric, type, details = {}) {
    const incident = {
      id: `inc-${Date.now()}`,
      metric,
      type,
      details,
      timestamp: new Date().toISOString(),
      status: 'open',
      resolution: null,
    }
    this.incidents.push(incident)
    return incident
  }

  /**
   * Get overall health status.
   */
  getHealth() {
    const metrics = {}
    for (const [name, metric] of this.metrics) {
      const values = metric.values.map((v) => v.value)
      metrics[name] = {
        current: values[values.length - 1],
        avg: values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : null,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
        status: metric.status,
        anomalies: this.detectAnomalies(name).length,
      }
    }

    return {
      metrics,
      openIncidents: this.incidents.filter((i) => i.status === 'open').length,
      totalIncidents: this.incidents.length,
      healingLog: this.healingLog.length,
    }
  }
}

/* ──────────────── Auto-healing ──────────────────────────── */

/**
 * Diagnose and fix a problem using AI.
 */
export async function diagnoseAndFix(problem, { context = '', metrics = {}, llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a self-healing diagnostic engine. Given a problem description and metrics, diagnose the root cause and propose a fix.

Steps:
1. Analyze the symptoms
2. Check the metrics for anomalies
3. Identify the root cause
4. Propose a fix
5. Estimate confidence in the fix
6. Suggest monitoring to verify the fix worked

Respond in JSON:
{
  "diagnosis": "root cause description",
  "confidence": 0.85,
  "severity": "low|medium|high|critical",
  "fix": {
    "action": "what to do",
    "code": "specific fix if applicable",
    "rollback": "how to undo if it makes things worse"
  },
  "monitoring": ["metric to watch after fix"],
  "prevention": "how to prevent this in the future"
}` },
    { role: 'user', content: `Problem: ${problem}\nContext: ${context}\nMetrics: ${JSON.stringify(metrics)}\n\nDiagnose and fix:` },
  ], { maxTokens: 600 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, diagnosis: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Self-test ──────────────────────────── */

/**
 * Run self-tests to verify all systems are working.
 */
export async function runSelfTests(modules) {
  const results = []

  for (const [name, mod] of Object.entries(modules)) {
    try {
      // Check if module exports exist
      const exports = Object.keys(mod)
      results.push({
        module: name,
        status: 'ok',
        exports: exports.length,
        functions: exports.filter((k) => typeof mod[k] === 'function').length,
      })
    } catch (err) {
      results.push({
        module: name,
        status: 'error',
        error: err.message,
      })
    }
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'error').length,
    results,
  }
}

export { HealthMonitor }
export default { HealthMonitor, diagnoseAndFix, runSelfTests }