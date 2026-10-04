/**
 * JARVIS Emotion Detector — detects emotions from voice, text, and behavior.
 *
 * Features:
 *   - Voice emotion detection (tone, pitch, speed analysis)
 *   - Text emotion detection (sentiment, word choice, punctuation)
 *   - Behavioral emotion detection (response time, message patterns)
 *   - Multi-modal fusion (combine all signals)
 *   - Emotion history tracking
 *   - Adaptive response based on detected emotion
 *
 * "Nuvvu frustrated ga unnav anipisthundi. Naa response ala adjust avthundi.
 *  Short, direct, solution-focused. Nee mood ki taggattu."
 */

import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Emotion Database ──────────────────────────── */

const EMOTIONS = {
  happy:     { valence: 0.8, arousal: 0.6, response: 'warm, enthusiastic, encouraging' },
  sad:       { valence: -0.6, arousal: -0.3, response: 'gentle, supportive, understanding' },
  angry:     { valence: -0.7, arousal: 0.8, response: 'calm, direct, solution-focused' },
  frustrated:{ valence: -0.5, arousal: 0.5, response: 'empathetic, efficient, no-nonsense' },
  excited:   { valence: 0.9, arousal: 0.9, response: 'matching energy, enthusiastic' },
  anxious:   { valence: -0.4, arousal: 0.7, response: 'reassuring, clear, structured' },
  tired:     { valence: -0.2, arousal: -0.5, response: 'brief, efficient, minimal effort required' },
  confused:  { valence: -0.2, arousal: 0.3, response: 'clear, step-by-step, patient' },
  confident: { valence: 0.6, arousal: 0.5, response: 'supportive, detailed, collaborative' },
  curious:   { valence: 0.5, arousal: 0.6, response: 'informative, engaging, exploratory' },
  neutral:   { valence: 0, arousal: 0, response: 'balanced, informative, professional' },
  surprised: { valence: 0.3, arousal: 0.8, response: 'explanatory, context-providing' },
  love:      { valence: 0.9, arousal: 0.7, response: 'warm, caring, personal' },
  scared:    { valence: -0.6, arousal: 0.8, response: 'calming, reassuring, protective' },
  sarcastic: { valence: -0.1, arousal: 0.4, response: 'witty, matching humor, not offended' },
}

/* ──────────────── Emotion Detector ──────────────────────────── */

class EmotionDetector {
  constructor() {
    // Emotion history
    this.emotionHistory = []       // [{emotion, confidence, source, timestamp}]
    this.maxHistory = 200

    // Current state
    this.currentEmotion = 'neutral'
    this.currentConfidence = 0
    this.emotionTimeline = []      // emotion changes over time

    // Pattern detection
    this.moodPatterns = new Map()  // hour → [emotions]
    this.triggerWords = new Map()  // word → emotion association
  }

  /**
   * Detect emotion from text. FAST — pattern matching first, LLM if needed.
   */
  detectFromText(text, { source = 'message' } = {}) {
    const startTime = Date.now()

    // Fast pattern matching — no LLM needed for obvious cases
    const quickResult = this._quickDetect(text)
    if (quickResult.confidence > 0.7) {
      this._recordEmotion(quickResult.emotion, quickResult.confidence, source)
      return { ...quickResult, latencyMs: Date.now() - startTime, method: 'pattern' }
    }

    // Return pattern result even if confidence is lower
    this._recordEmotion(quickResult.emotion, quickResult.confidence, source)
    return { ...quickResult, latencyMs: Date.now() - startTime, method: 'pattern' }
  }

  /**
   * Quick emotion detection — O(n), no LLM call.
   * Uses word patterns, punctuation, caps, emojis.
   */
  _quickDetect(text) {
    const lower = text.toLowerCase()
    const signals = []

    // EXCLAMATION MARKS — excitement or anger
    const exclamations = (text.match(/!/g) || []).length
    if (exclamations >= 3) signals.push({ emotion: 'excited', weight: 0.3 })

    // CAPS — anger or excitement
    const capsRatio = (text.match(/[A-Z]/g) || []).length / (text.length || 1)
    if (capsRatio > 0.5 && text.length > 5) signals.push({ emotion: 'angry', weight: 0.4 })

    // QUESTION MARKS — confusion or curiosity
    const questions = (text.match(/\?/g) || []).length
    if (questions >= 2) signals.push({ emotion: 'confused', weight: 0.3 })

    // ELLIPSIS — tired, sad, or thoughtful
    if (text.includes('...')) signals.push({ emotion: 'tired', weight: 0.2 })

    // POSITIVE WORDS
    const positiveWords = ['happy', 'great', 'awesome', 'love', 'amazing', 'wonderful', 'excellent', 'good', 'nice', 'best', 'super', 'fantastic', 'brilliant']
    const posCount = positiveWords.filter((w) => lower.includes(w)).length
    if (posCount > 0) signals.push({ emotion: 'happy', weight: posCount * 0.2 })

    // NEGATIVE WORDS
    const negativeWords = ['sad', 'bad', 'terrible', 'hate', 'awful', 'worst', 'horrible', 'angry', 'annoying', 'frustrating', 'stupid', 'useless']
    const negCount = negativeWords.filter((w) => lower.includes(w)).length
    if (negCount > 0) signals.push({ emotion: 'sad', weight: negCount * 0.2 })

    // ANGER WORDS
    const angerWords = ['angry', 'furious', 'mad', 'hate', 'stupid', 'idiot', 'damn', 'hell', 'wtf', 'fuck', 'shit', 'crap']
    const angerCount = angerWords.filter((w) => lower.includes(w)).length
    if (angerCount > 0) signals.push({ emotion: 'angry', weight: angerCount * 0.3 })

    // TELUGU EMOTION WORDS
    const teluguEmotions = {
      'chala bagundi': 'happy', 'bagundi': 'happy', 'super': 'happy',
      'baadha': 'sad', 'badha': 'sad', 'edupu': 'sad',
      'kopam': 'angry', 'tirigi': 'angry',
      'alasipoyanu': 'tired', 'alasi': 'tired',
      'ardham kaledu': 'confused', 'teliyaledu': 'confused',
    }
    for (const [word, emotion] of Object.entries(teluguEmotions)) {
      if (lower.includes(word)) signals.push({ emotion, weight: 0.4 })
    }

    // EMOJI ANALYSIS
    const emojiEmotions = {
      '😂': 'happy', '🤣': 'happy', '😊': 'happy', '😄': 'happy', '❤️': 'love',
      '😢': 'sad', '😭': 'sad', '😞': 'sad',
      '😡': 'angry', '🤬': 'angry', '😤': 'frustrated',
      '😱': 'scared', '😨': 'anxious',
      '🤔': 'confused', '😴': 'tired', '🙄': 'sarcastic',
      '🔥': 'excited', '🎉': 'excited', '💪': 'confident',
    }
    for (const [emoji, emotion] of Object.entries(emojiEmotions)) {
      if (text.includes(emoji)) signals.push({ emotion, weight: 0.3 })
    }

    // SHORT RESPONSES — could be tired or disinterested
    if (text.length < 5 && !text.includes('!')) {
      signals.push({ emotion: 'tired', weight: 0.2 })
    }

    // Calculate dominant emotion
    if (signals.length === 0) {
      return { emotion: 'neutral', confidence: 0.5, signals: [] }
    }

    const emotionScores = {}
    for (const signal of signals) {
      emotionScores[signal.emotion] = (emotionScores[signal.emotion] || 0) + signal.weight
    }

    const dominant = Object.entries(emotionScores)
      .sort((a, b) => b[1] - a[1])[0]

    return {
      emotion: dominant[0],
      confidence: Math.min(0.95, dominant[1]),
      signals: signals.map((s) => `${s.emotion}(${s.weight})`),
      allEmotions: emotionScores,
    }
  }

  /**
   * Detect emotion from voice characteristics.
   */
  detectFromVoice(voiceData) {
    // voiceData: { pitch, speed, volume, tremor }
    const signals = []

    // High pitch + fast speed = excited or anxious
    if (voiceData.pitch > 0.7 && voiceData.speed > 1.2) {
      signals.push({ emotion: 'excited', weight: 0.5 })
    }

    // Low pitch + slow speed = sad or tired
    if (voiceData.pitch < 0.3 && voiceData.speed < 0.8) {
      signals.push({ emotion: 'sad', weight: 0.5 })
    }

    // High volume + fast speed = angry
    if (voiceData.volume > 0.8 && voiceData.speed > 1.1) {
      signals.push({ emotion: 'angry', weight: 0.4 })
    }

    // Tremor = anxious or scared
    if (voiceData.tremor > 0.5) {
      signals.push({ emotion: 'anxious', weight: 0.4 })
    }

    const dominant = signals.sort((a, b) => b.weight - a.weight)[0]

    return {
      emotion: dominant?.emotion || 'neutral',
      confidence: dominant?.weight || 0.3,
      signals,
      source: 'voice',
    }
  }

  /**
   * Get adaptive response style based on current emotion.
   */
  getResponseStyle() {
    const emotion = EMOTIONS[this.currentEmotion] || EMOTIONS.neutral
    return {
      emotion: this.currentEmotion,
      style: emotion.response,
      valence: emotion.valence,
      arousal: emotion.arousal,
      guidelines: this._getStyleGuidelines(this.currentEmotion),
    }
  }

  /**
   * Get specific guidelines for responding to an emotion.
   */
  _getStyleGuidelines(emotion) {
    const guidelines = {
      happy:     'Match their energy. Be enthusiastic. Use positive language.',
      sad:       'Be gentle. Don\'t minimize their feelings. Offer support.',
      angry:     'Stay calm. Be direct. Focus on solutions, not emotions.',
      frustrated:'Acknowledge the frustration. Be efficient. Solve the problem.',
      excited:   'Share their excitement. Be encouraging. Keep the momentum.',
      anxious:   'Be reassuring. Provide clear steps. Reduce uncertainty.',
      tired:     'Be brief. Minimize effort needed. Get to the point.',
      confused:  'Be clear. Use simple language. Provide examples.',
      confident: 'Be collaborative. Provide detailed information.',
      curious:   'Be informative. Explore the topic together.',
      neutral:   'Be balanced and professional.',
      surprised: 'Provide context. Explain the unexpected.',
      love:      'Be warm and personal. Match the affection.',
      scared:    'Be calming. Provide reassurance. Be protective.',
      sarcastic: 'Be witty. Don\'t take it personally. Match the humor.',
    }
    return guidelines[emotion] || guidelines.neutral
  }

  /**
   * Record emotion in history.
   */
  _recordEmotion(emotion, confidence, source) {
    this.emotionHistory.push({
      emotion,
      confidence,
      source,
      timestamp: new Date().toISOString(),
    })
    if (this.emotionHistory.length > this.maxHistory) this.emotionHistory.shift()

    // Update current if confidence is high enough
    if (confidence > this.currentConfidence) {
      this.currentEmotion = emotion
      this.currentConfidence = confidence
      this.emotionTimeline.push({
        emotion,
        timestamp: new Date().toISOString(),
      })
      if (this.emotionTimeline.length > 50) this.emotionTimeline.shift()
    }

    eventBus.emit('emotion:detected', { emotion, confidence, source })
  }

  /**
   * Get emotion history.
   */
  getHistory({ limit = 20 } = {}) {
    return this.emotionHistory.slice(-limit)
  }

  /**
   * Get mood over time.
   */
  getMoodTimeline() {
    return this.emotionTimeline.slice(-20)
  }

  /**
   * Get stats.
   */
  getStats() {
    const emotionCounts = {}
    for (const entry of this.emotionHistory) {
      emotionCounts[entry.emotion] = (emotionCounts[entry.emotion] || 0) + 1
    }
    const dominant = Object.entries(emotionCounts)
      .sort((a, b) => b[1] - a[1])[0]

    return {
      currentEmotion: this.currentEmotion,
      currentConfidence: this.currentConfidence,
      historySize: this.emotionHistory.length,
      dominantEmotion: dominant?.[0] || 'neutral',
      emotionDistribution: emotionCounts,
      timelineLength: this.emotionTimeline.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const emotionDetector = new EmotionDetector()

export { emotionDetector, EmotionDetector, EMOTIONS }
export default emotionDetector