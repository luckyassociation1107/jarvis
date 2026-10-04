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
import { PLANNER_SYSTEM } from './workflow.mjs'

const SLOT = 'chat'

const KNOWN = {
  en: 'English', te: 'Telugu', hi: 'Hindi', ta: 'Tamil', kn: 'Kannada',
  ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', es: 'Spanish', fr: 'French',
  de: 'German', ja: 'Japanese', zh: 'Chinese', ar: 'Arabic',
}

const INTENTS = new Set(['launch', 'close', 'search', 'system', 'media', 'vision', 'code', 'chat'])

// The planner system prompt — imported from workflow.mjs
// It produces structured execution plans, not just intent tags.
const SYSTEM = PLANNER_SYSTEM

/**
 * Extract intent and create an execution plan.
 *
 * The planner model returns a structured plan with steps. We parse it
 * and also maintain backward-compatible fields (english, intent, prompt)
 * so existing callers still work.
 *
 * @returns {Promise<{language:string|null,english:string,intent:string,target:string,prompt:string,confidence:number,raw:boolean,plan:Array|null,response_to_user:string}>}
 */
export async function extractIntent(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) {
    return { language: null, english: '', intent: 'chat', target: '', prompt: '', confidence: 0, raw: true, plan: null, response_to_user: '' }
  }

  let out
  try {
    out = await complete(SLOT, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: trimmed },
    ], { maxTokens: 700 })
  } catch {
    return { language: null, english: trimmed, intent: 'chat', target: '', prompt: trimmed, confidence: 0, raw: true, plan: null, response_to_user: '' }
  }

  const parsed = parseJson(out)
  if (!parsed) {
    return { language: null, english: trimmed, intent: 'chat', target: '', prompt: trimmed, confidence: 0, raw: true, plan: null, response_to_user: '' }
  }

  const language = normaliseLanguage(parsed.language)
  const english = typeof parsed.english === 'string' && parsed.english.trim()
    ? parsed.english.trim()
    : typeof parsed.understanding === 'string' && parsed.understanding.trim()
      ? parsed.understanding.trim()
      : trimmed

  // New planner format: has a plan array
  const plan = Array.isArray(parsed.plan) ? parsed.plan : null

  // Derive intent from plan actions if not explicitly set
  let intent = INTENTS.has(parsed.intent) ? parsed.intent : null
  if (!intent && plan) {
    intent = deriveIntentFromPlan(plan)
  }
  if (!intent) intent = 'chat'

  const prompt = typeof parsed.prompt === 'string' && parsed.prompt.trim()
    ? parsed.prompt.trim()
    : plan
      ? plan.map((s) => `Step ${s.step}: ${s.action}${s.detail ? ` — ${s.detail}` : ''}`).join('\n')
      : english

  const responseToUser = typeof parsed.response_to_user === 'string' && parsed.response_to_user.trim()
    ? parsed.response_to_user.trim()
    : ''

  return {
    language,
    english,
    intent,
    target: typeof parsed.target === 'string' ? parsed.target.trim() : (plan?.[0]?.detail ?? ''),
    prompt,
    confidence: plan ? Math.min(1, Math.max(0.5, Number(parsed.confidence) || 0.8)) : clamp(Number(parsed.confidence) || 0),
    raw: false,
    plan,
    response_to_user: responseToUser,
    tools_needed: Array.isArray(parsed.tools_needed) ? parsed.tools_needed : [],
  }
}

/** Derive intent category from plan actions. */
function deriveIntentFromPlan(plan) {
  const actions = plan.map((s) => String(s.action ?? '').toLowerCase()).join(' ')
  if (/open_app|launch|start_app/.test(actions)) return 'launch'
  if (/close_app|close|quit|kill/.test(actions)) return 'close'
  if (/search|google|find|look_up/.test(actions)) return 'search'
  if (/play|pause|stop|next|prev|volume|media|song|video/.test(actions)) return 'media'
  if (/screenshot|camera|photo|image|vision|screen/.test(actions)) return 'vision'
  if (/code|write|edit|debug|build|compile|function|script/.test(actions)) return 'code'
  if (/system|settings|battery|wifi|bluetooth|notification/.test(actions)) return 'system'
  return 'chat'
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
