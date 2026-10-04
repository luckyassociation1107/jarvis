/**
 * JARVIS Multi-Modal Fusion — sees, hears, reads, and UNDERSTANDS.
 *
 * Not separate channels. ONE unified understanding:
 *   - Voice tone + words + facial expression = true intent
 *   - Screen content + user question = precise answer
 *   - Code + error message + user frustration = targeted help
 *   - Image + context + history = deep understanding
 *
 * "I don't just hear your words. I understand your MEANING."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Multi-Modal Fusion ──────────────────────────── */

/**
 * Fuse multiple modalities into one understanding.
 */
export async function fuseModalities(inputs, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a multi-modal fusion engine. Combine inputs from different modalities into ONE unified understanding.

Modalities:
- TEXT: what was said/written
- VOICE: tone, speed, emotion in speech
- VISION: what was seen (screen, image, video)
- CONTEXT: current situation, recent history
- BEHAVIOR: what the user was doing before

For each modality, extract the KEY INFORMATION.
Then FUSE them into a single, coherent understanding.
Resolve contradictions (voice says happy but words say frustrated → probably frustrated but coping).

Respond in JSON:
{
  "text_intent": "what the text says",
  "voice_emotion": "emotion from voice",
  "visual_context": "what was seen",
  "fused_understanding": "the TRUTH — what they really mean",
  "confidence": 0.85,
  "contradictions": ["any conflicts between modalities"],
  "recommended_action": "what to do"
}` },
    { role: 'user', content: `Inputs:\n${inputs.map((i) => `[${i.modality}]: ${i.data}`).join('\n')}\n\nFused understanding:` },
  ], { maxTokens: 500 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, fusion: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/**
 * Understand context from multiple sources.
 */
export async function understandContext({ screen = null, audio = null, text = null, history = null, llm = complete } = {}) {
  const inputs = []
  if (screen) inputs.push({ modality: 'vision', data: screen })
  if (audio) inputs.push({ modality: 'voice', data: audio })
  if (text) inputs.push({ modality: 'text', data: text })
  if (history) inputs.push({ modality: 'context', data: history })

  return fuseModalities(inputs, { llm })
}

/**
 * Resolve ambiguity using multiple modalities.
 */
export async function resolveAmbiguity(ambiguous, { modalities = [], llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Resolve this ambiguity using all available modalities.

For each possible interpretation:
1. How likely is it given the text alone?
2. How likely given the voice tone?
3. How likely given what was on screen?
4. How likely given the context?

Pick the most likely interpretation and explain why.` },
    { role: 'user', content: `Ambiguous: "${ambiguous}"\n\nModalities:\n${modalities.map((m) => `[${m.type}]: ${m.data}`).join('\n')}\n\nResolution:` },
  ], { maxTokens: 300 })

  return response
}

export default { fuseModalities, understandContext, resolveAmbiguity }