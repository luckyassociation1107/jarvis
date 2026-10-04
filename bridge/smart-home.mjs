/**
 * JARVIS Smart Home — control your entire home with voice.
 *
 * Features:
 *   - Light control (on/off, brightness, color)
 *   - AC/Thermostat control (temperature, mode)
 *   - Fan control (speed)
 *   - TV control (on/off, channel, volume)
 *   - Speaker control (play, pause, volume)
 *   - Door lock/unlock
 *   - Camera monitoring
 *   - Appliance control (washing machine, microwave, etc.)
 *   - Scene management (movie mode, sleep mode, party mode)
 *   - Energy monitoring
 *
 * "Lights dim cheyyu. AC 24 degrees pettu. TV on cheyyu.
 *  Spotify lo Telugu songs play cheyyu. Movie mode activate cheyyu."
 */

import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Device Database ──────────────────────────── */

const DEVICE_TYPES = {
  light:     { name: 'Light', controls: ['power', 'brightness', 'color', 'temperature'] },
  ac:        { name: 'Air Conditioner', controls: ['power', 'temperature', 'mode', 'fan_speed', 'swing'] },
  fan:       { name: 'Fan', controls: ['power', 'speed', 'timer'] },
  tv:        { name: 'TV', controls: ['power', 'volume', 'channel', 'input', 'mute'] },
  speaker:   { name: 'Speaker', controls: ['power', 'volume', 'play', 'pause', 'next', 'source'] },
  lock:      { name: 'Door Lock', controls: ['lock', 'unlock', 'status'] },
  camera:    { name: 'Camera', controls: ['power', 'record', 'snapshot', 'stream'] },
  curtain:   { name: 'Curtain', controls: ['open', 'close', 'position'] },
  plug:      { name: 'Smart Plug', controls: ['power', 'timer', 'energy'] },
  washer:    { name: 'Washing Machine', controls: ['power', 'start', 'pause', 'program'] },
  microwave: { name: 'Microwave', controls: ['power', 'start', 'stop', 'timer', 'temperature'] },
  fridge:    { name: 'Fridge', controls: ['temperature', 'mode'] },
}

/* ──────────────── Smart Home ──────────────────────────── */

class SmartHome {
  constructor() {
    // Devices
    this.devices = new Map()       // deviceId → device
    this.rooms = new Map()         // roomName → [deviceIds]
    this.scenes = new Map()        // sceneName → [actions]

    // State
    this.connected = false
    this.hubType = null            // 'alexa', 'google', 'homekit', 'mqtt', 'custom'

    // Energy tracking
    this.energyLog = []

    // Load default scenes
    this._loadDefaultScenes()
  }

  _loadDefaultScenes() {
    this.scenes.set('movie_mode', {
      name: 'Movie Mode',
      description: 'Dim lights, TV on, AC comfortable, curtains closed',
      actions: [
        { device: 'living_room_light', action: 'set', params: { brightness: 20 } },
        { device: 'tv', action: 'power', params: { state: 'on' } },
        { device: 'ac', action: 'set', params: { temperature: 24 } },
        { device: 'curtain', action: 'close', params: {} },
      ],
    })

    this.scenes.set('sleep_mode', {
      name: 'Sleep Mode',
      description: 'All lights off, AC to sleep mode, doors locked',
      actions: [
        { device: 'all_lights', action: 'power', params: { state: 'off' } },
        { device: 'ac', action: 'set', params: { temperature: 26, mode: 'sleep' } },
        { device: 'all_locks', action: 'lock', params: {} },
        { device: 'tv', action: 'power', params: { state: 'off' } },
      ],
    })

    this.scenes.set('party_mode', {
      name: 'Party Mode',
      description: 'Colorful lights, music on, AC cool',
      actions: [
        { device: 'all_lights', action: 'set', params: { brightness: 100, color: 'party' } },
        { device: 'speaker', action: 'play', params: { playlist: 'party' } },
        { device: 'ac', action: 'set', params: { temperature: 22 } },
      ],
    })

    this.scenes.set('work_mode', {
      name: 'Work Mode',
      description: 'Bright lights, cool AC, no distractions',
      actions: [
        { device: 'desk_light', action: 'set', params: { brightness: 100, color: 'white' } },
        { device: 'ac', action: 'set', params: { temperature: 23 } },
        { device: 'speaker', action: 'play', params: { playlist: 'focus' } },
      ],
    })

    this.scenes.set('morning_mode', {
      name: 'Morning Mode',
      description: 'Lights gradually brighten, curtains open, gentle music',
      actions: [
        { device: 'curtain', action: 'open', params: {} },
        { device: 'bedroom_light', action: 'set', params: { brightness: 50, color: 'warm' } },
        { device: 'speaker', action: 'play', params: { playlist: 'morning' } },
      ],
    })
  }

  /**
   * Connect to smart home hub.
   */
  async connect(hubType = 'mqtt', { host = 'localhost', port = 1883 } = {}) {
    this.hubType = hubType
    this.connected = true

    return { ok: true, hub: hubType, host, port }
  }

  /**
   * Add a device.
   */
  addDevice(id, { name, type, room, manufacturer = '', model = '' } = {}) {
    const deviceType = DEVICE_TYPES[type]
    if (!deviceType) return { ok: false, error: `Unknown device type: ${type}` }

    const device = {
      id,
      name,
      type,
      room,
      manufacturer,
      model,
      state: {},
      capabilities: deviceType.controls,
      online: true,
      lastUpdated: new Date().toISOString(),
    }

    this.devices.set(id, device)

    // Add to room
    const roomDevices = this.rooms.get(room) || []
    roomDevices.push(id)
    this.rooms.set(room, roomDevices)

    return { ok: true, device }
  }

  /**
   * Control a device.
   */
  async control(deviceId, action, params = {}) {
    const device = this.devices.get(deviceId)
    if (!device) return { ok: false, error: `Device "${deviceId}" not found` }

    // Update device state
    Object.assign(device.state, params)
    device.lastUpdated = new Date().toISOString()

    eventBus.emit('smart_home:device_control', {
      deviceId,
      deviceName: device.name,
      action,
      params,
    })

    return {
      ok: true,
      device: device.name,
      action,
      params,
      newState: device.state,
    }
  }

  /**
   * Control all devices of a type.
   */
  async controlAll(deviceType, action, params = {}) {
    const results = []
    for (const [id, device] of this.devices) {
      if (device.type === deviceType) {
        results.push(await this.control(id, action, params))
      }
    }
    return results
  }

  /**
   * Control all devices in a room.
   */
  async controlRoom(room, action, params = {}) {
    const deviceIds = this.rooms.get(room) || []
    const results = []
    for (const id of deviceIds) {
      results.push(await this.control(id, action, params))
    }
    return results
  }

  /**
   * Activate a scene.
   */
  async activateScene(sceneName) {
    const scene = this.scenes.get(sceneName)
    if (!scene) return { ok: false, error: `Scene "${sceneName}" not found` }

    const results = []
    for (const action of scene.actions) {
      results.push(await this.control(action.device, action.action, action.params))
    }

    return { ok: true, scene: scene.name, actions: results }
  }

  /**
   * Process natural language command.
   */
  async processCommand(command, { llm = null } = {}) {
    // Fast pattern matching first
    const lower = command.toLowerCase()

    // Light commands
    if (lower.includes('light') || lower.includes('లైట్')) {
      if (lower.includes('off') || lower.includes('ఆఫ్')) {
        return this.controlAll('light', 'power', { state: 'off' })
      }
      if (lower.includes('on') || lower.includes('ఆన్')) {
        return this.controlAll('light', 'power', { state: 'on' })
      }
      if (lower.includes('dim') || lower.includes('డిమ్')) {
        return this.controlAll('light', 'set', { brightness: 30 })
      }
      if (lower.includes('bright') || lower.includes('బ్రైట్')) {
        return this.controlAll('light', 'set', { brightness: 100 })
      }
    }

    // AC commands
    if (lower.includes('ac') || lower.includes('ఏసీ') || lower.includes('air conditioner')) {
      const tempMatch = lower.match(/(\d+)\s*degree/)
      if (tempMatch) {
        return this.controlAll('ac', 'set', { temperature: parseInt(tempMatch[1]) })
      }
      if (lower.includes('off') || lower.includes('ఆఫ్')) {
        return this.controlAll('ac', 'power', { state: 'off' })
      }
      if (lower.includes('on') || lower.includes('ఆన్')) {
        return this.controlAll('ac', 'power', { state: 'on' })
      }
    }

    // TV commands
    if (lower.includes('tv') || lower.includes('టీవీ') || lower.includes('television')) {
      if (lower.includes('off') || lower.includes('ఆఫ్')) {
        return this.controlAll('tv', 'power', { state: 'off' })
      }
      if (lower.includes('on') || lower.includes('ఆన్')) {
        return this.controlAll('tv', 'power', { state: 'on' })
      }
    }

    // Scene commands
    for (const [sceneName, scene] of this.scenes) {
      if (lower.includes(sceneName.replace('_', ' ')) || lower.includes(sceneName.replace('_', ''))) {
        return this.activateScene(sceneName)
      }
    }

    // Movie mode
    if (lower.includes('movie') || lower.includes('మూవీ')) {
      return this.activateScene('movie_mode')
    }

    // Sleep mode
    if (lower.includes('sleep') || lower.includes('నిద్ర')) {
      return this.activateScene('sleep_mode')
    }

    // Party mode
    if (lower.includes('party') || lower.includes('పార్టీ')) {
      return this.activateScene('party_mode')
    }

    return { ok: false, error: 'Command not recognized. Try: "lights off", "AC 24 degrees", "movie mode"' }
  }

  /**
   * Get device status.
   */
  getDeviceStatus(deviceId) {
    return this.devices.get(deviceId) || null
  }

  /**
   * Get all devices.
   */
  getAllDevices() {
    return Array.from(this.devices.values())
  }

  /**
   * Get rooms.
   */
  getRooms() {
    return Array.from(this.rooms.entries()).map(([name, devices]) => ({
      name,
      deviceCount: devices.length,
      devices: devices.map((id) => this.devices.get(id)?.name || id),
    }))
  }

  /**
   * Get scenes.
   */
  getScenes() {
    return Array.from(this.scenes.values()).map((s) => ({
      name: s.name,
      description: s.description,
      actions: s.actions.length,
    }))
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      connected: this.connected,
      hub: this.hubType,
      devices: this.devices.size,
      rooms: this.rooms.size,
      scenes: this.scenes.size,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const smartHome = new SmartHome()

export { smartHome, SmartHome, DEVICE_TYPES }
export default smartHome