/**
 * JARVIS Temporal & Spatial Reasoning — understands time, space, and causality.
 *
 * Temporal:
 *   - Understands past, present, future
 *   - Reasons about cause and effect
 *   - Plans sequences of actions
 *   - Manages deadlines and schedules
 *
 * Spatial:
 *   - Understands screen layout and UI structure
 *   - Reasons about physical space (for IoT/robotics)
 *   - Navigation and pathfinding
 *   - 3D spatial awareness
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Temporal reasoning ──────────────────────────── */

/**
 * Understand and reason about time-related queries.
 */
export async function reasonAboutTime(query, { currentTime = new Date() } = {}) {
  const response = await complete('chat', [
    { role: 'system', content: `You are a temporal reasoning engine. Understand time-related queries and provide precise answers.

Current time: ${currentTime.toISOString()}
Day: ${currentTime.toLocaleDateString('en-US', { weekday: 'long' })}

When reasoning about time:
- Convert relative references ("tomorrow", "next week") to absolute dates
- Calculate durations and deadlines
- Consider time zones
- Account for business days vs weekends
- Be precise with time calculations` },
    { role: 'user', content: query },
  ], { maxTokens: 300 })

  return response
}

/**
 * Plan a sequence of actions with timing.
 */
export async function planWithTiming(goal, { constraints = [], deadline = null } = {}) {
  const response = await complete('reason', [
    { role: 'system', content: `Create a time-aware action plan. Each step should have:
- What to do
- How long it will take
- Dependencies on other steps
- Deadline (if applicable)
- Buffer time for unexpected issues

Respond in JSON:
{
  "goal": "...",
  "total_estimated_time": "X hours/days",
  "steps": [
    {
      "id": 1,
      "action": "...",
      "duration": "X minutes/hours",
      "depends_on": [],
      "deadline": "date or null",
      "buffer": "X minutes",
      "parallel": false
    }
  ],
  "critical_path": [1, 3, 5],
  "risks": ["risk 1", "risk 2"]
}` },
    { role: 'user', content: `Goal: ${goal}${constraints.length ? `\nConstraints: ${constraints.join(', ')}` : ''}${deadline ? `\nDeadline: ${deadline}` : ''}` },
  ], { maxTokens: 800 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, plan: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Causal reasoning ──────────────────────────── */

/**
 * Understand cause and effect relationships.
 */
export async function reasonCausality(event, { context = '' } = {}) {
  const response = await complete('chat', [
    { role: 'system', content: `You are a causal reasoning engine. Analyze cause and effect chains.

For any event:
1. What caused it? (root causes)
2. What effects will it have? (immediate and long-term)
3. What are the feedback loops?
4. What counterfactuals exist? (what if X hadn't happened?)
5. What are the second-order effects?` },
    { role: 'user', content: `Event: ${event}${context ? `\nContext: ${context}` : ''}\n\nAnalyze the causal chain:` },
  ], { maxTokens: 500 })

  return response
}

/* ──────────────── Spatial reasoning ──────────────────────────── */

/**
 * Reason about screen layout and UI structure.
 */
export async function reasonAboutLayout(screenshot_description, { question = '' } = {}) {
  const response = await complete('chat', [
    { role: 'system', content: `You are a spatial reasoning engine for UI/UX. Analyze screen layouts and answer spatial questions.

When reasoning about UI:
- Identify element positions (top-left, center, bottom-right, etc.)
- Understand visual hierarchy (what's most prominent)
- Recognize common UI patterns (navigation, content, actions)
- Estimate distances and alignments
- Predict where elements might be based on patterns` },
    { role: 'user', content: `Screen: ${screenshot_description}${question ? `\nQuestion: ${question}` : ''}\n\nSpatial analysis:` },
  ], { maxTokens: 400 })

  return response
}

/**
 * Plan physical navigation (for robots, drones, or AR).
 */
export async function planNavigation(from, to, { obstacles = [], constraints = [] } = {}) {
  const response = await complete('reason', [
    { role: 'system', content: `Plan a navigation path from point A to point B.

Consider:
- Obstacles to avoid
- Shortest path vs safest path
- Speed constraints
- Energy/fuel limitations
- Multiple waypoints if needed

Respond in JSON:
{
  "path": [
    {"x": 0, "y": 0, "action": "start"},
    {"x": 5, "y": 3, "action": "move"},
    {"x": 10, "y": 5, "action": "arrive"}
  ],
  "total_distance": "X units",
  "estimated_time": "X seconds",
  "obstacles_avoided": ["obstacle 1"]
}` },
    { role: 'user', content: `From: ${from}\nTo: ${to}${obstacles.length ? `\nObstacles: ${obstacles.join(', ')}` : ''}${constraints.length ? `\nConstraints: ${constraints.join(', ')}` : ''}` },
  ], { maxTokens: 500 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, navigation: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Decision under uncertainty ──────────────────────────── */

/**
 * Make decisions when information is incomplete.
 */
export async function decideUnderUncertainty(options, { knownFacts = [], unknowns = [], riskTolerance = 'medium' } = {}) {
  const response = await complete('reason', [
    { role: 'system', content: `You are a decision-making engine that works with incomplete information.

For each option:
1. Estimate probability of success
2. Calculate expected value
3. Identify key unknowns that would change the decision
4. Suggest what information to gather first
5. Recommend the best option given current knowledge

Consider risk tolerance: ${riskTolerance}` },
    { role: 'user', content: `Options: ${JSON.stringify(options)}\nKnown facts: ${knownFacts.join(', ')}\nUnknowns: ${unknowns.join(', ')}\n\nRecommend the best decision:` },
  ], { maxTokens: 500 })

  return response
}

export default { reasonAboutTime, planWithTiming, reasonCausality, reasonAboutLayout, planNavigation, decideUnderUncertainty }