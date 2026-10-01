/**
 * JARVIS's multilingual intent and English-prompt stage.
 *
 * User text is first understood in its source language, then transformed into a
 * faithful, high-level English instruction for the capability that will act on
 * it. Code tasks get a coding brief; ordinary conversation and device actions
 * stay faithful to what the user actually asked. Original words are retained in
 * the working context so a translation mistake can be corrected rather than
 * silently becoming the user's intent.
 *
 * Failure is soft. If the selected local model is absent, unavailable within
 * the RAM plan, or returns malformed JSON, callers receive the original text
 * and no invented intent. Non-English capability quality still depends on the
 * selected model; the planner reports lower tiers rather than promising equal
 * accuracy at every memory size.
 */

import { complete } from './local-llm.mjs'

const SLOT = 'chat'

const KNOWN = {
  en: 'English', te: 'Telugu', hi: 'Hindi', ta: 'Tamil', kn: 'Kannada',
  ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', es: 'Spanish', fr: 'French',
  de: 'German', ja: 'Japanese', zh: 'Chinese', ar: 'Arabic',
}

const INTENTS = new Set(['launch', 'close', 'search', 'system', 'media', 'vision', 'code', 'chat'])

const SYSTEM = `You are JARVIS's multilingual intent extractor and prompt-preparation stage.

The user may write or speak in any language. Understand the full request, identify
its language and intent, and reply with one JSON object only—no markdown or prose:
{
  "language": "<ISO 639-1 code of the source language>",
  "english": "<faithful English translation of the user's words>",
  "intent": "<one of: launch, close, search, system, media, vision, code, chat>",
  "target": "<the app, file, object or subject, or empty string>",
  "prompt": "<a clear high-level English instruction for the next model>",
  "confidence": <number from 0.0 to 1.0>
}

Rules:
- Preserve names, numbers, constraints and the user's actual goal. Do not invent
  requirements or claim the task has already been completed.
- Choose code when the user asks to create, edit, explain, debug, test or review
  software. The prompt for code must be suitable for an English-only coding
  model: state the desired outcome, relevant constraints and expected output.
  Expand unclear phrasing only conservatively; mark missing details as questions
  instead of making them up.
- For other intents, prompt is a concise, actionable English restatement—not an
  answer and not a more ambitious task than the user requested.
- "chrome close cheyyu" means close Chrome. A normal greeting is chat.
- Do not claim to see an image. The separate vision stage will describe pixels.
- If a sentence is ambiguous, preserve that uncertainty and lower confidence.`

/**
 * Extract intent, translate faithfully, and prepare the downstream English prompt.
 * @returns {Promise<{language:string|null,english:string,intent:string,target:string,prompt:string,confidence:number,raw:boolean}>}
 */
export async function extractIntent(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) {
    return { language: null, english: '', intent: 'chat', target: '', prompt: '', confidence: 0, raw: true }
  }

  let out
  try {
    out = await complete(SLOT, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: trimmed },
    ], { maxTokens: 500 })
  } catch {
    return { language: null, english: trimmed, intent: 'chat', target: '', prompt: trimmed, confidence: 0, raw: true }
  }

  const parsed = parseJson(out)
  if (!parsed) {
    return { language: null, english: trimmed, intent: 'chat', target: '', prompt: trimmed, confidence: 0, raw: true }
  }

  const language = normaliseLanguage(parsed.language)
  const intent = INTENTS.has(parsed.intent) ? parsed.intent : 'chat'
  const english = typeof parsed.english === 'string' && parsed.english.trim()
    ? parsed.english.trim()
    : trimmed
  const prompt = typeof parsed.prompt === 'string' && parsed.prompt.trim()
    ? parsed.prompt.trim()
    : english
  return {
    language,
    english,
    intent,
    target: typeof parsed.target === 'string' ? parsed.target.trim() : '',
    prompt,
    confidence: clamp(Number(parsed.confidence) || 0),
    raw: false,
  }
}

/** Translate text to English without using it as an answer. */
export async function toEnglish(text) {
  const result = await extractIntent(text)
  return result.english
}

export function languageName(code) {
  return KNOWN[code] ?? code ?? 'unknown'
}

/**
 * Create a new conversation array. The visible transcript remains the original
 * utterance, while downstream models receive the English instruction and a
 * compact record of the original language and intent.
 */
export async function translateInbound(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages

  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { lastUser = i; break }
  }
  if (lastUser === -1) return messages

  const original = messages[lastUser]
  const parts = Array.isArray(original.content) ? original.content : null
  const text = typeof original.content === 'string'
    ? original.content
    : parts?.filter((part) => part?.type === 'text').map((part) => part.text).join(' ') ?? ''
  if (!text.trim()) return messages

  const result = await extractIntent(text)
  if (result.raw) return messages
  const alreadyEnglish = result.language === 'en' && result.confidence >= 0.6
  if (alreadyEnglish && result.intent !== 'code') return messages

  const rewritten = [...messages]
  const prompt = result.prompt || result.english
  const compiled = [
    `[JARVIS_INTENT: ${result.intent.toUpperCase()}]`,
    `[SOURCE_LANGUAGE: ${result.language ?? 'uncertain'}]`,
    `Faithful English translation: ${result.english}`,
    result.intent === 'code'
      ? `High-level English coding prompt: ${prompt}`
      : `Downstream English instruction: ${prompt}`,
    `Original user words: ${text}`,
  ].join('\n')
  rewritten[lastUser] = {
    ...original,
    content: parts
      ? [
          { type: 'text', text: compiled },
          ...parts.filter((part) => part?.type === 'image_url'),
        ]
      : compiled,
  }
  return rewritten
}

function parseJson(text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

function normaliseLanguage(value) {
  if (typeof value !== 'string') return null
  const code = value.trim().toLowerCase().slice(0, 2)
  return /^[a-z]{2}$/.test(code) ? code : null
}

function clamp(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
