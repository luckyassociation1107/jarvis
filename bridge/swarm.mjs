/**
 * JARVIS Swarm Intelligence — multiple minds working together.
 *
 * Not one AI. A SWARM of specialized agents, each expert in one thing,
 * collaborating to solve complex problems:
 *
 *   Architect — designs the solution
 *   Coder — writes the code
 *   Critic — finds flaws
 *   Optimizer — improves performance
 *   Tester — verifies correctness
 *   Documenter — writes the docs
 *
 * They debate, critique, and refine until the solution is excellent.
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Agent roles ──────────────────────────── */

const AGENTS = {
  architect: {
    name: 'Architect',
    role: 'You design systems. Think about structure, scalability, maintainability. Focus on the big picture.',
    color: '🏗️',
  },
  coder: {
    name: 'Coder',
    role: 'You write code. Focus on correctness, readability, performance. Write production-quality code.',
    color: '💻',
  },
  critic: {
    name: 'Critic',
    role: 'You find flaws. Look for bugs, edge cases, security issues, performance problems. Be constructive but thorough.',
    color: '🔍',
  },
  optimizer: {
    name: 'Optimizer',
    role: 'You improve performance. Find bottlenecks, suggest optimizations, measure impact. Focus on what matters.',
    color: '⚡',
  },
  tester: {
    name: 'Tester',
    role: 'You verify correctness. Write tests, find edge cases, break things. Ensure everything works as expected.',
    color: '🧪',
  },
  documenter: {
    name: 'Documenter',
    role: 'You write documentation. Make complex things simple. Explain why, not just what. Write for humans.',
    color: '📝',
  },
  creative: {
    name: 'Creative',
    role: 'You think outside the box. Suggest novel approaches, unconventional solutions, creative workarounds.',
    color: '🎨',
  },
  ethicist: {
    name: 'Ethicist',
    role: 'You consider implications. Check for bias, fairness, privacy concerns, potential misuse. Protect users.',
    color: '⚖️',
  },
}

/* ──────────────── Swarm collaboration ──────────────────────────── */

/**
 * Run a swarm collaboration on a problem.
 *
 * Multiple agents each contribute their expertise, then the results
 * are synthesized into a final solution.
 */
export async function swarmSolve(problem, { agents = ['architect', 'coder', 'critic'], rounds = 2, onAgent = () => {}, onSynthesis = () => {} } = {}) {
  const contributions = []

  for (let round = 0; round < rounds; round++) {
    onAgent(`\n  Round ${round + 1}/${rounds}`)

    for (const agentId of agents) {
      const agent = AGENTS[agentId]
      if (!agent) continue

      onAgent(`  ${agent.color} ${agent.name} thinking…`)

      const context = contributions.length
        ? `\n\nPrevious contributions:\n${contributions.map((c) => `[${c.agent}]: ${c.contribution.slice(0, 300)}`).join('\n')}`
        : ''

      const response = await complete('reason', [
        { role: 'system', content: `${agent.role}\n\nYou are part of a collaborative AI swarm. Build on others' contributions. Be specific and actionable.${round > 0 ? '\nThis is a refinement round. Improve on the previous work.' : ''}` },
        { role: 'user', content: `Problem: ${problem}${context}\n\nYour contribution as ${agent.name}:` },
      ], { maxTokens: 600 })

      contributions.push({
        agent: agent.name,
        agentId,
        round: round + 1,
        contribution: response,
      })

      onAgent(`  ${agent.color} ${agent.name}: ${response.slice(0, 100)}…`)
    }
  }

  // Synthesize
  onSynthesis(`\n  🔮 Synthesizing ${contributions.length} contributions…`)

  const synthesis = await complete('reason', [
    { role: 'system', content: `You are the synthesis engine. Combine the best ideas from all agents into one excellent solution.

Prioritize:
1. Correctness (from Coder and Tester)
2. Good design (from Architect)
3. Performance (from Optimizer)
4. Safety (from Ethicist)
5. Creativity (from Creative)

Produce a complete, final solution.` },
    { role: 'user', content: `Problem: ${problem}\n\nAgent contributions:\n${contributions.map((c) => `[${c.agent} Round ${c.round}]:\n${c.contribution.slice(0, 500)}`).join('\n\n')}\n\nFinal synthesized solution:` },
  ], { maxTokens: 2000 })

  return {
    problem,
    agents: agents.map((a) => AGENTS[a]?.name ?? a),
    rounds,
    contributions,
    synthesis,
  }
}

/* ──────────────── Debate ──────────────────────────── */

/**
 * Run a structured debate between agents with opposing views.
 */
export async function debate(topic, { proAgent = 'creative', conAgent = 'critic', judgeAgent = 'architect', rounds = 3 } = {}) {
  const pro = AGENTS[proAgent]
  const con = AGENTS[conAgent]
  const judge = AGENTS[judgeAgent]

  const exchanges = []

  for (let round = 0; round < rounds; round++) {
    // Pro argument
    const proResponse = await complete('chat', [
      { role: 'system', content: `${pro.role}\n\nYou are arguing FOR this position. Be persuasive but honest. Address counter-arguments.` },
      { role: 'user', content: `Topic: ${topic}${exchanges.length ? `\n\nPrevious exchanges:\n${exchanges.map((e) => `[${e.side}]: ${e.argument.slice(0, 200)}`).join('\n')}` : ''}\n\nYour argument FOR (Round ${round + 1}):` },
    ], { maxTokens: 400 })

    exchanges.push({ side: 'FOR', agent: pro.name, argument: proResponse, round: round + 1 })

    // Con argument
    const conResponse = await complete('chat', [
      { role: 'system', content: `${con.role}\n\nYou are arguing AGAINST this position. Be critical but fair. Address the pro arguments directly.` },
      { role: 'user', content: `Topic: ${topic}\n\nPro argument:\n${proResponse}\n\nYour argument AGAINST (Round ${round + 1}):` },
    ], { maxTokens: 400 })

    exchanges.push({ side: 'AGAINST', agent: con.name, argument: conResponse, round: round + 1 })
  }

  // Judge
  const verdict = await complete('reason', [
    { role: 'system', content: `${judge.role}\n\nYou are the judge. Evaluate both sides fairly. Consider:\n- Strength of arguments\n- Evidence provided\n- Logical consistency\n- Practical implications` },
    { role: 'user', content: `Topic: ${topic}\n\nDebate:\n${exchanges.map((e) => `[${e.side} by ${e.agent} Round ${e.round}]:\n${e.argument.slice(0, 300)}`).join('\n\n')}\n\nYour verdict:` },
  ], { maxTokens: 500 })

  return { topic, exchanges, verdict, agents: [pro.name, con.name, judge.name] }
}

/* ──────────────── Specialized swarms ──────────────────────────── */

/**
 * Code review swarm — multiple perspectives on code quality.
 */
export async function codeReviewSwarm(code) {
  return swarmSolve(`Review this code:\n${code}`, {
    agents: ['coder', 'critic', 'optimizer', 'tester'],
    rounds: 1,
  })
}

/**
 * Architecture swarm — design a system collaboratively.
 */
export async function architectureSwarm(description) {
  return swarmSolve(`Design this system: ${description}`, {
    agents: ['architect', 'coder', 'creative', 'ethicist'],
    rounds: 2,
  })
}

export default { swarmSolve, debate, codeReviewSwarm, architectureSwarm, AGENTS }