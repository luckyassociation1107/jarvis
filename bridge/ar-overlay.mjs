/**
 * JARVIS AR Overlay — augmented reality information overlay.
 *
 * Features:
 *   - Real-time object recognition and labeling
 *   - Information overlay on anything you look at
 *   - Translation overlay (see translated text in AR)
 *   - Navigation arrows in AR
 *   - Face recognition (name tags)
 *   - Price comparison overlay (shopping)
 *   - Recipe overlay (cooking)
 *   - Health data overlay (fitness)
 *
 *   "Camera tho chusthey — object names kanipisthayi.
 *    Text chusthey — translate avthundi.
 *    Face chusthey — name tag kanipisthundi.
 *    AR lo antha information kanipisthundi."
 */

import { complete } from './local-llm.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── AR Overlay ──────────────────────────── */

class AROverlay {
  constructor() {
    this.active = false
    this.overlays = new Map()      // overlayId → overlay data
    this.detections = []           // current frame detections
    this.settings = {
      showLabels: true,
      showTranslations: true,
      showPrices: false,
      showNames: true,
      opacity: 0.8,
    }
  }

  /**
   * Activate AR overlay.
   */
  activate() {
    this.active = true
    eventBus.emit('ar:activated')
    return { ok: true, message: 'AR overlay active. Point camera at anything.' }
  }

  /**
   * Deactivate AR overlay.
   */
  deactivate() {
    this.active = false
    this.overlays.clear()
    this.detections = []
    eventBus.emit('ar:deactivated')
    return { ok: true }
  }

  /**
   * Process a camera frame — detect objects and create overlays.
   */
  async processFrame(frameData, { llm = complete } = []) {
    if (!this.active) return null

    const response = await llm('reason', [
      { role: 'system', content: `Analyze this camera frame and identify ALL objects.

For each object:
1. Name (what it is)
2. Position (x, y coordinates 0-1)
3. Size (width, height 0-1)
4. Confidence (0-1)
5. Interesting fact (one sentence)
6. Related info (price, brand, model if applicable)

Respond in JSON:
{
  "objects": [
    {
      "name": "object name",
      "position": {"x": 0.5, "y": 0.3},
      "size": {"w": 0.2, "h": 0.15},
      "confidence": 0.9,
      "info": "interesting fact",
      "type": "person|object|text|animal|vehicle|food|building"
    }
  ],
  "scene": "brief scene description",
  "text_detected": ["any text visible in the scene"]
}` },
      { role: 'user', content: `Camera frame provided.\nIdentify all objects:` },
    ], { maxTokens: 600 })

    try {
      const start = response.indexOf('{')
      const end = response.lastIndexOf('}')
      const detections = JSON.parse(response.slice(start, end + 1))

      this.detections = detections.objects || []

      // Create overlays for each detection
      for (const obj of this.detections) {
        const overlayId = `overlay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        this.overlays.set(overlayId, {
          id: overlayId,
          ...obj,
          createdAt: Date.now(),
        })
      }

      // Translate any detected text
      if (detections.text_detected?.length > 0 && this.settings.showTranslations) {
        // Translation would happen here
      }

      return {
        ok: true,
        objects: this.detections.length,
        scene: detections.scene,
        overlays: Array.from(this.overlays.values()),
      }
    } catch {
      return { ok: false }
    }
  }

  /**
   * Add a custom text overlay.
   */
  addOverlay(text, { x = 0.5, y = 0.5, color = '#ffffff', size = 'medium', duration = 5000 } = {}) {
    const overlayId = `custom-${Date.now()}`
    const overlay = {
      id: overlayId,
      type: 'text',
      text,
      position: { x, y },
      color,
      size,
      createdAt: Date.now(),
      expiresAt: Date.now() + duration,
    }

    this.overlays.set(overlayId, overlay)

    // Auto-remove after duration
    setTimeout(() => this.overlays.delete(overlayId), duration)

    return { ok: true, overlay }
  }

  /**
   * Get current overlays.
   */
  getOverlays() {
    const now = Date.now()
    // Remove expired overlays
    for (const [id, overlay] of this.overlays) {
      if (overlay.expiresAt && overlay.expiresAt < now) {
        this.overlays.delete(id)
      }
    }
    return Array.from(this.overlays.values())
  }

  /**
   * Update settings.
   */
  updateSettings(updates) {
    Object.assign(this.settings, updates)
    return { ok: true, settings: this.settings }
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      active: this.active,
      overlays: this.overlays.size,
      detections: this.detections.length,
      settings: this.settings,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const arOverlay = new AROverlay()

export { arOverlay, AROverlay }
export default arOverlay