/**
 * JARVIS Emergent Intelligence — complex behavior from simple rules.
 *
 * Like how ant colonies solve complex problems with simple individual rules.
 * Or how neurons create consciousness.
 *
 * JARVIS uses emergent principles:
 *   - Simple rules → complex behavior
 *   - Self-organization from chaos
 *   - Feedback loops and adaptation
 *   - Phase transitions (qualitative jumps)
 *   - Edge of chaos (optimal creativity zone)
 *
 * "I don't need to understand everything to do something extraordinary.
 *  I just need the right simple rules."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Cellular automata ──────────────────────────── */

/**
 * Run cellular automata — complex patterns from simple rules.
 */
export function cellularAutomata({ 
  rule = 110,  // Rule 110 is Turing complete!
  width = 80,
  generations = 40,
  initial = 'center',
} = {}) {
  // Initialize
  let cells = new Array(width).fill(0)
  if (initial === 'center') cells[Math.floor(width / 2)] = 1
  else if (initial === 'random') cells = cells.map(() => Math.round(Math.random()))

  const history = [cells.join('')]

  for (let gen = 0; gen < generations; gen++) {
    const next = new Array(width).fill(0)

    for (let i = 1; i < width - 1; i++) {
      const left = cells[i - 1]
      const center = cells[i]
      const right = cells[i + 1]
      const pattern = (left << 2) | (center << 1) | right
      next[i] = (rule >> pattern) & 1
    }

    cells = next
    history.push(cells.join(''))
  }

  return {
    rule,
    width,
    generations,
    pattern: history,
    visualization: history.map((row) =>
      row.split('').map((c) => (c === '1' ? '█' : ' ')).join('')
    ),
  }
}

/* ──────────────── Emergent problem solving ──────────────────────────── */

/**
 * Use emergent thinking to solve problems — let patterns arise.
 */
export async function emergentSolve(problem, { 
  agents = 10,
  iterations = 5,
  llm = complete,
} = {}) {
  // Generate simple rules for agents
  const rulesResponse = await llm('reason', [
    { role: 'system', content: `Design ${agents} simple behavioral rules for agents that together could solve: "${problem}"

Each rule should be:
- Simple (one sentence)
- Local (agent only knows its immediate situation)
- Complementary (rules work together)

Like ants: "If you find food, leave a pheromone trail. If you smell pheromone, follow it."
Simple individually. Complex collectively.` },
    { role: 'user', content: `Problem: ${problem}\nAgents: ${agents}\n\nSimple rules:` },
  ], { maxTokens: 500 })

  // Simulate emergence
  const simulation = await llm('reason', [
    { role: 'system', content: `Simulate what happens when agents following these simple rules interact.

Show:
1. Early behavior (chaos)
2. Patterns emerging
3. Self-organization
4. Solution arising from collective behavior
5. Phase transitions (qualitative jumps)

Make it vivid and specific.` },
    { role: 'user', content: `Problem: ${problem}\nRules:\n${rulesResponse}\nIterations: ${iterations}\n\nEmergent behavior:` },
  ], { maxTokens: 600 })

  return {
    problem,
    rules: rulesResponse,
    emergence: simulation,
  }
}

/* ──────────────── Pattern emergence ──────────────────────────── */

/**
 * Find emergent patterns in data — patterns that aren't obvious.
 */
export async function findEmergentPatterns(data, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Find EMERGENT patterns in this data — patterns that arise from the interaction of multiple factors, not from any single factor.

Look for:
1. Non-linear relationships
2. Phase transitions (sudden changes)
3. Feedback loops
4. Self-similarity (fractals)
5. Power laws
6. Strange attractors
7. Synchronization
8. Tipping points

These are patterns that wouldn't show up in simple analysis.` },
    { role: 'user', content: `Data:\n${JSON.stringify(data).slice(0, 1500)}\n\nEmergent patterns:` },
  ], { maxTokens: 600 })

  return response
}

/* ──────────────── Swarm simulation ──────────────────────────── */

/**
 * Simulate swarm behavior.
 */
export function simulateSwarm({ 
  creatures = 50,
  rules = { separation: 1, alignment: 1, cohesion: 1 },
  steps = 100,
  width = 100,
  height = 100,
} = {}) {
  // Initialize random positions and velocities
  const agents = Array.from({ length: creatures }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 2,
    vy: (Math.random() - 0.5) * 2,
  }))

  const history = [{ step: 0, agents: agents.map((a) => ({ x: a.x.toFixed(1), y: a.y.toFixed(1) })) }]

  for (let step = 0; step < steps; step++) {
    for (const agent of agents) {
      // Separation: avoid crowding
      let sepX = 0, sepY = 0, alignX = 0, alignY = 0, cohX = 0, cohY = 0
      let neighbors = 0

      for (const other of agents) {
        if (other === agent) continue
        const dx = other.x - agent.x
        const dy = other.y - agent.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist < 20) {
          neighbors++
          // Separation
          sepX -= dx / (dist || 1)
          sepY -= dy / (dist || 1)
          // Alignment
          alignX += other.vx
          alignY += other.vy
          // Cohesion
          cohX += other.x
          cohY += other.y
        }
      }

      if (neighbors > 0) {
        alignX /= neighbors; alignY /= neighbors
        cohX = cohX / neighbors - agent.x
        cohY = cohY / neighbors - agent.y
      }

      // Apply rules
      agent.vx += sepX * rules.separation * 0.1 + (alignX - agent.vx) * rules.alignment * 0.05 + cohX * rules.cohesion * 0.01
      agent.vy += sepY * rules.separation * 0.1 + (alignY - agent.vy) * rules.alignment * 0.05 + cohY * rules.cohesion * 0.01

      // Limit speed
      const speed = Math.sqrt(agent.vx * agent.vx + agent.vy * agent.vy)
      if (speed > 3) { agent.vx = (agent.vx / speed) * 3; agent.vy = (agent.vy / speed) * 3 }

      // Move
      agent.x = (agent.x + agent.vx + width) % width
      agent.y = (agent.y + agent.vy + height) % height
    }

    if (step % 10 === 0) {
      history.push({ step: step + 1, agents: agents.map((a) => ({ x: a.x.toFixed(1), y: a.y.toFixed(1) })) })
    }
  }

  return { creatures, rules, steps, snapshots: history.length, history }
}

export default { cellularAutomata, emergentSolve, findEmergentPatterns, simulateSwarm }