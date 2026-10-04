/**
 * JARVIS Voice Replica — acts as YOUR digital twin in conversations.
 *
 * How it works:
 *   1. Learns your messaging style from past conversations
 *   2. Analyzes: vocabulary, emoji usage, sentence length, humor, slang
 *   3. When you say "reply to Rahul", it crafts a message in YOUR style
 *   4. Uses cloned voice for voice messages and calls
 *   5. Maintains context from previous conversations
 *
 * "I've analyzed 500 of your messages. You use 'ra' and 'bro' a lot,
 *  your sentences are short, you use 😂 and 🔥 frequently,
 *  and you reply fast with minimal punctuation. I'll match that."
 */

import { complete } from './local-llm.mjs'
import { voiceCloneEngine } from './voice-clone.mjs'
import { eventBus, EVENTS } from './event-bus.mjs'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

/* ──────────────── Constants ──────────────────────────── */

const REPLICA_DIR = join(process.cwd(), 'data', 'replica')
const STYLE_FILE = join(REPLICA_DIR, 'messaging-style.json')
const CONVERSATIONS_DIR = join(REPLICA_DIR, 'conversations')

/* ──────────────── Voice Replica ──────────────────────────── */

class VoiceReplica {
  constructor() {
    this.messagingStyle = null    // learned style
    this.conversations = new Map() // contact → conversation history
    this.contacts = new Map()     // name → contact info
    this.initialized = false
  }

  /**
   * Initialize — load existing style data.
   */
  async init() {
    if (this.initialized) return

    try {
      if (!existsSync(REPLICA_DIR)) await mkdir(REPLICA_DIR, { recursive: true })
      if (!existsSync(CONVERSATIONS_DIR)) await mkdir(CONVERSATIONS_DIR, { recursive: true })

      if (existsSync(STYLE_FILE)) {
        this.messagingStyle = JSON.parse(await readFile(STYLE_FILE, 'utf-8'))
      }
      this.initialized = true
    } catch {
      this.initialized = true
    }
  }

  /**
   * Learn messaging style from past conversations.
   * messages = [{sender: 'me'|'them', text: '...', timestamp: '...'}]
   */
  async learnStyle(messages, { contactName = 'general', llm = complete } = {}) {
    await this.init()

    const myMessages = messages.filter((m) => m.sender === 'me')
    if (myMessages.length < 10) {
      return { ok: false, error: 'Need at least 10 messages to learn style' }
    }

    const response = await llm('reason', [
      { role: 'system', content: `Analyze these messages and extract the messaging STYLE.

Extract:
1. VOCABULARY — common words, slang, abbreviations
2. SENTENCE STRUCTURE — short/long, fragments, run-ons
3. EMOJI USAGE — which emojis, how often, placement
4. PUNCTUATION — periods, exclamation marks, ellipsis, none
5. TONE — formal/casual/friendly/sarcastic
6. HUMOR — type of jokes, sarcasm level
7. GREETINGS — how they start conversations
8. SIGN-OFFS — how they end conversations
9. RESPONSE PATTERNS — quick/delayed, brief/detailed
10. LANGUAGE MIXING — Telugu/English/Hindi patterns
11. TYPOS — intentional misspellings, shortcuts
12. UNIQUE TRAITS — what makes this person's style distinctive

Respond in JSON:
{
  "vocabulary": ["word1", "word2"],
  "sentence_style": "short and punchy",
  "emojis": {"frequent": ["😂", "🔥"], "occasional": ["👍"]},
  "punctuation": "minimal periods, lots of exclamation",
  "tone": "casual friendly",
  "humor": "sarcastic but warm",
  "greeting_patterns": ["hey", "yo", "ra"],
  "signoff_patterns": ["ok ra", "bye", "tc"],
  "response_speed": "fast, usually within minutes",
  "language_mix": "70% English, 30% Telugu",
  "typical_length": "1-2 sentences",
  "unique_traits": "uses 'ra' a lot, short replies, 🔥 for emphasis"
}` },
      { role: 'user', content: `Contact: ${contactName}\n\nMy messages (${myMessages.length} total):\n${myMessages.slice(0, 50).map((m) => `- ${m.text}`).join('\n')}\n\nMessaging style:` },
    ], { maxTokens: 600 })

    try {
      const start = response.indexOf('{')
      const end = response.lastIndexOf('}')
      const style = JSON.parse(response.slice(start, end + 1))

      this.messagingStyle = {
        ...style,
        learnedFrom: myMessages.length,
        contactName,
        learnedAt: new Date().toISOString(),
      }

      await writeFile(STYLE_FILE, JSON.stringify(this.messagingStyle, null, 2))
      return { ok: true, style: this.messagingStyle }
    } catch {
      return { ok: false, error: 'Failed to parse style analysis' }
    }
  }

  /**
   * Import conversation history for a contact.
   */
  async importConversation(contactName, messages) {
    await this.init()

    this.conversations.set(contactName, messages)

    // Save to disk
    const filePath = join(CONVERSATIONS_DIR, `${contactName.replace(/[^a-zA-Z0-9]/g, '_')}.json`)
    await writeFile(filePath, JSON.stringify({ contact: contactName, messages, importedAt: new Date().toISOString() }, null, 2))

    // Also learn style from this conversation
    return { ok: true, messageCount: messages.length }
  }

  /**
   * Generate a reply in your style.
   */
  async generateReply(contactName, incomingMessage, { context = '', medium = 'text', llm = complete } = {}) {
    await this.init()

    // Get conversation history
    const history = this.conversations.get(contactName) || []
    const recentHistory = history.slice(-10)

    // Get contact info
    const contact = this.contacts.get(contactName) || {}

    const style = this.messagingStyle || {}

    const response = await llm('chat', [
      { role: 'system', content: `You are replicating someone's messaging style. Generate a reply that sounds EXACTLY like them.

MUST FOLLOW STYLE RULES:
- Vocabulary: ${style.vocabulary?.join(', ') || 'natural, casual'}
- Sentence style: ${style.sentence_style || 'short and direct'}
- Emojis: ${JSON.stringify(style.emojis || { frequent: ['😂'] })}
- Punctuation: ${style.punctuation || 'minimal'}
- Tone: ${style.tone || 'casual friendly'}
- Language mix: ${style.language_mix || 'English with some Telugu'}
- Typical length: ${style.typical_length || '1-2 sentences'}
- Unique traits: ${style.unique_traits || 'natural, authentic'}

RULES:
1. Match the EXACT style — vocabulary, length, emoji usage
2. Don't be too formal or too casual — match THEIR level
3. Use the same language mix they use
4. If they use slang, use the SAME slang
5. If they're brief, be brief. If they're detailed, be detailed.
6. NEVER sound like an AI. Sound like a HUMAN.
7. Reference past conversations naturally if relevant
8. Match the emotional tone of the conversation

${medium === 'voice' ? 'This will be spoken as a voice message. Write naturally for speech.' : ''}` },
      { role: 'user', content: `Contact: ${contactName}${contact.relationship ? ` (${contact.relationship})` : ''}\n${context ? `Context: ${context}` : ''}\n\nRecent conversation:\n${recentHistory.map((m) => `${m.sender === 'me' ? 'Me' : contactName}: ${m.text}`).join('\n')}\n\n${contactName}: ${incomingMessage}\n\nMe (in my style):` },
    ], { maxTokens: 200 })

    return response
  }

  /**
   * Generate a voice message using cloned voice.
   */
  async generateVoiceMessage(contactName, incomingMessage, { context = '' } = {}) {
    // First generate the text reply
    const text = await this.generateReply(contactName, incomingMessage, { context, medium: 'voice' })

    // Then generate voice parameters using cloned voice
    const voiceResult = await voiceCloneEngine.generateClonedSpeech(text, { emotion: 'casual' })

    return {
      ok: true,
      text,
      voice: voiceResult,
      contactName,
    }
  }

  /**
   * Set contact information.
   */
  setContact(name, { relationship = '', platform = '', notes = '' } = {}) {
    this.contacts.set(name, { relationship, platform, notes, updatedAt: new Date().toISOString() })
  }

  /**
   * Get messaging style summary.
   */
  getStyleSummary() {
    if (!this.messagingStyle) return { learned: false }
    return {
      learned: true,
      ...this.messagingStyle,
      conversationsStored: this.conversations.size,
      contactsKnown: this.contacts.size,
    }
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      styleLearned: !!this.messagingStyle,
      conversations: this.conversations.size,
      contacts: this.contacts.size,
      styleAccuracy: this.messagingStyle?.learnedFrom || 0,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const voiceReplica = new VoiceReplica()

export { voiceReplica, VoiceReplica }
export default voiceReplica