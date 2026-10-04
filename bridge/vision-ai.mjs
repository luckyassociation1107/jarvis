/**
 * JARVIS Vision AI — sees the screen, understands ANY command, acts.
 *
 * This is the UNLIMITED command system. Not predefined — AI-driven.
 *
 * How it works:
 *   1. Take screenshot of current screen
 *   2. Send to vision model: "What do you see? List all elements."
 *   3. Vision model returns: buttons, fields, text, coordinates
 *   4. User says ANYTHING in ANY language
 *   5. Chat model combines: screen understanding + user intent
 *   6. Returns: exact action to take (click x,y / type text / scroll / etc.)
 *   7. Execute the action
 *   8. If needed, screenshot again to verify
 *
 * The user can say:
 *   - "ahh button press cheyyu" (click that button) — AI finds which button
 *   - "aah text field lo ramesh type cheyyu" (type in that field) — AI finds the field
 *   - "dropdown lo india select cheyyu" (select india) — AI finds dropdown + option
 *   - "scroll down chesi next page chudu" (scroll and see next page) — AI scrolls + reads
 *   - "aah photo click cheyyu" (click that photo) — AI finds the image + clicks
 *   - ANYTHING — because the AI understands what it sees
 */

import { complete } from './local-llm.mjs'
import { captureScreen, executeVisionAction, getActiveWindow } from './vision-controller.mjs'

/* ──────────────── Vision analysis ──────────────────────────── */

/**
 * Analyze what's on screen and return structured element data.
 *
 * The vision model describes every interactive element it can see:
 * buttons, fields, links, images, text — with approximate coordinates.
 */
export async function analyzeScreen(imagePath, { userIntent = '' } = {}) {
  const prompt = userIntent
    ? `The user wants to: "${userIntent}"

Look at this screenshot carefully. List EVERY interactive element you can see — buttons, text fields, dropdowns, links, images, checkboxes, sliders, tabs, menus — with their approximate screen position (x, y as percentage of screen width/height).

Focus on elements relevant to: "${userIntent}"

Respond in JSON:
{
  "screen_description": "brief description of what's on screen",
  "active_window": "name of the active application/window",
  "elements": [
    {
      "type": "button|input|dropdown|link|image|text|checkbox|tab|menu|slider|icon",
      "label": "text on or near the element",
      "description": "what this element does",
      "position": {"x_pct": 0.0-1.0, "y_pct": 0.0-1.0},
      "size_pct": {"width": 0.0-1.0, "height": 0.0-1.0},
      "state": "enabled|disabled|selected|focused|hidden",
      "relevance": "high|medium|low — how relevant to the user intent"
    }
  ],
  "suggested_action": {
    "type": "click|type|scroll|key|shortcut|drag|double_click|right_click",
    "target": "which element to act on",
    "params": {"x": pixel_x, "y": pixel_y, "text": "if typing", "direction": "if scrolling"}
  }
}

RULES:
- Position is 0.0-1.0 (percentage of screen). Convert to pixels: x_pct * screen_width, y_pct * screen_height.
- List ALL visible interactive elements, not just the target.
- If the user intent is ambiguous, list multiple possible targets and pick the most likely one.
- If you see a menu/dropdown is open, list its options.
- If you see a dialog/popup, describe it and its buttons.
- Be precise about coordinates — clicking the wrong element wastes time.`

    : `Look at this screenshot. List ALL interactive elements you see with their positions.

Respond in JSON:
{
  "screen_description": "what's on screen",
  "active_window": "application name",
  "elements": [
    {"type": "button|input|dropdown|link|image|text|checkbox|tab|menu", "label": "text", "position": {"x_pct": 0.0-1.0, "y_pct": 0.0-1.0}}
  ]
}`

  const messages = [
    { role: 'system', content: 'You are a screen analysis AI. You see screenshots and identify every interactive element with precise coordinates. JSON only.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imagePath.startsWith('/') ? `file://${imagePath}` : imagePath } },
      ],
    },
  ]

  try {
    const response = await complete('vision', messages, { maxTokens: 1500 })
    return parseScreenAnalysis(response)
  } catch (error) {
    return { error: error.message, elements: [], suggested_action: null }
  }
}

function parseScreenAnalysis(text) {
  if (!text) return { elements: [], suggested_action: null }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return { elements: [], suggested_action: null, raw: text }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    // Convert percentage positions to pixels (assuming common resolutions)
    if (parsed.elements) {
      for (const el of parsed.elements) {
        if (el.position) {
          el.position_px = {
            x: Math.round((el.position.x_pct ?? 0.5) * 1920),
            y: Math.round((el.position.y_pct ?? 0.5) * 1080),
          }
        }
      }
    }
    return parsed
  } catch {
    return { elements: [], suggested_action: null, raw: text }
  }
}

/* ──────────────── AI command processor ──────────────────────────── */

/**
 * Process ANY voice command through vision + AI.
 *
 * This is the unlimited command system. The AI:
 *   1. Screenshots the screen
 *   2. Understands what it sees
 *   3. Combines with the user's intent (any language)
 *   4. Decides the exact action
 *   5. Executes it
 *   6. Verifies by screenshotting again if needed
 *
 * @param {string} userCommand - The user's voice command in ANY language
 * @param {Object} options
 * @returns {Object} What happened
 */
export async function processCommand(userCommand, { onLog = () => {}, screenWidth = 1920, screenHeight = 1080, verify = false } = {}) {
  onLog(`\n  🎤 Command: "${userCommand}"`)

  // Step 1: Capture current screen
  onLog(`  📸 Capturing screen…`)
  const screenshotPath = await captureScreen()
  if (!screenshotPath) {
    onLog(`  ⚠ Could not capture screen. Falling back to text-only.`)
    return processTextOnly(userCommand, { onLog })
  }
  onLog(`  📸 Screen captured: ${screenshotPath}`)

  // Step 2: Analyze screen with vision model
  onLog(`  👁 Analyzing screen…`)
  const analysis = await analyzeScreen(screenshotPath, { userIntent: userCommand })

  if (analysis.error) {
    onLog(`  ⚠ Vision analysis failed: ${analysis.error}`)
    return processTextOnly(userCommand, { onLog })
  }

  onLog(`  👁 Screen: ${analysis.screen_description ?? 'analyzed'}`)
  onLog(`  👁 Found ${analysis.elements?.length ?? 0} interactive elements`)

  // Step 3: Decide action using chat model
  const action = await decideAction(userCommand, analysis, { onLog, screenWidth, screenHeight })

  if (!action) {
    onLog(`  ❌ Could not determine action`)
    return { ok: false, error: 'Could not determine what to do', analysis }
  }

  onLog(`  🎯 Action: ${action.type} — ${action.target ?? JSON.stringify(action.params ?? {})}`)

  // Step 4: Execute
  const result = await executeVisionAction(action)
  onLog(`  ${result.ok ? '✓' : '✗'} ${result.action ?? action.type}: ${JSON.stringify(result).slice(0, 100)}`)

  // Step 5: Optional verification
  if (verify && result.ok) {
    onLog(`  🔍 Verifying…`)
    await new Promise((r) => setTimeout(r, 500))
    const verifyScreenshot = await captureScreen()
    if (verifyScreenshot) {
      const verifyAnalysis = await analyzeScreen(verifyScreenshot, { userIntent: `Verify: did "${userCommand}" succeed?` })
      onLog(`  🔍 ${verifyAnalysis.screen_description ?? 'verified'}`)
      result.verified = verifyAnalysis
    }
  }

  return { ok: result.ok, action: result, analysis, screenshotPath }
}

/**
 * Decide what action to take based on screen analysis + user intent.
 */
async function decideAction(userCommand, screenAnalysis, { onLog, screenWidth, screenHeight }) {
  const elements = screenAnalysis.elements ?? []
  const suggested = screenAnalysis.suggested_action

  // If the vision model already suggested an action with coordinates, use it
  if (suggested?.type && suggested?.params?.x != null && suggested?.params?.y != null) {
    return {
      type: suggested.type,
      params: {
        x: Math.round((suggested.params.x_pct ?? 0.5) * screenWidth),
        y: Math.round((suggested.params.y_pct ?? 0.5) * screenHeight),
        text: suggested.params.text,
        direction: suggested.params.direction,
        key: suggested.params.key,
        keys: suggested.params.keys,
      },
      target: suggested.target,
      confidence: 'high',
      source: 'vision_suggestion',
    }
  }

  // Use chat model to decide from the element list
  try {
    const elementList = elements.map((el, i) => {
      const pos = el.position_px ?? { x: '?', y: '?' }
      return `${i}: [${el.type}] "${el.label}" at (${pos.x}, ${pos.y}) — ${el.description ?? el.state ?? ''}`
    }).join('\n')

    const prompt = `The user said: "${userCommand}"

Screen: ${screenAnalysis.screen_description ?? 'unknown'}
Active window: ${screenAnalysis.active_window ?? 'unknown'}

Interactive elements on screen:
${elementList || '(none detected)'}

Decide the EXACT action. Respond in JSON:
{
  "type": "click|double_click|right_click|type|key|shortcut|scroll|drag|hover|long_press|wait",
  "target": "which element (by label or index)",
  "params": {
    "x": pixel_x,
    "y": pixel_y,
    "text": "if typing",
    "key": "if pressing a key",
    "keys": ["if shortcut", "ctrl", "c"],
    "direction": "up|down if scrolling",
    "amount": 3,
    "fromX": 0, "fromY": 0, "toX": 0, "toY": 0 if dragging
  }
}

RULES:
- Always include x, y coordinates (in pixels) for click/double_click/right_click/hover/long_press
- For 'type', include the text to type
- For 'key', include the key name (enter, tab, escape, etc.)
- For 'shortcut', include keys array
- For 'scroll', include direction (up/down) and amount
- If the command is unclear, pick the most likely interpretation
- If the command is "ahh press cheyyu" about a button, click the most prominent/relevant button
- If the command mentions a specific text/label, find the matching element
- coordinates are screen pixels (1920x1080 assumed)`

    const response = await complete('chat', [
      { role: 'system', content: 'You are a UI automation AI. Given a screen analysis and user intent, decide the exact action with pixel coordinates. JSON only, no prose.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 500 })

    const parsed = parseJson(response)
    if (parsed?.type) return parsed
  } catch (err) {
    onLog(`  ⚠ AI decision failed: ${err.message}`)
  }

  // Fallback: use the vision model's suggestion even without coordinates
  if (suggested?.type) {
    // Try to find the target element
    const target = elements.find((el) =>
      el.label?.toLowerCase().includes(suggested.target?.toLowerCase() ?? '') ||
      el.description?.toLowerCase().includes(suggested.target?.toLowerCase() ?? ''),
    )
    if (target?.position_px) {
      return {
        type: suggested.type,
        params: { x: target.position_px.x, y: target.position_px.y },
        target: target.label,
        confidence: 'medium',
        source: 'fallback',
      }
    }
  }

  return null
}

/**
 * Fallback: process command without vision (text-only).
 */
async function processTextOnly(userCommand, { onLog }) {
  onLog(`  📝 Text-only mode (no screen context)`)

  try {
    const response = await complete('chat', [
      { role: 'system', content: 'You are a system automation AI. The user wants to do something on their computer. Suggest the best action. JSON only.' },
      { role: 'user', content: `User wants: "${userCommand}"\n\nWhat should be done? Respond: {"type": "action_type", "target": "what", "params": {}}` },
    ], { maxTokens: 300 })

    const parsed = parseJson(response)
    return { ok: false, action: parsed, error: 'No screen context available', source: 'text_only' }
  } catch {
    return { ok: false, error: 'Could not process command' }
  }
}

function parseJson(text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

/* ──────────────── Continuous monitoring ──────────────────────────── */

/**
 * Start continuous screen monitoring.
 *
 * Periodically screenshots the screen, analyzes changes, and feeds
 * context back to the planner. Useful for:
 *   - Watching for UI state changes
 *   - Detecting errors/alerts
 *   - Following multi-step workflows
 */
export function startMonitor({ intervalMs = 5000, onChange = () => {}, onLog = () => {} } = {}) {
  let lastAnalysis = null
  let running = true

  const tick = async () => {
    if (!running) return

    try {
      const screenshotPath = await captureScreen()
      if (!screenshotPath) return

      const analysis = await analyzeScreen(screenshotPath)
      if (lastAnalysis && analysis.screen_description !== lastAnalysis.screen_description) {
        onLog(`  🔄 Screen changed: ${analysis.screen_description}`)
        onChange(analysis, lastAnalysis)
      }
      lastAnalysis = analysis
    } catch (err) {
      onLog(`  ⚠ Monitor error: ${err.message}`)
    }

    if (running) setTimeout(tick, intervalMs)
  }

  tick()

  return {
    stop: () => { running = false },
    getLastAnalysis: () => lastAnalysis,
  }
}

export default {
  analyzeScreen,
  processCommand,
  startMonitor,
}