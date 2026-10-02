import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { diag } from '../lib/hands'

/**
 * What your hands can do.
 *
 * A touchless interface has the same problem a voice interface has: no menus,
 * no buttons, nothing on screen that tells you what is possible. The
 * suggestions strip solves that for speech, and this is its equivalent for
 * hands — shown when the camera comes on, when you would actually be wondering.
 *
 * It fades once you have used it. A legend that stays up forever is clutter,
 * and the moment you have successfully pinched something you no longer need to
 * be told how; but it comes back whenever the camera is turned on again. Hud
 * keys this component to the camera session, so each explicit opt-in starts a
 * fresh, un-dismissed guide without resetting React state from an effect.
 */

const MOVES: { gesture: string; hand: string; does: string }[] = [
  { gesture: 'point', hand: '☝', does: 'move the cursor' },
  { gesture: 'pinch', hand: '🤏', does: 'grab a blade · move it · press' },
  { gesture: 'open', hand: '🖐', does: 'let go' },
  { gesture: 'peace', hand: '✌', does: 'two fingers up-down to scroll' },
  { gesture: 'frame', hand: '📐', does: 'two L-corners to resize' },
]

/** How long the legend stays after the first successful press. */
const DISMISS_MS = 1400

export function GestureGuide({ live }: { live: boolean }) {
  const [dismissed, setDismissed] = useState(false)
  const used = useRef(false)
  const show = live && !dismissed

  useEffect(() => {
    if (!live) return
    let dismissTimer = 0

    // Polled rather than subscribed: the tracker publishes a plain mutable
    // object on purpose, so that the loop's timing is not at the mercy of
    // React. Four times a second is plenty to notice a first pinch.
    const poll = window.setInterval(() => {
      if (used.current || !diag.gesture.includes('pinch')) return
      used.current = true
      dismissTimer = window.setTimeout(() => setDismissed(true), DISMISS_MS)
    }, 250)

    return () => {
      window.clearInterval(poll)
      if (dismissTimer) window.clearTimeout(dismissTimer)
    }
  }, [live])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="gguide"
          initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 8, filter: 'blur(6px)', transition: { duration: 0.5 } }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        >
          <div className="gguide-head">HAND CONTROL</div>
          {MOVES.map((m) => (
            <div key={m.gesture} className="gguide-row">
              <span className="gguide-icon">{m.hand}</span>
              <span className="gguide-name">{m.gesture}</span>
              <span className="gguide-does">{m.does}</span>
            </div>
          ))}
          <div className="gguide-foot">
            grab a blade by its bar · <kbd>G</kbd> to stop
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
