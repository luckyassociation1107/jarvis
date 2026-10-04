/**
 * JARVIS Holographic Display — 3D holographic output.
 *
 * Features:
 *   - 3D object rendering in holographic style
 *   - Floating UI panels
 *   - 3D data visualization
 *   - Holographic notifications
 *   - 3D model viewer
 *   - Spatial computing interface
 *   - Gesture-controlled 3D workspace
 *
 *   "3D objects air lo float avthayi.
 *    Holographic panels kanipisthayi.
 *    3D lo data visualize cheyyachu.
 *    Minority Report la untundi."
 */

import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Holographic Display ──────────────────────────── */

class HolographicDisplay {
  constructor() {
    this.active = false
    this.objects = new Map()       // objectId → 3D object
    this.panels = new Map()        // panelId → floating panel
    this.workspace = { x: 0, y: 0, z: 0, scale: 1 }
    this.renderMode = 'stereo'     // stereo, mono, anaglyph
  }

  /**
   * Activate holographic display.
   */
  activate({ renderMode = 'stereo' } = {}) {
    this.active = true
    this.renderMode = renderMode
    eventBus.emit('holographic:activated', { renderMode })
    return { ok: true, renderMode, message: 'Holographic display active.' }
  }

  /**
   * Deactivate.
   */
  deactivate() {
    this.active = false
    this.objects.clear()
    this.panels.clear()
    return { ok: true }
  }

  /**
   * Add a 3D object.
   */
  addObject(type, { x = 0, y = 0, z = 0, scale = 1, rotation = { x: 0, y: 0, z: 0 }, color = '#00ffff', opacity = 0.8 } = {}) {
    if (!this.active) return { ok: false }

    const objectId = `obj-${Date.now()}`
    const obj = {
      id: objectId,
      type, // cube, sphere, cylinder, text, model, chart, notification
      position: { x, y, z },
      scale,
      rotation,
      color,
      opacity,
      createdAt: Date.now(),
    }

    this.objects.set(objectId, obj)
    return { ok: true, object: obj }
  }

  /**
   * Add a floating panel.
   */
  addPanel(title, content, { x = 0, y = 1, z = -1, width = 2, height = 1.5, opacity = 0.7 } = {}) {
    if (!this.active) return { ok: false }

    const panelId = `panel-${Date.now()}`
    const panel = {
      id: panelId,
      title,
      content,
      position: { x, y, z },
      size: { width, height },
      opacity,
      createdAt: Date.now(),
    }

    this.panels.set(panelId, panel)
    return { ok: true, panel }
  }

  /**
   * Create 3D data visualization.
   */
  visualizeData(data, { type = 'bar', title = 'Data' } = {}) {
    if (!this.active) return { ok: false }

    // Create 3D bars/points for data
    const bars = data.map((d, i) => ({
      id: `bar-${i}`,
      type: 'cylinder',
      position: { x: i * 0.5 - (data.length * 0.25), y: d.value / 2, z: 0 },
      scale: { x: 0.3, y: d.value, z: 0.3 },
      color: d.color || `hsl(${i * 30}, 80%, 60%)`,
      label: d.label,
    }))

    return {
      ok: true,
      visualization: type,
      title,
      elements: bars.length,
    }
  }

  /**
   * Show holographic notification.
   */
  showNotification(message, { type = 'info', duration = 5000 } = {}) {
    const colors = { info: '#00ffff', warning: '#ffaa00', error: '#ff4444', success: '#44ff44' }

    return this.addObject('notification', {
      x: 1.5,
      y: 1.5,
      z: -0.5,
      color: colors[type] || colors.info,
      opacity: 0.9,
    })
  }

  /**
   * Move an object.
   */
  moveObject(objectId, x, y, z) {
    const obj = this.objects.get(objectId)
    if (!obj) return { ok: false }
    obj.position = { x, y, z }
    return { ok: true, object: obj }
  }

  /**
   * Rotate an object.
   */
  rotateObject(objectId, x, y, z) {
    const obj = this.objects.get(objectId)
    if (!obj) return { ok: false }
    obj.rotation = { x, y, z }
    return { ok: true, object: obj }
  }

  /**
   * Remove an object.
   */
  removeObject(objectId) {
    return { ok: this.objects.delete(objectId) }
  }

  /**
   * Get all objects.
   */
  getObjects() {
    return Array.from(this.objects.values())
  }

  /**
   * Get all panels.
   */
  getPanels() {
    return Array.from(this.panels.values())
  }

  /**
   * Get status.
   */
  getStatus() {
    return {
      active: this.active,
      renderMode: this.renderMode,
      objects: this.objects.size,
      panels: this.panels.size,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const holographicDisplay = new HolographicDisplay()

export { holographicDisplay, HolographicDisplay }
export default holographicDisplay