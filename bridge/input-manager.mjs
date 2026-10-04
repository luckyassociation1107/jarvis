/**
 * JARVIS Input Manager — coordinates ALL input modes.
 *
 * Detects available hardware and enables/disables features:
 *   - Camera available → Gesture control ON
 *   - Mic available → Voice control ON
 *   - Neither → Chat mode (keyboard input)
 *   - All available → User chooses preferred mode
 *
 * Priority: Gesture > Voice > Chat (but user can switch anytime)
 *
 * "Camera untey gestures tho control cheyyu.
 *  Mic untey voice tho control cheyyu.
 *  Rendu untey nee istam — gesture or voice or both.
 *  Emi lekapothey keyboard type cheyyu, AI work chesthundi."
 */

import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Input Modes ──────────────────────────── */

const INPUT_MODES = {
  GESTURE: 'gesture',    // Camera + hand tracking
  VOICE:   'voice',      // Microphone + speech recognition
  CHAT:    'chat',        // Keyboard text input
  HYBRID:  'hybrid',      // Multiple modes simultaneously
}

/* ──────────────── Hardware Detection ──────────────────────────── */

class HardwareDetector {
  constructor() {
    this.camera = { available: false, device: null, resolution: null }
    this.microphone = { available: false, device: null }
    this.speakers = { available: false, device: null }
    this.touchscreen = { available: false }
    this.detected = false
  }

  /**
   * Detect all available hardware.
   */
  async detect() {
    // Camera detection
    this.camera = await this._detectCamera()

    // Microphone detection
    this.microphone = await this._detectMicrophone()

    // Speaker detection
    this.speakers = await this._detectSpeakers()

    // Touchscreen detection
    this.touchscreen = await this._detectTouchscreen()

    this.detected = true

    return {
      camera: this.camera.available,
      microphone: this.microphone.available,
      speakers: this.speakers.available,
      touchscreen: this.touchscreen.available,
      summary: this._getSummary(),
    }
  }

  async _detectCamera() {
    // In production: enumerate video devices
    return { available: true, device: 'Default Camera', resolution: '1280x720' }
  }

  async _detectMicrophone() {
    // In production: enumerate audio input devices
    return { available: true, device: 'Default Microphone' }
  }

  async _detectSpeakers() {
    return { available: true, device: 'Default Speakers' }
  }

  async _detectTouchscreen() {
    return { available: false }
  }

  _getSummary() {
    const available = []
    if (this.camera.available) available.push('Camera')
    if (this.microphone.available) available.push('Microphone')
    if (this.speakers.available) available.push('Speakers')
    if (this.touchscreen.available) available.push('Touchscreen')

    if (available.length === 0) return 'No input devices detected. Using chat mode.'
    if (available.length === 1) return `${available[0]} detected. ${available[0] === 'Camera' ? 'Gesture' : 'Voice'} control available.`
    return `${available.join(', ')} detected. All input modes available.`
  }
}

/* ──────────────── Input Manager ──────────────────────────── */

class InputManager {
  constructor() {
    // Hardware
    this.hardware = new HardwareDetector()

    // Current mode
    this.currentMode = INPUT_MODES.CHAT
    this.activeModes = new Set()  // can be multiple in hybrid mode

    // Mode states
    this.gestureActive = false
    this.voiceActive = false
    this.chatActive = true     // always available as fallback

    // Input history
    this.inputHistory = []     // [{mode, input, timestamp}]

    // Feature flags
    this.features = {
      gesturePointer: false,
      gestureKeyboard: false,
      voiceCommands: false,
      voiceDictation: false,
      chatInput: true,
    }

    // Stats
    this.stats = {
      gestureInputs: 0,
      voiceInputs: 0,
      chatInputs: 0,
      modeSwitches: 0,
    }
  }

  /**
   * Initialize — detect hardware and set up input modes.
   */
  async init() {
    const detection = await this.hardware.detect()

    // Enable features based on available hardware
    if (detection.camera) {
      this.features.gesturePointer = true
      this.features.gestureKeyboard = true
    }

    if (detection.microphone) {
      this.features.voiceCommands = true
      this.features.voiceDictation = true
    }

    // Set initial mode based on available hardware
    if (detection.camera && detection.microphone) {
      this.setMode(INPUT_MODES.HYBRID)
    } else if (detection.camera) {
      this.setMode(INPUT_MODES.GESTURE)
    } else if (detection.microphone) {
      this.setMode(INPUT_MODES.VOICE)
    } else {
      this.setMode(INPUT_MODES.CHAT)
    }

    return {
      ok: true,
      hardware: detection,
      mode: this.currentMode,
      features: { ...this.features },
    }
  }

  /**
   * Set input mode.
   */
  setMode(mode) {
    const previousMode = this.currentMode
    this.currentMode = mode
    this.stats.modeSwitches++

    // Reset active modes
    this.activeModes.clear()

    switch (mode) {
      case INPUT_MODES.GESTURE:
        if (!this.features.gesturePointer) {
          return { ok: false, error: 'Camera not available. Cannot use gesture mode.' }
        }
        this.gestureActive = true
        this.voiceActive = false
        this.activeModes.add('gesture')
        break

      case INPUT_MODES.VOICE:
        if (!this.features.voiceCommands) {
          return { ok: false, error: 'Microphone not available. Cannot use voice mode.' }
        }
        this.gestureActive = false
        this.voiceActive = true
        this.activeModes.add('voice')
        break

      case INPUT_MODES.CHAT:
        this.gestureActive = false
        this.voiceActive = false
        this.chatActive = true
        this.activeModes.add('chat')
        break

      case INPUT_MODES.HYBRID:
        if (this.features.gesturePointer) {
          this.gestureActive = true
          this.activeModes.add('gesture')
        }
        if (this.features.voiceCommands) {
          this.voiceActive = true
          this.activeModes.add('voice')
        }
        this.chatActive = true
        this.activeModes.add('chat')
        break
    }

    eventBus.emit('input:mode_changed', {
      from: previousMode,
      to: mode,
      activeModes: [...this.activeModes],
    })

    return { ok: true, mode, previousMode, activeModes: [...this.activeModes] }
  }

  /**
   * Process input from any source.
   */
  processInput(input, { mode = 'auto' } = {}) {
    const detectedMode = mode === 'auto' ? this._detectInputMode(input) : mode

    // Record in history
    this.inputHistory.push({
      mode: detectedMode,
      input: typeof input === 'string' ? input.slice(0, 100) : input,
      timestamp: new Date().toISOString(),
    })
    if (this.inputHistory.length > 200) this.inputHistory.shift()

    // Update stats
    if (detectedMode === 'gesture') this.stats.gestureInputs++
    else if (detectedMode === 'voice') this.stats.voiceInputs++
    else this.stats.chatInputs++

    return {
      mode: detectedMode,
      input,
      processed: true,
    }
  }

  /**
   * Detect input mode from input data.
   */
  _detectInputMode(input) {
    if (input?.landmarks) return 'gesture'
    if (input?.audio) return 'voice'
    return 'chat'
  }

  /**
   * Get current status.
   */
  getStatus() {
    return {
      mode: this.currentMode,
      activeModes: [...this.activeModes],
      gestureActive: this.gestureActive,
      voiceActive: this.voiceActive,
      chatActive: this.chatActive,
      features: { ...this.features },
      hardware: {
        camera: this.hardware.camera.available,
        microphone: this.hardware.microphone.available,
        speakers: this.hardware.speakers.available,
      },
    }
  }

  /**
   * Get available modes.
   */
  getAvailableModes() {
    const modes = []
    if (this.features.gesturePointer) modes.push({ id: 'gesture', name: 'Gesture Control', available: true })
    if (this.features.voiceCommands) modes.push({ id: 'voice', name: 'Voice Control', available: true })
    modes.push({ id: 'chat', name: 'Chat Input', available: true })
    if (modes.length > 1) modes.push({ id: 'hybrid', name: 'All Modes', available: true })
    return modes
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      currentMode: this.currentMode,
      ...this.stats,
      totalInputs: this.stats.gestureInputs + this.stats.voiceInputs + this.stats.chatInputs,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const inputManager = new InputManager()

export { inputManager, InputManager, INPUT_MODES }
export default inputManager