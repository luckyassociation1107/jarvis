/**
 * JARVIS Virtual Mic — routes cloned audio to system audio input.
 *
 * How it works:
 *   1. Creates a virtual audio device (VB-Cable / Virtual Audio Cable)
 *   2. Generates TTS audio using cloned voice
 *   3. Plays audio through virtual mic
 *   4. Any app (WhatsApp, Zoom, Telegram) picks it up as real mic input
 *   5. User appears to be speaking in their own voice
 *
 * Flow:
 *   Text → Cloned Voice TTS → Virtual Mic → WhatsApp/Telegram/Zoom
 *
 * "Your voice is ready. I'll play it through the virtual mic.
 *  WhatsApp thinks it's your real voice. No one can tell."
 */

import { eventBus, EVENTS } from './event-bus.mjs'
import { voiceCloneEngine } from './voice-clone.mjs'

/* ──────────────── Virtual Mic ──────────────────────────── */

class VirtualMic {
  constructor() {
    this.isConnected = false
    this.activeApp = null       // which app is using the mic
    this.audioQueue = []        // queued audio to play
    this.isPlaying = false
    this.deviceName = 'JARVIS Virtual Mic'
    this.volume = 1.0           // 0.0 to 1.0
    this.logs = []
  }

  /**
   * Check if virtual audio device is available.
   */
  async checkDevice() {
    // Check for VB-Cable or similar virtual audio device
    // In production, this checks for actual audio devices
    const devices = await this._listAudioDevices()
    const virtualDevice = devices.find((d) =>
      d.name.includes('CABLE') ||
      d.name.includes('Virtual') ||
      d.name.includes('VB-Audio') ||
      d.name.includes('JARVIS')
    )

    return {
      available: !!virtualDevice,
      device: virtualDevice || null,
      allDevices: devices,
      setupNeeded: !virtualDevice,
      setupInstructions: !virtualDevice
        ? 'Install VB-Cable (https://vb-audio.com/Cable/) to enable virtual microphone'
        : null,
    }
  }

  /**
   * List available audio devices.
   */
  async _listAudioDevices() {
    // In production: use native audio APIs
    // For now, return typical devices
    return [
      { id: 'mic-0', name: 'Default Microphone', type: 'input', isDefault: true },
      { id: 'mic-1', name: 'Realtek Audio', type: 'input', isDefault: false },
      { id: 'virtual-0', name: 'CABLE Output (VB-Audio Virtual Cable)', type: 'input', isDefault: false },
      { id: 'speaker-0', name: 'Default Speaker', type: 'output', isDefault: true },
    ]
  }

  /**
   * Connect to virtual mic device.
   */
  async connect() {
    const check = await this.checkDevice()
    if (!check.available) {
      return {
        ok: false,
        error: 'Virtual audio device not found',
        setup: check.setupInstructions,
      }
    }

    this.isConnected = true
    this._log('connected', 'Virtual mic connected')
    eventBus.emit('virtual_mic:connected', { device: check.device })
    return { ok: true, device: check.device }
  }

  /**
   * Disconnect virtual mic.
   */
  disconnect() {
    this.isConnected = false
    this.activeApp = null
    this.isPlaying = false
    this.audioQueue = []
    this._log('disconnected', 'Virtual mic disconnected')
    return { ok: true }
  }

  /**
   * Set active app (which app should receive the audio).
   */
  setActiveApp(app) {
    const supportedApps = ['whatsapp', 'telegram', 'instagram', 'discord', 'zoom', 'teams', 'slack', 'signal']
    if (!supportedApps.includes(app.toLowerCase())) {
      return { ok: false, error: `App "${app}" not supported. Supported: ${supportedApps.join(', ')}` }
    }
    this.activeApp = app.toLowerCase()
    this._log('app_set', `Active app: ${this.activeApp}`)
    return { ok: true, app: this.activeApp }
  }

  /**
   * Play text as voice through virtual mic.
   * This is the main function — converts text to cloned voice and plays it.
   */
  async speak(text, { emotion = 'neutral', profileName = null, waitForFinish = true } = {}) {
    if (!this.isConnected) {
      return { ok: false, error: 'Virtual mic not connected. Call connect() first.' }
    }

    // Generate cloned voice audio
    const voiceResult = await voiceCloneEngine.generateClonedSpeech(text, { profileName, emotion })
    if (!voiceResult.ok) return voiceResult

    // Queue the audio
    const audioItem = {
      id: `audio-${Date.now()}`,
      text,
      voiceParams: voiceResult.tts_params,
      emotion,
      profile: voiceResult.profile,
      status: 'queued',
      createdAt: new Date().toISOString(),
    }
    this.audioQueue.push(audioItem)

    // Process queue
    if (!this.isPlaying) {
      await this._processQueue()
    }

    return {
      ok: true,
      audioId: audioItem.id,
      text,
      profile: voiceResult.profile,
      estimatedDuration: voiceResult.estimated_duration || '~3s',
    }
  }

  /**
   * Process audio queue.
   */
  async _processQueue() {
    this.isPlaying = true

    while (this.audioQueue.length > 0) {
      const item = this.audioQueue.shift()
      item.status = 'playing'
      this._log('playing', `Playing: "${item.text.slice(0, 50)}..."`)

      // In production: actually generate audio and play through virtual device
      // Using child_process to call ffmpeg/sox or native audio APIs
      await this._playAudioThroughDevice(item)

      item.status = 'completed'
      item.completedAt = new Date().toISOString()
      this._log('completed', `Completed: "${item.text.slice(0, 50)}..."`)

      eventBus.emit('virtual_mic:played', { audioId: item.id, text: item.text })
    }

    this.isPlaying = false
  }

  /**
   * Play audio through the virtual audio device.
   */
  async _playAudioThroughDevice(item) {
    // In production: this would use:
    // 1. TTS engine (Coqui/Piper/XTTS) with voice cloning params
    // 2. Audio pipeline to virtual device
    // 3. Real-time audio streaming

    // The actual implementation would be:
    // const audioBuffer = await ttsEngine.synthesize(item.text, item.voiceParams)
    // await audioDevice.play(audioBuffer, 'CABLE Output')

    // For now, simulate the delay
    const estimatedMs = item.text.length * 50 // ~50ms per character
    await new Promise((r) => setTimeout(r, Math.min(estimatedMs, 5000)))
  }

  /**
   * Stop current playback.
   */
  stop() {
    this.audioQueue = []
    this.isPlaying = false
    this._log('stopped', 'Playback stopped')
    return { ok: true }
  }

  /**
   * Set volume.
   */
  setVolume(level) {
    this.volume = Math.max(0, Math.min(1, level))
    return { ok: true, volume: this.volume }
  }

  /**
   * Get status.
   */
  getStatus() {
    return {
      connected: this.isConnected,
      activeApp: this.activeApp,
      isPlaying: this.isPlaying,
      queueLength: this.audioQueue.length,
      volume: this.volume,
    }
  }

  _log(type, message) {
    this.logs.push({ type, message, timestamp: new Date().toISOString() })
    if (this.logs.length > 100) this.logs.shift()
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const virtualMic = new VirtualMic()

export { virtualMic, VirtualMic }
export default virtualMic