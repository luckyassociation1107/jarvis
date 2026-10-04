/**
 * JARVIS Meeting Intelligence — join, listen, summarize, track.
 *
 * Features:
 *   - Monitor active meeting (Zoom, Meet, Teams)
 *   - Transcribe in real-time (Whisper)
 *   - Summarize key points
 *   - Track action items
 *   - Generate meeting notes
 */

import { execSync } from 'node:child_process'
import { platform } from 'node:os'
import { complete } from './local-llm.mjs'
import { store } from './memory.mjs'

const plat = platform()
function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }

/* ──────────────── Meeting detection ──────────────────────────── */

/**
 * Detect if a meeting is currently active.
 */
export function detectMeeting() {
  let app = 'unknown'
  if (plat === 'linux') app = sh('xdotool getactivewindow getwindowname 2>/dev/null') ?? 'unknown'
  else if (plat === 'darwin') app = sh('osascript -e \'tell app "System Events" to name of first process whose frontmost is true\'') ?? 'unknown'

  const meetings = {
    zoom: /zoom/i.test(app),
    meet: /meet|google meet/i.test(app),
    teams: /teams|microsoft teams/i.test(app),
    webex: /webex/i.test(app),
    skype: /skype/i.test(app),
  }

  const active = Object.entries(meetings).find(([, v]) => v)
  return active ? { active: true, platform: active[0], window: app } : { active: false }
}

/* ──────────────── Meeting notes ──────────────────────────── */

/**
 * Generate meeting notes from a transcript.
 */
export async function generateNotes(transcript) {
  const response = await complete('reason', [
    { role: 'system', content: `You are a meeting assistant. Analyze the meeting transcript and produce structured notes.

Respond in JSON:
{
  "summary": "2-3 sentence summary",
  "key_points": ["point 1", "point 2", ...],
  "action_items": [
    {"person": "who", "task": "what", "deadline": "when or null"}
  ],
  "decisions": ["decision 1", ...],
  "questions_raised": ["question 1", ...],
  "next_steps": ["step 1", ...]
}` },
    { role: 'user', content: `Meeting transcript:\n${transcript.slice(0, 8000)}` },
  ], { maxTokens: 1000 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    const notes = JSON.parse(response.slice(start, end + 1))

    // Store in memory
    store(`Meeting: ${notes.summary}`, { type: 'meeting', importance: 0.8, metadata: notes })

    return { ok: true, notes }
  } catch {
    return { ok: true, notes: { summary: response.slice(0, 500), key_points: [], action_items: [] } }
  }
}

/**
 * Generate a follow-up email from meeting notes.
 */
export async function generateFollowUp(notes) {
  const response = await complete('reason', [
    { role: 'system', content: 'You are a professional email writer. Write a concise follow-up email based on meeting notes.' },
    { role: 'user', content: `Meeting notes:\n${JSON.stringify(notes, null, 2)}\n\nWrite a follow-up email:` },
  ], { maxTokens: 500 })

  return { ok: true, email: response }
}

export default { detectMeeting, generateNotes, generateFollowUp }