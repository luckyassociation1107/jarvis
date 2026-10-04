/**
 * JARVIS Voice Call Bridge — makes REAL voice calls with your cloned voice.
 *
 * How it works:
 *   1. TTS Engine generates audio in your voice
 *   2. Audio is routed through Virtual Mic
 *   3. WhatsApp/Telegram/Zoom picks up the virtual mic as input
 *   4. Person on the other end hears YOUR voice
 *
 * Supports:
 *   - WhatsApp voice calls
 *   - Telegram voice calls
 *   - Discord voice channels
 *   - Zoom/Teams meetings
 *   - Any app that uses the microphone
 *
 * "Nuvvu call chey. Nenu nee voice lo matladtha.
 *  Vallaki teliyadu nenu AI ani."
 */

import { ttsEngine } from './tts-engine.mjs'
import { voiceCloneEngine } from './voice-clone.mjs'
import { virtualMic } from './virtual-mic.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

/* ──────────────── Constants ──────────────────────────── */

const CALLS_DIR = join(process.cwd(), 'data', 'calls')
const CALL_LOG_FILE = join(CALLS_DIR, 'call-log.json')

/* ──────────────── Voice Call Bridge ──────────────────────────── */

class VoiceCallBridge {
  constructor() {
    // Call state
    this.activeCall = null       // { platform, contact, startTime, status }
    this.callHistory = []        // completed calls

    // Voice mode
    this.voiceMode = 'clone'     // 'clone' (your voice), 'ai' (AI voice), 'mixed'
    this.conversationMode = 'realtime'  // 'realtime' (respond immediately), 'script' (follow script)

    // Call script — for scripted conversations
    this.callScript = null       // { lines: [{speaker, text}] }
    this.scriptIndex = 0

    // Real-time conversation state
    this.conversationHistory = [] // {speaker, text, timestamp}
    this.isListening = false
    this.isSpeaking = false

    // Performance
    this.stats = {
      totalCalls: 0,
      totalCallMinutes: 0,
      avgResponseMs: 0,
    }
  }

  /**
   * Start a voice call.
   */
  async startCall(platform, contact, { voiceProfile = null, mode = 'realtime' } = {}) {
    if (this.activeCall) {
      return { ok: false, error: 'Already in a call. End current call first.' }
    }

    // Setup virtual mic
    const micReady = await virtualMic.connect()
    if (!micReady.ok) return micReady

    virtualMic.setActiveApp(platform)

    // Load voice profile
    if (voiceProfile) {
      voiceCloneEngine.selectVoice(voiceProfile)
    }

    // Load TTS references
    await ttsEngine.loadVoiceReferences()

    this.activeCall = {
      platform,
      contact,
      startTime: new Date().toISOString(),
      status: 'active',
      voiceProfile: voiceProfile || voiceCloneEngine.activeProfile,
      mode,
    }

    this.conversationHistory = []
    this.conversationMode = mode

    eventBus.emit('call:started', { platform, contact, voiceProfile })

    return {
      ok: true,
      call: this.activeCall,
      message: `Call started with ${contact} on ${platform}. Voice: ${this.activeCall.voiceProfile}`,
    }
  }

  /**
   * End the active call.
   */
  endCall() {
    if (!this.activeCall) return { ok: false, error: 'No active call' }

    const endTime = new Date().toISOString()
    const durationMs = new Date(endTime) - new Date(this.activeCall.startTime)

    const callRecord = {
      ...this.activeCall,
      endTime,
      durationMs,
      durationMinutes: Math.round(durationMs / 60000),
      messages: this.conversationHistory.length,
      transcript: [...this.conversationHistory],
    }

    this.callHistory.push(callRecord)
    this.stats.totalCalls++
    this.stats.totalCallMinutes += callRecord.durationMinutes

    this.activeCall = null
    this.isListening = false
    this.isSpeaking = false

    // Disconnect virtual mic
    virtualMic.disconnect()

    eventBus.emit('call:ended', callRecord)

    return { ok: true, call: callRecord }
  }

  /**
   * Speak during a call — REAL voice through virtual mic.
   * This is the MAIN function that makes the other person hear your voice.
   */
  async speak(text, { emotion = 'neutral', speed = 1.0 } = {}) {
    if (!this.activeCall) {
      return { ok: false, error: 'No active call. Start a call first.' }
    }

    this.isSpeaking = true
    const startTime = Date.now()

    // Generate audio with TTS engine using cloned voice
    const audioResult = await ttsEngine.speak(text, {
      voice: this.activeCall.voiceProfile,
      language: this._detectLanguage(text),
      emotion,
      speed,
      format: 'wav',
      stream: true,
    })

    if (!audioResult.ok) {
      this.isSpeaking = false
      return { ok: false, error: `TTS failed: ${audioResult.error}` }
    }

    // Play through virtual mic — the other person hears this
    const playResult = await virtualMic.speak(text, {
      emotion,
      profileName: this.activeCall.voiceProfile,
    })

    this.isSpeaking = false

    // Log to conversation
    this.conversationHistory.push({
      speaker: 'me',
      text,
      timestamp: new Date().toISOString(),
      emotion,
      latencyMs: Date.now() - startTime,
    })

    return {
      ok: true,
      text,
      audioFile: audioResult.filePath,
      duration: audioResult.duration,
      generationMs: audioResult.generationMs,
      totalMs: Date.now() - startTime,
      voice: this.activeCall.voiceProfile,
    }
  }

  /**
   * Process incoming speech during a call.
   * The other person said something — generate a response.
   */
  async processIncomingSpeech(theirText, { emotion = 'neutral', llm = null } = {}) {
    if (!this.activeCall) {
      return { ok: false, error: 'No active call' }
    }

    // Log their speech
    this.conversationHistory.push({
      speaker: this.activeCall.contact,
      text: theirText,
      timestamp: new Date().toISOString(),
    })

    // Generate response
    let response
    if (llm) {
      response = await this._generateCallResponse(theirText, { llm })
    } else {
      response = await this._generateCallResponse(theirText, {})
    }

    // Speak the response in cloned voice
    const speakResult = await this.speak(response, { emotion })

    return {
      ok: true,
      incoming: theirText,
      response,
      speakResult,
    }
  }

  /**
   * Generate a response for a call conversation.
   */
  async _generateCallResponse(theirText, { llm = null } = {}) {
    if (!llm) {
      // Simple pattern matching for when no LLM is available
      const lower = theirText.toLowerCase()
      if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
        return 'Hey! How are you?'
      }
      if (lower.includes('how are you')) {
        return 'I\'m good, thanks! What\'s up?'
      }
      if (lower.includes('bye') || lower.includes('goodbye')) {
        return 'Bye! Talk to you later.'
      }
      return 'Hmm, tell me more about that.'
    }

    const recent = this.conversationHistory.slice(-6)
    const response = await llm('reason', [
      { role: 'system', content: `You are on a voice call. Respond naturally like a human.

Rules:
- Keep it SHORT (1-2 sentences max — it's a voice call)
- Be natural, not robotic
- Match the conversation energy
- Use casual language
- Don't say "as an AI" or similar
- Respond in the same language they're speaking` },
      { role: 'user', content: `Call with: ${this.activeCall.contact}\n\n${recent.map((m) => `${m.speaker}: ${m.text}`).join('\n')}\n\nYour response (short, natural, spoken style):` },
    ], { maxTokens: 80 })

    return response.replace(/^(Me:|Response:)\s*/i, '').trim().slice(0, 200)
  }

  /**
   * Run a scripted call — follow a pre-written script.
   */
  async runScript(script) {
    if (!this.activeCall) {
      return { ok: false, error: 'No active call' }
    }

    this.callScript = script
    this.scriptIndex = 0
    this.conversationMode = 'script'

    // Speak first line
    if (script.lines && script.lines.length > 0) {
      const firstLine = script.lines[0]
      if (firstLine.speaker === 'me') {
        await this.speak(firstLine.text, { emotion: firstLine.emotion || 'neutral' })
        this.scriptIndex = 1
      }
    }

    return { ok: true, totalLines: script.lines?.length || 0 }
  }

  /**
   * Advance script — speak next line.
   */
  async advanceScript() {
    if (!this.callScript || !this.activeCall) return { ok: false }

    if (this.scriptIndex >= this.callScript.lines.length) {
      return { ok: true, finished: true }
    }

    const line = this.callScript.lines[this.scriptIndex]
    this.scriptIndex++

    if (line.speaker === 'me') {
      await this.speak(line.text, { emotion: line.emotion || 'neutral' })
      return { ok: true, spoke: line.text, remaining: this.callScript.lines.length - this.scriptIndex }
    }

    return { ok: true, waiting: line.text, remaining: this.callScript.lines.length - this.scriptIndex }
  }

  /**
   * Detect language from text.
   */
  _detectLanguage(text) {
    const teluguChars = (text.match(/[\u0C00-\u0C7F]/g) || []).length
    const hindiChars = (text.match(/[\u0900-\u097F]/g) || []).length
    const total = text.length || 1

    if (teluguChars / total > 0.3) return 'te'
    if (hindiChars / total > 0.3) return 'hi'
    return 'en'
  }

  /**
   * Get active call info.
   */
  getActiveCall() {
    return this.activeCall
  }

  /**
   * Get call history.
   */
  getCallHistory({ limit = 10 } = {}) {
    return this.callHistory.slice(-limit)
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      activeCall: !!this.activeCall,
      totalCalls: this.stats.totalCalls,
      totalCallMinutes: this.stats.totalCallMinutes,
      avgResponseMs: this.stats.avgResponseMs,
      conversationLength: this.conversationHistory.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const voiceCallBridge = new VoiceCallBridge()

export { voiceCallBridge, VoiceCallBridge }
export default voiceCallBridge