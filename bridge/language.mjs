/**
 * JARVIS's ears, for languages other than English.
 *
 * The pipeline has three model slots and this is the one that was missing:
 * vision sees, coder builds, and this one *understands*. A user who says
 * "computer lo chrome close cheyyu" should not have to speak English to their
 * own machine.
 *
 * Two jobs, deliberately separated:
 *
 *   1. extractIntent  — what does this sentence want, in a structured form the
 *      tool router can act on
 *   2. toEnglish      — the same sentence in English, so the reasoning model
 *      downstream never has to see a language it was not trained for
 *
 * Both go through one small model, because the job is classification and
 * translation rather than reasoning, and a 0.5b model does it in well under a
 * second. Routing this through the 7b coder would triple the latency of every
 * command for no gain.
 *
 * Failure is soft. If the model is unreachable, or returns something
 * unparseable, the caller gets the original text back with `language: null` and
 * the router proceeds in English exactly as it did before this file existed.
 * A feature that breaks the whole assistant when the model is down is not a
 * feature.
 */

import { complete } from './local-llm.mjs'

/** Slot name, so the model can be swapped independently of the others. */
const SLOT = 'chat'

/**
 * Languages worth detecting. Not an exhaustive list — the model detects
 * anything — but these are the ones that get a first-class name back, because
 * they are what this build was asked about.
 */
const KNOWN = {
  en: 'English',
  te: 'Telugu',
  hi: 'Hindi',
  ta: 'Tamil',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  bn: 'Bengali',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  zh: 'Chinese',
  ar: 'Arabic',
}

const SYSTEM = `You are an intent extractor for a desktop assistant.

Given one sentence in any language, reply with a single JSON object and nothing
else — no prose, no markdown fence, no explanation.

{
  "language": "<ISO 639-1 code of the input>",
  "english": "<the sentence translated to English>",
  "intent": "<one of: launch, close, search, system, media, vision, code, chat>",
  "target": "<the app, file, or thing being acted on, or empty string>",
  "confidence": <0.0 to 1.0>
}

Rules:
- Pick the closest intent. "chrome close cheyyu" is close, not chat.
- target is the bare noun: "Visual Studio Code", "Chrome", "the volume".
- If the sentence is ordinary conversation with no device action, intent is
  chat and target is empty.
- confidence is how sure you are, not how important the sentence is.`

/**
 * Extract an intent from a sentence in any language.
 *
 * @param {string} text  the raw user sentence
 * @returns {Promise<{language: string|null, english: string, intent: string,
 *                    target: string, confidence: number, raw: boolean}>}
 */
export async function extractIntent(text) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) {
    return { language: null, english: '', intent: 'chat', target: '', confidence: 0, raw: true }
  }

  let out
  try {
    out = await complete(SLOT, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: trimmed },
    ])
  } catch {
    // Model down. Fall through to the passthrough below.
    return { language: null, english: trimmed, intent: 'chat', target: '', confidence: 0, raw: true }
  }

  const parsed = parseJson(out)
  if (!parsed) {
    // Unparseable is not an error worth surfacing. The user said something; the
    // assistant will treat it as English and carry on.
    return { language: null, english: trimmed, intent: 'chat', target: '', confidence: 0, raw: true }
  }

  const language = normaliseLanguage(parsed.language)
  return {
    language,
    english: typeof parsed.english === 'string' && parsed.english.trim()
      ? parsed.english.trim()
      : trimmed,
    intent: typeof parsed.intent === 'string' ? parsed.intent : 'chat',
    target: typeof parsed.target === 'string' ? parsed.target.trim() : '',
    confidence: clamp(Number(parsed.confidence) || 0),
    raw: false,
  }
}

/**
 * Translate to English without extracting an intent. Used when the caller
 * already knows what it wants and only needs the model to see English.
 */
export async function toEnglish(text) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return ''
  try {
    const out = await complete(SLOT, [
      {
        role: 'system',
        content:
          'Translate the user\'s sentence to English. Reply with the translation ' +
          'and nothing else — no quotes, no notes, no original text.',
      },
      { role: 'user', content: trimmed },
    ])
    return (out ?? '').trim() || trimmed
  } catch {
    return trimmed
  }
}

/** A human-readable name for a language code, for the UI. */
export function languageName(code) {
  return KNOWN[code] ?? code ?? 'unknown'
}

// ---------------------------------------------------------------------------

/** Pull the first JSON object out of a model reply, fences and all. */
function parseJson(text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
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

function clamp(n) {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * Rewrite the last user message in English, in place-ish.
 *
 * Returns a new array rather than mutating: the caller's `messages` is the
 * conversation record, and silently rewriting history would make the transcript
 * lie about what the user actually said.
 *
 * Only the *last* user message is translated. Earlier turns have already been
 * answered, and re-translating them would cost a model call per turn for no
 * benefit — the history is context, not the thing being acted on.
 *
 * @param {Array<{role:string,content:string}>} messages
 * @returns {Promise<Array<{role:string,content:string}>>}
 */
export async function translateInbound(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages

  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { lastUser = i; break }
  }
  if (lastUser === -1) return messages

  const original = messages[lastUser]
  const text = typeof original.content === 'string'
    ? original.content
    : Array.isArray(original.content)
      ? original.content.filter((p) => p?.type === 'text').map((p) => p.text).join(' ')
      : ''
  if (!text.trim()) return messages

  const result = await extractIntent(text)

  // Already English and confident — leave it exactly as it was, so an English
  // user pays no latency and sees no rewritten transcript.
  if (result.raw || (result.language === 'en' && result.confidence >= 0.6)) {
    return messages
  }

  const rewritten = [...messages]
  rewritten[lastUser] = {
    ...original,
    // Keep the original visible to the model as well as the translation: it
    // costs a few tokens and means a mistranslation is recoverable in-context
    // rather than silently wrong.
    content: `${result.english}\n\n[original: ${text}]`,
  }
  return rewritten
}
