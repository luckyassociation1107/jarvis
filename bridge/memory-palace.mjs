/**
 * JARVIS Memory Palace — spatial memory, just like ancient Greeks.
 *
 * Instead of storing memories as flat lists, organize them in a
 * VIRTUAL SPACE — a 3D palace you can walk through.
 *
 * Each room = a topic. Each wall = a subtopic. Each object = a memory.
 *
 * When you need to recall something, JARVIS "walks" to the right room,
 * looks at the right wall, and finds the memory on the right object.
 *
 * This is the ACTUAL memory technique used by memory champions.
 * Now your AI uses it too.
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Palace structure ──────────────────────────── */

class MemoryPalace {
  constructor() {
    this.rooms = new Map()      // topic → Room
    this.spatialIndex = new Map() // keyword → [{room, wall, object}]
    this.pathHistory = []       // navigation history
  }

  /**
   * Create a new room in the palace.
   */
  createRoom(topic, { description = '', capacity = 50 } = {}) {
    const room = {
      id: `room-${Date.now()}`,
      topic,
      description,
      capacity,
      walls: new Map(),
      objects: [],
      connections: [], // to other rooms
      createdAt: new Date().toISOString(),
    }
    this.rooms.set(topic, room)
    return room
  }

  /**
   * Place a memory as an object in a room on a specific wall.
   */
  placeMemory(topic, wall, memory, { keywords = [], importance = 5 } = {}) {
    if (!this.rooms.has(topic)) {
      this.createRoom(topic)
    }

    const room = this.rooms.get(topic)

    if (!room.walls.has(wall)) {
      room.walls.set(wall, [])
    }

    const obj = {
      id: `obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      memory,
      wall,
      keywords,
      importance,
      lastAccessed: new Date().toISOString(),
      accessCount: 0,
      position: room.walls.get(wall).length, // position on wall
    }

    room.walls.get(wall).push(obj)
    room.objects.push(obj)

    // Update spatial index
    for (const kw of keywords) {
      const existing = this.spatialIndex.get(kw) || []
      existing.push({ room: topic, wall, objectId: obj.id })
      this.spatialIndex.set(kw, existing)
    }

    return obj
  }

  /**
   * Recall a memory by walking through the palace.
   */
  recall(query, { llm = complete } = {}) {
    // First, try spatial index (fast path)
    const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    const directHits = []

    for (const kw of keywords) {
      const refs = this.spatialIndex.get(kw) || []
      for (const ref of refs) {
        const room = this.rooms.get(ref.room)
        if (!room) continue
        const obj = room.objects.find((o) => o.id === ref.objectId)
        if (obj) {
          obj.accessCount++
          obj.lastAccessed = new Date().toISOString()
          directHits.push({ room: ref.room, wall: ref.wall, memory: obj.memory, importance: obj.importance })
        }
      }
    }

    if (directHits.length > 0) {
      return {
        method: 'spatial_index',
        hits: directHits.sort((a, b) => b.importance - a.importance),
        query,
      }
    }

    // Fallback: walk through rooms
    const roomTopics = Array.from(this.rooms.keys())
    return {
      method: 'browse',
      rooms: roomTopics,
      query,
      suggestion: `No direct match. Available rooms: ${roomTopics.join(', ')}`,
    }
  }

  /**
   * Connect two rooms (create a hallway).
   */
  connectRooms(topic1, topic2, { relationship = 'related' } = {}) {
    const room1 = this.rooms.get(topic1)
    const room2 = this.rooms.get(topic2)
    if (!room1 || !room2) return { ok: false, error: 'Room not found' }

    room1.connections.push({ to: topic2, relationship })
    room2.connections.push({ to: topic1, relationship })

    return { ok: true, connection: `${topic1} ↔ ${topic2}` }
  }

  /**
   * Get the full palace map.
   */
  getMap() {
    const map = []
    for (const [topic, room] of this.rooms) {
      map.push({
        topic,
        description: room.description,
        walls: Array.from(room.walls.entries()).map(([wall, objs]) => ({
          wall,
          objects: objs.length,
          items: objs.map((o) => ({ memory: o.memory.slice(0, 80), keywords: o.keywords })),
        })),
        connections: room.connections,
        totalObjects: room.objects.length,
      })
    }
    return map
  }

  /**
   * Navigate the palace — walk from room to room.
   */
  navigate(from, to) {
    this.pathHistory.push({ from, to, timestamp: new Date().toISOString() })

    const room = this.rooms.get(from)
    if (!room) return { ok: false, error: `Room "${from}" not found` }

    // Direct connection?
    const direct = room.connections.find((c) => c.to === to)
    if (direct) {
      return { ok: true, path: [from, to], relationship: direct.relationship }
    }

    // BFS pathfinding
    const visited = new Set([from])
    const queue = [[from]]

    while (queue.length > 0) {
      const path = queue.shift()
      const current = path[path.length - 1]
      const currentRoom = this.rooms.get(current)

      if (!currentRoom) continue

      for (const conn of currentRoom.connections) {
        if (conn.to === to) {
          return { ok: true, path: [...path, to] }
        }
        if (!visited.has(conn.to)) {
          visited.add(conn.to)
          queue.push([...path, conn.to])
        }
      }
    }

    return { ok: false, error: `No path from "${from}" to "${to}"` }
  }

  /**
   * Get palace statistics.
   */
  getStats() {
    let totalObjects = 0
    let totalWalls = 0
    for (const room of this.rooms.values()) {
      totalObjects += room.objects.length
      totalWalls += room.walls.size
    }

    return {
      rooms: this.rooms.size,
      walls: totalWalls,
      objects: totalObjects,
      keywords: this.spatialIndex.size,
      connections: Array.from(this.rooms.values()).reduce((sum, r) => sum + r.connections.length, 0) / 2,
    }
  }
}

/* ──────────────── AI-powered palace organization ──────────────────────────── */

/**
 * Use AI to organize a memory into the palace.
 */
export async function organizeMemory(palace, memory, { llm = complete } = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Decide where to place a memory in a Memory Palace.

Available rooms: ${Array.from(palace.rooms.keys()).join(', ') || 'none yet'}

Decide:
1. Which room (topic) it belongs to (or create a new one)
2. Which wall (subtopic) within that room
3. Keywords for retrieval
4. Importance (1-10)
5. Connections to other rooms

Respond in JSON:
{
  "room": "topic name",
  "wall": "subtopic",
  "keywords": ["kw1", "kw2"],
  "importance": 7,
  "connections": ["other topic"],
  "new_room": false
}` },
    { role: 'user', content: `Memory to place: "${memory}"` },
  ], { maxTokens: 300 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    const decision = JSON.parse(response.slice(start, end + 1))

    // Place the memory
    const obj = palace.placeMemory(decision.room, decision.wall, memory, {
      keywords: decision.keywords || [],
      importance: decision.importance || 5,
    })

    // Create connections
    if (decision.connections) {
      for (const conn of decision.connections) {
        palace.connectRooms(decision.room, conn)
      }
    }

    return { ok: true, decision, objectId: obj.id }
  } catch {
    // Default placement
    const obj = palace.placeMemory('Uncategorized', 'General', memory, { keywords: memory.split(/\s+/).slice(0, 5) })
    return { ok: true, decision: { room: 'Uncategorized', wall: 'General' }, objectId: obj.id }
  }
}

export { MemoryPalace }
export default { MemoryPalace, organizeMemory }