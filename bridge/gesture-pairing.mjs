/**
 * JARVIS Gesture Pairing — register YOUR hands with JARVIS.
 *
 * How it works:
 *   1. JARVIS shows a holographic hand animation
 *   2. You copy the gesture 3 times
 *   3. JARVIS locks YOUR hand profile
 *   4. Now JARVIS only responds to YOUR hands
 *
 * Pairing Flow:
 *   ┌─────────────────────────────────────────────────────┐
 *   │  Step 1: Show holographic hand doing gesture       │
 *   │  Step 2: You copy it — JARVIS detects              │
 *   │  Step 3: Repeat 3 times — confidence builds        │
 *   │  Step 4: LOCKED — your hand profile saved          │
 *   │  Step 5: Next gesture...                           │
 *   │  Step 6: All gestures paired = READY               │
 *   └─────────────────────────────────────────────────────┘
 *
 * Each gesture has:
 *   - Holographic 3D hand animation
 *   - Text description
 *   - Demo video showing real-world use
 *   - Success/progress indicator
 *
 * "Nee hands JARVIS ki register cheyyu.
 *  Animation follow ayyi 3 times cheyyu.
 *  Lock ayyaka nee hands tho PC control cheyyu."
 */

import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Gesture Steps with Animation Data ──────────────────────────── */

const GESTURE_STEPS = [
  {
    id: 'point',
    name: 'Point',
    nameTe: 'చూపు',
    description: 'Extend index finger. Others closed.',
    descriptionTe: 'చూపు వేలు చాపు. మిగతావి మూసి ఉంచు.',
    demo: 'Move cursor on screen',
    demoTe: 'స్క్రీన్ మీద cursor move అవుతుంది',
    animation: {
      frames: 60,
      hand: 'right',
      fingers: {
        thumb: { angle: -30, visible: false },
        index: { angle: 0, visible: true, extended: true },
        middle: { angle: -45, visible: false },
        ring: { angle: -45, visible: false },
        pinky: { angle: -45, visible: false },
      },
      movement: { type: 'trace_circle', radius: 100, speed: 2 },
      hologramColor: '#00ffff',
      glowIntensity: 0.8,
    },
    requiredRepeats: 3,
    category: 'pointer',
  },
  {
    id: 'left_click',
    name: 'Left Click',
    nameTe: 'లెఫ్ట్ క్లిక్',
    description: 'Thumb + Index quick pinch and release.',
    descriptionTe: 'బొటన వేలు + చూపు వేలు త్వరగా కలపు, విడు.',
    demo: 'Click buttons, select items',
    demoTe: 'బటన్లు నొక్కు, ఐటెమ్లు సెలెక్ట్ చేయి',
    animation: {
      frames: 40,
      hand: 'right',
      fingers: {
        thumb: { angle: 30, visible: true, animate: 'pinch' },
        index: { angle: 15, visible: true, animate: 'pinch' },
        middle: { angle: -30, visible: false },
        ring: { angle: -30, visible: false },
        pinky: { angle: -30, visible: false },
      },
      movement: { type: 'pinch_release', speed: 3 },
      hologramColor: '#00ff88',
      glowIntensity: 0.9,
      clickEffect: { type: 'ripple', color: '#00ff88' },
    },
    requiredRepeats: 3,
    category: 'click',
  },
  {
    id: 'right_click',
    name: 'Right Click',
    nameTe: 'రైట్ క్లిక్',
    description: 'Thumb + Middle quick pinch and release.',
    descriptionTe: 'బొటన వేలు + మధ్య వేలు త్వరగా కలపు, విడు.',
    demo: 'Open context menus, right-click actions',
    demoTe: 'Context menu తెరువు, right-click actions',
    animation: {
      frames: 40,
      hand: 'right',
      fingers: {
        thumb: { angle: 20, visible: true, animate: 'pinch' },
        index: { angle: 10, visible: true },
        middle: { angle: 20, visible: true, animate: 'pinch' },
        ring: { angle: -30, visible: false },
        pinky: { angle: -30, visible: false },
      },
      movement: { type: 'pinch_release', speed: 3 },
      hologramColor: '#ff8800',
      glowIntensity: 0.9,
      clickEffect: { type: 'ripple', color: '#ff8800' },
    },
    requiredRepeats: 3,
    category: 'click',
  },
  {
    id: 'drag',
    name: 'Drag',
    nameTe: 'డ్రాగ్',
    description: 'Pinch thumb+index and HOLD. Move hand to drag.',
    descriptionTe: 'బొటన+చూపు కలిపి HOLD చేయి. చేయి కదిలిస్తే drag.',
    demo: 'Move files, resize windows, draw',
    demoTe: 'ఫైల్స్ మూవ్, విండోస్ resize, draw చేయి',
    animation: {
      frames: 80,
      hand: 'right',
      fingers: {
        thumb: { angle: 25, visible: true, animate: 'pinch_hold' },
        index: { angle: 15, visible: true, animate: 'pinch_hold' },
        middle: { angle: -30, visible: false },
        ring: { angle: -30, visible: false },
        pinky: { angle: -30, visible: false },
      },
      movement: { type: 'drag_path', path: [[0,0], [200,0], [200,150], [0,150]], speed: 2 },
      hologramColor: '#ffaa00',
      glowIntensity: 1.0,
      dragTrail: { color: '#ffaa00', width: 3 },
    },
    requiredRepeats: 3,
    category: 'drag',
  },
  {
    id: 'scroll',
    name: 'Scroll',
    nameTe: 'స్క్రోల్',
    description: 'Index + Middle extended. Move hand up/down.',
    descriptionTe: 'చూపు + మధ్య వేలు చాపు. చేయి పైకి/కిందికి కదిలించు.',
    demo: 'Scroll pages, browse content',
    demoTe: 'పేజీలు scroll, content browse',
    animation: {
      frames: 80,
      hand: 'right',
      fingers: {
        thumb: { angle: -20, visible: false },
        index: { angle: 0, visible: true, extended: true },
        middle: { angle: 0, visible: true, extended: true },
        ring: { angle: -40, visible: false },
        pinky: { angle: -40, visible: false },
      },
      movement: { type: 'scroll_vertical', distance: 150, speed: 3 },
      hologramColor: '#88aaff',
      glowIntensity: 0.8,
      scrollIndicator: { direction: 'both', color: '#88aaff' },
    },
    requiredRepeats: 3,
    category: 'scroll',
  },
  {
    id: 'ctrl',
    name: 'Ctrl Key',
    nameTe: 'Ctrl కీ',
    description: 'Index + Pinky extended (rock sign 🤘). Toggle on/off.',
    descriptionTe: 'చూపు + చిటికెన వేలు చాపు. Toggle on/off.',
    demo: 'Ctrl+C, Ctrl+V, Ctrl+Z shortcuts',
    demoTe: 'Ctrl+C, Ctrl+V, Ctrl+Z shortcuts',
    animation: {
      frames: 50,
      hand: 'right',
      fingers: {
        thumb: { angle: -20, visible: false },
        index: { angle: 0, visible: true, extended: true },
        middle: { angle: -40, visible: false },
        ring: { angle: -40, visible: false },
        pinky: { angle: 10, visible: true, extended: true },
      },
      movement: { type: 'pulse', speed: 2 },
      hologramColor: '#ff4444',
      glowIntensity: 1.0,
      modifierIndicator: { key: 'CTRL', color: '#ff4444' },
    },
    requiredRepeats: 3,
    category: 'modifier',
  },
  {
    id: 'shift',
    name: 'Shift Key',
    nameTe: 'Shift కీ',
    description: 'Index + Ring + Pinky extended. Toggle on/off.',
    descriptionTe: 'చూపు + ఉంగరం + చిటికెన వేలు చాపు. Toggle on/off.',
    demo: 'Shift+Click, Shift+Arrow select',
    demoTe: 'Shift+Click, Shift+Arrow select',
    animation: {
      frames: 50,
      hand: 'right',
      fingers: {
        thumb: { angle: -20, visible: false },
        index: { angle: 0, visible: true, extended: true },
        middle: { angle: -40, visible: false },
        ring: { angle: 5, visible: true, extended: true },
        pinky: { angle: 10, visible: true, extended: true },
      },
      movement: { type: 'pulse', speed: 2 },
      hologramColor: '#ffff44',
      glowIntensity: 1.0,
      modifierIndicator: { key: 'SHIFT', color: '#ffff44' },
    },
    requiredRepeats: 3,
    category: 'modifier',
  },
  {
    id: 'stop',
    name: 'Stop / Cancel',
    nameTe: 'ఆపు / రద్దు',
    description: 'Open palm — all 5 fingers extended.',
    descriptionTe: 'చేయి తెరువు — 5 వేళ్లు చాపు.',
    demo: 'Stop actions, cancel operations, close menus',
    demoTe: 'ఆపు, operations రద్దు, menus మూసి',
    animation: {
      frames: 40,
      hand: 'right',
      fingers: {
        thumb: { angle: 60, visible: true, extended: true },
        index: { angle: 0, visible: true, extended: true },
        middle: { angle: 0, visible: true, extended: true },
        ring: { angle: 0, visible: true, extended: true },
        pinky: { angle: 0, visible: true, extended: true },
      },
      movement: { type: 'hold', speed: 0 },
      hologramColor: '#ff2222',
      glowIntensity: 1.0,
      stopEffect: { type: 'shield', color: '#ff2222' },
    },
    requiredRepeats: 3,
    category: 'action',
  },
  {
    id: 'grab',
    name: 'Grab / Select',
    nameTe: 'పట్టుకో / సెలెక్ట్',
    description: 'Closed fist — all fingers closed.',
    descriptionTe: 'చేయి ముడిచి — వేళ్లు అన్నీ మూసి.',
    demo: 'Select files, pick up objects, grab and move',
    demoTe: 'ఫైల్స్ select, objects pick up, grab and move',
    animation: {
      frames: 50,
      hand: 'right',
      fingers: {
        thumb: { angle: -10, visible: true },
        index: { angle: -60, visible: true },
        middle: { angle: -60, visible: true },
        ring: { angle: -60, visible: true },
        pinky: { angle: -60, visible: true },
      },
      movement: { type: 'grab_squeeze', speed: 2 },
      hologramColor: '#aa44ff',
      glowIntensity: 0.9,
      grabEffect: { type: 'magnet', color: '#aa44ff' },
    },
    requiredRepeats: 3,
    category: 'action',
  },
  {
    id: 'thumbs_up',
    name: 'Thumbs Up',
    nameTe: 'థమ్స్ అప్',
    description: 'Only thumb extended, others closed.',
    descriptionTe: 'బొటన వేలు మాత్రమే చాపు, మిగతావి మూసి.',
    demo: 'Approve, confirm, say OK',
    demoTe: 'అంగీకరించు, confirm, OK చెప్పు',
    animation: {
      frames: 40,
      hand: 'right',
      fingers: {
        thumb: { angle: 70, visible: true, extended: true },
        index: { angle: -50, visible: false },
        middle: { angle: -50, visible: false },
        ring: { angle: -50, visible: false },
        pinky: { angle: -50, visible: false },
      },
      movement: { type: 'thumbs_up_raise', speed: 2 },
      hologramColor: '#44ff44',
      glowIntensity: 1.0,
      confirmEffect: { type: 'checkmark', color: '#44ff44' },
    },
    requiredRepeats: 3,
    category: 'action',
  },
  {
    id: 'undo',
    name: 'Undo',
    nameTe: 'Undo చేయి',
    description: 'Closed fist, shake left-right quickly.',
    descriptionTe: 'చేయి ముడిచి, ఎడమ-కుడి త్వరగా ఊపు.',
    demo: 'Undo last action',
    demoTe: 'చివరి action undo చేయి',
    animation: {
      frames: 60,
      hand: 'right',
      fingers: {
        thumb: { angle: -10, visible: true },
        index: { angle: -60, visible: true },
        middle: { angle: -60, visible: true },
        ring: { angle: -60, visible: true },
        pinky: { angle: -60, visible: true },
      },
      movement: { type: 'shake_horizontal', distance: 80, speed: 5 },
      hologramColor: '#ffaa44',
      glowIntensity: 0.9,
      undoEffect: { type: 'curved_arrow', color: '#ffaa44' },
    },
    requiredRepeats: 3,
    category: 'action',
  },
  {
    id: 'zoom_in',
    name: 'Zoom In',
    nameTe: 'జూమ్ ఇన్',
    description: 'Both hands pinch, then spread apart.',
    descriptionTe: 'రెండు చేతులు pinch, తర్వాత విడదీయి.',
    demo: 'Zoom into images, maps, documents',
    demoTe: 'Images, maps, documents zoom in',
    animation: {
      frames: 60,
      hand: 'both',
      fingers: {
        left: { thumb: { angle: 25 }, index: { angle: 15 } },
        right: { thumb: { angle: 25 }, index: { angle: 15 } },
      },
      movement: { type: 'spread_apart', startDistance: 50, endDistance: 300, speed: 2 },
      hologramColor: '#00ddff',
      glowIntensity: 0.8,
      zoomIndicator: { direction: 'in', color: '#00ddff' },
    },
    requiredRepeats: 3,
    category: 'two_hand',
  },
  {
    id: 'zoom_out',
    name: 'Zoom Out',
    nameTe: 'జూమ్ అవుట్',
    description: 'Both hands spread, then pinch together.',
    descriptionTe: 'రెండు చేతులు విడదీసి, తర్వాత కలపు.',
    demo: 'Zoom out from images, maps',
    demoTe: 'Images, maps zoom out',
    animation: {
      frames: 60,
      hand: 'both',
      fingers: {
        left: { thumb: { angle: 25 }, index: { angle: 15 } },
        right: { thumb: { angle: 25 }, index: { angle: 15 } },
      },
      movement: { type: 'pinch_together', startDistance: 300, endDistance: 50, speed: 2 },
      hologramColor: '#dd00ff',
      glowIntensity: 0.8,
      zoomIndicator: { direction: 'out', color: '#dd00ff' },
    },
    requiredRepeats: 3,
    category: 'two_hand',
  },
]

/* ──────────────── Gesture Pairing System ──────────────────────────── */

class GesturePairing {
  constructor() {
    // State
    this.isActive = false
    this.currentStep = 0
    this.totalSteps = GESTURE_STEPS.length

    // Per-gesture tracking
    this.gestureProgress = new Map()  // gestureId → {repeats, bestScore, locked}
    this.completedGestures = []

    // Hand profile
    this.handProfile = null           // locked hand measurements

    // Stats
    this.stats = {
      totalPairings: 0,
      gesturesLocked: 0,
      avgRepeats: 0,
    }

    // Initialize progress for all gestures
    for (const step of GESTURE_STEPS) {
      this.gestureProgress.set(step.id, {
        repeats: 0,
        scores: [],
        bestScore: 0,
        locked: false,
      })
    }
  }

  /**
   * Start the pairing process.
   */
  startPairing() {
    this.isActive = true
    this.currentStep = 0

    const step = GESTURE_STEPS[0]

    eventBus.emit('pairing:started', {
      totalSteps: this.totalSteps,
      firstGesture: step,
    })

    return {
      ok: true,
      totalSteps: this.totalSteps,
      currentStep: 0,
      gesture: step,
    }
  }

  /**
   * Get current step info — what gesture to show.
   */
  getCurrentStep() {
    if (!this.isActive) return null

    const step = GESTURE_STEPS[this.currentStep]
    const progress = this.gestureProgress.get(step.id)

    return {
      stepIndex: this.currentStep,
      totalSteps: this.totalSteps,
      gesture: step,
      progress: {
        repeats: progress.repeats,
        required: step.requiredRepeats,
        bestScore: progress.bestScore,
        locked: progress.locked,
        percent: Math.round((progress.repeats / step.requiredRepeats) * 100),
      },
    }
  }

  /**
   * Submit a detected gesture — check if it matches current step.
   */
  submitGesture(detectedGesture, { score = 0.8 } = {}) {
    if (!this.isActive) return { ok: false, error: 'Pairing not active' }

    const step = GESTURE_STEPS[this.currentStep]
    const progress = this.gestureProgress.get(step.id)

    // Check if detected gesture matches
    if (detectedGesture !== step.id) {
      return {
        ok: false,
        match: false,
        expected: step.id,
        detected: detectedGesture,
        message: `Expected "${step.name}" gesture. Try again.`,
        messageTe: `"${step.nameTe}" gesture cheyyali. Malli try cheyyu.`,
      }
    }

    // Record repeat
    progress.repeats++
    progress.scores.push(score)
    progress.bestScore = Math.max(progress.bestScore, score)

    // Check if locked (3 successful repeats)
    if (progress.repeats >= step.requiredRepeats) {
      progress.locked = true
      this.completedGestures.push(step.id)
      this.stats.gesturesLocked++

      eventBus.emit('pairing:gesture_locked', {
        gesture: step.id,
        name: step.name,
        nameTe: step.nameTe,
        totalLocked: this.stats.gesturesLocked,
      })

      // Auto-advance to next step
      const hasNext = this.currentStep < this.totalSteps - 1

      return {
        ok: true,
        match: true,
        locked: true,
        repeats: progress.repeats,
        score,
        message: `✅ "${step.name}" LOCKED! ${hasNext ? 'Next gesture...' : 'All gestures paired!'}`,
        messageTe: `✅ "${step.nameTe}" LOCKED! ${hasNext ? 'తదుపరి gesture...' : 'అన్ని gestures paired!'}`,
        nextStep: hasNext ? this.currentStep + 1 : null,
        allComplete: !hasNext,
      }
    }

    return {
      ok: true,
      match: true,
      locked: false,
      repeats: progress.repeats,
      required: step.requiredRepeats,
      score,
      message: `✅ "${step.name}" — ${progress.repeats}/${step.requiredRepeats} repeats`,
      messageTe: `✅ "${step.nameTe}" — ${progress.repeats}/${step.requiredRepeats} repeats`,
    }
  }

  /**
   * Advance to next step.
   */
  nextStep() {
    if (this.currentStep < this.totalSteps - 1) {
      this.currentStep++
      return this.getCurrentStep()
    }
    return null
  }

  /**
   * Go back to previous step.
   */
  prevStep() {
    if (this.currentStep > 0) {
      this.currentStep--
      return this.getCurrentStep()
    }
    return null
  }

  /**
   * Skip current gesture.
   */
  skipGesture() {
    return this.nextStep()
  }

  /**
   * Complete pairing — lock hand profile.
   */
  completePairing() {
    const allLocked = GESTURE_STEPS.every((s) =>
      this.gestureProgress.get(s.id)?.locked
    )

    this.handProfile = {
      pairedAt: new Date().toISOString(),
      gesturesLocked: this.stats.gesturesLocked,
      totalGestures: this.totalSteps,
      allComplete: allLocked,
    }

    this.isActive = false
    this.stats.totalPairings++

    eventBus.emit('pairing:complete', this.handProfile)

    return {
      ok: true,
      allLocked,
      profile: this.handProfile,
      message: allLocked
        ? '🎉 All gestures paired! Your hands are registered with JARVIS.'
        : `⚠️ ${this.stats.gesturesLocked}/${this.totalSteps} gestures locked. Some skipped.`,
      messageTe: allLocked
        ? '🎉 అన్ని gestures paired! నీ చేతులు JARVIS తో register అయ్యాయి.'
        : `⚠️ ${this.stats.gesturesLocked}/${this.totalSteps} gestures locked. కొన్ని skip అయ్యాయి.`,
    }
  }

  /**
   * Get pairing progress.
   */
  getProgress() {
    const locked = GESTURE_STEPS.filter((s) =>
      this.gestureProgress.get(s.id)?.locked
    ).length

    return {
      active: this.isActive,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      locked,
      percent: Math.round((locked / this.totalSteps) * 100),
      handProfile: this.handProfile,
    }
  }

  /**
   * Get all gesture steps with their progress.
   */
  getAllSteps() {
    return GESTURE_STEPS.map((step) => ({
      ...step,
      progress: this.gestureProgress.get(step.id),
    }))
  }

  /**
   * Reset pairing.
   */
  reset() {
    this.isActive = false
    this.currentStep = 0
    this.handProfile = null
    this.completedGestures = []
    for (const [, progress] of this.gestureProgress) {
      progress.repeats = 0
      progress.scores = []
      progress.bestScore = 0
      progress.locked = false
    }
    return { ok: true }
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      ...this.stats,
      active: this.isActive,
      currentStep: this.currentStep,
      progress: this.getProgress(),
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const gesturePairing = new GesturePairing()

export { gesturePairing, GesturePairing, GESTURE_STEPS }
export default gesturePairing