/**
 * JARVIS Creative Writer — not just generating text. Creating ART.
 *
 * Full creative suite:
 *   - Novel/story writing with character development
 *   - Screenplay and script writing
 *   - Poetry in any style (sonnet, haiku, free verse, rap)
 *   - Song lyrics with rhyme and meter
 *   - Copywriting and marketing
 *   - Technical writing
 *   - Speech writing
 *   - World-building and lore creation
 *
 * "I don't just write words. I craft experiences."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Story engine ──────────────────────────── */

/**
 * Write a story with full narrative structure.
 */
export async function writeStory(premise, { 
  genre = 'literary fiction',
  length = 'short',  // flash, short, novelette, novel_chapter
  tone = 'balanced',
  pov = 'third_limited',
  themes = [],
  llm = complete,
} = {}) {
  const wordCounts = { flash: 500, short: 2000, novelette: 5000, novel_chapter: 3000 }
  const targetWords = wordCounts[length] || 2000

  const response = await llm('chat', [
    { role: 'system', content: `You are a master storyteller. Write compelling fiction.

Style guidelines:
- Genre: ${genre}
- Tone: ${tone}
- POV: ${pov}
- Themes: ${themes.join(', ') || 'universal human experience'}
- Target: ~${targetWords} words

Techniques:
- Show, don't tell
- Strong opening hook
- Vivid sensory details
- Authentic dialogue
- Emotional resonance
- Satisfying but not predictable ending
- Subtext and layered meaning

Write the COMPLETE story. No placeholders.` },
    { role: 'user', content: `Premise: ${premise}\n\nWrite the story:` },
  ], { maxTokens: Math.min(4000, targetWords * 2) })

  return { premise, genre, length, story: response }
}

/* ──────────────── Poetry engine ──────────────────────────── */

/**
 * Write poetry in any style.
 */
export async function writePoem(topic, { 
  style = 'free_verse',  // sonnet, haiku, limerick, free_verse, rap, ghazal, villanelle
  mood = 'contemplative',
  language = 'english',
  llm = complete,
} = {}) {
  const styleInstructions = {
    sonnet: '14 lines, iambic pentameter, ABAB CDCD EFEF GG rhyme scheme',
    haiku: '3 lines: 5-7-5 syllables. Nature imagery. Seasonal reference.',
    limerick: '5 lines, AABBA rhyme, humorous, bouncy rhythm',
    free_verse: 'No fixed structure. Focus on imagery, rhythm, and line breaks.',
    rap: 'Strong rhythm, internal rhymes, wordplay, flow. Aggressive or smooth.',
    ghazal: 'Couplets, refrain at end of each, addressing a beloved. Urdu/Hindi tradition.',
    villanelle: '19 lines, 5 tercets + quatrain, two refrains. Obsessive, circular.',
    spoken_word: 'Performance poetry. Raw, emotional, rhythmic. Meant to be heard.',
  }

  const response = await llm('chat', [
    { role: 'system', content: `You are a master poet. Write in ${style} style.

Form: ${styleInstructions[style] || 'Free expression'}
Mood: ${mood}
Language: ${language}

Rules:
- Every word must earn its place
- Rhythm matters as much as meaning
- Surprise the reader
- End with impact
- Be specific, not generic
- One truly original image per poem minimum` },
    { role: 'user', content: `Write a ${style} poem about: ${topic}` },
  ], { maxTokens: 500 })

  return { topic, style, mood, poem: response }
}

/* ──────────────── Screenplay engine ──────────────────────────── */

/**
 * Write a screenplay scene.
 */
export async function writeScene(premise, { 
  genre = 'drama',
  characters = [],
  setting = '',
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Write a screenplay scene in proper format.

Format:
- Scene heading: INT./EXT. LOCATION - TIME
- Action lines: present tense, visual
- Character names: centered, uppercase
- Dialogue: natural, subtext-heavy
- Parentheticals: only when needed
- Transitions: minimal

Make dialogue sound REAL. People don't speak in complete sentences.
Subtext > text. What they DON'T say matters more.` },
    { role: 'user', content: `Premise: ${premise}\nGenre: ${genre}\nCharacters: ${characters.join(', ') || 'to be determined'}\nSetting: ${setting || 'to be determined'}\n\nWrite the scene:` },
  ], { maxTokens: 2000 })

  return { premise, genre, scene: response }
}

/* ──────────────── Lyrics engine ──────────────────────────── */

/**
 * Write song lyrics.
 */
export async function writeLyrics(theme, { 
  genre = 'pop',
  mood = 'uplifting',
  structure = 'verse_chorus',
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Write song lyrics. Focus on:
- Catchy hooks
- Consistent meter
- Rhyme (but not forced)
- Emotional arc
- Singability (read it aloud in your head)
- Structure: ${structure}
- Genre conventions: ${genre}

Don't be cliché. Find a fresh angle on the theme.
The chorus should be the emotional core.` },
    { role: 'user', content: `Theme: ${theme}\nGenre: ${genre}\nMood: ${mood}\n\nWrite the lyrics:` },
  ], { maxTokens: 1000 })

  return { theme, genre, mood, lyrics: response }
}

/* ──────────────── World builder ──────────────────────────── */

/**
 * Build a fictional world with deep lore.
 */
export async function buildWorld(concept, { 
  genre = 'fantasy',
  depth = 'detailed',  // sketch, moderate, detailed, encyclopedic
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `You are a world-builder. Create a rich, consistent fictional world.

Include:
- Geography and climate
- History and major events
- Cultures and societies
- Magic/technology systems (if applicable)
- Political structures
- Economy and trade
- Religion and mythology
- Notable characters/factions
- Conflicts and tensions
- Unique details that make it feel REAL

Depth: ${depth}
Genre: ${genre}

Make it internally consistent. Every detail should connect.` },
    { role: 'user', content: `World concept: ${concept}\n\nBuild the world:` },
  ], { maxTokens: 3000 })

  return { concept, genre, world: response }
}

/* ──────────────── Speech writer ──────────────────────────── */

/**
 * Write a speech.
 */
export async function writeSpeech(topic, { 
  occasion = 'general',
  audience = 'general',
  duration = '5 minutes',
  tone = 'inspiring',
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Write a powerful speech.

Structure:
1. Hook — grab attention in the first 10 seconds
2. Problem — what's wrong, why it matters
3. Solution — your vision, your idea
4. Evidence — stories, data, examples
5. Call to action — what should the audience DO
6. Close — memorable final line

Rhetorical devices:
- Rule of three
- Repetition for emphasis
- Personal stories
- Rhetorical questions
- Contrast (before/after, old/new)

Duration: ${duration}
Tone: ${tone}
Audience: ${audience}` },
    { role: 'user', content: `Topic: ${topic}\nOccasion: ${occasion}\n\nWrite the speech:` },
  ], { maxTokens: 2000 })

  return { topic, occasion, audience, speech: response }
}

export default { writeStory, writePoem, writeScene, writeLyrics, buildWorld, writeSpeech }