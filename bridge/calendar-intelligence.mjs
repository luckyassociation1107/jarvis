/**
 * JARVIS Calendar Intelligence — smart scheduling and time optimization.
 *
 *   - Smart meeting scheduling
 *   - Meeting preparation
 *   - Time optimization
 *   - Buffer time management
 *   - Travel time calculation
 *   - Energy-aware scheduling
 *
 * "You have a meeting at 2 PM and another at 3 PM.
 *  That's tight — the first usually runs over.
 *  I've blocked 2:45-3:00 as buffer. Also, the 3 PM meeting
 *  needs prep — I've drafted the agenda based on the last email thread."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Calendar Intelligence ──────────────────────────── */

class CalendarIntelligence {
  constructor() {
    this.events = []
    this.preferences = {
      bufferTime: 15,           // minutes between meetings
      focusBlocks: [{ start: '09:00', end: '11:00' }],  // protect these hours
      maxMeetingsPerDay: 4,
      preferredMeetingDays: ['Tuesday', 'Wednesday', 'Thursday'],
      noMeetingsAfter: '17:00',
    }
    this.meetingPrep = new Map() // eventId → prep notes
  }

  /**
   * Add a calendar event.
   */
  addEvent(title, { date, startTime, endTime, location = '', attendees = [], description = '', type = 'meeting' } = {}) {
    const event = {
      id: `cal-${Date.now()}`,
      title,
      date,
      startTime,
      endTime,
      location,
      attendees,
      description,
      type, // meeting, focus, personal, reminder
      createdAt: new Date().toISOString(),
    }
    this.events.push(event)
    return event
  }

  /**
   * Smart scheduling — find the best time for a meeting.
   */
  findBestTime({ duration = '1h', attendees = [], preferences = {}, date = null } = {}) {
    const targetDate = date || new Date().toISOString().split('T')[0]
    const dayEvents = this.events.filter((e) => e.date === targetDate)
    const dayOfWeek = new Date(targetDate).toLocaleDateString('en-US', { weekday: 'long' })

    // Check constraints
    const constraints = []
    if (dayEvents.length >= this.preferences.maxMeetingsPerDay) {
      constraints.push('Max meetings reached for this day')
    }
    if (!this.preferences.preferredMeetingDays.includes(dayOfWeek)) {
      constraints.push(`${dayOfWeek} is not a preferred meeting day`)
    }

    // Find free slots
    const busySlots = dayEvents.map((e) => ({
      start: this._timeToMinutes(e.startTime),
      end: this._timeToMinutes(e.endTime),
    }))

    const freeSlots = []
    const dayStart = this._timeToMinutes('09:00')
    const dayEnd = this._timeToMinutes('18:00')
    const durationMinutes = this._parseDuration(duration)

    let current = dayStart
    for (const busy of busySlots.sort((a, b) => a.start - b.start)) {
      if (busy.start - current >= durationMinutes + this.preferences.bufferTime) {
        freeSlots.push({
          start: this._minutesToTime(current),
          end: this._minutesToTime(current + durationMinutes),
          quality: this._rateTimeSlot(current),
        })
      }
      current = Math.max(current, busy.end + this.preferences.bufferTime)
    }
    if (dayEnd - current >= durationMinutes) {
      freeSlots.push({
        start: this._minutesToTime(current),
        end: this._minutesToTime(current + durationMinutes),
        quality: this._rateTimeSlot(current),
      })
    }

    // Filter out focus blocks
    const availableSlots = freeSlots.filter((slot) => {
      const slotStart = this._timeToMinutes(slot.start)
      return !this.preferences.focusBlocks.some((block) => {
        const blockStart = this._timeToMinutes(block.start)
        const blockEnd = this._timeToMinutes(block.end)
        return slotStart >= blockStart && slotStart < blockEnd
      })
    })

    return {
      available: availableSlots.length > 0,
      bestSlot: availableSlots.sort((a, b) => b.quality - a.quality)[0] || null,
      allSlots: availableSlots,
      constraints,
    }
  }

  /**
   * Prepare for a meeting.
   */
  async prepareMeeting(eventId, { llm = complete } = {}) {
    const event = this.events.find((e) => e.id === eventId)
    if (!event) return null

    const response = await llm('reason', [
      { role: 'system', content: `Prepare for this meeting. Create a meeting prep document.

Include:
1. AGENDA (suggested topics with time allocation)
2. KEY POINTS TO RAISE (based on context)
3. QUESTIONS TO ASK
4. DATA/NUMBERS TO HAVE READY
5. POTENTIAL OBJECTIONS AND RESPONSES
6. DESIRED OUTCOME
7. FOLLOW-UP ACTIONS TO PLAN

Be specific and actionable. This should take 5 minutes to review.` },
      { role: 'user', content: `Meeting: ${event.title}\nDate: ${event.date} at ${event.startTime}\nAttendees: ${event.attendees.join(', ') || 'not specified'}\nDescription: ${event.description || 'none'}\n\nMeeting prep:` },
    ], { maxTokens: 600 })

    this.meetingPrep.set(eventId, response)
    return response
  }

  /**
   * Get today's schedule with smart insights.
   */
  getTodayInsights() {
    const today = new Date().toISOString().split('T')[0]
    const todayEvents = this.events.filter((e) => e.date === today)

    const insights = {
      totalEvents: todayEvents.length,
      meetings: todayEvents.filter((e) => e.type === 'meeting').length,
      focusBlocks: todayEvents.filter((e) => e.type === 'focus').length,
      totalMeetingMinutes: todayEvents
        .filter((e) => e.type === 'meeting')
        .reduce((sum, e) => sum + this._parseDuration(`${e.startTime}-${e.endTime}`), 0),
      backToBack: this._findBackToBack(todayEvents),
      recommendations: [],
    }

    if (insights.meetings > this.preferences.maxMeetingsPerDay) {
      insights.recommendations.push('Heavy meeting day — protect focus time tomorrow')
    }
    if (insights.backToBack.length > 0) {
      insights.recommendations.push(`${insights.backToBack.length} back-to-back meetings — add buffer time`)
    }

    return insights
  }

  _findBackToBack(events) {
    const sorted = events
      .map((e) => ({ ...e, endMinutes: this._timeToMinutes(e.endTime), startMinutes: this._timeToMinutes(e.startTime) }))
      .sort((a, b) => a.startMinutes - b.startMinutes)

    const backToBack = []
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startMinutes - sorted[i - 1].endMinutes < this.preferences.bufferTime) {
        backToBack.push([sorted[i - 1].title, sorted[i].title])
      }
    }
    return backToBack
  }

  _timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number)
    return h * 60 + m
  }

  _minutesToTime(minutes) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  _parseDuration(duration) {
    const match = duration.match(/(\d+)h/)
    return match ? parseInt(match[1]) * 60 : 60
  }

  _rateTimeSlot(minutes) {
    // Morning meetings are better for important decisions
    if (minutes >= 540 && minutes <= 660) return 3  // 9-11 AM
    if (minutes >= 840 && minutes <= 900) return 2  // 2-3 PM
    return 1
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      events: this.events.length,
      meetingPreps: this.meetingPrep.size,
      focusBlocks: this.preferences.focusBlocks.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const calendarIntelligence = new CalendarIntelligence()

export { calendarIntelligence, CalendarIntelligence }
export default calendarIntelligence