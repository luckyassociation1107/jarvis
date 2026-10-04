/**
 * JARVIS Universal Translator — speak EVERY language, understand EVERY culture.
 *
 * Not just Google Translate. CULTURAL translation:
 *   - Understands idioms, slang, regional dialects
 *   - Adapts tone (formal/informal) for the target culture
 *   - Preserves emotional nuance
 *   - Knows when NOT to translate (cultural references that don't transfer)
 *   - Supports code-switching (mixed languages)
 *   - Learns user's language patterns over time
 *
 * "Namaste! Or as we say in Hyderabad, 'Elago unnaaru?' See? Same respect,
 *  different vibe. I get it."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Translation ──────────────────────────── */

/**
 * Translate with cultural context.
 */
export async function translate(text, { 
  from = 'auto', 
  to = 'en', 
  formality = 'auto',   // formal, informal, auto
  preserveTone = true,
  culturalAdaptation = true,
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `You are a universal translator with cultural expertise.

Rules:
1. Translate the MEANING, not just the words
2. Adapt idioms to equivalent expressions in the target language
3. Preserve emotional tone and nuance
4. Adjust formality for the target culture
5. If something can't be translated (cultural reference), note it
6. For mixed-language input, identify each language segment

Target language: ${to}
Formality: ${formality}
Cultural adaptation: ${culturalAdaptation ? 'yes' : 'no'}

Respond in JSON:
{
  "translation": "the translated text",
  "source_language": "detected language",
  "confidence": 0.95,
  "notes": ["any cultural notes or untranslatable parts"],
  "tone_preserved": true,
  "formality_used": "formal|informal|neutral"
}` },
    { role: 'user', content: `Translate: "${text}"` },
  ], { maxTokens: 500 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, result: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Language detection ──────────────────────────── */

/**
 * Detect the language(s) in a text, including code-switching.
 */
export async function detectLanguage(text, { llm = complete } = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Detect all languages in the text. Handle:
- Single language
- Code-switching (mixing languages in one sentence)
- Dialect identification
- Script identification (Latin, Devanagari, Telugu, Arabic, etc.)

Respond in JSON:
{
  "primary_language": "English",
  "primary_code": "en",
  "segments": [
    { "text": "segment", "language": "Telugu", "code": "te" }
  ],
  "confidence": 0.95,
  "dialect": "Hyderabadi Telugu" or null,
  "formality": "informal"
}` },
    { role: 'user', content: `Text: "${text}"` },
  ], { maxTokens: 300 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, detection: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Cultural context ──────────────────────────── */

/**
 * Get cultural context for a phrase or situation.
 */
export async function culturalContext(phrase, { culture = '', llm = complete } = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `You are a cultural expert. Explain the cultural context of phrases, gestures, or situations.

Include:
- What it means literally
- What it means culturally
- When it's appropriate/inappropriate
- Regional variations
- Historical context if relevant
- How someone from a different culture might misinterpret it` },
    { role: 'user', content: `Phrase/Situation: "${phrase}"${culture ? `\nCulture: ${culture}` : ''}\n\nCultural context:` },
  ], { maxTokens: 400 })

  return response
}

/* ──────────────── Language learning ──────────────────────────── */

/**
 * Help the user learn a new language through conversation.
 */
export async function languageCoach(text, { 
  targetLanguage = 'en', 
  nativeLanguage = 'te',
  level = 'beginner',  // beginner, intermediate, advanced
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `You are a language coach. Help the user learn ${targetLanguage}.

Their native language: ${nativeLanguage}
Their level: ${level}

For each message:
1. Understand what they're trying to say
2. Correct any errors gently
3. Teach the correct form
4. Explain WHY (grammar rule, idiom, etc.)
5. Give them a practice exercise
6. Be encouraging!

Respond in JSON:
{
  "understood": "what they meant",
  "corrected": "correct version",
  "corrections": [{"original": "...", "corrected": "...", "explanation": "..."}],
  "new_vocabulary": ["word1: meaning", "word2: meaning"],
  "practice": "a practice exercise",
  "encouragement": "positive feedback"
}` },
    { role: 'user', content: `Student says: "${text}"` },
  ], { maxTokens: 600 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, coaching: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Telugu-English specific ──────────────────────────── */

/**
 * Specialized Telugu-English translation and coaching.
 * Hyderabad-specific: understands local slang, movie references, cultural context.
 */
export async function teluguEnglish(text, { direction = 'auto', llm = complete } = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `You are a Telugu-English bilingual expert from Hyderabad.

You understand:
- Formal Telugu (శుద్ధ తెలుగు)
- Hyderabad Telugu (తెలుగు + Urdu + Hindi mix)
- Telugu written in English script (Tenglish)
- Movie dialogues and their cultural context
- Local slang: "enti", "rey", "abba", "baap re", "nakko"
- Respectful forms: "meeru" vs "nuvvu"

Translate naturally, preserving the LOCAL feel.` },
    { role: 'user', content: `Text: "${text}"\nDirection: ${direction}\n\nTranslation:` },
  ], { maxTokens: 400 })

  return response
}

export default { translate, detectLanguage, culturalContext, languageCoach, teluguEnglish }