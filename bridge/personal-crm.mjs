/**
 * JARVIS Personal CRM — manages relationships and contacts.
 *
 *   - Contact management with context
 *   - Interaction history
 *   - Follow-up reminders
 *   - Relationship strength tracking
 *   - Birthday and anniversary reminders
 *   - Networking suggestions
 *
 * "You haven't talked to Rahul in 3 weeks. His birthday is next Tuesday.
 *  Last time you talked, he mentioned his startup launch.
 *  Suggested message: 'Hey Rahul, how's the launch going?'"
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Personal CRM ──────────────────────────── */

class PersonalCRM {
  constructor() {
    this.contacts = new Map()    // name → contact data
    this.interactions = []       // all interactions
  }

  /**
   * Add a contact.
   */
  addContact(name, { email = '', phone = '', company = '', role = '', birthday = null, notes = '', tags = [] } = {}) {
    const contact = {
      id: `contact-${Date.now()}`,
      name,
      email,
      phone,
      company,
      role,
      birthday,
      notes,
      tags,
      createdAt: new Date().toISOString(),
      lastInteraction: null,
      interactionCount: 0,
      relationshipStrength: 5, // 1-10
    }
    this.contacts.set(name.toLowerCase(), contact)
    return contact
  }

  /**
   * Log an interaction.
   */
  logInteraction(contactName, { type = 'chat', summary = '', sentiment = 'neutral', nextAction = null } = {}) {
    const contact = this.contacts.get(contactName.toLowerCase())
    if (!contact) return { ok: false, error: 'Contact not found' }

    const interaction = {
      id: `int-${Date.now()}`,
      contactId: contact.id,
      contactName: contact.name,
      type, // chat, call, email, meeting, social
      summary,
      sentiment, // positive, neutral, negative
      nextAction,
      timestamp: new Date().toISOString(),
    }
    this.interactions.push(interaction)
    contact.lastInteraction = interaction.timestamp
    contact.interactionCount++

    // Update relationship strength
    if (sentiment === 'positive') {
      contact.relationshipStrength = Math.min(10, contact.relationshipStrength + 0.5)
    } else if (sentiment === 'negative') {
      contact.relationshipStrength = Math.max(1, contact.relationshipStrength - 1)
    }

    return { ok: true, interaction }
  }

  /**
   * Get contacts needing attention.
   */
  getNeedingAttention({ days = 14 } = {}) {
    const cutoff = new Date(Date.now() - days * 86400000)
    return Array.from(this.contacts.values())
      .filter((c) => !c.lastInteraction || new Date(c.lastInteraction) < cutoff)
      .sort((a, b) => b.relationshipStrength - a.relationshipStrength)
  }

  /**
   * Get upcoming birthdays.
   */
  getUpcomingBirthdays({ days = 30 } = {}) {
    const now = new Date()
    return Array.from(this.contacts.values())
      .filter((c) => c.birthday)
      .map((c) => {
        const bday = new Date(c.birthday)
        const thisYear = new Date(now.getFullYear(), bday.getMonth(), bday.getDate())
        if (thisYear < now) thisYear.setFullYear(thisYear.getFullYear() + 1)
        const daysUntil = Math.ceil((thisYear - now) / 86400000)
        return { name: c.name, birthday: c.birthday, daysUntil }
      })
      .filter((b) => b.daysUntil <= days)
      .sort((a, b) => a.daysUntil - b.daysUntil)
  }

  /**
   * Suggest a message for reconnecting.
   */
  async suggestMessage(contactName, { llm = complete } = {}) {
    const contact = this.contacts.get(contactName.toLowerCase())
    if (!contact) return null

    const recentInteractions = this.interactions
      .filter((i) => i.contactId === contact.id)
      .slice(-5)

    const response = await llm('chat', [
      { role: 'system', content: `Suggest a natural, warm message to reconnect with this contact.

Make it:
- Personal (reference last interaction or their situation)
- Genuine (not generic "how are you")
- Brief (2-3 sentences max)
- Engaging (ends with a question or hook)

Don't be salesy or fake. Be human.` },
      { role: 'user', content: `Contact: ${contact.name}\nCompany: ${contact.company || 'unknown'}\nRole: ${contact.role || 'unknown'}\nLast interaction: ${contact.lastInteraction || 'never'}\nRelationship strength: ${contact.relationshipStrength}/10\n\nRecent interactions:\n${recentInteractions.map((i) => `- [${i.type}] ${i.summary}`).join('\n') || 'No recent interactions'}\n\nSuggested message:` },
    ], { maxTokens: 200 })

    return response
  }

  /**
   * Get contact stats.
   */
  getStats() {
    return {
      contacts: this.contacts.size,
      interactions: this.interactions.length,
      needingAttention: this.getNeedingAttention().length,
      upcomingBirthdays: this.getUpcomingBirthdays().length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const personalCRM = new PersonalCRM()

export { personalCRM, PersonalCRM }
export default personalCRM