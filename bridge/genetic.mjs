/**
 * JARVIS Genetic Engine — self-evolving code and strategies.
 *
 * Like biological evolution but for AI:
 *   - Population of solutions/strategies
 *   - Fitness evaluation (how good is each?)
 *   - Selection (keep the best)
 *   - Crossover (combine good solutions)
 *   - Mutation (random changes for diversity)
 *   - Survival of the fittest
 *
 * Used for:
 *   - Evolving better prompts
 *   - Optimizing code
 *   - Finding creative solutions
 *   - Tuning parameters
 *   - Strategy evolution
 *
 * "I don't just improve. I EVOLVE."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Genetic algorithm engine ──────────────────────────── */

/**
 * Evolve solutions to any problem using genetic algorithms.
 */
export async function evolve(problem, {
  populationSize = 10,
  generations = 5,
  fitnessCriteria = 'effectiveness',
  mutationRate = 0.2,
  llm = complete,
} = {}) {
  // Step 1: Generate initial population
  const populationResponse = await llm('reason', [
    { role: 'system', content: `Generate a diverse population of ${populationSize} solutions.

Each solution should be DIFFERENT — like genetic diversity.
Some should be conventional, some wild, some hybrid.

Respond in JSON:
{
  "population": [
    { "id": 1, "solution": "description", "genes": { "approach": "...", "style": "...", "focus": "...", "risk": "..." }, "estimated_fitness": 0.7 }
  ]
}` },
    { role: 'user', content: `Problem: ${problem}\nFitness criteria: ${fitnessCriteria}\n\nGenerate initial population:` },
  ], { maxTokens: 1500 })

  let population = []
  try {
    const start = populationResponse.indexOf('{')
    const end = populationResponse.lastIndexOf('}')
    population = JSON.parse(populationResponse.slice(start, end + 1)).population || []
  } catch {
    population = [{ id: 1, solution: problem, estimated_fitness: 0.5 }]
  }

  const evolutionLog = [{ generation: 0, bestFitness: Math.max(...population.map((p) => p.estimated_fitness || 0)) }]

  // Step 2: Evolve through generations
  for (let gen = 0; gen < generations; gen++) {
    // Evaluate fitness
    const evalResponse = await llm('reason', [
      { role: 'system', content: `Evaluate the fitness of each solution.

Criteria: ${fitnessCriteria}

For each solution, score 0-1 on:
- Effectiveness (does it solve the problem?)
- Efficiency (resource usage)
- Elegance (simplicity and beauty)
- Robustness (handles edge cases)
- Novelty (creative approach)

Respond in JSON:
{
  "evaluations": [
    { "id": 1, "fitness": 0.75, "strengths": ["..."], "weaknesses": ["..."] }
  ],
  "best": { "id": 1, "why": "..." },
  "worst": { "id": 10, "why": "..." }
}` },
      { role: 'user', content: `Problem: ${problem}\nGeneration ${gen + 1}:\n${population.map((p) => `[${p.id}]: ${JSON.stringify(p.solution || p.genes).slice(0, 100)}`).join('\n')}\n\nEvaluate:` },
    ], { maxTokens: 800 })

    let evaluations = []
    try {
      const start = evalResponse.indexOf('{')
      const end = evalResponse.lastIndexOf('}')
      evaluations = JSON.parse(evalResponse.slice(start, end + 1)).evaluations || []
    } catch {
      evaluations = population.map((p) => ({ id: p.id, fitness: 0.5 }))
    }

    // Selection + Crossover + Mutation
    const nextGenResponse = await llm('reason', [
      { role: 'system', content: `Create the next generation through evolution.

Steps:
1. SELECTION: Keep the top performers (elitism)
2. CROSSOVER: Combine genes from two good parents to create offspring
3. MUTATION: Randomly modify some offspring (${Math.round(mutationRate * 100)}% rate)
4. DIVERSITY: Ensure the population doesn't converge too early

The goal is to find the BEST solution through evolution.

Respond in JSON:
{
  "next_generation": [
    { "id": 1, "solution": "...", "genes": {}, "parentage": "crossover of 2+5" | "mutation of 3" | "elite" }
  ],
  "improvement": "what changed from last generation"
}` },
      { role: 'user', content: `Problem: ${problem}\nCurrent generation fitness:\n${evaluations.map((e) => `[${e.id}]: fitness=${e.fitness}`).join(', ')}\nMutation rate: ${mutationRate}\n\nCreate next generation:` },
    ], { maxTokens: 1000 })

    try {
      const start = nextGenResponse.indexOf('{')
      const end = nextGenResponse.lastIndexOf('}')
      const next = JSON.parse(nextGenResponse.slice(start, end + 1))
      population = next.next_generation || population
    } catch { /* keep current population */ }

    const bestFitness = Math.max(...evaluations.map((e) => e.fitness || 0))
    evolutionLog.push({ generation: gen + 1, bestFitness, populationSize: population.length })
  }

  // Final selection
  const best = population[0]

  return {
    problem,
    generations,
    evolutionLog,
    winner: best,
    finalPopulation: population.map((p) => ({
      id: p.id,
      solution: typeof p.solution === 'string' ? p.solution.slice(0, 200) : p.solution,
      genes: p.genes,
    })),
  }
}

/* ──────────────── Prompt evolution ──────────────────────────── */

/**
 * Evolve a better prompt for a specific task.
 */
export async function evolvePrompt(task, {
  initialPrompts = [],
  generations = 3,
  llm = complete,
} = {}) {
  return evolve(
    `Evolve the best system prompt for: ${task}`,
    {
      populationSize: 8,
      generations,
      fitnessCriteria: 'prompt effectiveness, clarity, and output quality',
      mutationRate: 0.3,
      llm,
    }
  )
}

/* ──────────────── Strategy evolution ──────────────────────────── */

/**
 * Evolve a better strategy for a recurring situation.
 */
export async function evolveStrategy(situation, {
  pastOutcomes = [],
  generations = 3,
  llm = complete,
} = {}) {
  return evolve(
    `Evolve the best strategy for: ${situation}\nPast outcomes: ${JSON.stringify(pastOutcomes).slice(0, 500)}`,
    {
      populationSize: 6,
      generations,
      fitnessCriteria: 'strategy effectiveness given past outcomes',
      mutationRate: 0.25,
      llm,
    }
  )
}

export default { evolve, evolvePrompt, evolveStrategy }