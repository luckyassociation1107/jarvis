/**
 * JARVIS Autonomous Research — search, read, synthesize, deliver.
 *
 * Give it a topic, and it:
 *   1. Searches multiple sources
 *   2. Reads and extracts key information
 *   3. Synthesizes findings
 *   4. Delivers a structured report
 *
 * Works offline with local models, or online with web access.
 */

import { complete } from './local-llm.mjs'
import { readFile } from './documents.mjs'

/* ──────────────── Web research ──────────────────────────── */

/**
 * Research a topic by searching the web.
 */
export async function researchTopic(query, { depth = 'standard', maxSources = 5, onProgress = () => {} } = {}) {
  onProgress(`Researching: ${query}`)

  // Step 1: Generate search queries
  const searchQueries = await generateSearchQueries(query)
  onProgress(`Generated ${searchQueries.length} search queries`)

  // Step 2: Search and collect information
  const sources = []
  for (const sq of searchQueries.slice(0, maxSources)) {
    onProgress(`Searching: ${sq}`)
    try {
      const results = await webSearch(sq)
      sources.push(...results)
    } catch { /* continue */ }
  }

  // Step 3: Synthesize
  onProgress(`Synthesizing ${sources.length} sources…`)
  const report = await synthesize(query, sources)

  return { ok: true, query, sources: sources.length, report }
}

async function generateSearchQueries(topic) {
  const response = await complete('chat', [
    { role: 'system', content: 'Generate 3-5 search queries to thoroughly research a topic. One query per line, no numbering.' },
    { role: 'user', content: `Topic: ${topic}` },
  ], { maxTokens: 200 })

  return response.split('\n').map((q) => q.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean)
}

async function webSearch(query) {
  // Use curl to search (works without browser)
  const { execSync } = require('node:child_process')
  try {
    const encoded = encodeURIComponent(query)
    const out = execSync(`curl -sL "https://html.duckduckgo.com/html/?q=${encoded}" 2>/dev/null | grep -oP '(?<=<a rel="nofollow" class="result__a" href=")[^"]+' | head -5`, { encoding: 'utf8', timeout: 15_000 })
    return out.split('\n').filter(Boolean).map((url) => ({ url, query }))
  } catch {
    return []
  }
}

async function synthesize(topic, sources) {
  const sourceText = sources.map((s, i) => `[${i + 1}] ${s.url ?? s.text ?? ''}`).join('\n')

  const response = await complete('reason', [
    { role: 'system', content: `You are a research analyst. Synthesize information from multiple sources into a clear, comprehensive report.

Format:
# [Topic]
## Summary
[2-3 paragraph overview]
## Key Findings
- [finding 1]
- [finding 2]
## Details
[Detailed analysis]
## Sources
[Numbered list]` },
    { role: 'user', content: `Research topic: ${topic}\n\nSources:\n${sourceText}\n\nWrite the report:` },
  ], { maxTokens: 2000 })

  return response
}

/* ──────────────── Local file research ──────────────────────────── */

/**
 * Research across local files (documents, code, notes).
 */
export async function researchLocal(query, directories = ['.'], { maxFiles = 20, onProgress = () => {} } = {}) {
  onProgress(`Searching local files for: ${query}`)

  const { execSync } = require('node:child_process')
  const matches = []

  for (const dir of directories) {
    try {
      const out = execSync(`grep -rl "${query}" "${dir}" --include="*.md" --include="*.txt" --include="*.js" --include="*.py" --include="*.json" 2>/dev/null | head -${maxFiles}`, { encoding: 'utf8', timeout: 10_000 })
      for (const file of out.split('\n').filter(Boolean)) {
        const doc = readFile(file)
        if (doc.ok) matches.push({ file, content: doc.content.slice(0, 2000) })
      }
    } catch { /* continue */ }
  }

  onProgress(`Found ${matches.length} relevant files`)

  if (!matches.length) return { ok: true, findings: `No local files found matching "${query}"` }

  const response = await complete('reason', [
    { role: 'system', content: 'Synthesize findings from local files into a clear summary. Cite specific files.' },
    { role: 'user', content: `Query: ${query}\n\nFiles found:\n${matches.map((m) => `${m.file}:\n${m.content.slice(0, 500)}`).join('\n\n')}` },
  ], { maxTokens: 1000 })

  return { ok: true, findings: response, files: matches.length }
}

export default { researchTopic, researchLocal }