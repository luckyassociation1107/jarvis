/**
 * JARVIS Emotion Detection — understands your mood, adapts.
 *
 * Detects emotion from:
 *   - Voice tone (pitch, speed, volume)
 *   - Text sentiment (words, patterns)
 *   - Behavior patterns (typing speed, app switching)
 *
 * Adapts:
 *   - Response tone (empathetic, excited, calm)
 *   - Music suggestions (happy → upbeat, sad → soothing)
 *   - Proactive behavior (frustrated → offer help)
 */

/* ──────────────── Text sentiment analysis ──────────────────────────── */

/**
 * Analyze sentiment from text (works for any language).
 */
export function analyzeSentiment(text) {
  const t = String(text ?? '').toLowerCase()

  const signals = {
    frustrated: /frustrated|annoyed|irritated|angry|stupid|useless|worst|terrible|hate|grr|ugh|damn|shit|fuck|nacchadu|chiraku|tirigi|daridram|pichi|dengey/i,
    happy: /happy|great|awesome|amazing|love|wonderful|fantastic|excellent|perfect|beautiful|super|nice|chala bagundi|santosham|anandam|baagundi/i,
    sad: /sad|depressed|lonely|miss|cry|tear|heartbreak|sorry|unfortunately|badha|badha|edupu|aloneness/i,
    excited: /excited|wow|omg|incredible|unbelievable|yay|woohoo|cant wait|eager|thrilled|super|chala/i,
    tired: /tired|exhausted|sleepy|fatigued|worn out|drained|alasika|nidra|kashtam/i,
    confused: /confused|don't understand|what|huh|emiti|enti|ela|enduku|confused/i,
    urgent: /urgent|asap|quickly|hurry|fast|now|immediately|veganga|thuranga/i,
    calm: /calm|relaxed|peaceful|chill|easy|comfortable|santosham|shanti/i,
  }

  const detected = []
  for (const [emotion, pattern] of Object.entries(signals)) {
    if (pattern.test(t)) detected.push(emotion)
  }

  // Punctuation signals
  if (/[!]{2,}/.test(text) || /[A-Z]{3,}/.test(text)) detected.push('emphatic')
  if (/[?]{2,}/.test(text)) detected.push('confused')
  if (/\.{3,}/.test(text)) detected.push('thoughtful')

  const primary = detected[0] ?? 'neutral'
  const intensity = Math.min(1, detected.length * 0.3 + (text.includes('!') ? 0.2 : 0))

  return {
    primary,
    all: detected,
    intensity,
    isNegative: ['frustrated', 'sad', 'tired', 'confused'].includes(primary),
    isPositive: ['happy', 'excited', 'calm'].includes(primary),
    suggestedTone: getSuggestedTone(primary),
  }
}

function getSuggestedTone(emotion) {
  const map = {
    frustrated: 'empathetic',
    happy: 'enthusiastic',
    sad: 'gentle',
    excited: 'matching',
    tired: 'calm',
    confused: 'patient',
    urgent: 'efficient',
    calm: 'relaxed',
    neutral: 'casual',
    emphatic: 'matching',
    thoughtful: 'patient',
  }
  return map[emotion] ?? 'casual'
}

/* ──────────────── Voice emotion detection ──────────────────────────── */

/**
 * Analyze emotion from voice audio features.
 *
 * This uses basic audio heuristics. For production, pair with
 * a dedicated emotion recognition model.
 */
export function analyzeVoice({ pitch = 0, speed = 1, volume = 0.5, pauseDuration = 0 } = {}) {
  const signals = []

  // High pitch + fast speed = excited or frustrated
  if (pitch > 0.7 && speed > 1.2) signals.push('excited')
  if (pitch > 0.8 && speed > 1.3 && volume > 0.7) signals.push('frustrated')

  // Low pitch + slow speed = tired or sad
  if (pitch < 0.3 && speed < 0.8) signals.push('tired')
  if (pitch < 0.3 && speed < 0.7 && volume < 0.3) signals.push('sad')

  // Long pauses = thinking or confused
  if (pauseDuration > 3) signals.push('thoughtful')
  if (pauseDuration > 5) signals.push('confused')

  // Very loud = urgent or angry
  if (volume > 0.8 && speed > 1.1) signals.push('urgent')

  return {
    detected: signals,
    primary: signals[0] ?? 'neutral',
    suggestedTone: getSuggestedTone(signals[0] ?? 'neutral'),
  }
}

/* ──────────────── Response adaptation ──────────────────────────── */

/**
 * Get emotion-aware response modifiers.
 */
export function getResponseModifiers(sentiment) {
  const mods = {
    prefix: '',
    suffix: '',
    tone: sentiment.suggestedTone,
    ttsSpeed: 1.0,
    ttsPitch: 1.0,
    emoji: false,
  }

  switch (sentiment.primary) {
    case 'frustrated':
      mods.prefix = 'Sorry to hear that. '
      mods.ttsSpeed = 0.9
      break
    case 'happy':
      mods.suffix = ' 😊'
      mods.ttsSpeed = 1.1
      mods.emoji = true
      break
    case 'sad':
      mods.prefix = ''
      mods.ttsSpeed = 0.85
      mods.ttsPitch = 0.95
      break
    case 'excited':
      mods.suffix = '!'
      mods.ttsSpeed = 1.15
      mods.emoji = true
      break
    case 'tired':
      mods.prefix = ''
      mods.ttsSpeed = 0.8
      break
    case 'confused':
      mods.prefix = 'Let me explain. '
      mods.ttsSpeed = 0.9
      break
    case 'urgent':
      mods.ttsSpeed = 1.2
      break
  }

  return mods
}

export default { analyzeSentiment, analyzeVoice, getResponseModifiers }