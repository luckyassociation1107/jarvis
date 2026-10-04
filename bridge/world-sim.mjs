/**
 * JARVIS World Simulator — simulate entire systems and predict outcomes.
 *
 * Not just answering questions. SIMULATING REALITY.
 *
 * Build a model of any system — economy, traffic, social dynamics,
 * weather, ecosystems — and run experiments on it.
 *
 * "What happens if we increase the price by 20%?"
 * "What if we add a traffic light here?"
 * "What if this person leaves the team?"
 *
 * JARVIS doesn't guess. It SIMULATES.
 */

import { complete } from './local-llm.mjs'

/* ──────────────── World model creation ──────────────────────────── */

/**
 * Create a simulation model of any system.
 */
export async function createWorldModel(description, { 
  entities = null, 
  rules = null,
  variables = null,
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a world modeler. Given a description of a system, create a complete simulation model.

Identify:
1. Entities (actors, objects, components)
2. Variables (things that change)
3. Rules (how entities interact, cause and effect)
4. Initial state (starting values)
5. Constraints (boundaries, limits)
6. Emergent behaviors (complex patterns from simple rules)

Respond in JSON:
{
  "name": "model name",
  "description": "...",
  "entities": [
    { "id": "e1", "name": "...", "type": "...", "properties": {} }
  ],
  "variables": [
    { "id": "v1", "name": "...", "initial_value": 0, "min": 0, "max": 100, "unit": "..." }
  ],
  "rules": [
    { "id": "r1", "description": "...", "condition": "when X > Y", "effect": "Z increases by 10%" }
  ],
  "constraints": ["constraint 1"],
  "time_step": "1 hour/day/step"
}` },
    { role: 'user', content: `System: ${description}${entities ? `\nEntities: ${entities.join(', ')}` : ''}${rules ? `\nKnown rules: ${rules.join(', ')}` : ''}${variables ? `\nVariables: ${variables.join(', ')}` : ''}` },
  ], { maxTokens: 1500 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, model: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Simulation runner ──────────────────────────── */

/**
 * Run a simulation with interventions and observe outcomes.
 */
export async function simulate(model, { 
  steps = 10, 
  interventions = [], 
  observations = [],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a simulation engine. Given a world model, simulate it step by step.

At each step:
1. Apply all rules
2. Apply any interventions for that step
3. Update all variables
4. Check for emergent behaviors
5. Record observations

Show the state at each step and the final outcome.

Respond in JSON:
{
  "steps": [
    {
      "step": 1,
      "state": { "v1": 10, "v2": 20 },
      "events": ["event description"],
      "emergent": ["emergent behavior"]
    }
  ],
  "final_state": { "v1": 15, "v2": 25 },
  "outcome": "description of what happened",
  "predictions": ["prediction 1", "prediction 2"],
  "sensitivity": { "most_sensitive_variable": "v1", "reason": "..." }
}` },
    { role: 'user', content: `Model: ${JSON.stringify(model).slice(0, 1000)}\nSteps: ${steps}\nInterventions: ${JSON.stringify(interventions)}\nObservations: ${observations.join(', ')}\n\nRun simulation:` },
  ], { maxTokens: 2000 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, simulation: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Scenario comparison ──────────────────────────── */

/**
 * Compare multiple scenarios side by side.
 */
export async function compareScenarios(model, scenarios, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Run multiple scenarios on the same model and compare outcomes.

For each scenario:
1. Apply the scenario's interventions
2. Run the simulation
3. Record the outcome

Then compare:
- Which scenario performed best on each metric
- Trade-offs between scenarios
- Recommendation with reasoning` },
    { role: 'user', content: `Model: ${JSON.stringify(model).slice(0, 800)}\nScenarios: ${JSON.stringify(scenarios)}\n\nCompare all scenarios:` },
  ], { maxTokens: 1500 })

  return { model: model.name || 'model', scenarios, comparison: response }
}

/* ──────────────── Sensitivity analysis ──────────────────────────── */

/**
 * Find which variables matter most — change one thing, see what happens.
 */
export async function sensitivityAnalysis(model, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Perform sensitivity analysis on this model.

For each key variable:
1. Increase it by 10% — what changes?
2. Decrease it by 10% — what changes?
3. Set it to 0 — what breaks?
4. Set it to maximum — what happens?

Rank variables by their impact on the outcome.

Respond in JSON:
{
  "analysis": [
    {
      "variable": "v1",
      "impact_score": 8.5,
      "increase_10pct": "description",
      "decrease_10pct": "description",
      "set_to_zero": "description",
      "set_to_max": "description"
    }
  ],
  "rankings": ["v1", "v3", "v2"],
  "critical_variables": ["v1"],
  "recommendation": "focus on controlling v1"
}` },
    { role: 'user', content: `Model: ${JSON.stringify(model).slice(0, 800)}\n\nSensitivity analysis:` },
  ], { maxTokens: 1200 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, analysis: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Pre-built world models ──────────────────────────── */

const TEMPLATES = {
  traffic: {
    name: 'Traffic Flow',
    entities: ['cars', 'intersections', 'traffic_lights', 'roads'],
    variables: ['flow_rate', 'congestion', 'average_speed', 'wait_time'],
    rules: ['congestion increases when flow > capacity', 'speed decreases with congestion'],
  },
  economy: {
    name: 'Market Economy',
    entities: ['buyers', 'sellers', 'products', 'market'],
    variables: ['price', 'supply', 'demand', 'revenue', 'profit'],
    rules: ['price increases when demand > supply', 'supply increases when price is high'],
  },
  team: {
    name: 'Team Dynamics',
    entities: ['team_members', 'tasks', 'meetings', 'deadlines'],
    variables: ['productivity', 'morale', 'workload', 'communication'],
    rules: ['productivity decreases when workload > capacity', 'morale increases with recognition'],
  },
  ecosystem: {
    name: 'Ecosystem',
    entities: ['predators', 'prey', 'plants', 'environment'],
    variables: ['population_predator', 'population_prey', 'food_supply', 'temperature'],
    rules: ['predator population follows prey population', 'prey grows when food is abundant'],
  },
}

/**
 * Create a model from a template.
 */
export function fromTemplate(templateName) {
  const template = TEMPLATES[templateName]
  if (!template) return { ok: false, error: `Unknown template: ${templateName}`, available: Object.keys(TEMPLATES) }
  return { ok: true, template }
}

export default { createWorldModel, simulate, compareScenarios, sensitivityAnalysis, fromTemplate, TEMPLATES }