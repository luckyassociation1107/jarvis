/**
 * JARVIS Gesture Engine — REALISTIC hand gestures with your 2 hands.
 *
 * Only gestures that are NATURAL and EASY with human hands.
 * No L-shapes, no circles, no snap symbols, no 3-hand gestures.
 * Just real, intuitive hand movements.
 *
 * ═══════════════════════════════════════════════════════════
 *  ONE HAND GESTURES (Primary hand):
 * ═══════════════════════════════════════════════════════════
 *
 *  POINTER:    Index finger extended, others closed
 *              → Mouse pointer moves with finger
 *
 *  LEFT CLICK: Quick pinch (thumb + index touch then release)
 *              → Left mouse click
 *
 *  RIGHT CLICK: Quick pinch (thumb + middle touch then release)
 *               → Right mouse click
 *
 *  DOUBLE CLICK: Two quick pinches in a row
 *                → Double click
 *
 *  DRAG:       Pinch and HOLD (thumb + index locked)
 *              then move hand = drag
 *              Release pinch = drop
 *
 *  SCROLL:     Index + Middle extended, move up/down
 *              → Scroll wheel up/down
 *
 *  CTRL:       Index + Pinky extended (others closed)
 *              → Ctrl key held
 *
 *  SHIFT:      Index + Ring + Pinky extended (others closed)
 *              → Shift key held
 *
 *  STOP:       Open palm (all fingers extended)
 *              → Cancel / Stop / Close
 *
 *  FIST:       Closed fist (all fingers closed)
 *              → Grab / Select / Pick up
 *
 *  THUMBS UP:  Thumb extended, others closed
 *              → Approve / Like / OK
 *
 *  UNDO:       Closed fist, shake left-right
 *              → Undo last action
 *
 * ═══════════════════════════════════════════════════════════
 *  TWO HAND GESTURES:
 * ═══════════════════════════════════════════════════════════
 *
 *  ZOOM IN:    Both hands, pinch → spread apart
 *              → Zoom in
 *
 *  ZOOM OUT:   Both hands, spread → pinch together
 *              → Zoom out
 *
 *  SELECT:     Both index fingers = start/end of selection
 *              → Select text/area between two points
 *
 * ═══════════════════════════════════════════════════════════
 *
 * "2 hands. 10 fingers. Full PC control.
 *  Natural gestures. No weird shapes.
 *  Point = mouse. Pinch = click. Grab = drag."
 */

import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Hand Landmarks (MediaPipe) ──────────────────────────── */

const HAND = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
}

/* ──────────────── Gesture Definitions (REALISTIC ONLY) ──────────────────────────── */

const GESTURES = {
  // ── POINTER ──
  POINT: {
    name: 'Point',
    description: 'Index finger extended = mouse pointer',
    fingers: { thumb: false, index: true, middle: false, ring: false, pinky: false },
    action: 'pointer_move',
  },

  // ── CLICKS ──
  LEFT_CLICK: {
    name: 'Left Click',
    description: 'Thumb + Index quick pinch',
    fingers: { thumb: true, index: true, middle: false, ring: false, pinky: false },
    pinch: 'thumb_index',
    action: 'left_click',
  },
  RIGHT_CLICK: {
    name: 'Right Click',
    description: 'Thumb + Middle quick pinch',
    fingers: { thumb: true, index: false, middle: true, ring: false, pinky: false },
    pinch: 'thumb_middle',
    action: 'right_click',
  },
  DOUBLE_CLICK: {
    name: 'Double Click',
    description: 'Two quick thumb+index pinches',
    fingers: { thumb: true, index: true, middle: false, ring: false, pinky: false },
    pinch: 'thumb_index',
    doubleTap: true,
    action: 'double_click',
  },

  // ── DRAG ──
  DRAG: {
    name: 'Drag',
    description: 'Thumb + Index pinch HOLD then move',
    fingers: { thumb: true, index: true, middle: false, ring: false, pinky: false },
    pinch: 'thumb_index',
    hold: true,
    action: 'drag',
  },

  // ── SCROLL ──
  SCROLL_UP: {
    name: 'Scroll Up',
    description: 'Index + Middle extended, hand moves up',
    fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
    direction: 'up',
    action: 'scroll_up',
  },
  SCROLL_DOWN: {
    name: 'Scroll Down',
    description: 'Index + Middle extended, hand moves down',
    fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
    direction: 'down',
    action: 'scroll_down',
  },

  // ── KEYBOARD MODIFIERS ──
  CTRL: {
    name: 'Ctrl',
    description: 'Index + Pinky extended (rock sign)',
    fingers: { thumb: false, index: true, middle: false, ring: false, pinky: true },
    action: 'ctrl_hold',
  },
  SHIFT: {
    name: 'Shift',
    description: 'Index + Ring + Pinky extended',
    fingers: { thumb: false, index: true, middle: false, ring: true, pinky: true },
    action: 'shift_hold',
  },

  // ── ACTION GESTURES ──
  OPEN_PALM: {
    name: 'Open Palm',
    description: 'All fingers open = Stop/Cancel',
    fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
    action: 'stop',
  },
  CLOSED_FIST: {
    name: 'Closed Fist',
    description: 'All fingers closed = Grab/Select',
    fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
    action: 'grab',
  },
  THUMBS_UP: {
    name: 'Thumbs Up',
    description: 'Only thumb up = Approve/OK',
    fingers: { thumb: true, index: false, middle: false, ring: false, pinky: false },
    action: 'approve',
  },
  UNDO: {
    name: 'Undo',
    description: 'Fist + shake left-right',
    fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
    shake: true,
    action: 'undo',
  },

  // ── TWO-HAND GESTURES ──
  ZOOM_IN: {
    name: 'Zoom In',
    description: 'Both hands pinch then spread apart',
    hands: 2,
    action: 'zoom_in',
  },
  ZOOM_OUT: {
    name: 'Zoom Out',
    description: 'Both hands spread then pinch together',
    hands: 2,
    action: 'zoom_out',
  },
  TWO_POINT_SELECT: {
    name: 'Select Area',
    description: 'Both index fingers = select range between them',
    hands: 2,
    action: 'select_area',
  },
}

/* ──────────────── Gesture Engine ──────────────────────────── */

class GestureEngine {
  constructor() {
    // State
    this.active = false
    this.cameraAvailable = false
    this.handDetected = false
    this.handsCount = 0           // 0, 1, or 2

    // Hand tracking
    this.leftHand = null          // landmarks for left hand
    this.rightHand = null         // landmarks for right hand
    this.previousLeft = null
    this.previousRight = null

    // Pointer — index finger tip of right hand
    this.pointer = { x: 0, y: 0, visible: false }
    this.pointerSmoothing = 5
    this.pointerHistory = []

    // Gesture state
    this.currentGesture = null
    this.previousGesture = null
    this.gestureStartTime = 0
    this.lastClickTime = 0        // for double-click detection
    this.doubleClickThreshold = 300  // ms

    // Pinch state
    this.isPinching = false
    this.pinchStartTime = 0
    this.pinchHoldThreshold = 400  // ms — hold vs tap

    // Keyboard modifier state
    this.modifiers = { ctrl: false, shift: false, alt: false }

    // Drag state
    this.isDragging = false
    this.dragStart = null

    // Scroll state
    this.scrollCooldown = 0

    // Shake detection (for undo)
    this.shakeHistory = []
    this.shakeThreshold = 3       // shakes needed for undo

    // Stats
    this.stats = {
      framesProcessed: 0,
      gesturesRecognized: 0,
      clicks: 0,
      drags: 0,
      scrolls: 0,
      avgLatencyMs: 0,
    }
  }

  /**
   * Initialize gesture engine.
   */
  async init({ cameraIndex = 0 } = {}) {
    this.cameraAvailable = await this._checkCamera()

    if (this.cameraAvailable) {
      this.active = true
      eventBus.emit('gesture:ready', { camera: true })
      return { ok: true, camera: true, message: 'Gesture control active. Show your hand.' }
    }

    return { ok: false, camera: false, message: 'Camera not found.' }
  }

  async _checkCamera() {
    return true // In production: check for camera device
  }

  /**
   * Process a video frame — detect hands and recognize gestures.
   */
  async processFrame(frameData) {
    if (!this.active) return null

    const startTime = Date.now()
    this.stats.framesProcessed++

    // Step 1: Detect hands
    const hands = await this._detectHands(frameData)
    if (!hands || hands.length === 0) {
      this.handDetected = false
      this.pointer.visible = false
      this._resetPinch()
      return null
    }

    this.handDetected = true
    this.handsCount = hands.length

    // Assign hands (left/right based on x position)
    if (hands.length === 1) {
      this.rightHand = hands[0]
      this.leftHand = null
    } else {
      // Sort by x position — left hand has lower x
      const sorted = hands.sort((a, b) => a[WRIST].x - b[WRIST].x)
      this.leftHand = sorted[0]
      this.rightHand = sorted[1]
    }

    // Step 2: Update pointer (right hand index finger)
    this._updatePointer(this.rightHand)

    // Step 3: Recognize gesture
    let gesture = null
    if (this.handsCount === 1) {
      gesture = this._recognizeOneHand(this.rightHand)
    } else if (this.handsCount === 2) {
      gesture = this._recognizeTwoHands(this.leftHand, this.rightHand)
    }

    // Step 4: Execute action
    if (gesture) {
      this.previousGesture = this.currentGesture
      this.currentGesture = gesture
      this._executeGesture(gesture)
      this.stats.gesturesRecognized++
    }

    // Store for next frame
    this.previousRight = this.rightHand
    this.previousLeft = this.leftHand

    const latencyMs = Date.now() - startTime
    this.stats.avgLatencyMs = (this.stats.avgLatencyMs + latencyMs) / 2

    return {
      gesture: gesture?.name || null,
      action: gesture?.action || null,
      pointer: { ...this.pointer },
      modifiers: { ...this.modifiers },
      isDragging: this.isDragging,
      hands: this.handsCount,
      latencyMs,
    }
  }

  /**
   * Detect hands using MediaPipe.
   */
  async _detectHands(frameData) {
    // In production: MediaPipe Hands detection
    return frameData?.hands || null
  }

  /**
   * Update pointer position from right hand index finger.
   */
  _updatePointer(hand) {
    if (!hand) return

    const indexTip = hand[HAND.INDEX_TIP]
    if (!indexTip) return

    // Convert normalized (0-1) to screen coordinates
    const screenX = Math.round(indexTip.x * 1920)
    const screenY = Math.round(indexTip.y * 1080)

    // Smooth with moving average
    this.pointerHistory.push({ x: screenX, y: screenY })
    if (this.pointerHistory.length > this.pointerSmoothing) {
      this.pointerHistory.shift()
    }

    const avgX = this.pointerHistory.reduce((s, p) => s + p.x, 0) / this.pointerHistory.length
    const avgY = this.pointerHistory.reduce((s, p) => s + p.y, 0) / this.pointerHistory.length

    this.pointer.x = Math.round(avgX)
    this.pointer.y = Math.round(avgY)
    this.pointer.visible = true
  }

  /**
   * Recognize one-hand gesture.
   */
  _recognizeOneHand(hand) {
    if (!hand) return null

    const fingers = this._getFingerStates(hand)
    const thumbTip = hand[HAND.THUMB_TIP]
    const indexTip = hand[HAND.INDEX_TIP]
    const middleTip = hand[HAND.MIDDLE_TIP]

    if (!thumbTip || !indexTip) return null

    // Distances
    const thumbIndexDist = this._dist(thumbTip, indexTip)
    const thumbMiddleDist = this._dist(thumbTip, middleTip)
    const indexMiddleDist = this._dist(indexTip, middleTip)

    const thumbIndexPinch = thumbIndexDist < 0.06
    const thumbMiddlePinch = thumbMiddleDist < 0.06

    // ── LEFT CLICK: thumb + index pinch ──
    if (thumbIndexPinch && !fingers.middle && !fingers.ring && !fingers.pinky) {
      if (!this.isPinching) {
        this.isPinching = true
        this.pinchStartTime = Date.now()
        return null // Wait to see if it's a tap or hold
      }

      const holdDuration = Date.now() - this.pinchStartTime

      // Hold = drag
      if (holdDuration > this.pinchHoldThreshold) {
        if (!this.isDragging) {
          this.isDragging = true
          this.dragStart = { ...this.pointer }
          this.stats.drags++
          return GESTURES.DRAG
        }
        return null // Continue dragging
      }

      return null // Still waiting
    }

    // ── PINCH RELEASE ──
    if (this.isPinching && !thumbIndexPinch) {
      this.isPinching = false
      const holdDuration = Date.now() - this.pinchStartTime

      if (this.isDragging) {
        // End drag
        this.isDragging = false
        this.dragStart = null
        return { ...GESTURES.DRAG, action: 'drag_end' }
      }

      if (holdDuration < this.pinchHoldThreshold) {
        // Quick pinch = click
        const now = Date.now()
        const timeSinceLastClick = now - this.lastClickTime

        if (timeSinceLastClick < this.doubleClickThreshold) {
          this.lastClickTime = 0
          return GESTURES.DOUBLE_CLICK
        }

        this.lastClickTime = now
        this.stats.clicks++
        return GESTURES.LEFT_CLICK
      }
    }

    // ── RIGHT CLICK: thumb + middle pinch ──
    if (thumbMiddlePinch && !fingers.index && !fingers.ring && !fingers.pinky) {
      return GESTURES.RIGHT_CLICK
    }

    // ── POINT: only index extended ──
    if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
      return GESTURES.POINT
    }

    // ── SCROLL: index + middle extended ──
    if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) {
      if (this.previousRight && Date.now() > this.scrollCooldown) {
        const prevIndex = this.previousRight[HAND.INDEX_TIP]
        const currIndex = hand[HAND.INDEX_TIP]
        const deltaY = currIndex.y - prevIndex.y

        if (Math.abs(deltaY) > 0.015) {
          this.scrollCooldown = Date.now() + 100 // 100ms cooldown
          this.stats.scrolls++
          return deltaY < 0 ? GESTURES.SCROLL_UP : GESTURES.SCROLL_DOWN
        }
      }
      return null
    }

    // ── CTRL: index + pinky (rock sign) ──
    if (fingers.index && !fingers.middle && !fingers.ring && fingers.pinky) {
      return GESTURES.CTRL
    }

    // ── SHIFT: index + ring + pinky ──
    if (fingers.index && !fingers.middle && fingers.ring && fingers.pinky) {
      return GESTURES.SHIFT
    }

    // ── OPEN PALM: all fingers open ──
    if (fingers.thumb && fingers.index && fingers.middle && fingers.ring && fingers.pinky) {
      return GESTURES.OPEN_PALM
    }

    // ── CLOSED FIST: all fingers closed ──
    if (!fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
      // Check for shake (undo)
      if (this._detectShake(hand)) {
        return GESTURES.UNDO
      }
      return GESTURES.CLOSED_FIST
    }

    // ── THUMBS UP: only thumb ──
    if (fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
      return GESTURES.THUMBS_UP
    }

    return null
  }

  /**
   * Recognize two-hand gestures.
   */
  _recognizeTwoHands(leftHand, rightHand) {
    const leftIndex = leftHand[HAND.INDEX_TIP]
    const rightIndex = rightHand[HAND.INDEX_TIP]

    if (!leftIndex || !rightIndex) return null

    const leftFingers = this._getFingerStates(leftHand)
    const rightFingers = this._getFingerStates(rightHand)

    const leftPinch = this._dist(leftHand[HAND.THUMB_TIP], leftIndex) < 0.06
    const rightPinch = this._dist(rightHand[HAND.THUMB_TIP], rightIndex) < 0.06

    // ── ZOOM: both hands pinch, then spread apart ──
    if (leftPinch && rightPinch) {
      const currentDist = this._dist(leftIndex, rightIndex)
      if (this.previousLeft && this.previousRight) {
        const prevDist = this._dist(
          this.previousLeft[HAND.INDEX_TIP],
          this.previousRight[HAND.INDEX_TIP]
        )
        const delta = currentDist - prevDist

        if (Math.abs(delta) > 0.02) {
          return delta > 0 ? GESTURES.ZOOM_IN : GESTURES.ZOOM_OUT
        }
      }
    }

    // ── SELECT: both index fingers pointing ──
    if (leftFingers.index && !leftFingers.middle &&
        rightFingers.index && !rightFingers.middle) {
      return GESTURES.TWO_POINT_SELECT
    }

    return null
  }

  /**
   * Get finger states (extended or not).
   */
  _getFingerStates(hand) {
    return {
      thumb: hand[HAND.THUMB_TIP]?.x < hand[HAND.THUMB_IP]?.x, // thumb is special
      index: hand[HAND.INDEX_TIP]?.y < hand[HAND.INDEX_PIP]?.y,
      middle: hand[HAND.MIDDLE_TIP]?.y < hand[HAND.MIDDLE_PIP]?.y,
      ring: hand[HAND.RING_TIP]?.y < hand[HAND.RING_PIP]?.y,
      pinky: hand[HAND.PINKY_TIP]?.y < hand[HAND.PINKY_PIP]?.y,
    }
  }

  /**
   * Detect shake motion (for undo gesture).
   */
  _detectShake(hand) {
    const wrist = hand[HAND.WRIST]
    if (!wrist) return false

    this.shakeHistory.push({ x: wrist.x, time: Date.now() })
    if (this.shakeHistory.length > 10) this.shakeHistory.shift()

    // Check for rapid left-right movement
    let directionChanges = 0
    for (let i = 2; i < this.shakeHistory.length; i++) {
      const prev = this.shakeHistory[i - 1].x - this.shakeHistory[i - 2].x
      const curr = this.shakeHistory[i].x - this.shakeHistory[i - 1].x
      if (prev * curr < 0 && Math.abs(curr) > 0.01) directionChanges++
    }

    if (directionChanges >= this.shakeThreshold) {
      this.shakeHistory = []
      return true
    }
    return false
  }

  /**
   * Calculate distance between two landmarks.
   */
  _dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + ((a.z || 0) - (b.z || 0)) ** 2)
  }

  /**
   * Execute gesture action — emit event.
   */
  _executeGesture(gesture) {
    // Handle modifier toggles
    if (gesture.action === 'ctrl_hold') {
      this.modifiers.ctrl = !this.modifiers.ctrl
    } else if (gesture.action === 'shift_hold') {
      this.modifiers.shift = !this.modifiers.shift
    }

    eventBus.emit('gesture:action', {
      gesture: gesture.name,
      action: gesture.action,
      pointer: { ...this.pointer },
      modifiers: { ...this.modifiers },
      isDragging: this.isDragging,
      hands: this.handsCount,
    })
  }

  _resetPinch() {
    if (this.isPinching) {
      this.isPinching = false
      if (this.isDragging) {
        this.isDragging = false
        this.dragStart = null
      }
    }
  }

  /**
   * Get pointer position.
   */
  getPointer() { return { ...this.pointer } }

  /**
   * Get modifier state.
   */
  getModifiers() { return { ...this.modifiers } }

  /**
   * Get all available gestures.
   */
  getGestures() {
    return Object.values(GESTURES).map((g) => ({
      name: g.name,
      description: g.description,
      action: g.action,
      hands: g.hands || 1,
    }))
  }

  /**
   * Stop gesture engine.
   */
  stop() {
    this.active = false
    this.pointer.visible = false
    this.modifiers = { ctrl: false, shift: false, alt: false }
    this.isDragging = false
    this.isPinching = false
    return { ok: true }
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      active: this.active,
      cameraAvailable: this.cameraAvailable,
      handDetected: this.handDetected,
      handsCount: this.handsCount,
      pointer: { ...this.pointer },
      isDragging: this.isDragging,
      modifiers: { ...this.modifiers },
      ...this.stats,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const gestureEngine = new GestureEngine()

export { gestureEngine, GestureEngine, GESTURES, HAND }
export default gestureEngine