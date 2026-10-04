/**
 * JARVIS Data Analytics — analyze any data, generate insights.
 *
 *   - CSV/JSON data analysis
 *   - Statistical analysis
 *   - Trend detection
 *   - Anomaly detection
 *   - Data visualization suggestions
 *   - Report generation
 *
 * "Your sales data shows a 23% increase on weekends.
 *  Best performing product: Widget X. Worst: Widget Z.
 *  Anomaly detected: March 15 spike — likely marketing campaign.
 *  Recommendation: increase weekend ad spend."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Data Analytics ──────────────────────────── */

/**
 * Analyze any dataset.
 */
export async function analyzeData(data, { question = '', format = 'auto', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze this data and provide insights.

Include:
1. DATA OVERVIEW — what we're looking at, size, structure
2. KEY STATISTICS — mean, median, mode, range, std dev
3. TRENDS — what's increasing, decreasing, cyclical
4. PATTERNS — correlations, clusters, segments
5. ANOMALIES — unusual data points, outliers
6. INSIGHTS — what the data tells us
7. RECOMMENDATIONS — what to do based on the data
8. VISUALIZATION — what charts would best show this

Be specific with numbers. Don't just say "there's a trend" — say "23% increase over 3 months".` },
    { role: 'user', content: `Data:\n${JSON.stringify(data).slice(0, 3000)}\n${question ? `\nQuestion: ${question}` : ''}\n\nAnalysis:` },
  ], { maxTokens: 1000 })

  return response
}

/**
 * Detect anomalies in data.
 */
export async function detectAnomalies(data, { metric = '', threshold = 'auto', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Detect anomalies in this data.

For each anomaly:
1. What data point is unusual
2. Why it's unusual (how far from normal)
3. Possible explanations
4. Severity (low/medium/high/critical)
5. Recommended action

Use statistical methods: z-scores, IQR, moving averages.` },
    { role: 'user', content: `Data:\n${JSON.stringify(data).slice(0, 3000)}\n${metric ? `Focus metric: ${metric}` : ''}\n\nAnomalies:` },
  ], { maxTokens: 600 })

  return response
}

/**
 * Generate a data report.
 */
export async function generateReport(data, { title = 'Data Report', audience = 'executive', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Generate a professional data report.

Structure:
1. EXECUTIVE SUMMARY (3-5 bullet points)
2. KEY FINDINGS (with supporting data)
3. TRENDS AND PATTERNS
4. RISKS AND CONCERNS
5. RECOMMENDATIONS (actionable, specific)
6. APPENDIX (detailed statistics)

Audience: ${audience}
- Executive: high-level, focus on decisions
- Technical: detailed, include methodology
- General: accessible, use analogies` },
    { role: 'user', content: `Title: ${title}\nData:\n${JSON.stringify(data).slice(0, 3000)}\n\nReport:` },
  ], { maxTokens: 1200 })

  return response
}

/**
 * Compare datasets.
 */
export async function compareDatasets(dataset1, dataset2, { label1 = 'Dataset A', label2 = 'Dataset B', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Compare these two datasets.

Include:
1. STRUCTURE — how they differ in format
2. OVERLAP — what they have in common
3. DIFFERENCES — key divergences
4. TRENDS — how they've changed relative to each other
5. INSIGHTS — what the comparison tells us
6. RECOMMENDATIONS — which to use and when` },
    { role: 'user', content: `${label1}:\n${JSON.stringify(dataset1).slice(0, 1500)}\n\n${label2}:\n${JSON.stringify(dataset2).slice(0, 1500)}\n\nComparison:` },
  ], { maxTokens: 800 })

  return response
}

export default { analyzeData, detectAnomalies, generateReport, compareDatasets }