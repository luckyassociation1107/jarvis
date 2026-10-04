/**
 * JARVIS System Intelligence — deep understanding of YOUR machine.
 *
 * Not just running commands. UNDERSTANDING the system:
 *   - What's running and why
 *   - What's using resources
 *   - What's broken and how to fix it
 *   - What can be optimized
 *   - What's the health of the system
 *
 * "I know your machine better than you do. Not because I'm smarter,
 *  because I'm paying attention."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── System Intelligence ──────────────────────────── */

/**
 * Deep system analysis.
 */
export async function analyzeSystem({ os = 'windows', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze this system comprehensively.

Check:
1. CPU usage and top processes
2. Memory usage and what's consuming it
3. Disk usage and free space
4. Network connections
5. Running services
6. Startup programs
7. Recent errors in event logs
8. Security status
9. Driver status
10. Update status

Provide actionable recommendations.
OS: ${os}` },
    { role: 'user', content: `Analyze this ${os} system.\n\nSystem analysis:` },
  ], { maxTokens: 800 })

  return response
}

/**
 * Troubleshoot a system issue.
 */
export async function troubleshoot(issue, { context = '', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Troubleshoot this system issue step by step.

Approach:
1. Identify the SYMPTOMS (what's happening)
2. Identify the SCOPE (when, where, how often)
3. Identify the CAUSE (what changed recently)
4. Propose DIAGNOSTIC STEPS (commands to run)
5. Propose FIXES (from least to most invasive)
6. Verify the fix worked

Be specific. Give exact commands. Explain what each does.` },
    { role: 'user', content: `Issue: ${issue}\n${context ? `Context: ${context}` : ''}\n\nTroubleshooting:` },
  ], { maxTokens: 800 })

  return response
}

/**
 * Optimize system performance.
 */
export async function optimizeSystem({ os = 'windows', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Suggest system optimizations for ${os}.

Categories:
1. Startup optimization (remove unnecessary startup programs)
2. Service optimization (disable unnecessary services)
3. Memory optimization (reduce background processes)
4. Disk optimization (cleanup, defrag if HDD)
5. Network optimization (DNS, TCP settings)
6. Power optimization (balance performance vs battery)
7. Visual optimization (disable unnecessary effects)
8. Security optimization (firewall, updates)

For each: what to do, exact commands, expected impact, risk level.` },
    { role: 'user', content: `Optimize this ${os} system.\n\nOptimizations:` },
  ], { maxTokens: 1000 })

  return response
}

/**
 * Monitor system health over time.
 */
export async function healthReport({ metrics = {}, llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Generate a system health report from these metrics.

Assess:
1. Overall health score (1-100)
2. CPU health
3. Memory health
4. Disk health
5. Network health
6. Security health
7. Top concerns
8. Recommendations

Be honest. If something is bad, say so.` },
    { role: 'user', content: `Metrics:\n${JSON.stringify(metrics).slice(0, 1000)}\n\nHealth report:` },
  ], { maxTokens: 600 })

  return response
}

export default { analyzeSystem, troubleshoot, optimizeSystem, healthReport }