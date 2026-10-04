/**
 * JARVIS Health Engine — your personal health intelligence.
 *
 * Not a doctor. A health PARTNER:
 *   - Symptom analysis and tracking
 *   - Health pattern recognition
 *   - Wellness optimization
 *   - Mental health monitoring
 *   - Fitness planning
 *   - Nutrition guidance
 *   - Sleep optimization
 *   - Medication reminders
 *
 * DISCLAIMER: This is for informational purposes only.
 * Always consult a healthcare professional for medical decisions.
 *
 * "I'm not your doctor. I'm the one who notices things your doctor
 *  doesn't see because they only see you for 15 minutes."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Health tracking ──────────────────────────── */

class HealthEngine {
  constructor() {
    this.symptoms = []
    this.vitals = []
    this.medications = []
    this.wellness = { exercise: [], nutrition: [], sleep: [], mood: [] }
    this.alerts = []
  }

  /**
   * Log a symptom.
   */
  logSymptom(symptom, { severity = 5, duration = '', triggers = [], notes = '' } = {}) {
    this.symptoms.push({
      symptom,
      severity: Math.max(1, Math.min(10, severity)),
      duration,
      triggers,
      notes,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Log vital signs.
   */
  logVitals({ heartRate = null, bloodPressure = null, temperature = null, weight = null, oxygenSat = null, steps = null } = {}) {
    this.vitals.push({
      heartRate,
      bloodPressure,
      temperature,
      weight,
      oxygenSat,
      steps,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Log wellness activity.
   */
  logWellness(type, entry) {
    if (this.wellness[type]) {
      this.wellness[type].push({ ...entry, timestamp: new Date().toISOString() })
    }
  }

  /**
   * Analyze symptoms — what might be going on.
   */
  async analyzeSymptoms({ llm = complete } = {}) {
    const recentSymptoms = this.symptoms.slice(-20)
    if (recentSymptoms.length === 0) return 'No symptoms logged.'

    const response = await llm('reason', [
      { role: 'system', content: `Analyze these symptoms for patterns and possible explanations.

IMPORTANT: This is NOT a diagnosis. This is pattern analysis to help the user
have more informed conversations with their healthcare provider.

Look for:
1. Patterns (timing, triggers, combinations)
2. Potential connections between symptoms
3. Lifestyle factors that might contribute
4. Questions to ask their doctor
5. When to seek immediate care (red flags)

Always recommend professional medical consultation.` },
      { role: 'user', content: `Recent symptoms:\n${recentSymptoms.map((s) => `- ${s.symptom} (severity: ${s.severity}/10, duration: ${s.duration || 'unknown'}, triggers: ${s.triggers.join(', ') || 'none'})`).join('\n')}\n\nPattern analysis:` },
    ], { maxTokens: 600 })

    return response
  }

  /**
   * Generate wellness plan.
   */
  async generateWellnessPlan({ goals = [], llm = complete } = {}) {
    const recentVitals = this.vitals.slice(-5)
    const recentSleep = this.wellness.sleep.slice(-7)
    const recentExercise = this.wellness.exercise.slice(-7)

    const response = await llm('reason', [
      { role: 'system', content: `Create a personalized wellness plan.

Consider:
1. Current health status (vitals, symptoms)
2. Current habits (exercise, sleep, nutrition)
3. Goals and preferences
4. Realistic and sustainable changes
5. Progressive difficulty (start easy, build up)

DISCLAIMER: This is general wellness guidance, not medical advice.
Always consult healthcare professionals for medical decisions.` },
      { role: 'user', content: `Goals: ${goals.join(', ') || 'general wellness'}\nRecent vitals: ${JSON.stringify(recentVitals.slice(-2))}\nRecent sleep: ${recentSleep.length} entries\nRecent exercise: ${recentExercise.length} entries\n\nWellness plan:` },
    ], { maxTokens: 800 })

    return response
  }

  /**
   * Sleep analysis and optimization.
   */
  async analyzeSleep({ llm = complete } = {}) {
    const sleepData = this.wellness.sleep.slice(-14)

    const response = await llm('reason', [
      { role: 'system', content: `Analyze sleep patterns and provide optimization recommendations.

Consider:
1. Sleep duration (7-9 hours recommended for adults)
2. Sleep quality (interruptions, restlessness)
3. Sleep timing (consistency, circadian rhythm)
4. Factors affecting sleep (caffeine, screens, stress)
5. Sleep hygiene recommendations

Provide specific, actionable advice.` },
      { role: 'user', content: `Sleep data (last ${sleepData.length} entries):\n${sleepData.map((s) => `- ${JSON.stringify(s)}`).join('\n') || 'No sleep data logged'}\n\nSleep analysis:` },
    ], { maxTokens: 500 })

    return response
  }

  /**
   * Get health dashboard.
   */
  getDashboard() {
    const recentVitals = this.vitals[this.vitals.length - 1] || {}
    return {
      symptoms: {
        total: this.symptoms.length,
        recent: this.symptoms.slice(-5).map((s) => s.symptom),
        avgSeverity: this.symptoms.length
          ? (this.symptoms.reduce((sum, s) => sum + s.severity, 0) / this.symptoms.length).toFixed(1)
          : null,
      },
      vitals: {
        latest: recentVitals,
        count: this.vitals.length,
      },
      wellness: {
        exercise: this.wellness.exercise.length,
        sleep: this.wellness.sleep.length,
        nutrition: this.wellness.nutrition.length,
        mood: this.wellness.mood.length,
      },
      medications: this.medications.length,
      alerts: this.alerts.length,
    }
  }
}

export { HealthEngine }
export default { HealthEngine }