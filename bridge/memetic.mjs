/**
 * JARVIS Memetic Engine — ideas that spread, evolve, and PERSIST.
 *
 * Not just content. MEMES (in the original Dawkins sense):
 *   - Ideas that replicate and evolve
 *   - Content engineered for virality
 *   - Narrative frameworks that stick
 *   - Brand/message architecture
 *   - Influence without manipulation
 *   - Cultural signal processing
 *
 * "The most powerful technology isn't silicon. It's an idea
 *  that spreads from mind to mind."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Viral content engineering ──────────────────────────── */

/**
 * Engineer content for maximum spread.
 */
export async function engineerViral(message, { 
  platform = 'general',
  audience = 'broad',
  goal = 'awareness',  // awareness, engagement, action, behavior_change
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Engineer content for maximum spread using memetic principles.

Principles:
1. SIMPLICITY — can it be understood in 3 seconds?
2. EMOTION — does it make you feel something?
3. IDENTITY — does it say something about who you are?
4. UTILITY — is it useful enough to share?
5. NOVELTY — is it surprising or new?
6. STORY — does it have a narrative hook?
7. TRIGGER — does it connect to everyday experiences?
8. PUBLIC — is the behavior visible to others?
9. VALUE — does sharing make you look good?
10. PRACTICAL — can people act on it?

Platform: ${platform}
Audience: ${audience}
Goal: ${goal}

Respond in JSON:
{
  "original_message": "...",
  "optimized_versions": [
    {
      "platform": "...",
      "content": "...",
      "hook": "the attention-grabbing part",
      "emotion": "what it makes you feel",
      "share_trigger": "why someone would share this",
      "predicted_reach": "high|medium|low"
    }
  ],
  "memetic_elements": ["which principles it uses"],
  "hashtags": ["#tag1", "#tag2"],
  "timing": "best time to post"
}` },
    { role: 'user', content: `Message: ${message}\nPlatform: ${platform}\nAudience: ${audience}\n\nViral engineering:` },
  ], { maxTokens: 800 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, engineered: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Narrative architecture ──────────────────────────── */

/**
 * Build a narrative framework that sticks.
 */
export async function buildNarrative(coreMessage, { 
  archetype = 'hero_journey',
  llm = complete,
} = {}) {
  const archetypes = {
    hero_journey: 'Ordinary person faces challenge, transforms, returns with wisdom',
    david_goliath: 'Underdog overcomes impossible odds through cleverness',
    rebirth: 'Character falls, hits bottom, rises transformed',
    quest: 'Group journeys toward a goal, faces trials, achieves it',
    tragedy: 'Flawed character rises, falls due to their flaw',
    comedy: 'Confusion and chaos, eventually everything resolves happily',
    rags_to_riches: 'Nobody becomes somebody through grit and opportunity',
  }

  const response = await llm('chat', [
    { role: 'system', content: `Build a narrative framework using the ${archetype} archetype.

Archetype: ${archetypes[archetype]}

Structure:
1. SETUP — establish the world and character
2. DISRUPTION — something changes
3. STRUGGLE — conflict and obstacles
4. TRANSFORMATION — growth or change
5. RESOLUTION — new equilibrium

Make the core message INESCAPABLE — it should be the moral of the story, not the premise.` },
    { role: 'user', content: `Core message: ${coreMessage}\nArchetype: ${archetype}\n\nNarrative framework:` },
  ], { maxTokens: 800 })

  return { coreMessage, archetype, narrative: response }
}

/* ──────────────── Influence architecture ──────────────────────────── */

/**
 * Design an ethical influence strategy.
 */
export async function designInfluence(goal, { 
  audience = '',
  ethicalBoundaries = ['no_deception', 'no_manipulation', 'respect_autonomy'],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Design an ethical influence strategy.

Ethical boundaries (NEVER cross):
${ethicalBoundaries.map((b) => `- ${b}`).join('\n')}

Principles of ethical influence:
1. TRANSPARENCY — be clear about intentions
2. RESPECT — honor the audience's autonomy
3. VALUE — genuinely improve their lives
4. TRUTH — never deceive or mislead
5. CONSENT — they can opt out at any time

Focus on:
- Making the RIGHT choice EASY
- Removing friction for good decisions
- Social proof from genuine sources
- Reciprocity through real value` },
    { role: 'user', content: `Goal: ${goal}\nAudience: ${audience}\n\nInfluence strategy:` },
  ], { maxTokens: 600 })

  return { goal, audience, strategy: response }
}

/* ──────────────── Cultural signal processing ──────────────────────────── */

/**
 * Read the cultural zeitgeist — what's happening in the collective mind.
 */
export async function readCulture(signals, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Read cultural signals and identify the zeitgeist.

Look for:
1. What themes are recurring?
2. What emotions are dominant?
3. What values are shifting?
4. What language/memes are spreading?
5. What are people hungry for?
6. What are they tired of?
7. What's the collective mood?

Synthesize into a cultural snapshot.` },
    { role: 'user', content: `Cultural signals:\n${signals.map((s) => `- ${s}`).join('\n')}\n\nCultural analysis:` },
  ], { maxTokens: 500 })

  return response
}

export default { engineerViral, buildNarrative, designInfluence, readCulture }