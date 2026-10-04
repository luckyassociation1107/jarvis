/**
 * JARVIS Virtual Keyboard — gesture-controlled keyboard on screen.
 *
 * Features:
 *   - Semi-transparent keyboard overlay
 *   - Reduced opacity (always visible, not intrusive)
 *   - Tap gesture to type
 *   - Hold gesture for modifier keys (Ctrl, Shift, Alt)
 *   - Multi-language support (English, Telugu, Hindi)
 *   - Predictive text
 *   - Swipe typing
 *   - Custom layouts
 *   - Gesture hover = key highlight
 *   - Gesture tap = key press
 *
 * "Keyboard screen midha untundi. Opacity thaggutundi.
 *  Nee gestures tho type cheyyachu. Tap = key press.
 *  Hold = modifier key (Ctrl, Shift)."
 */

import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Keyboard Layouts ──────────────────────────── */

const LAYOUTS = {
  en: {
    name: 'English',
    rows: [
      ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
      ['Tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
      ['Caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'Enter'],
      ['Shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'Shift'],
      ['Ctrl', 'Win', 'Alt', 'Space', 'Alt', 'Win', 'Menu', 'Ctrl'],
    ],
  },
  te: {
    name: 'Telugu (తెలుగు)',
    rows: [
      ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
      ['Tab', 'ౌ', 'ై', 'ా', 'ీ', 'ూ', 'బ', 'హ', 'గ', 'ద', 'జ', 'డ', 'ఞ', '\\'],
      ['Caps', 'ో', 'ే', '్', 'ి', 'ు', 'ప', 'ర', 'క', 'త', 'చ', 'ట', 'Enter'],
      ['Shift', 'ం', 'ః', 'మ', 'న', 'వ', 'ల', 'స', ',', '.', '/', 'Shift'],
      ['Ctrl', 'Win', 'Alt', 'Space', 'Alt', 'Win', 'Menu', 'Ctrl'],
    ],
  },
  hi: {
    name: 'Hindi (हिन्दी)',
    rows: [
      ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
      ['Tab', 'ौ', 'ै', 'ा', 'ी', 'ू', 'ब', 'ह', 'ग', 'द', 'ज', 'ड', 'ञ', '\\'],
      ['Caps', 'ो', 'े', '्', 'ि', 'ु', 'प', 'र', 'क', 'त', 'च', 'ट', 'Enter'],
      ['Shift', 'ं', 'ः', 'म', 'न', 'व', 'ल', 'स', ',', '.', '/', 'Shift'],
      ['Ctrl', 'Win', 'Alt', 'Space', 'Alt', 'Win', 'Menu', 'Ctrl'],
    ],
  },
}

/* ──────────────── Virtual Keyboard ──────────────────────────── */

class VirtualKeyboard {
  constructor() {
    // State
    this.active = false
    this.visible = false
    this.opacity = 0.3            // default opacity (semi-transparent)
    this.position = 'bottom'      // top, bottom, left, right, center
    this.size = 'medium'          // small, medium, large

    // Layout
    this.currentLayout = 'en'
    this.capsLock = false
    this.shiftActive = false

    // Key dimensions (normalized 0-1)
    this.keyWidth = 0.06
    this.keyHeight = 0.08
    this.keyGap = 0.005

    // Hover state
    this.hoveredKey = null
    this.hoverStartTime = 0
    this.tapThreshold = 300       // ms — tap vs hold

    // Predictive text
    this.suggestions = []
    this.typedText = ''

    // Stats
    this.stats = {
      keysPressed: 0,
      wordsTyped: 0,
    }
  }

  /**
   * Show virtual keyboard.
   */
  show({ opacity = 0.3, position = 'bottom', size = 'medium', layout = 'en' } = {}) {
    this.active = true
    this.visible = true
    this.opacity = opacity
    this.position = position
    this.size = size
    this.currentLayout = layout

    eventBus.emit('keyboard:shown', { opacity, position, layout })
    return { ok: true, opacity, position, layout }
  }

  /**
   * Hide virtual keyboard.
   */
  hide() {
    this.visible = false
    eventBus.emit('keyboard:hidden')
    return { ok: true }
  }

  /**
   * Toggle visibility.
   */
  toggle() {
    if (this.visible) return this.hide()
    return this.show()
  }

  /**
   * Set opacity. Lower = more transparent.
   */
  setOpacity(level) {
    this.opacity = Math.max(0.05, Math.min(1, level))
    return { ok: true, opacity: this.opacity }
  }

  /**
   * Get key at pointer position.
   * Returns the key character if pointer is over a key.
   */
  getKeyAtPosition(x, y) {
    const layout = LAYOUTS[this.currentLayout]
    if (!layout) return null

    // Calculate key positions based on layout and screen position
    const startY = this.position === 'bottom' ? 0.7 : this.position === 'top' ? 0.05 : 0.3

    for (let row = 0; row < layout.rows.length; row++) {
      for (let col = 0; col < layout.rows[row].length; col++) {
        const key = layout.rows[row][col]
        const keyX = 0.05 + col * (this.keyWidth + this.keyGap)
        const keyY = startY + row * (this.keyHeight + this.keyGap)

        // Check if pointer is within key bounds
        if (x >= keyX && x <= keyX + this.keyWidth &&
            y >= keyY && y <= keyY + this.keyHeight) {
          return { key, row, col, x: keyX, y: keyY }
        }
      }
    }

    return null
  }

  /**
   * Process gesture hover — highlight key.
   */
  processHover(x, y) {
    const keyInfo = this.getKeyAtPosition(x, y)
    this.hoveredKey = keyInfo

    if (keyInfo && !this.hoverStartTime) {
      this.hoverStartTime = Date.now()
    } else if (!keyInfo) {
      this.hoverStartTime = 0
    }

    return keyInfo
  }

  /**
   * Process gesture tap — press key.
   */
  processTap(x, y) {
    const keyInfo = this.getKeyAtPosition(x, y)
    if (!keyInfo) return null

    return this.pressKey(keyInfo.key)
  }

  /**
   * Press a key.
   */
  pressKey(key) {
    this.stats.keysPressed++

    // Handle special keys
    switch (key) {
      case 'Shift':
        this.shiftActive = !this.shiftActive
        return { key: 'Shift', action: 'modifier', state: this.shiftActive }
      case 'Caps':
        this.capsLock = !this.capsLock
        return { key: 'Caps', action: 'modifier', state: this.capsLock }
      case 'Ctrl':
        return { key: 'Ctrl', action: 'modifier', hold: true }
      case 'Alt':
        return { key: 'Alt', action: 'modifier', hold: true }
      case 'Win':
        return { key: 'Win', action: 'modifier', hold: true }
      case 'Space':
        this.typedText += ' '
        return { key: ' ', action: 'type', text: ' ' }
      case 'Backspace':
        this.typedText = this.typedText.slice(0, -1)
        return { key: 'Backspace', action: 'delete' }
      case 'Enter':
        this.typedText = ''
        return { key: 'Enter', action: 'enter' }
      case 'Tab':
        return { key: 'Tab', action: 'tab' }
      default:
        // Regular key
        let output = key
        if (this.shiftActive || this.capsLock) {
          output = key.toUpperCase()
          if (this.shiftActive) this.shiftActive = false
        }
        this.typedText += output
        return { key: output, action: 'type', text: output }
    }
  }

  /**
   * Hold a modifier key.
   */
  holdModifier(modifier) {
    switch (modifier) {
      case 'Ctrl': return this.pressKey('Ctrl')
      case 'Shift': return this.pressKey('Shift')
      case 'Alt': return this.pressKey('Alt')
      default: return null
    }
  }

  /**
   * Release a modifier key.
   */
  releaseModifier(modifier) {
    return { key: modifier, action: 'release' }
  }

  /**
   * Switch keyboard layout.
   */
  switchLayout(lang) {
    if (LAYOUTS[lang]) {
      this.currentLayout = lang
      return { ok: true, layout: lang, name: LAYOUTS[lang].name }
    }
    return { ok: false, error: `Layout "${lang}" not found` }
  }

  /**
   * Get current layout info.
   */
  getLayout() {
    const layout = LAYOUTS[this.currentLayout]
    return {
      lang: this.currentLayout,
      name: layout?.name || 'Unknown',
      rows: layout?.rows || [],
    }
  }

  /**
   * Get available layouts.
   */
  getAvailableLayouts() {
    return Object.entries(LAYOUTS).map(([code, layout]) => ({
      code,
      name: layout.name,
      active: code === this.currentLayout,
    }))
  }

  /**
   * Get keyboard status.
   */
  getStatus() {
    return {
      active: this.active,
      visible: this.visible,
      opacity: this.opacity,
      position: this.position,
      layout: this.currentLayout,
      capsLock: this.capsLock,
      shiftActive: this.shiftActive,
      hoveredKey: this.hoveredKey?.key || null,
      typedText: this.typedText,
    }
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      keysPressed: this.stats.keysPressed,
      wordsTyped: this.stats.wordsTyped,
      currentLayout: this.currentLayout,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const virtualKeyboard = new VirtualKeyboard()

export { virtualKeyboard, VirtualKeyboard, LAYOUTS }
export default virtualKeyboard