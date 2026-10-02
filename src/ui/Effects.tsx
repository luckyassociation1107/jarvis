import { useEffect, useRef } from 'react'
import { useStore, type UiEffect } from '../store'

/**
 * One-shot frame effects, fired by JARVIS.
 *
 * These are punctuation, not state: the store owns the current event and its
 * monotonic timestamp. The component renders that event directly and clears it
 * only if the same event is still current, so an older timeout can never erase
 * a newer flourish.
 */

/** How long each effect's keyframes run. Kept in step with index.css. */
const DURATION: Record<UiEffect['kind'], number> = {
  glitch: 620,
  pulse: 900,
  scan: 900,
  shake: 520,
  flash: 480,
}

export function Effects() {
  const effect = useStore((s) => s.ui.effect)
  const clearEffect = useStore((s) => s.clearEffect)
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!effect) return
    const done = window.setTimeout(() => clearEffect(effect.at), DURATION[effect.kind] ?? 600)
    return () => window.clearTimeout(done)
  }, [effect, clearEffect])

  useEffect(() => {
    if (!effect || effect.kind !== 'shake') return
    const hud = root.current?.closest('.hud')
    if (!hud) return
    hud.classList.add('fx-shaking')
    const done = window.setTimeout(() => hud.classList.remove('fx-shaking'), DURATION.shake)
    return () => {
      window.clearTimeout(done)
      hud.classList.remove('fx-shaking')
    }
  }, [effect])

  if (!effect) return null

  return (
    <div className="fx" ref={root} aria-hidden="true">
      <div key={`${effect.kind}-${effect.at}`} className={`fx-play fx-${effect.kind}`}>
        {/* Slices for the tear, rings for the shockwave. The rest of the
            effects are a single painted layer and need no children. */}
        {effect.kind === 'glitch' && (
          <>
            <span className="fx-slice" />
            <span className="fx-slice" />
            <span className="fx-slice" />
          </>
        )}
        {effect.kind === 'pulse' && (
          <>
            <span className="fx-wave" />
            <span className="fx-wave" />
          </>
        )}
      </div>
    </div>
  )
}
