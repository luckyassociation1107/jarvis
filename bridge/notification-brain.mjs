/**
 * JARVIS Notification Brain — knows WHEN to speak and WHEN to stay silent.
 *
 * The most important feature of an AI: knowing when NOT to interrupt.
 *
 * Rules:
 *   - Focus mode → only urgent notifications
 *   - Meeting → silent unless emergency
 *   - Deep work → batch notifications
 *   - Idle → proactive suggestions OK
 *   - Night → only critical alerts
 *   - Morning → briefing time
 *
 * "I know when to speak. I know when to listen.
 *  I know when you need me, and when you need silence."
 */

import { eventBus, EVENTS } from './event-bus.mjs'

/* ──────────────── Notification Brain ──────────────────────────── */

class NotificationBrain {
  constructor() {
    this.state = 'idle'           // idle, focused, meeting, sleeping, driving
    this.queue = []               // pending notifications
    this.delivered = []           // delivered notifications
    this.suppressed = []          // suppressed notifications
    this.rules = {
      idle: { allowAll: true, batchSize: false },
      focused: { allowAll: false, onlyUrgent: true, batchInterval: 30 },
      meeting: { allowAll: false, onlyCritical: true },
      sleeping: { allowAll: false, onlyEmergency: true },
      driving: { allowAll: false, onlyVoice: true, onlyUrgent: true },
    }
    this.preferences = {
      quietHoursStart: 23,
      quietHoursEnd: 7,
      maxNotificationsPerHour: 5,
      batchInterval: 15,          // minutes
    }
    this.recentDeliveries = []
  }

  /**
   * Set current state.
   */
  setState(state) {
    this.state = state
    eventBus.emit('notification:state_change', { state })
  }

  /**
   * Should this notification be delivered?
   */
  shouldDeliver(notification) {
    const rules = this.rules[this.state] || this.rules.idle
    const hour = new Date().getHours()

    // Quiet hours check
    if (hour >= this.preferences.quietHoursStart || hour < this.preferences.quietHoursEnd) {
      if (notification.urgency !== 'emergency') {
        this.suppressed.push({ ...notification, reason: 'quiet_hours', timestamp: new Date().toISOString() })
        return { deliver: false, reason: 'Quiet hours' }
      }
    }

    // State-based rules
    if (rules.onlyEmergency && notification.urgency !== 'emergency') {
      this.suppressed.push({ ...notification, reason: `state_${this.state}`, timestamp: new Date().toISOString() })
      return { deliver: false, reason: `In ${this.state} mode — only emergencies` }
    }

    if (rules.onlyCritical && !['critical', 'emergency'].includes(notification.urgency)) {
      this.suppressed.push({ ...notification, reason: `state_${this.state}`, timestamp: new Date().toISOString() })
      return { deliver: false, reason: `In ${this.state} mode — only critical` }
    }

    if (rules.onlyUrgent && !['urgent', 'critical', 'emergency'].includes(notification.urgency)) {
      // Queue for batch delivery
      this.queue.push(notification)
      return { deliver: false, reason: 'Queued for batch delivery' }
    }

    // Rate limiting
    const recentCount = this.recentDeliveries.filter(
      (d) => Date.now() - new Date(d.timestamp).getTime() < 3600000
    ).length
    if (recentCount >= this.preferences.maxNotificationsPerHour) {
      this.queue.push(notification)
      return { deliver: false, reason: 'Rate limited' }
    }

    return { deliver: true }
  }

  /**
   * Deliver a notification.
   */
  deliver(notification) {
    const decision = this.shouldDeliver(notification)
    if (!decision.deliver) return decision

    const delivered = {
      ...notification,
      deliveredAt: new Date().toISOString(),
      state: this.state,
    }
    this.delivered.push(delivered)
    this.recentDeliveries.push(delivered)
    if (this.recentDeliveries.length > 50) this.recentDeliveries.shift()

    eventBus.emit(EVENTS.SYSTEM_ALERT, notification)
    return { deliver: true, notification: delivered }
  }

  /**
   * Flush queued notifications (batch delivery).
   */
  flushQueue() {
    const toDeliver = [...this.queue]
    this.queue = []

    // Summarize if many
    if (toDeliver.length > 3) {
      return {
        summary: `${toDeliver.length} notifications while you were ${this.state}`,
        items: toDeliver.map((n) => n.message || n.title).slice(0, 5),
      }
    }

    return toDeliver
  }

  /**
   * Get notification stats.
   */
  getStats() {
    return {
      state: this.state,
      queued: this.queue.length,
      delivered: this.delivered.length,
      suppressed: this.suppressed.length,
      recentRate: this.recentDeliveries.filter(
        (d) => Date.now() - new Date(d.timestamp).getTime() < 3600000
      ).length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const notificationBrain = new NotificationBrain()

export { notificationBrain, NotificationBrain }
export default notificationBrain