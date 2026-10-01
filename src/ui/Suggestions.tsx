import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'

/**
 * Rotating example commands, shown only while idle.
 *
 * A voice interface has no menus — nothing tells you what it can do. This is
 * the affordance. It disappears the moment JARVIS is doing anything, so it
 * never competes with the answer.
 *
 * Each line is phrased the way you'd actually say it, not as a feature name.
 *
 * Every one of these works with nothing installed but a local model. That is
 * the constraint worth keeping: a suggestion that needs a paid MCP server is a
 * promise the app cannot keep on a fresh machine, and the first thing a new
 * user tries should not be the one thing that fails.
 *
 * The first few deliberately reach for JARVIS's own tools — the display, the
 * camera, the interface controls — because those are built into the bridge and
 * cannot be missing. The rest need only a web search.
 */
const EXAMPLES = [
  'look at me',
  'watch me do this',
  'make the interface red',
  'show me the top story on Hacker News',
  "what's the weather looking like",
  'take a screenshot of my phone',
  'search for the best coffee near me',
  'find me a loading animation',
  'open my GitHub notifications',
  'clear the screen',
]

const ROTATE_MS = 4200

export function Suggestions() {
  const phase = useStore((s) => s.phase)
  const turns = useStore((s) => s.turns)
  const [i, setI] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % EXAMPLES.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [])

  // Only while genuinely idle, and only until the first exchange — once the
  // user knows how it works, the prompt is just clutter.
  if (phase !== 'dormant' || turns.length > 0) return null

  return (
    <div className="suggest">
      <span className="suggest-lead">try</span>
      <AnimatePresence mode="wait">
        <motion.span
          key={i}
          className="suggest-text"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35 }}
        >
          “hey jarvis, {EXAMPLES[i]}”
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
