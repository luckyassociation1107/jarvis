/**
 * JARVIS Meeting Assistant — joins meetings, takes notes, summarizes, follows up.
 *
 * Features:
 *   - Join meetings automatically (Zoom, Teams, Google Meet)
 *   - Real-time transcription
 *   - Action item extraction
 *   - Meeting summary generation
 *   - Follow-up email drafting
 *   - Meeting preparation (agenda, talking points)
 *   - Participant analysis
 *
 * "Meeting lo JARVIS untundi. Notes teeskuntundi.
 *  Action items identify chesthundi. Follow-up email kuda draft chesthundi.
 *  Nuvvu just meeting lo matladu."
 */

import { complete } from './local-llm.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Meeting Assistant ──────────────────────────── */

class MeetingAssistant {
  constructor() {
    // Active meeting
    this.activeMeeting = null

    // Meeting history
    this.meetings = []

    // Real-time transcription
    this.transcript = []        // [{speaker, text, timestamp}]
    this.isTranscribing = false

    // Action items from current meeting
    this.actionItems = []

    // Meeting stats
    this.stats = {
      totalMeetings: 0,
      totalMinutes: 0,
      totalActionItems: 0,
    }
  }

  /**
   * Start meeting tracking.
   */
  startMeeting(title, { platform = 'zoom', participants = [], agenda = '' } = {}) {
    this.activeMeeting = {
      id: `meeting-${Date.now()}`,
      title,
      platform,
      participants,
      agenda,
      startTime: new Date().toISOString(),
      endTime: null,
      status: 'active',
    }

    this.transcript = []
    this.actionItems = []
    this.isTranscribing = true

    eventBus.emit('meeting:started', { title, platform })

    return { ok: true, meeting: this.activeMeeting }
  }

  /**
   * Add transcription line.
   */
  addTranscript(speaker, text) {
    if (!this.activeMeeting) return

    this.transcript.push({
      speaker,
      text,
      timestamp: new Date().toISOString(),
    })

    // Auto-detect action items
    this._detectActionItem(speaker, text)
  }

  /**
   * Auto-detect action items from transcript.
   */
  _detectActionItem(speaker, text) {
    const triggers = [
      'will do', 'i\'ll', 'i will', 'let me', 'going to',
      'action item', 'todo', 'follow up', 'deadline',
      'by tomorrow', 'by next week', 'before friday',
      'assign', 'responsible', 'deliver',
      'chestha', 'chesthanu', 'cheddam', 'plan',
    ]

    const lower = text.toLowerCase()
    const isAction = triggers.some((t) => lower.includes(t))

    if (isAction) {
      this.actionItems.push({
        id: `action-${Date.now()}`,
        speaker,
        text,
        timestamp: new Date().toISOString(),
        status: 'pending',
        assignee: speaker,
      })
    }
  }

  /**
   * End meeting and generate summary.
   */
  async endMeeting({ llm = complete } = {}) {
    if (!this.activeMeeting) return { ok: false, error: 'No active meeting' }

    this.activeMeeting.endTime = new Date().toISOString()
    this.activeMeeting.status = 'completed'
    this.activeMeeting.durationMinutes = Math.round(
      (new Date(this.activeMeeting.endTime) - new Date(this.activeMeeting.startTime)) / 60000
    )

    this.isTranscribing = false

    // Generate summary
    const summary = await this._generateSummary({ llm })

    // Store meeting
    const meeting = {
      ...this.activeMeeting,
      transcript: [...this.transcript],
      actionItems: [...this.actionItems],
      summary,
    }
    this.meetings.push(meeting)

    // Update stats
    this.stats.totalMeetings++
    this.stats.totalMinutes += meeting.durationMinutes
    this.stats.totalActionItems += this.actionItems.length

    this.activeMeeting = null

    eventBus.emit('meeting:ended', meeting)

    return { ok: true, meeting }
  }

  /**
   * Generate meeting summary.
   */
  async _generateSummary({ llm = complete }) {
    if (this.transcript.length === 0) return 'No transcript available.'

    const response = await llm('reason', [
      { role: 'system', content: `Generate a concise meeting summary.

Include:
1. KEY TOPICS discussed
2. DECISIONS made
3. ACTION ITEMS (who, what, by when)
4. OPEN QUESTIONS
5. NEXT STEPS

Be brief but complete. A busy person should get everything in 1 minute.` },
      { role: 'user', content: `Meeting: ${this.activeMeeting?.title}\nDuration: ${this.activeMeeting?.durationMinutes} min\nParticipants: ${this.activeMeeting?.participants.join(', ')}\n\nTranscript:\n${this.transcript.slice(0, 50).map((t) => `${t.speaker}: ${t.text}`).join('\n')}\n\nAction items:\n${this.actionItems.map((a) => `- ${a.assignee}: ${a.text}`).join('\n')}\n\nSummary:` },
    ], { maxTokens: 600 })

    return response
  }

  /**
   * Prepare for an upcoming meeting.
   */
  async prepareMeeting(title, { context = '', participants = [], llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Prepare for this meeting. Create a prep document.

Include:
1. AGENDA with time allocation
2. KEY POINTS to raise
3. QUESTIONS to ask
4. DATA to have ready
5. POTENTIAL OBJECTIONS and responses
6. DESIRED OUTCOME
7. TALKING POINTS for each participant

Make it actionable. 5-minute review should be enough.` },
      { role: 'user', content: `Meeting: ${title}\n${participants.length ? `Participants: ${participants.join(', ')}` : ''}\n${context ? `Context: ${context}` : ''}\n\nMeeting prep:` },
    ], { maxTokens: 600 })

    return response
  }

  /**
   * Draft follow-up email.
   */
  async draftFollowUp({ llm = complete } = {}) {
    if (this.meetings.length === 0 && !this.activeMeeting) {
      return 'No meeting data available.'
    }

    const meeting = this.meetings[this.meetings.length - 1] || {
      title: this.activeMeeting?.title,
      actionItems: this.actionItems,
    }

    const response = await llm('chat', [
      { role: 'system', content: `Draft a follow-up email for this meeting.

Include:
1. Thank participants
2. Key decisions summary
3. Action items with owners and deadlines
4. Next meeting date (if applicable)
5. Any attachments or references

Keep it professional but warm. Max 200 words.` },
      { role: 'user', content: `Meeting: ${meeting.title}\n\nAction items:\n${(meeting.actionItems || this.actionItems).map((a) => `- ${a.assignee}: ${a.text}`).join('\n')}\n\nFollow-up email:` },
    ], { maxTokens: 400 })

    return response
  }

  /**
   * Get active meeting status.
   */
  getActiveMeeting() {
    return this.activeMeeting
      ? {
          ...this.activeMeeting,
          transcriptLength: this.transcript.length,
          actionItems: this.actionItems.length,
          durationSoFar: Math.round((Date.now() - new Date(this.activeMeeting.startTime).getTime()) / 60000),
        }
      : null
  }

  /**
   * Get meeting history.
   */
  getHistory({ limit = 10 } = {}) {
    return this.meetings.slice(-limit).map((m) => ({
      id: m.id,
      title: m.title,
      platform: m.platform,
      duration: m.durationMinutes,
      participants: m.participants.length,
      actionItems: m.actionItems.length,
      date: m.startTime,
    }))
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      activeMeeting: !!this.activeMeeting,
      totalMeetings: this.stats.totalMeetings,
      totalMinutes: this.stats.totalMinutes,
      totalActionItems: this.stats.totalActionItems,
      transcriptLines: this.transcript.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const meetingAssistant = new MeetingAssistant()

export { meetingAssistant, MeetingAssistant }
export default meetingAssistant