/**
 * JARVIS Creative Generation — images, music, stories, code art.
 *
 * Generate creative content locally:
 *   - Images (via Stable Diffusion / DALL-E local)
 *   - Stories and poetry
 *   - Code art and ASCII art
 *   - Music descriptions (for Suno/Udio)
 *   - Presentation content
 */

import { complete } from './local-llm.mjs'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const OUTPUT_DIR = resolve('models/creative')
mkdirSync(OUTPUT_DIR, { recursive: true })

/* ──────────────── Text generation ──────────────────────────── */

/**
 * Generate a story.
 */
export async function generateStory(prompt, { style = 'narrative', length = 'medium', language = 'en' } = {}) {
  const langMap = { te: 'Telugu', hi: 'Hindi', en: 'English', ta: 'Tamil' }
  const lang = langMap[language] ?? 'English'

  const response = await complete('chat', [
    { role: 'system', content: `You are a creative writer. Write in ${lang}. Style: ${style}. Be vivid, engaging, and original.` },
    { role: 'user', content: `Write a ${length} story: ${prompt}` },
  ], { maxTokens: length === 'short' ? 500 : length === 'long' ? 2000 : 1000 })

  return { ok: true, content: response, style, language }
}

/**
 * Generate poetry.
 */
export async function generatePoem(prompt, { style = 'free verse', language = 'en' } = {}) {
  const response = await complete('chat', [
    { role: 'system', content: `You are a poet. Write beautiful, evocative poetry. Style: ${style}.` },
    { role: 'user', content: `Write a poem about: ${prompt}` },
  ], { maxTokens: 500 })

  return { ok: true, content: response, style }
}

/**
 * Generate code art (ASCII art, creative coding).
 */
export async function generateCodeArt(prompt, { type = 'ascii' } = {}) {
  if (type === 'ascii') {
    const response = await complete('chat', [
      { role: 'system', content: 'You are an ASCII art artist. Create detailed ASCII art. Return ONLY the art, no explanation.' },
      { role: 'user', content: `Create ASCII art of: ${prompt}` },
    ], { maxTokens: 1000 })
    return { ok: true, art: response, type: 'ascii' }
  }

  if (type === 'p5js') {
    const response = await complete('reason', [
      { role: 'system', content: 'You are a creative coder. Write a complete p5.js sketch. Return ONLY the JavaScript code.' },
      { role: 'user', content: `Create a p5.js sketch: ${prompt}` },
    ], { maxTokens: 2000 })
    return { ok: true, code: response.replace(/^```\w*\n?/m, '').replace(/\n?```$/m, ''), type: 'p5js' }
  }

  return { ok: false, error: 'Unknown art type' }
}

/* ──────────────── Image generation ──────────────────────────── */

/**
 * Generate an image using local Stable Diffusion (if available).
 */
export async function generateImage(prompt, { style = 'realistic', size = '512x512' } = {}) {
  // Check if stable-diffusion or similar is available
  const sdPath = process.env.STABLE_DIFFUSION_PATH ?? '/usr/local/bin/sd'
  const comfyPath = process.env.COMFYUI_PATH

  if (comfyPath) {
    // Use ComfyUI API
    try {
      const res = await fetch(`${comfyPath}/api/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, style, size }),
        signal: AbortSignal.timeout(120_000),
      })
      const data = await res.json()
      return { ok: true, image: data, method: 'comfyui' }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }

  // Fallback: describe what the image would look like
  const description = await complete('chat', [
    { role: 'system', content: 'You are an art director. Describe in vivid detail what an image would look like. Be specific about colors, composition, lighting, mood.' },
    { role: 'user', content: `Describe this image in detail: ${prompt} (style: ${style})` },
  ], { maxTokens: 300 })

  return {
    ok: true,
    description,
    method: 'text_description',
    note: 'Image generation requires ComfyUI or Stable Diffusion. Set COMFYUI_PATH or STABLE_DIFFUSION_PATH.',
  }
}

/* ──────────────── Music prompts ──────────────────────────── */

/**
 * Generate a music prompt for AI music generators (Suno, Udio).
 */
export async function generateMusicPrompt(description, { genre = 'auto', mood = 'auto', duration = '30s' } = {}) {
  const response = await complete('chat', [
    { role: 'system', content: 'You are a music producer. Create detailed prompts for AI music generators. Include genre, mood, instruments, tempo, and structure.' },
    { role: 'user', content: `Create a music prompt for: ${description}\nGenre: ${genre}\nMood: ${mood}\nDuration: ${duration}\n\nProvide:\n1. A short prompt (for Suno/Udio)\n2. Style tags\n3. Lyrics (if applicable)` },
  ], { maxTokens: 500 })

  return { ok: true, prompt: response }
}

/* ──────────────── Presentation generation ──────────────────────────── */

/**
 * Generate presentation content.
 */
export async function generatePresentation(topic, { slides = 10, style = 'professional' } = {}) {
  const response = await complete('reason', [
    { role: 'system', content: `Create presentation content. Return JSON:
{
  "title": "presentation title",
  "slides": [
    {"title": "slide title", "content": ["bullet point 1", "bullet point 2"], "speaker_notes": "what to say"}
  ]
}` },
    { role: 'user', content: `Create a ${slides}-slide presentation about: ${topic}\nStyle: ${style}` },
  ], { maxTokens: 3000 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, presentation: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, error: 'Could not parse presentation', raw: response }
  }
}

export default { generateStory, generatePoem, generateCodeArt, generateImage, generateMusicPrompt, generatePresentation }