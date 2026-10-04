/**
 * JARVIS Skill Acquisition — learns NEW skills from examples.
 *
 * Show JARVIS how to do something once, and it learns:
 *   - New tool usage patterns
 *   - New workflows
 *   - New vocabulary
 *   - New problem-solving strategies
 *   - New coding patterns
 *
 * "Show me once. I'll know it forever."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Skill Acquisition ──────────────────────────── */

class SkillAcquisition {
  constructor() {
    this.skills = new Map()      // skillName → {description, examples, steps, success_rate}
    this.observations = []       // observed user actions
    this.learnedWorkflows = []   // workflows learned from observation
  }

  /**
   * Learn a new skill from examples.
   */
  async learnSkill(name, examples, { description = '', llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Learn a new skill from these examples.

Extract:
1. The PATTERN — what's common across all examples
2. The STEPS — the procedure to follow
3. The VARIATIONS — what changes between instances
4. The PRECONDITIONS — when to apply this skill
5. The SUCCESS CRITERIA — how to know it worked

Respond in JSON:
{
  "name": "skill name",
  "description": "what this skill does",
  "pattern": "the common pattern",
  "steps": ["step 1", "step 2", "step 3"],
  "variations": ["what changes between instances"],
  "preconditions": ["when to apply"],
  "success_criteria": ["how to verify success"],
  "difficulty": "easy|medium|hard",
  "confidence": 0.8
}` },
      { role: 'user', content: `Skill: ${name}\n${description ? `Description: ${description}` : ''}\nExamples:\n${examples.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\nExtract the skill:` },
    ], { maxTokens: 600 })

    try {
      const start = response.indexOf('{')
      const end = response.lastIndexOf('}')
      const skill = JSON.parse(response.slice(start, end + 1))
      this.skills.set(name, {
        ...skill,
        learnedAt: new Date().toISOString(),
        timesUsed: 0,
        successCount: 0,
      })
      return { ok: true, skill }
    } catch {
      return { ok: false }
    }
  }

  /**
   * Observe user action and learn from it.
   */
  async observeAction(action, { context = '', llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Observe this user action and extract a learnable skill or pattern.

What can we learn from this?
- Is this a repeatable workflow?
- Is there a shortcut possible?
- Is there a pattern we should remember?` },
      { role: 'user', content: `Action: ${action}\n${context ? `Context: ${context}` : ''}\n\nWhat can we learn:` },
    ], { maxTokens: 300 })

    this.observations.push({
      action,
      learning: response,
      timestamp: new Date().toISOString(),
    })

    return response
  }

  /**
   * Apply a learned skill to a new situation.
   */
  async applySkill(skillName, situation, { llm = complete } = {}) {
    const skill = this.skills.get(skillName)
    if (!skill) return { ok: false, error: 'Skill not found' }

    skill.timesUsed++

    const response = await llm('reason', [
      { role: 'system', content: `Apply the learned skill "${skillName}" to this new situation.

Skill: ${skill.description}
Steps: ${skill.steps?.join(' → ')}
Variations: ${skill.variations?.join(', ')}

Adapt the skill to the specific situation. Follow the pattern but handle variations.` },
      { role: 'user', content: `Situation: ${situation}\n\nApply skill:` },
    ], { maxTokens: 500 })

    return { ok: true, skill: skillName, result: response }
  }

  /**
   * Get all learned skills.
   */
  getSkills() {
    return Array.from(this.skills.entries()).map(([name, skill]) => ({
      name,
      description: skill.description,
      steps: skill.steps?.length || 0,
      timesUsed: skill.timesUsed,
      successRate: skill.timesUsed > 0
        ? ((skill.successCount / skill.timesUsed) * 100).toFixed(0) + '%'
        : 'N/A',
    }))
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      skills: this.skills.size,
      observations: this.observations.length,
      workflows: this.learnedWorkflows.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const skillAcquisition = new SkillAcquisition()

export { skillAcquisition, SkillAcquisition }
export default skillAcquisition