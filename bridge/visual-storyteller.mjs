/**
 * JARVIS Visual Storyteller — turning data into narratives.
 *
 * Not just charts. STORIES with data:
 *   - Infographic generation
 *   - Data narrative creation
 *   - Visual metaphor design
 *   - Timeline visualization
 *   - Comparison dashboards
 *   - Story arc with data points
 *
 * "Numbers are boring. Stories with numbers change the world."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Data storytelling ──────────────────────────── */

/**
 * Turn data into a compelling story.
 */
export async function tellStory(data, { 
  audience = 'general',
  purpose = 'inform',  // inform, persuade, inspire, warn
  format = 'narrative',  // narrative, infographic, presentation, report
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `You are a data storyteller. Turn raw data into a compelling narrative.

Story structure:
1. HOOK — surprising finding or relatable scenario
2. CONTEXT — why this matters, what's at stake
3. DATA — present the key numbers (but make them meaningful)
4. INSIGHT — what the data reveals (the "aha" moment)
5. IMPLICATION — what should we do about it
6. CLOSE — memorable ending

Rules:
- One number is a fact. Two numbers are a comparison. Three numbers are a story.
- Use analogies and comparisons to make numbers real
- "50% increase" means nothing. "Doubled" means everything.
- Find the human angle in every dataset
- Audience: ${audience}
- Purpose: ${purpose}` },
    { role: 'user', content: `Data:\n${JSON.stringify(data).slice(0, 1500)}\nFormat: ${format}\n\nData story:` },
  ], { maxTokens: 1500 })

  return { data, audience, purpose, format, story: response }
}

/* ──────────────── Infographic generator ──────────────────────────── */

/**
 * Generate an infographic specification.
 */
export async function generateInfographic(data, { 
  title = '',
  style = 'modern',  // modern, minimal, playful, corporate, dark
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Design an infographic specification. Output the structure, visual elements, and text content.

Style: ${style}

Include:
1. Header section (title, subtitle, key stat)
2. Main content (3-5 key data points with visuals)
3. Supporting details
4. Call to action or conclusion
5. Color palette suggestion
6. Icon/illustration suggestions
7. Layout description

Make it scannable — people read infographics in 10 seconds.` },
    { role: 'user', content: `Title: ${title || 'Data Insights'}\nData:\n${JSON.stringify(data).slice(0, 1000)}\n\nInfographic spec:` },
  ], { maxTokens: 800 })

  return { title, style, specification: response }
}

/* ──────────────── Visual metaphors ──────────────────────────── */

/**
 * Find the perfect visual metaphor for a concept.
 */
export async function findMetaphor(concept, { 
  audience = 'general',
  count = 3,
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Find powerful visual metaphors for abstract concepts.

A great metaphor:
- Maps the unfamiliar to the familiar
- Is immediately intuitive
- Carries the right emotional weight
- Can be visualized easily
- Resonates with the audience

Find ${count} different metaphors, each with a different angle.` },
    { role: 'user', content: `Concept: ${concept}\nAudience: ${audience}\n\nVisual metaphors:` },
  ], { maxTokens: 400 })

  return { concept, audience, metaphors: response }
}

/* ──────────────── Comparison builder ──────────────────────────── */

/**
 * Create a compelling comparison between options.
 */
export async function buildComparison(items, { 
  criteria = [],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Build a compelling comparison that helps people make decisions.

Structure:
1. Quick summary (winner at a glance)
2. Key differentiators (what makes each unique)
3. Detailed comparison (criteria × items matrix)
4. Best for... (each item is best for a specific use case)
5. Final recommendation with reasoning

Make it visual even in text format. Use tables, symbols, and clear hierarchy.` },
    { role: 'user', content: `Items: ${items.join(', ')}\nCriteria: ${criteria.join(', ') || 'determine automatically'}\n\nComparison:` },
  ], { maxTokens: 800 })

  return { items, comparison: response }
}

/* ──────────────── Timeline narrative ──────────────────────────── */

/**
 * Create a narrative timeline of events.
 */
export async function narrativeTimeline(events, { 
  theme = '',
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Create a narrative timeline — not just dates, but a STORY through time.

Structure:
1. Opening context (what was the world like before)
2. Each event is a story beat (not just "X happened")
3. Show cause and effect between events
4. Identify turning points
5. Build to a climax
6. Show the aftermath

Make it feel like reading a story, not a textbook.` },
    { role: 'user', content: `Events:\n${events.map((e) => `- ${e}`).join('\n')}${theme ? `\nTheme: ${theme}` : ''}\n\nNarrative timeline:` },
  ], { maxTokens: 1000 })

  return { events, theme, narrative: response }
}

export default { tellStory, generateInfographic, findMetaphor, buildComparison, narrativeTimeline }