/**
 * JARVIS Unified Communications — ONE system for ALL communication.
 *
 * Everything in one place:
 *   - Text messages (chat as you)
 *   - Voice messages (your cloned voice)
 *   - Voice calls (real-time conversation)
 *   - Video calls (with your avatar/face)
 *   - Group chats
 *   - Broadcast messages
 *   - Scheduled messages
 *   - Auto-reply across ALL platforms
 *
 * ONE interface. ALL platforms. ALL modes. AT THE SAME TIME.
 *
 * "WhatsApp lo Rahul ki text, Instagram lo Priya ki voice message,
 *  Discord lo group call — antha okate time lo cheyyagalanu.
 *  Nenu AI ni ani evariki teliyadu."
 */

import { voiceCloneEngine } from './voice-clone.mjs'
import { voiceReplica } from './voice-replica.mjs'
import { ttsEngine } from './tts-engine.mjs'
import { virtualMic } from './virtual-mic.mjs'
import { socialBridge } from './social-bridge.mjs'
import { voiceCallBridge } from './voice-call-bridge.mjs'
import { voiceMessageSender } from './voice-message-sender.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

/* ──────────────── Constants ──────────────────────────── */

const COMMS_DIR = join(process.cwd(), 'data', 'comms')
const STATE_FILE = join(COMMS_DIR, 'state.json')

/* ──────────────── Platform Registry ──────────────────────────── */

const PLATFORMS = {
  whatsapp:  { name: 'WhatsApp',  supports: ['text', 'voice_msg', 'voice_call', 'video_call', 'group', 'broadcast'], icon: '📱' },
  telegram:  { name: 'Telegram',  supports: ['text', 'voice_msg', 'voice_call', 'video_call', 'group', 'broadcast'], icon: '✈️' },
  instagram: { name: 'Instagram', supports: ['text', 'voice_msg', 'group'], icon: '📸' },
  discord:   { name: 'Discord',   supports: ['text', 'voice_msg', 'voice_call', 'group'], icon: '🎮' },
  signal:    { name: 'Signal',    supports: ['text', 'voice_msg', 'voice_call', 'video_call', 'group'], icon: '🔒' },
  slack:     { name: 'Slack',     supports: ['text', 'voice_msg', 'group', 'broadcast'], icon: '💼' },
  teams:     { name: 'Teams',     supports: ['text', 'voice_call', 'video_call', 'group'], icon: '🏢' },
  zoom:      { name: 'Zoom',      supports: ['voice_call', 'video_call'], icon: '📹' },
  sms:       { name: 'SMS',       supports: ['text', 'voice_msg'], icon: '💬' },
}

/* ──────────────── Communication Modes ──────────────────────────── */

const MODES = {
  TEXT:        'text',          // Send text messages
  VOICE_MSG:  'voice_msg',    // Send voice messages (cloned voice)
  VOICE_CALL: 'voice_call',   // Live voice call (real-time)
  VIDEO_CALL: 'video_call',   // Video call (with avatar)
  GROUP:      'group',         // Group chat participation
  BROADCAST:  'broadcast',     // Send to multiple contacts
  SCHEDULED:  'scheduled',     // Schedule messages for later
  AUTO:       'auto',          // Auto-reply to everything
}

/* ──────────────── Unified Communications ──────────────────────────── */

class UnifiedComms {
  constructor() {
    // Platform connections
    this.connectedPlatforms = new Map()  // platform → {status, connection}

    // Active sessions — multiple at the same time
    this.activeSessions = new Map()      // sessionId → {platform, contact, mode, state}

    // Global settings
    this.settings = {
      autoReply: false,
      autoReplyMode: 'draft',     // 'auto', 'draft', 'ask'
      defaultVoice: null,         // default voice profile
      defaultEmotion: 'neutral',
      language: 'auto',           // auto-detect
      maxConcurrentSessions: 5,
    }

    // Message queue — handles multiple conversations simultaneously
    this.messageQueue = []
    this.processing = false

    // Statistics
    this.stats = {
      totalMessages: 0,
      totalVoiceMsgs: 0,
      totalCalls: 0,
      totalCallMinutes: 0,
      byPlatform: {},
    }

    // State persistence
    this.ready = false
  }

  /**
   * Initialize — connect to all platforms, load state.
   */
  async init() {
    if (this.ready) return

    try {
      if (!existsSync(COMMS_DIR)) await mkdir(COMMS_DIR, { recursive: true })

      // Load saved state
      if (existsSync(STATE_FILE)) {
        const saved = JSON.parse(await readFile(STATE_FILE, 'utf-8'))
        if (saved.settings) Object.assign(this.settings, saved.settings)
        if (saved.stats) Object.assign(this.stats, saved.stats)
      }

      // Initialize subsystems
      await voiceCloneEngine.init()
      await voiceReplica.init()
      await socialBridge.init()
      await ttsEngine.init()
      await ttsEngine.loadVoiceReferences()

      this.ready = true
    } catch {
      this.ready = true
    }
  }

  /**
   * Connect to a platform.
   */
  async connectPlatform(platform) {
    await this.init()

    const result = await socialBridge.connectPlatform(platform)

    this.connectedPlatforms.set(platform, {
      connected: result.ok,
      connectedAt: result.ok ? new Date().toISOString() : null,
      info: result,
    })

    return result
  }

  /**
   * Connect to ALL platforms at once.
   */
  async connectAll() {
    await this.init()
    const results = {}
    for (const platform of Object.keys(PLATFORMS)) {
      results[platform] = await this.connectPlatform(platform)
    }
    return results
  }

  /* ═══════════════════════════════════════════════════════════
   *  TEXT MESSAGES — Chat as you
   * ═══════════════════════════════════════════════════════════ */

  /**
   * Send a text message. Can reply in your style automatically.
   */
  async sendText(platform, contact, text, { style = true, context = '' } = {}) {
    await this.init()

    let message = text

    // Apply your messaging style if enabled
    if (style && voiceReplica.messagingStyle) {
      // Style is already applied by voice-replica when generating
      // For direct text, we keep it as-is (user typed it)
    }

    // Send through social bridge
    const result = await socialBridge._sendMessage(platform, contact, message)

    this._updateStats('text', platform)

    return {
      ok: true,
      type: 'text',
      platform,
      contact,
      message,
    }
  }

  /**
   * Reply to incoming message as text.
   */
  async replyText(platform, contact, incomingMessage, { context = '' } = {}) {
    await this.init()

    // Generate reply in your style
    const reply = await voiceReplica.generateReply(contact, incomingMessage, {
      context: `Platform: ${platform}. ${context}`,
    })

    // Send it
    return this.sendText(platform, contact, reply, { style: false })
  }

  /* ═══════════════════════════════════════════════════════════
   *  VOICE MESSAGES — Your cloned voice
   * ═══════════════════════════════════════════════════════════ */

  /**
   * Send a voice message with your cloned voice.
   */
  async sendVoiceMsg(platform, contact, text = null, {
    emotion = 'neutral',
    incomingMessage = null,
    context = '',
  } = {}) {
    await this.init()

    const result = await voiceMessageSender.sendVoiceMessage(platform, contact, text, {
      voice: this.settings.defaultVoice,
      emotion,
      incomingMessage,
      context,
    })

    this._updateStats('voice_msg', platform)

    return result
  }

  /**
   * Reply with voice message to incoming text.
   */
  async replyVoiceMsg(platform, contact, incomingMessage, { emotion = 'neutral', context = '' } = {}) {
    await this.init()

    return this.sendVoiceMsg(platform, contact, null, {
      emotion,
      incomingMessage,
      context,
    })
  }

  /* ═══════════════════════════════════════════════════════════
   *  VOICE CALLS — Real-time conversation as you
   * ═══════════════════════════════════════════════════════════ */

  /**
   * Start a voice call.
   */
  async startVoiceCall(platform, contact, { voiceProfile = null } = {}) {
    await this.init()

    const result = await voiceCallBridge.startCall(platform, contact, {
      voiceProfile: voiceProfile || this.settings.defaultVoice,
    })

    if (result.ok) {
      const sessionId = `call-${Date.now()}`
      this.activeSessions.set(sessionId, {
        platform,
        contact,
        mode: MODES.VOICE_CALL,
        startTime: new Date().toISOString(),
        status: 'active',
      })
      this._updateStats('voice_call', platform)
    }

    return result
  }

  /**
   * Speak during a call.
   */
  async callSpeak(text, { emotion = 'neutral' } = {}) {
    return voiceCallBridge.speak(text, { emotion })
  }

  /**
   * Process what the other person said during a call.
   */
  async callListen(theirText, { emotion = 'neutral' } = {}) {
    return voiceCallBridge.processIncomingSpeech(theirText, { emotion })
  }

  /**
   * End a voice call.
   */
  async endVoiceCall() {
    return voiceCallBridge.endCall()
  }

  /* ═══════════════════════════════════════════════════════════
   *  MULTI-PLATFORM — Do multiple things at once
   * ═══════════════════════════════════════════════════════════ */

  /**
   * Send message to multiple contacts across platforms simultaneously.
   */
  async broadcast(platforms, contacts, message, { type = 'text', emotion = 'neutral' } = {}) {
    await this.init()

    const results = []

    // Parallel — send to all simultaneously
    const promises = []
    for (const platform of platforms) {
      for (const contact of contacts) {
        if (type === 'text') {
          promises.push(
            this.sendText(platform, contact, message)
              .then((r) => results.push({ platform, contact, ...r }))
              .catch((e) => results.push({ platform, contact, ok: false, error: e.message }))
          )
        } else if (type === 'voice') {
          promises.push(
            this.sendVoiceMsg(platform, contact, message, { emotion })
              .then((r) => results.push({ platform, contact, ...r }))
              .catch((e) => results.push({ platform, contact, ok: false, error: e.message }))
          )
        }
      }
    }

    await Promise.all(promises)

    return {
      ok: true,
      type: 'broadcast',
      totalSent: results.filter((r) => r.ok).length,
      totalFailed: results.filter((r) => !r.ok).length,
      results,
    }
  }

  /**
   * Schedule a message for later.
   */
  async scheduleMessage(platform, contact, message, sendAt, { type = 'text', emotion = 'neutral' } = {}) {
    const delay = new Date(sendAt).getTime() - Date.now()
    if (delay <= 0) {
      // Send immediately
      if (type === 'text') return this.sendText(platform, contact, message)
      return this.sendVoiceMsg(platform, contact, message, { emotion })
    }

    // Schedule
    const scheduled = {
      id: `sched-${Date.now()}`,
      platform,
      contact,
      message,
      type,
      emotion,
      sendAt: new Date(sendAt).toISOString(),
      status: 'scheduled',
    }

    setTimeout(async () => {
      if (type === 'text') {
        await this.sendText(platform, contact, message)
      } else {
        await this.sendVoiceMsg(platform, contact, message, { emotion })
      }
      scheduled.status = 'sent'
      scheduled.sentAt = new Date().toISOString()
    }, delay)

    return { ok: true, scheduled }
  }

  /* ═══════════════════════════════════════════════════════════
   *  AUTO-REPLY — JARVIS handles everything
   * ═══════════════════════════════════════════════════════════ */

  /**
   * Enable auto-reply across all platforms.
   */
  async enableAutoReply({ mode = 'draft', defaultType = 'text' } = {}) {
    this.settings.autoReply = true
    this.settings.autoReplyMode = mode
    this.settings.defaultReplyType = defaultType

    socialBridge.setReplyMode(mode)

    return { ok: true, mode, defaultType }
  }

  /**
   * Disable auto-reply.
   */
  disableAutoReply() {
    this.settings.autoReply = false
    socialBridge.setReplyMode('ask')
    return { ok: true }
  }

  /**
   * Process incoming message — auto-reply if enabled.
   */
  async processIncoming(platform, contact, message, { isVoice = false } = {}) {
    await this.init()

    // Process through social bridge
    const result = await socialBridge.processIncomingMessage(platform, contact, message, { isVoice })

    // If auto-reply enabled and reply generated
    if (this.settings.autoReply && result.reply) {
      const replyType = this.settings.defaultReplyType || 'text'

      if (replyType === 'voice') {
        // Send as voice message
        await this.sendVoiceMsg(platform, contact, result.reply)
      }
      // Text reply already sent by social bridge
    }

    return result
  }

  /* ═══════════════════════════════════════════════════════════
   *  SETTINGS
   * ═══════════════════════════════════════════════════════════ */

  /**
   * Set default voice profile.
   */
  setDefaultVoice(profileName) {
    this.settings.defaultVoice = profileName
    voiceCloneEngine.selectVoice(profileName)
    return { ok: true, voice: profileName }
  }

  /**
   * Update settings.
   */
  updateSettings(updates) {
    Object.assign(this.settings, updates)
    this._saveState()
    return { ok: true, settings: this.settings }
  }

  /* ═══════════════════════════════════════════════════════════
   *  STATUS & STATS
   * ═══════════════════════════════════════════════════════════ */

  /**
   * Get full system status.
   */
  getStatus() {
    return {
      ready: this.ready,
      platforms: Object.fromEntries(this.connectedPlatforms),
      activeSessions: this.activeSessions.size,
      settings: this.settings,
      stats: { ...this.stats },
      subsystems: {
        voiceClone: voiceCloneEngine.getStats(),
        voiceReplica: voiceReplica.getStats(),
        tts: ttsEngine.getStats(),
        virtualMic: virtualMic.getStatus(),
        social: socialBridge.getStats(),
        calls: voiceCallBridge.getStats(),
        voiceMsg: voiceMessageSender.getStats(),
      },
    }
  }

  /**
   * Get available capabilities.
   */
  getCapabilities() {
    const capabilities = {}

    for (const [platform, info] of Object.entries(PLATFORMS)) {
      const connected = this.connectedPlatforms.get(platform)?.connected
      capabilities[platform] = {
        ...info,
        connected,
        available: connected ? info.supports : [],
      }
    }

    return {
      platforms: capabilities,
      voiceCloned: voiceCloneEngine.profiles.size > 0,
      styleLearned: !!voiceReplica.messagingStyle,
      ttsReady: ttsEngine.ready,
      supportedModes: Object.values(MODES),
    }
  }

  /* ═══════════════════════════════════════════════════════════
   *  INTERNAL
   * ═══════════════════════════════════════════════════════════ */

  _updateStats(type, platform) {
    this.stats.totalMessages++
    if (type === 'voice_msg') this.stats.totalVoiceMsgs++
    if (type === 'voice_call') this.stats.totalCalls++
    if (!this.stats.byPlatform[platform]) this.stats.byPlatform[platform] = 0
    this.stats.byPlatform[platform]++
  }

  async _saveState() {
    const state = {
      settings: this.settings,
      stats: this.stats,
      savedAt: new Date().toISOString(),
    }
    writeFile(STATE_FILE, JSON.stringify(state, null, 2)).catch(() => {})
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const unifiedComms = new UnifiedComms()

export { unifiedComms, UnifiedComms, PLATFORMS, MODES }
export default unifiedComms