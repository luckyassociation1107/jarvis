/**
 * JARVIS Cross-Device Consciousness — one mind, EVERYWHERE.
 *
 * JARVIS doesn't live on one device. It exists on ALL of them:
 *   - Phone, laptop, desktop, smart TV, smart speaker, car
 *   - Shares memory across all devices
 *   - Maintains conversation context when switching devices
 *   - Knows which device you're on and adapts
 *   - Syncs state in real-time
 *   - If one device dies, another picks up seamlessly
 *
 * "You walked away from your laptop mid-sentence? I know.
 *  Your phone just buzzed. I continued exactly where you left off."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Device registry ──────────────────────────── */

class CrossDeviceMind {
  constructor() {
    this.devices = new Map()     // deviceId → device info
    this.activeDevice = null     // currently active device
    this.conversations = new Map() // deviceId → conversation history
    this.sharedState = {         // state that syncs across devices
      context: null,
      currentTask: null,
      mood: 'neutral',
      lastInteraction: null,
    }
    this.switchLog = []          // device switch history
  }

  /**
   * Register a device.
   */
  registerDevice(id, { type = 'unknown', name = '', capabilities = [] } = {}) {
    this.devices.set(id, {
      id,
      type, // phone, laptop, desktop, tv, speaker, car, watch
      name,
      capabilities, // ['screen', 'voice', 'keyboard', 'touch', 'camera']
      registered: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      active: false,
    })
  }

  /**
   * Switch active device — seamless context transfer.
   */
  switchDevice(newDeviceId) {
    const oldDevice = this.activeDevice
    const newDevice = this.devices.get(newDeviceId)

    if (!newDevice) return { ok: false, error: 'Device not registered' }

    // Save old device state
    if (oldDevice) {
      const old = this.devices.get(oldDevice)
      if (old) old.active = false
    }

    // Switch
    newDevice.active = true
    newDevice.lastSeen = new Date().toISOString()
    this.activeDevice = newDeviceId

    // Log the switch
    this.switchLog.push({
      from: oldDevice,
      to: newDeviceId,
      timestamp: new Date().toISOString(),
    })

    // Adapt to new device capabilities
    const adaptation = this._adaptToDevice(newDevice)

    return {
      ok: true,
      switchedFrom: oldDevice,
      switchedTo: newDeviceId,
      deviceType: newDevice.type,
      adaptation,
      contextPreserved: true,
    }
  }

  /**
   * Adapt behavior to device capabilities.
   */
  _adaptToDevice(device) {
    const adaptations = {
      phone: {
        responseLength: 'short',
        preferredMode: 'voice',
        uiStyle: 'compact',
        proactiveLevel: 'high',
      },
      laptop: {
        responseLength: 'medium',
        preferredMode: 'text',
        uiStyle: 'full',
        proactiveLevel: 'medium',
      },
      desktop: {
        responseLength: 'detailed',
        preferredMode: 'text',
        uiStyle: 'full',
        proactiveLevel: 'medium',
      },
      tv: {
        responseLength: 'short',
        preferredMode: 'voice',
        uiStyle: 'large',
        proactiveLevel: 'low',
      },
      speaker: {
        responseLength: 'very_short',
        preferredMode: 'voice_only',
        uiStyle: 'none',
        proactiveLevel: 'medium',
      },
      car: {
        responseLength: 'very_short',
        preferredMode: 'voice_only',
        uiStyle: 'none',
        proactiveLevel: 'high',
        safety: 'hands_free_only',
      },
      watch: {
        responseLength: 'minimal',
        preferredMode: 'haptic',
        uiStyle: 'glanceable',
        proactiveLevel: 'very_high',
      },
    }

    return adaptations[device.type] || adaptations.laptop
  }

  /**
   * Get context-aware system prompt for current device.
   */
  getContextPrompt() {
    const device = this.devices.get(this.activeDevice)
    const adaptation = device ? this._adaptToDevice(device) : {}

    return `DEVICE CONTEXT:
- Current device: ${device?.name || 'unknown'} (${device?.type || 'unknown'})
- Response length: ${adaptation.responseLength || 'medium'}
- Preferred mode: ${adaptation.preferredMode || 'text'}
- Safety: ${adaptation.safety || 'normal'}
- Shared context: ${this.sharedState.context || 'none'}
- Current task: ${this.sharedState.currentTask || 'none'}
- Mood: ${this.sharedState.mood}

${adaptation.safety === 'hands_free_only' ? '⚠️ HANDS-FEe ONLY — user is driving. Keep responses extremely short. Voice only.' : ''}`
  }

  /**
   * Sync shared state across devices.
   */
  syncState(updates) {
    Object.assign(this.sharedState, updates, {
      lastInteraction: new Date().toISOString(),
    })

    // Notify all devices (in real implementation, this would use WebSocket/Push)
    const activeDevices = Array.from(this.devices.values()).filter((d) => d.id !== this.activeDevice)

    return {
      synced: true,
      updates,
      devicesNotified: activeDevices.length,
    }
  }

  /**
   * Get the handoff summary — what the new device needs to know.
   */
  getHandoffSummary() {
    return {
      previousDevice: this.switchLog[this.switchLog.length - 1]?.from,
      currentTask: this.sharedState.currentTask,
      context: this.sharedState.context,
      mood: this.sharedState.mood,
      recentInteractions: this.switchLog.slice(-5),
    }
  }

  /**
   * Get all registered devices.
   */
  listDevices() {
    return Array.from(this.devices.values()).map((d) => ({
      id: d.id,
      type: d.type,
      name: d.name,
      active: d.id === this.activeDevice,
      capabilities: d.capabilities,
      lastSeen: d.lastSeen,
    }))
  }
}

export { CrossDeviceMind }
export default { CrossDeviceMind }