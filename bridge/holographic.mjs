/**
 * JARVIS Holographic Interface — not a screen. A SPATIAL EXPERIENCE.
 *
 * The future isn't flat screens. It's information in SPACE:
 *   - 3D data visualization
 *   - Spatial UI layout
 *   - Gesture-aware interactions
 *   - Contextual information floating in space
 *   - AR overlay generation
 *   - Spatial audio positioning
 *   - Holographic memory visualization
 *
 * "Your data doesn't live in windows. It lives in the air around you."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Spatial layout engine ──────────────────────────── */

/**
 * Design a spatial UI layout for data.
 */
export async function designSpatialLayout(data, { 
  environment = 'desktop',  // desktop, ar, vr, car
  interactionMode = 'mouse', // mouse, gesture, voice, eye_tracking
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Design a spatial UI layout. Think in 3D.

Environment: ${environment}
Interaction: ${interactionMode}

Design principles:
- Most important info at eye level (center)
- Supporting info in peripheral vision
- Actions within arm's reach
- Contextual info appears on demand
- Depth used for hierarchy (closer = more important)
- Negative space is as important as content

Respond in JSON:
{
  "layout": {
    "center": { "content": "...", "size": "large", "depth": 0 },
    "left": { "content": "...", "size": "medium", "depth": 0.2 },
    "right": { "content": "...", "size": "medium", "depth": 0.2 },
    "above": { "content": "...", "size": "small", "depth": 0.5 },
    "below": { "content": "...", "size": "small", "depth": 0.3 }
  },
  "interactions": [
    { "gesture": "point", "action": "select" },
    { "gesture": "swipe", "action": "dismiss" }
  ],
  "transitions": ["how elements animate in/out"]
}` },
    { role: 'user', content: `Data to visualize:\n${JSON.stringify(data).slice(0, 1000)}\n\nSpatial layout:` },
  ], { maxTokens: 800 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, layout: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── AR overlay generator ──────────────────────────── */

/**
 * Generate AR overlay instructions for real-world objects.
 */
export async function generateAROverlay(scene, { 
  purpose = 'information',
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Generate AR overlay specifications for a real-world scene.

Purpose: ${purpose}

For each object in the scene:
1. What information to overlay
2. Where to position it (relative to object)
3. What style (minimal, detailed, gamified)
4. When to show/hide (always, on gaze, on gesture)
5. Interaction possibilities

Respond in JSON:
{
  "overlays": [
    {
      "target": "object name",
      "position": "above|below|beside|on_top",
      "content": "what to show",
      "style": "minimal|detailed|hud",
      "visibility": "always|on_gaze|on_gesture",
      "interactions": ["tap to expand", "swipe to dismiss"],
      "color": "suggested color",
      "opacity": 0.8
    }
  ],
  "global_hud": "top-level information always visible",
  "gestures": { "point": "select", "pinch": "zoom", "swipe": "navigate" }
}` },
    { role: 'user', content: `Scene: ${scene}\nPurpose: ${purpose}\n\nAR overlay design:` },
  ], { maxTokens: 800 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, overlay: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── 3D data visualization ──────────────────────────── */

/**
 * Create a 3D visualization specification for data.
 */
export async function visualize3D(data, { 
  chartType = 'auto',
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Design a 3D data visualization. Choose the best chart type.

Chart types:
- 3D scatter: relationships between 3 variables
- 3D surface: continuous data over 2 dimensions
- 3D bar: categorical comparisons with depth
- Network graph: connections and relationships
- Tree map: hierarchical data
- Timeline spiral: temporal data in 3D
- Force-directed: dynamic relationships
- Geographic 3D: spatial data with elevation

Choose based on the data characteristics.
Specify colors, sizes, labels, interactions.` },
    { role: 'user', content: `Data:\n${JSON.stringify(data).slice(0, 800)}\nPreferred chart: ${chartType}\n\n3D visualization spec:` },
  ], { maxTokens: 600 })

  return { data, visualization: response }
}

/* ──────────────── Spatial audio ──────────────────────────── */

/**
 * Design spatial audio positioning for notifications and feedback.
 */
export async function designSpatialAudio(events, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Design spatial audio for events. Position sounds in 3D space.

Consider:
- Direction: where the sound comes from (left, right, above, behind)
- Distance: how close/far (intimate, personal, room, distant)
- Movement: static, approaching, passing, orbiting
- Priority: louder = more important
- Notification vs ambient vs interactive

Respond in JSON:
{
  "sounds": [
    {
      "event": "...",
      "position": { "x": 0, "y": 0, "z": -1 },
      "distance": "personal",
      "movement": "static",
      "priority": 5,
      "description": "what it sounds like"
    }
  ]
}` },
    { role: 'user', content: `Events:\n${events.map((e) => `- ${e}`).join('\n')}\n\nSpatial audio design:` },
  ], { maxTokens: 500 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, audio: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Gesture recognition ──────────────────────────── */

/**
 * Define gesture vocabulary for spatial interaction.
 */
export function defineGestureVocabulary() {
  return {
    navigation: {
      'point': 'Select/inspect element',
      'swipe_left': 'Previous item',
      'swipe_right': 'Next item',
      'swipe_up': 'Scroll up / expand',
      'swipe_down': 'Scroll down / collapse',
      'pinch': 'Zoom in/out',
      'two_hand_rotate': 'Rotate 3D object',
    },
    manipulation: {
      'grab': 'Pick up / move element',
      'throw': 'Dismiss / delete',
      'pull_towards': 'Bring closer / zoom in',
      'push_away': 'Send further / zoom out',
      'spread': 'Expand / reveal more',
      'squeeze': 'Collapse / minimize',
    },
    system: {
      'palm_up': 'Open menu',
      'fist': 'Quick action / confirm',
      'wave': 'Dismiss notification',
      'thumbs_up': 'Approve / like',
      'peace_sign': 'Share / send',
      'pinch_and_twist': 'Adjust setting (volume, brightness)',
    },
  }
}

export default { designSpatialLayout, generateAROverlay, visualize3D, designSpatialAudio, defineGestureVocabulary }