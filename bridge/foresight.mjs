/**
 * JARVIS Foresight Engine — seeing the future before it happens.
 *
 * Not prediction. FORESIGHT:
 *   - Trend analysis and extrapolation
 *   - Scenario planning (multiple futures)
 *   - Early warning signals detection
 *   - Black swan identification
 *   - Opportunity window detection
 *   - Risk horizon scanning
 *
 * "I don't predict the future. I see the SIGNALS that create it."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Trend analysis ──────────────────────────── */

/**
 * Analyze trends and extrapolate forward.
 */
export async function analyzeTrends(domain, { 
  timeframe = '1 year',
  dataPoints = [],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze trends in this domain and project forward.

Method:
1. Identify current trends (what's growing, declining, stable)
2. Find inflection points (where trends might change)
3. Identify leading indicators (early signals)
4. Project trends forward with confidence intervals
5. Identify potential disruption points
6. Consider S-curves, exponential growth, and saturation points

Timeframe: ${timeframe}

Respond in JSON:
{
  "trends": [
    {
      "name": "...",
      "direction": "up|down|stable|cyclical",
      "strength": "strong|moderate|weak",
      "confidence": 0.8,
      "projection": "where this leads in ${timeframe}",
      "leading_indicators": ["signal 1", "signal 2"]
    }
  ],
  "inflection_points": [
    { "event": "...", "probability": 0.6, "impact": "high", "timing": "Q2 2025" }
  ],
  "disruptions": ["potential disruption 1"],
  "opportunities": ["opportunity arising from trends"],
  "overall_direction": "summary of where things are heading"
}` },
    { role: 'user', content: `Domain: ${domain}${dataPoints.length ? `\nData points: ${dataPoints.join(', ')}` : ''}\nTimeframe: ${timeframe}\n\nTrend analysis:` },
  ], { maxTokens: 1000 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, analysis: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Early warning system ──────────────────────────── */

/**
 * Detect early warning signals for potential events.
 */
export async function detectEarlyWarnings(context, { 
  watchFor = [],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Detect early warning signals for potential events.

For each potential event:
1. What are the leading indicators?
2. What signals would appear BEFORE the event?
3. How early would we see them?
4. What's the current state of each indicator?
5. What's the overall risk level?

Be specific about what to MONITOR.` },
    { role: 'user', content: `Context: ${context}\nWatching for: ${watchFor.join(', ') || 'any significant changes'}\n\nEarly warning analysis:` },
  ], { maxTokens: 600 })

  return response
}

/* ──────────────── Scenario planning ──────────────────────────── */

/**
 * Plan for multiple possible futures.
 */
export async function scenarioPlan(situation, { 
  scenarios = 4,
  timeframe = '6 months',
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Create ${scenarios} distinct future scenarios.

Each scenario should be:
- Plausible (not fantasy)
- Distinct (fundamentally different from others)
- Complete (describe the full state)
- With probability estimate

For each scenario:
1. Description of the future state
2. Key events that led there
3. Probability (should sum to ~100%)
4. Early signals that indicate this path
5. Best response strategy
6. Opportunities in this scenario
7. Risks in this scenario

Timeframe: ${timeframe}` },
    { role: 'user', content: `Situation: ${situation}\nScenarios: ${scenarios}\nTimeframe: ${timeframe}\n\nScenario planning:` },
  ], { maxTokens: 1500 })

  return { situation, scenarios: response }
}

/* ──────────────── Opportunity scanner ──────────────────────────── */

/**
 * Scan for emerging opportunities.
 */
export async function scanOpportunities(domain, { 
  filters = [],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Scan for emerging opportunities in this domain.

Look for:
1. Gaps in the market
2. Emerging needs
3. Technology enablers
4. Regulatory changes creating openings
5. Shifts in consumer behavior
6. Underserved segments
7. Timing windows (when to act)

For each opportunity:
- Description
- Window of opportunity (how long it stays open)
- Difficulty to capture
- Potential reward
- First mover advantage assessment` },
    { role: 'user', content: `Domain: ${domain}\nFilters: ${filters.join(', ') || 'none'}\n\nOpportunities:` },
  ], { maxTokens: 800 })

  return response
}

/* ──────────────── Risk horizon ──────────────────────────── */

/**
 * Scan the risk horizon — what threats are approaching?
 */
export async function riskHorizonScan(context, { 
  timeframe = '1 year',
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Scan the risk horizon for approaching threats.

Categorize by timeframe:
- Immediate (0-30 days)
- Near-term (1-3 months)
- Medium-term (3-12 months)
- Long-term (1-5 years)

For each risk:
- Description
- Probability
- Impact if it occurs
- Current trajectory (getting worse/better/stable)
- Mitigation options
- Cost of mitigation vs cost of risk` },
    { role: 'user', content: `Context: ${context}\nTimeframe: ${timeframe}\n\nRisk horizon scan:` },
  ], { maxTokens: 800 })

  return response
}

export default { analyzeTrends, detectEarlyWarnings, scenarioPlan, scanOpportunities, riskHorizonScan }