/**
 * JARVIS Document Generator — generates professional documents.
 *
 *   - Reports with proper formatting
 *   - Proposals and pitches
 *   - Presentations (outline and content)
 *   - Legal documents (templates)
 *   - Technical documentation
 *   - Blog posts and articles
 *
 * "I need a proposal for the client."
 *  Done. 8-page proposal with executive summary, scope, timeline, pricing.
 *  Formatted. Ready to send."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Document Generator ──────────────────────────── */

/**
 * Generate a professional document.
 */
export async function generateDocument(type, { 
  topic = '',
  audience = 'professional',
  length = 'medium',
  tone = 'formal',
  context = '',
  llm = complete,
} = {}) {
  const typeGuide = {
    report: `Structure: Title, Executive Summary, Introduction, Findings, Analysis, Recommendations, Conclusion, Appendix.
Style: Data-driven, objective, well-organized. Use headings and bullet points.`,

    proposal: `Structure: Cover, Executive Summary, Problem Statement, Proposed Solution, Timeline, Budget, Team, Terms.
Style: Persuasive but professional. Focus on value proposition and ROI.`,

    presentation: `Structure: Title slide, Agenda, Problem, Solution, Benefits, Demo, Q&A, Call to Action.
Style: Visual, concise. Each slide: one key point, supporting data, speaker notes.`,

    documentation: `Structure: Overview, Getting Started, API Reference, Examples, Troubleshooting, FAQ.
Style: Clear, precise, with code examples. Assume reader is technical.`,

    article: `Structure: Hook, Introduction, Main Points (3-5), Evidence, Conclusion, Call to Action.
Style: Engaging, conversational but authoritative. Use stories and examples.`,

    email: `Structure: Subject, Greeting, Context, Request/Update, Action Items, Closing.
Style: Concise, professional. Every sentence must earn its place.`,

    letter: `Structure: Header, Date, Recipient, Salutation, Body (3-4 paragraphs), Closing, Signature.
Style: Formal, respectful. Match tone to purpose (complaint, request, thank you).`,
  }

  const lengthGuide = {
    brief: '1 page or less. Get to the point immediately.',
    medium: '3-5 pages. Balanced detail and brevity.',
    detailed: '8-15 pages. Comprehensive with evidence.',
  }

  const response = await llm('chat', [
    { role: 'system', content: `Generate a professional ${type}.

${typeGuide[type] || typeGuide.report}
Length: ${lengthGuide[length] || lengthGuide.medium}
Tone: ${tone}
Audience: ${audience}

Rules:
1. Professional formatting with clear headings
2. No filler — every paragraph must add value
3. Specific numbers and facts when possible
4. Clear call to action or next steps
5. Proper grammar and style throughout` },
    { role: 'user', content: `Topic: ${topic}\n${context ? `Context: ${context}` : ''}\n\n${type}:` },
  ], { maxTokens: length === 'brief' ? 500 : length === 'medium' ? 1500 : 3000 })

  return response
}

/**
 * Generate presentation outline.
 */
export async function generatePresentation(topic, { slides = 10, audience = 'general', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Create a presentation outline with ${slides} slides.

For each slide:
- Title
- Key point (one sentence)
- Supporting data/evidence
- Visual suggestion (chart, image, diagram)
- Speaker notes (what to say)

Structure:
1. Title slide
2. Problem/Hook
3-7. Main content (key points with evidence)
8. Solution/Recommendation
9. Next steps/Call to action
10. Q&A` },
    { role: 'user', content: `Topic: ${topic}\nAudience: ${audience}\nSlides: ${slides}\n\nPresentation outline:` },
  ], { maxTokens: 800 })

  return response
}

/**
 * Generate technical documentation.
 */
export async function generateDocs(codeOrSpec, { type = 'api', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Generate ${type} documentation.

Include:
1. Overview (what it does, why it exists)
2. Getting Started (quick start guide)
3. Detailed Reference (every function/endpoint/feature)
4. Examples (real-world usage)
5. Error Handling (common errors and solutions)
6. Best Practices
7. FAQ

Use clear language. Include code examples. Be thorough but not verbose.` },
    { role: 'user', content: `Source:\n${codeOrSpec.slice(0, 3000)}\n\nDocumentation:` },
  ], { maxTokens: 1500 })

  return response
}

export default { generateDocument, generatePresentation, generateDocs }