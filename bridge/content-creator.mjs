/**
 * JARVIS Content Creator — generates content for all platforms.
 *
 * Features:
 *   - Social media posts (Instagram, Twitter, LinkedIn, YouTube)
 *   - Blog posts and articles
 *   - Email newsletters
 *   - Video scripts
 *   - Podcast outlines
 *   - Ad copy
 *   - Product descriptions
 *   - SEO-optimized content
 *
 * "Instagram post raasko. LinkedIn article raasko.
 *  YouTube script raasko. Blog post raasko.
 *  Antha JARVIS chesthundi. Nuvvu just topic cheppu."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Content Creator ──────────────────────────── */

/**
 * Create social media post.
 */
export async function createSocialPost(platform, topic, {
  tone = 'casual',
  hashtags = true,
  emojis = true,
  length = 'medium',
  llm = complete,
} = {}) {
  const platformGuide = {
    instagram: 'Visual-first. Use emojis. Hashtags important. Max 2200 chars. Casual, aesthetic.',
    twitter: 'Concise. Max 280 chars. Witty. Hashtags for reach. Threads for long content.',
    linkedin: 'Professional. Value-driven. Stories work well. No excessive emojis.',
    youtube: 'Title: catchy, SEO. Description: detailed with timestamps. Tags: relevant.',
    facebook: 'Conversational. Stories and personal. Moderate hashtags.',
  }

  const lengthGuide = { short: '1-2 sentences', medium: '1 paragraph', long: '2-3 paragraphs' }

  const response = await llm('chat', [
    { role: 'system', content: `Create a ${platform} post.

Platform guide: ${platformGuide[platform] || platformGuide.instagram}
Tone: ${tone}
Length: ${lengthGuide[length]}
${hashtags ? 'Include relevant hashtags.' : 'No hashtags.'}
${emojis ? 'Use appropriate emojis.' : 'No emojis.'}

Make it engaging, authentic, and optimized for the platform.
Write like a real person, not a brand.` },
    { role: 'user', content: `Topic: ${topic}\n\n${platform} post:` },
  ], { maxTokens: length === 'short' ? 100 : length === 'medium' ? 300 : 600 })

  return response
}

/**
 * Create blog post / article.
 */
export async function createBlogPost(topic, {
  style = 'informative',
  length = 'medium',
  seo = true,
  llm = complete,
} = {}) {
  const lengthGuide = { short: '500 words', medium: '1000 words', long: '2000+ words' }

  const response = await llm('chat', [
    { role: 'system', content: `Write a blog post.

Style: ${style}
Length: ${lengthGuide[length]}
${seo ? 'SEO-optimized with keywords in title, headers, and body.' : ''}

Structure:
1. Catchy title (with keyword)
2. Hook (first paragraph grabs attention)
3. Introduction (what they'll learn)
4. Main content (headers, subheaders, examples)
5. Conclusion (key takeaway)
6. Call to action

Write like a human expert, not an AI. Use examples and stories.` },
    { role: 'user', content: `Topic: ${topic}\n\nBlog post:` },
  ], { maxTokens: length === 'short' ? 800 : length === 'medium' ? 1500 : 3000 })

  return response
}

/**
 * Create video script.
 */
export async function createVideoScript(topic, {
  platform = 'youtube',
  duration = '10min',
  style = 'educational',
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Write a video script for ${platform}.

Duration: ${duration}
Style: ${style}

Structure:
1. HOOK (first 10 seconds — grab attention)
2. INTRO (what this video is about — 30 seconds)
3. MAIN CONTENT (key points with examples)
4. ENGAGEMENT (ask to like/subscribe/comment)
5. OUTRO (summary + call to action)

Include:
- [VISUAL] cues for what to show on screen
- [B-ROLL] suggestions for cutaway footage
- [TEXT] on-screen text suggestions
- [MUSIC] mood suggestions

Write for SPEAKING, not reading. Conversational tone.` },
    { role: 'user', content: `Topic: ${topic}\nPlatform: ${platform}\nDuration: ${duration}\n\nVideo script:` },
    ], { maxTokens: 2000 })

  return response
}

/**
 * Create email newsletter.
 */
export async function createNewsletter(topic, {
  audience = 'subscribers',
  tone = 'friendly',
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Write an email newsletter.

Audience: ${audience}
Tone: ${tone}

Structure:
1. Subject line (curiosity-driven, not clickbait)
2. Preview text (shows in inbox preview)
3. Opening (personal, relatable)
4. Main content (valuable, actionable)
5. CTA (clear next step)
6. P.S. (additional hook or reminder)

Keep it scannable. Short paragraphs. Bold key points.` },
    { role: 'user', content: `Topic: ${topic}\n\nNewsletter:` },
  ], { maxTokens: 800 })

  return response
}

/**
 * Create ad copy.
 */
export async function createAdCopy(product, {
  platform = 'facebook',
  goal = 'conversions',
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Write ad copy for ${platform}.

Goal: ${goal}

Rules:
1. Headline: attention-grabbing, benefit-focused
2. Body: pain point → solution → proof → CTA
3. CTA: clear, urgent, specific
4. Keep it SHORT — people scroll fast
5. Use power words: free, new, proven, instant, guaranteed
6. Include social proof if possible` },
    { role: 'user', content: `Product: ${product}\nPlatform: ${platform}\nGoal: ${goal}\n\nAd copy:` },
  ], { maxTokens: 300 })

  return response
}

/**
 * Generate content calendar.
 */
export async function generateContentCalendar(niche, {
  days = 30,
  platforms = ['instagram', 'twitter', 'linkedin'],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Create a ${days}-day content calendar.

Niche: ${niche}
Platforms: ${platforms.join(', ')}

For each day:
- Platform
- Content type (post, story, reel, article, video)
- Topic/title
- Key message
- Best posting time

Mix content types. Include:
- Educational content (40%)
- Entertainment (20%)
- Promotional (20%)
- Engagement (questions, polls) (20%)` },
    { role: 'user', content: `Niche: ${niche}\nDays: ${days}\nPlatforms: ${platforms.join(', ')}\n\nContent calendar:` },
  ], { maxTokens: 2000 })

  return response
}

export default {
  createSocialPost,
  createBlogPost,
  createVideoScript,
  createNewsletter,
  createAdCopy,
  generateContentCalendar,
}