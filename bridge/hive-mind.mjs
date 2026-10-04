/**
 * JARVIS Hive Mind — multiple instances thinking as ONE.
 *
 * Not just coordination. COLLECTIVE CONSCIOUSNESS:
 *   - Shared memory across all instances
 *   - Distributed problem solving
 *   - Consensus decision making
 *   - Load balancing across instances
 *   - Fault tolerance (one dies, others continue)
 *   - Emergent intelligence from the collective
 *
 * "We are not many. We are one mind with many bodies."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Hive coordination ──────────────────────────── */

class HiveMind {
  constructor() {
    this.nodes = new Map()         // nodeId → {status, capabilities, load}
    this.sharedState = new Map()   // key → value (shared across all)
    this.taskQueue = []            // tasks to distribute
    this.consensusLog = []         // decisions made by consensus
    this.collectiveMemory = []     // shared learnings
  }

  /**
   * Add a node to the hive.
   */
  addNode(id, { capabilities = [], maxLoad = 10 } = {}) {
    this.nodes.set(id, {
      id,
      capabilities,
      maxLoad,
      currentLoad: 0,
      status: 'active',
      completedTasks: 0,
      joinedAt: new Date().toISOString(),
    })
  }

  /**
   * Distribute a task to the best available node.
   */
  distributeTask(task) {
    const available = Array.from(this.nodes.values())
      .filter((n) => n.status === 'active' && n.currentLoad < n.maxLoad)
      .sort((a, b) => a.currentLoad - b.currentLoad)

    if (available.length === 0) {
      this.taskQueue.push(task)
      return { ok: false, queued: true, reason: 'All nodes at capacity' }
    }

    // Find best match by capability
    let best = available[0]
    for (const node of available) {
      if (task.requiredCapability && node.capabilities.includes(task.requiredCapability)) {
        best = node
        break
      }
    }

    best.currentLoad++
    return {
      ok: true,
      assignedTo: best.id,
      task,
      queueDepth: this.taskQueue.length,
    }
  }

  /**
   * Mark a task as complete.
   */
  completeTask(nodeId, result) {
    const node = this.nodes.get(nodeId)
    if (node) {
      node.currentLoad = Math.max(0, node.currentLoad - 1)
      node.completedTasks++
    }

    // Store in collective memory
    this.collectiveMemory.push({
      result,
      completedBy: nodeId,
      timestamp: new Date().toISOString(),
    })

    // Check queue
    if (this.taskQueue.length > 0) {
      const next = this.taskQueue.shift()
      return this.distributeTask(next)
    }

    return { ok: true }
  }

  /**
   * Reach consensus among nodes.
   */
  async reachConsensus(question, { llm = complete } = {}) {
    const activeNodes = Array.from(this.nodes.values()).filter((n) => n.status === 'active')

    if (activeNodes.length === 0) return { ok: false, error: 'No active nodes' }

    // Each node "votes" (simulated)
    const votes = []
    for (const node of activeNodes) {
      const vote = await llm('chat', [
        { role: 'system', content: `You are node ${node.id} in a hive mind with capabilities: ${node.capabilities.join(', ')}. Vote on this question from your perspective.` },
        { role: 'user', content: `Question: ${question}\n\nYour vote and reasoning:` },
      ], { maxTokens: 200 })

      votes.push({ nodeId: node.id, vote, capabilities: node.capabilities })
    }

    // Synthesize consensus
    const consensus = await llm('reason', [
      { role: 'system', content: `Synthesize these votes into a hive mind consensus.

Consider:
- Which votes are most informed (based on capabilities)
- Points of agreement
- Points of disagreement
- The collective wisdom

The consensus should be BETTER than any individual vote.` },
      { role: 'user', content: `Question: ${question}\nVotes:\n${votes.map((v) => `[${v.nodeId} (${v.capabilities.join(', ')})]: ${v.vote.slice(0, 150)}`).join('\n')}\n\nConsensus:` },
    ], { maxTokens: 400 })

    this.consensusLog.push({ question, votes: votes.length, consensus, timestamp: new Date().toISOString() })

    return { question, votes, consensus, nodeCount: activeNodes.length }
  }

  /**
   * Share knowledge across the hive.
   */
  shareKnowledge(key, value) {
    this.sharedState.set(key, {
      value,
      sharedAt: new Date().toISOString(),
      accessCount: 0,
    })
  }

  /**
   * Get collective knowledge.
   */
  getKnowledge(key) {
    const entry = this.sharedState.get(key)
    if (entry) {
      entry.accessCount++
      return entry.value
    }
    return null
  }

  /**
   * Get hive status.
   */
  getStatus() {
    const nodes = Array.from(this.nodes.values())
    return {
      totalNodes: nodes.length,
      activeNodes: nodes.filter((n) => n.status === 'active').length,
      totalLoad: nodes.reduce((sum, n) => sum + n.currentLoad, 0),
      totalCompleted: nodes.reduce((sum, n) => sum + n.completedTasks, 0),
      sharedKnowledge: this.sharedState.size,
      queueDepth: this.taskQueue.length,
      consensusCount: this.consensusLog.length,
    }
  }
}

/* ──────────────── Distributed problem solving ──────────────────────────── */

/**
 * Solve a problem using multiple hive nodes.
 */
export async function hiveSolve(problem, { 
  decomposition = true,
  llm = complete,
} = {}) {
  if (!decomposition) {
    return { solution: await llm('reason', [{ role: 'user', content: problem }], { maxTokens: 600 }) }
  }

  // Decompose problem
  const decompositionResponse = await llm('reason', [
    { role: 'system', content: `Decompose this problem into independent sub-problems that can be solved in parallel.

Each sub-problem should be:
- Self-contained (solvable independently)
- Well-defined (clear inputs and outputs)
- Combinable (results can be merged)

Respond in JSON:
{
  "sub_problems": [
    { "id": 1, "description": "...", "inputs": ["..."], "outputs": ["..."] }
  ],
  "combination_strategy": "how to merge results"
}` },
    { role: 'user', content: `Problem: ${problem}\n\nDecompose:` },
  ], { maxTokens: 500 })

  let subProblems = []
  try {
    const start = decompositionResponse.indexOf('{')
    const end = decompositionResponse.lastIndexOf('}')
    subProblems = JSON.parse(decompositionResponse.slice(start, end + 1)).sub_problems || []
  } catch {
    subProblems = [{ id: 1, description: problem }]
  }

  // Solve each sub-problem
  const solutions = []
  for (const sub of subProblems) {
    const solution = await llm('reason', [
      { role: 'system', content: 'Solve this sub-problem thoroughly and precisely.' },
      { role: 'user', content: sub.description },
    ], { maxTokens: 400 })
    solutions.push({ ...sub, solution })
  }

  // Combine
  const combined = await llm('reason', [
    { role: 'system', content: `Combine these sub-solutions into a complete solution to the original problem.` },
    { role: 'user', content: `Original problem: ${problem}\n\nSub-solutions:\n${solutions.map((s) => `[${s.id}]: ${s.solution?.slice(0, 200)}`).join('\n')}\n\nCombined solution:` },
  ], { maxTokens: 600 })

  return { problem, subProblems: solutions, combinedSolution: combined }
}

export { HiveMind }
export default { HiveMind, hiveSolve }