/**
 * JARVIS Knowledge Graph — connecting EVERYTHING.
 *
 * Not a database. A NETWORK of knowledge:
 *   - Entities (people, places, concepts, things)
 *   - Relationships (is_a, has_a, part_of, causes, relates_to)
 *   - Properties (attributes, values, timestamps)
 *   - Inference (discover new connections from existing ones)
 *   - Visualization (how knowledge connects)
 *
 * "I don't store facts. I store CONNECTIONS between facts.
 *  That's how I know things I was never told."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Graph structure ──────────────────────────── */

class KnowledgeGraph {
  constructor() {
    this.entities = new Map()     // id → {name, type, properties}
    this.relationships = []       // [{from, to, type, weight, properties}]
    this.index = new Map()        // name → id (for quick lookup)
    this.inferenceRules = []      // rules for deriving new knowledge
  }

  /**
   * Add an entity to the graph.
   */
  addEntity(name, { type = 'concept', properties = {} } = {}) {
    const id = `ent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const entity = { id, name, type, properties, createdAt: new Date().toISOString() }
    this.entities.set(id, entity)
    this.index.set(name.toLowerCase(), id)
    return entity
  }

  /**
   * Find or create an entity.
   */
  getOrCreate(name, type = 'concept') {
    const existing = this.index.get(name.toLowerCase())
    if (existing) return this.entities.get(existing)
    return this.addEntity(name, { type })
  }

  /**
   * Add a relationship between entities.
   */
  addRelationship(fromName, toName, { type = 'relates_to', weight = 1, properties = {} } = {}) {
    const from = this.getOrCreate(fromName)
    const to = this.getOrCreate(toName)

    const rel = {
      from: from.id,
      to: to.id,
      fromName: from.name,
      toName: to.name,
      type,
      weight,
      properties,
      createdAt: new Date().toISOString(),
    }

    this.relationships.push(rel)
    return rel
  }

  /**
   * Query the graph — find connections.
   */
  query(name, { depth = 2, relationshipType = null } = {}) {
    const entityId = this.index.get(name.toLowerCase())
    if (!entityId) return { found: false, name }

    const visited = new Set()
    const results = []

    const traverse = (currentId, currentDepth) => {
      if (currentDepth > depth || visited.has(currentId)) return
      visited.add(currentId)

      for (const rel of this.relationships) {
        if (rel.from === currentId || rel.to === currentId) {
          if (relationshipType && rel.type !== relationshipType) continue

          const otherId = rel.from === currentId ? rel.to : rel.from
          const other = this.entities.get(otherId)
          const direction = rel.from === currentId ? 'outgoing' : 'incoming'

          results.push({
            entity: other?.name,
            type: other?.type,
            relationship: rel.type,
            direction,
            weight: rel.weight,
            depth: currentDepth,
          })

          traverse(otherId, currentDepth + 1)
        }
      }
    }

    traverse(entityId, 1)

    return {
      found: true,
      name,
      connections: results.sort((a, b) => a.depth - b.depth),
      totalConnections: results.length,
    }
  }

  /**
   * Find path between two entities.
   */
  findPath(fromName, toName) {
    const fromId = this.index.get(fromName.toLowerCase())
    const toId = this.index.get(toName.toLowerCase())
    if (!fromId || !toId) return { found: false }

    const visited = new Set([fromId])
    const queue = [[fromId]]

    while (queue.length > 0) {
      const path = queue.shift()
      const current = path[path.length - 1]

      if (current === toId) {
        return {
          found: true,
          path: path.map((id) => this.entities.get(id)?.name || id),
          length: path.length - 1,
          relationships: path.slice(0, -1).map((id, i) => {
            const rel = this.relationships.find(
              (r) => (r.from === id && r.to === path[i + 1]) || (r.to === id && r.from === path[i + 1])
            )
            return rel?.type || 'unknown'
          }),
        }
      }

      for (const rel of this.relationships) {
        let next = null
        if (rel.from === current && !visited.has(rel.to)) next = rel.to
        if (rel.to === current && !visited.has(rel.from)) next = rel.from

        if (next) {
          visited.add(next)
          queue.push([...path, next])
        }
      }
    }

    return { found: false }
  }

  /**
   * Infer new relationships from existing ones.
   */
  infer() {
    const newRelationships = []

    // Transitivity: if A → B and B → C, then A → C (for certain types)
    const transitiveTypes = ['is_a', 'part_of', 'causes', 'contains']

    for (const rel1 of this.relationships) {
      if (!transitiveTypes.includes(rel1.type)) continue

      for (const rel2 of this.relationships) {
        if (rel2.type !== rel1.type) continue
        if (rel1.to !== rel2.from) continue
        if (rel1.from === rel2.to) continue

        // Check if this relationship already exists
        const exists = this.relationships.some(
          (r) => r.from === rel1.from && r.to === rel2.to && r.type === rel1.type
        )

        if (!exists) {
          const from = this.entities.get(rel1.from)
          const to = this.entities.get(rel2.to)

          newRelationships.push({
            from: rel1.from,
            to: rel2.to,
            fromName: from?.name,
            toName: to?.name,
            type: rel1.type,
            weight: rel1.weight * rel2.weight * 0.8, // decay
            inferred: true,
            via: [rel1.fromName, rel2.fromName],
          })
        }
      }
    }

    // Add inferred relationships
    this.relationships.push(...newRelationships)

    return {
      inferred: newRelationships.length,
      newRelationships: newRelationships.map((r) => `${r.fromName} --${r.type}--> ${r.toName} (via ${r.via.join(', ')})`),
    }
  }

  /**
   * Get graph statistics.
   */
  getStats() {
    const typeCounts = {}
    for (const entity of this.entities.values()) {
      typeCounts[entity.type] = (typeCounts[entity.type] || 0) + 1
    }

    const relCounts = {}
    for (const rel of this.relationships) {
      relCounts[rel.type] = (relCounts[rel.type] || 0) + 1
    }

    return {
      entities: this.entities.size,
      relationships: this.relationships.length,
      entityTypes: typeCounts,
      relationshipTypes: relCounts,
      inferred: this.relationships.filter((r) => r.inferred).length,
    }
  }
}

/* ──────────────── AI-powered graph building ──────────────────────────── */

/**
 * Extract knowledge graph from text.
 */
export async function extractGraph(text, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Extract a knowledge graph from this text.

Identify:
1. Entities (people, places, concepts, organizations, dates)
2. Relationships between entities (specific, not generic)
3. Properties of entities (attributes, facts)

Respond in JSON:
{
  "entities": [
    { "name": "...", "type": "person|place|concept|org|event", "properties": {} }
  ],
  "relationships": [
    { "from": "...", "to": "...", "type": "is_a|has_a|part_of|causes|created|knows|located_in|works_at", "weight": 0.9 }
  ]
}` },
    { role: 'user', content: `Text:\n${text.slice(0, 2000)}\n\nKnowledge graph:` },
  ], { maxTokens: 1000 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, graph: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

export { KnowledgeGraph }
export default { KnowledgeGraph, extractGraph }