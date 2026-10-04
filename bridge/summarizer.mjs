/**
 * JARVIS Summarizer — summarizes ANYTHING.
 *
 *   - Articles and blog posts
 *   - YouTube videos (via transcript)
 *   - PDFs and documents
 *   - Meeting transcripts
 *   - Email threads
 *   - Code repositories
 *   - Books
 *   - Research papers
 *
 * "I read the entire 50-page report. Here's what matters:
 *  3 key findings, 2 risks, 1 recommendation. 30-second read."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Summarizer ──────────────────────────── */

/**
 * Summarize any content with smart formatting.
 */
export async function summarize(content, { 
  type = 'auto',  // auto, article, video, document, meeting, email, code, book, paper
  length = 'medium',  // brief (2-3 sentences), medium (1 paragraph), detailed (key points)
  audience = 'general',
  llm = complete,
} = {}) {
  const lengthGuide = {
    brief: '2-3 sentences. Just the essential point.',
    medium: 'One paragraph. Key points with context.',
    detailed: 'Numbered key points with explanations. Include details.',
  }

  const typeGuide = {
    article: 'Focus on: main argument, evidence, conclusion, and why it matters.',
    video: 'Focus on: key points, demonstrations, takeaways, and action items.',
    document: 'Focus on: purpose, key findings, recommendations, and next steps.',
    meeting: 'Focus on: decisions made, action items (who, what, by when), and open questions.',
    email: 'Focus on: what they want, what action is needed, and deadline.',
    code: 'Focus on: what it does, how it works, key patterns, and potential issues.',
    book: 'Focus on: main thesis, key arguments, and practical takeaways.',
    paper: 'Focus on: research question, methodology, findings, and implications.',
  }

  const response = await llm('reason', [
    { role: 'system', content: `Summarize this content. Be precise and useful.

Length: ${lengthGuide[length] || lengthGuide.medium}
Type: ${typeGuide[type] || typeGuide.article}
Audience: ${audience}

Rules:
1. No filler words. Every word must earn its place.
2. Lead with the most important information.
3. Use specific numbers and facts when available.
4. Include "so what" — why does this matter?
5. End with actionable insight if applicable.` },
    { role: 'user', content: `Content:\n${content.slice(0, 4000)}\n\nSummary (${length}):` },
  ], { maxTokens: length === 'brief' ? 100 : length === 'medium' ? 300 : 600 })

  return response
}

/**
 * Compare and synthesize multiple sources.
 */
export async function synthesize(sources, { question = '', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Synthesize these multiple sources into one coherent analysis.

Identify:
1. Points of AGREEMENT (what all sources say)
2. Points of DISAGREEMENT (where they differ)
3. UNIQUE INSIGHTS (what only one source says)
4. GAPS (what's missing from all sources)
5. SYNTHESIS (the balanced view combining all perspectives)
6. RELIABILITY (which sources are most credible)

${question ? `Focus on answering: ${question}` : ''}` },
    { role: 'user', content: `Sources:\n${sources.map((s, i) => `--- Source ${i + 1} ---\n${s.slice(0, 1000)}`).join('\n\n')}\n\nSynthesis:` },
  ], { maxTokens: 800 })

  return response
}

/**
 * Extract key facts from content.
 */
export async function extractFacts(content, { count = 10, llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Extract the ${count} most important facts from this content.

Format each fact as:
- FACT: [the fact]
- SOURCE: [where in the content]
- RELEVANCE: [why it matters]

Prioritize by: novelty, importance, and actionability.` },
    { role: 'user', content: `Content:\n${content.slice(0, 4000)}\n\nKey facts:` },
  ], { maxTokens: 500 })

  return response
}

export default { summarize, synthesize, extractFacts }