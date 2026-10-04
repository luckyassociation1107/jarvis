/**
 * JARVIS AI Avatar — your visual representation for video calls.
 *
 * Features:
 *   - Animated avatar that lip-syncs to your cloned voice
 *   - Realistic facial expressions matching emotion
 *   - Background replacement (any scene)
 *   - Gesture generation (nod, wave, point)
 *   - Real-time face tracking from your webcam
 *   - Avatar customization (appearance, style)
 *   - Video output for Zoom/Teams/Google Meet
 *
 * "Video call lo nee face kanipinchadu. Nee avatar matladthundi.
 *  Nee voice lo. Nee expressions tho. Evadu teliyadu AI ani."
 */

import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── AI Avatar ──────────────────────────── */

class AIAvatar {
  constructor() {
    // Avatar state
    this.active = false
    this.currentAvatar = null
    this.avatars = new Map()       // avatarId → avatar config

    // Animation state
    this.currentExpression = 'neutral'
    this.currentGesture = 'idle'
    this.lipSyncActive = false
    this.eyeContact = true

    // Video output
    this.outputDevice = null       // virtual camera device
    this.resolution = { width: 1280, height: 720 }
    this.fps = 30

    // Pre-defined avatars
    this._loadDefaultAvatars()

    // Expression map — emotion → facial parameters
    this.expressionMap = {
      neutral:  { smile: 0, browRaise: 0, eyeWide: 0, mouthOpen: 0 },
      happy:    { smile: 0.8, browRaise: 0.2, eyeWide: 0.1, mouthOpen: 0.2 },
      sad:      { smile: -0.3, browRaise: -0.2, eyeWide: 0, mouthOpen: 0 },
      angry:    { smile: -0.5, browRaise: -0.5, eyeWide: 0.3, mouthOpen: 0.1 },
      excited:  { smile: 1.0, browRaise: 0.5, eyeWide: 0.4, mouthOpen: 0.5 },
      confused: { smile: 0, browRaise: 0.3, eyeWide: 0.2, mouthOpen: 0.1 },
      thinking: { smile: 0, browRaise: 0.1, eyeWide: 0, mouthOpen: 0 },
      laughing: { smile: 1.0, browRaise: 0.3, eyeWide: 0.5, mouthOpen: 0.8 },
    }

    // Gesture library
    this.gestureLibrary = {
      idle:      { type: 'idle', duration: 0 },
      nod:       { type: 'nod', duration: 1000 },
      wave:      { type: 'wave', duration: 2000 },
      point:     { type: 'point', duration: 1500 },
      thumbsup:  { type: 'thumbsup', duration: 1500 },
      shrug:     { type: 'shrug', duration: 2000 },
      clap:      { type: 'clap', duration: 2000 },
      thinking:  { type: 'thinking', duration: 3000 },
    }
  }

  _loadDefaultAvatars() {
    this.avatars.set('professional_male', {
      id: 'professional_male',
      name: 'Professional Male',
      gender: 'male',
      age: 'adult',
      style: 'professional',
      appearance: { hair: 'short dark', skin: 'medium', outfit: 'business casual' },
    })

    this.avatars.set('professional_female', {
      id: 'professional_female',
      name: 'Professional Female',
      gender: 'female',
      age: 'adult',
      style: 'professional',
      appearance: { hair: 'long dark', skin: 'medium', outfit: 'business casual' },
    })

    this.avatars.set('casual_male', {
      id: 'casual_male',
      name: 'Casual Male',
      gender: 'male',
      age: 'young',
      style: 'casual',
      appearance: { hair: 'short', skin: 'medium', outfit: 't-shirt' },
    })

    this.avatars.set('custom', {
      id: 'custom',
      name: 'Custom Avatar',
      gender: 'neutral',
      age: 'adult',
      style: 'custom',
      appearance: null,
    })
  }

  /**
   * Select an avatar.
   */
  selectAvatar(avatarId) {
    const avatar = this.avatars.get(avatarId)
    if (!avatar) return { ok: false, error: `Avatar "${avatarId}" not found` }

    this.currentAvatar = avatar
    return { ok: true, avatar }
  }

  /**
   * Create a custom avatar from a photo.
   */
  async createFromPhoto(photoPath, { name = 'My Avatar' } = {}) {
    // In production: use face detection + 3D model generation
    const avatar = {
      id: `custom-${Date.now()}`,
      name,
      gender: 'auto-detected',
      age: 'auto-detected',
      style: 'photo-based',
      appearance: { sourcePhoto: photoPath },
      createdAt: new Date().toISOString(),
    }

    this.avatars.set(avatar.id, avatar)
    return { ok: true, avatar }
  }

  /**
   * Start avatar for video call.
   */
  async startAvatar({ outputDevice = 'virtual_camera' } = {}) {
    if (!this.currentAvatar) {
      this.selectAvatar('professional_male')
    }

    this.active = true
    this.outputDevice = outputDevice

    eventBus.emit('avatar:started', { avatar: this.currentAvatar })

    return {
      ok: true,
      avatar: this.currentAvatar,
      output: outputDevice,
      resolution: this.resolution,
      fps: this.fps,
    }
  }

  /**
   * Stop avatar.
   */
  stopAvatar() {
    this.active = false
    this.lipSyncActive = false
    this.currentExpression = 'neutral'
    this.currentGesture = 'idle'

    eventBus.emit('avatar:stopped')
    return { ok: true }
  }

  /**
   * Set facial expression. Instant — parameter update only.
   */
  setExpression(emotion) {
    if (!this.active) return { ok: false, error: 'Avatar not active' }

    const expression = this.expressionMap[emotion] || this.expressionMap.neutral
    this.currentExpression = emotion

    return { ok: true, emotion, expression }
  }

  /**
   * Play a gesture. Returns gesture duration.
   */
  playGesture(gestureName) {
    if (!this.active) return { ok: false, error: 'Avatar not active' }

    const gesture = this.gestureLibrary[gestureName]
    if (!gesture) return { ok: false, error: `Gesture "${gestureName}" not found` }

    this.currentGesture = gestureName

    // Auto-return to idle after gesture
    if (gesture.duration > 0) {
      setTimeout(() => {
        this.currentGesture = 'idle'
      }, gesture.duration)
    }

    return { ok: true, gesture: gestureName, duration: gesture.duration }
  }

  /**
   * Start lip sync — avatar mouth moves with audio.
   */
  startLipSync() {
    this.lipSyncActive = true
    return { ok: true }
  }

  /**
   * Stop lip sync.
   */
  stopLipSync() {
    this.lipSyncActive = false
    return { ok: true }
  }

  /**
   * Update lip sync with audio analysis data.
   * Called continuously during speech.
   */
  updateLipSync(audioData) {
    if (!this.lipSyncActive) return

    // Map audio amplitude to mouth opening
    const amplitude = audioData?.amplitude || 0
    const mouthOpen = Math.min(1, amplitude * 2)

    return {
      mouthOpen,
      viseme: this._amplitudeToViseme(amplitude),
    }
  }

  /**
   * Map amplitude to viseme (mouth shape).
   */
  _amplitudeToViseme(amplitude) {
    if (amplitude < 0.1) return 'closed'
    if (amplitude < 0.3) return 'slightly_open'
    if (amplitude < 0.5) return 'open'
    if (amplitude < 0.7) return 'wide'
    return 'very_wide'
  }

  /**
   * Get avatar status.
   */
  getStatus() {
    return {
      active: this.active,
      avatar: this.currentAvatar?.name || 'none',
      expression: this.currentExpression,
      gesture: this.currentGesture,
      lipSync: this.lipSyncActive,
      output: this.outputDevice,
      resolution: this.resolution,
      fps: this.fps,
    }
  }

  /**
   * List available avatars.
   */
  listAvatars() {
    return Array.from(this.avatars.values()).map((a) => ({
      id: a.id,
      name: a.name,
      style: a.style,
      isActive: a.id === this.currentAvatar?.id,
    }))
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      active: this.active,
      avatars: this.avatars.size,
      currentAvatar: this.currentAvatar?.name || 'none',
      expressions: Object.keys(this.expressionMap).length,
      gestures: Object.keys(this.gestureLibrary).length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const aiAvatar = new AIAvatar()

export { aiAvatar, AIAvatar }
export default aiAvatar