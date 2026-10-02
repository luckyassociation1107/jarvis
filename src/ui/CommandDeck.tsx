import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BRIDGE_HTTP_URL } from '../config'
import { useStore, type Phase } from '../store'
import { analyserActive, micLevel } from '../lib/audio'
import './CommandDeck.css'

const ModelManager = lazy(() => import('./ModelManager').then((module) => ({ default: module.ModelManager })))

type HealthSlot = {
  slot: string
  model?: string
  state?: string
  ok?: boolean
  note?: string | null
}

type HealthPayload = {
  ok: boolean
  summary?: string
  models?: HealthSlot[]
}

type BridgeState = {
  mode: 'checking' | 'online' | 'offline' | 'view'
  payload?: HealthPayload
}

const PHASE_LABEL: Record<Phase, string> = {
  offline: 'STANDBY',
  boot: 'INITIALISING',
  dormant: 'READY / WAKE WORD',
  waking: 'POWERING UP',
  listening: 'VOICE INPUT',
  thinking: 'INFERENCE',
  tooling: 'TOOL EXECUTION',
  speaking: 'VOICE OUTPUT',
}

const FALLBACK_SLOTS = [
  { slot: 'CHAT', hint: 'CONVERSATION MODEL' },
  { slot: 'VISION', hint: 'OPTIONAL IMAGE MODEL' },
  { slot: 'REASON', hint: 'CODE / TOOL MODEL' },
]

// Fixed decorative traces add the reference display's instrumentation density.
// They are explicitly labelled schematic and are never presented as telemetry.
function makeSchematicTrace(seed: number) {
  return Array.from({ length: 52 }, (_, index) => {
    const carrier = 0.1 + Math.abs(Math.sin(index * 0.39 + seed)) * 0.12
    const burst = Math.max(0, 1 - Math.abs(((index + seed * 3) % 17) - 8) / 1.8)
    const echo = Math.max(0, 1 - Math.abs(((index + seed * 7) % 29) - 13) / 3.4)
    return Math.min(0.96, carrier + burst * 0.66 + echo * 0.24)
  })
}

const SCHEMATIC_TRACES = [0.7, 2.1, 4.3, 5.8].map(makeSchematicTrace)

function initialBridgeMode(): BridgeState['mode'] {
  if (typeof window === 'undefined') return 'checking'
  // GitHub Pages is a static preview. Do not make the hosted page probe the
  // visitor's localhost; the local bridge is intentionally not exposed there.
  if (window.location.hostname.endsWith('.github.io')) return 'view'

  try {
    const target = new URL(BRIDGE_HTTP_URL, window.location.href)
    // An HTTPS page cannot safely poll a plain-HTTP bridge. Local development
    // works over HTTP; a remote deployment needs a separately configured HTTPS
    // bridge rather than silently downgrading the browser connection.
    if (window.location.protocol === 'https:' && target.protocol === 'http:') return 'view'
  } catch {
    return 'offline'
  }
  return 'checking'
}

function useBridgeHealth(): BridgeState {
  const [initialMode] = useState<BridgeState['mode']>(initialBridgeMode)
  const [state, setState] = useState<BridgeState>(() => ({ mode: initialMode }))

  useEffect(() => {
    if (initialMode !== 'checking') return
    let live = true
    let active: AbortController | null = null

    const poll = async () => {
      active?.abort()
      const controller = new AbortController()
      active = controller
      const timeout = window.setTimeout(() => controller.abort(), 7500)
      try {
        const response = await fetch(`${BRIDGE_HTTP_URL}/health`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`bridge ${response.status}`)
        const payload = (await response.json()) as HealthPayload
        if (live) setState({ mode: 'online', payload })
      } catch {
        if (live) setState({ mode: 'offline' })
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void poll()
    const interval = window.setInterval(() => void poll(), 10000)
    return () => {
      live = false
      active?.abort()
      window.clearInterval(interval)
    }
  }, [initialMode])

  return state
}

function PanelFrame({
  title,
  code,
  className = '',
  children,
}: {
  title: string
  code: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`deck-panel ${className}`}>
      <div className="deck-panel-head">
        <div className="deck-panel-name">
          <span className="deck-panel-code">{code}</span>
          <span>{title}</span>
        </div>
        <span className="deck-panel-menu" aria-hidden="true">•••</span>
      </div>
      <div className="deck-panel-body">{children}</div>
      <i className="deck-corner deck-corner-tl" />
      <i className="deck-corner deck-corner-br" />
    </section>
  )
}

function BrandMark() {
  return (
    <svg className="deck-brand-glyph" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 3 44 14.5v19L24 45 4 33.5v-19L24 3Z" />
      <path d="M24 10 38 18v12L24 38 10 30V18l14-8Z" />
      <path d="m24 14 9 15H15l9-15Z" />
      <circle cx="24" cy="25" r="3" />
    </svg>
  )
}

function SensorSchematic() {
  return (
    <div className="deck-sensor-figure">
      <svg viewBox="0 0 180 238" role="img" aria-label="Non-live human interface schematic">
        <defs>
          <linearGradient id="suit-line" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".9" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".18" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#suit-line)" strokeWidth="1.05" strokeLinejoin="round">
          <path d="M90 17c-10 0-16 8-16 19v11c0 8 5 14 10 17v9c-17 3-31 12-37 27l-9 28 15 6 11-26 7 39-13 42 15 6 17-38 17 38 15-6-13-42 7-39 11 26 15-6-9-28c-6-15-20-24-37-27v-9c5-3 10-9 10-17V36c0-11-6-19-16-19Z" />
          <path d="M74 44h32m-32 9h32M81 65l9 7 9-7M57 105l21 7 12-9 12 9 21-7M69 120l21 8 21-8M76 135l14 5 14-5M67 155h46m-41 13 18 8 18-8M61 189l15 2m28 0 15-2" />
          <path d="M39 126 22 150l11 8 17-20m91-12 17 24-11 8-17-20M70 187l-6 26 17 3 9-21m20-8 7 26-17 3-9-21" />
          <path d="M90 83v52m-21-20-6 23m48-23 6 23" strokeDasharray="3 4" />
          <path d="m90 93-8 11 8 11 8-11-8-11Z" strokeWidth="1.3" />
        </g>
        <g fill="currentColor" opacity=".9">
          <circle cx="90" cy="103" r="2.4" />
          <circle cx="54" cy="109" r="2" />
          <circle cx="126" cy="109" r="2" />
          <circle cx="69" cy="153" r="2" />
          <circle cx="111" cy="153" r="2" />
        </g>
        <g fill="none" stroke="currentColor" strokeOpacity=".4" strokeWidth=".7">
          <circle cx="90" cy="109" r="44" strokeDasharray="2 5" />
          <circle cx="90" cy="109" r="60" strokeDasharray="24 4 3 4" />
          <path d="M8 111h34m96 0h34M90 2v14m0 211v9" />
        </g>
        <g fill="currentColor" fontFamily="monospace" fontSize="6" letterSpacing="1.2" opacity=".65">
          <text x="6" y="106">INPUT / 01</text>
          <text x="135" y="106">CORE / 02</text>
          <text x="11" y="225">HUMAN SCHEMATIC</text>
          <text x="121" y="225">NON-LIVE</text>
        </g>
      </svg>
      <span className="deck-sensor-tag deck-sensor-tag-a">VISUAL / LAYER</span>
      <span className="deck-sensor-tag deck-sensor-tag-b">SCHEMATIC</span>
      <span className="deck-sensor-reticle" />
    </div>
  )
}

function NetworkMap() {
  return (
    <div className="deck-map-wrap">
      <svg className="deck-map" viewBox="0 0 360 112" aria-hidden="true">
        <g className="deck-map-grid">
          <path d="M0 28h360M0 56h360M0 84h360M45 0v112M90 0v112M135 0v112M180 0v112M225 0v112M270 0v112M315 0v112" />
        </g>
        <g className="deck-map-land">
          <path d="m28 25 14-10 18 2 9 9 18 3 6 10-9 6-3 11-12 2-5 14-10 7-4-11-9-6-4-17-13-5 3-9-7-7Z" />
          <path d="m87 69 11 4 8 14-5 12-5 12-7-9-1-16-7-9Z" />
          <path d="m155 23 9-7 11 4 2 9-9 5-8-3Zm8 20 13-5 16 5 8 11-6 12-12 4-7 17-9 14-7-4 2-18-10-10 3-12-10-7Z" />
          <path d="m205 24 17-10 23 2 16 8 23-4 28 8 11 11-9 10-17-3-11 9-15-1-10 12-15-3-10 10-11-7-7-14-13-3-7-12-10-4Z" />
          <path d="m277 76 17-6 13 8-4 11-13 5-14-7Z" />
        </g>
        <g className="deck-map-routes">
          <path d="M74 41Q150 2 226 38T307 44M92 78Q182 42 274 80M74 41Q84 57 92 78M226 38Q250 70 274 80" />
        </g>
        <g className="deck-map-nodes">
          <circle cx="74" cy="41" r="3" /><circle cx="226" cy="38" r="3" /><circle cx="307" cy="44" r="3" /><circle cx="92" cy="78" r="3" /><circle cx="274" cy="80" r="3" />
        </g>
      </svg>
      <div className="deck-map-caption"><span>ROUTE DIAGRAM</span><span>SCHEMATIC / NOT LIVE</span></div>
    </div>
  )
}

function RadarScale({ phase }: { phase: Phase }) {
  const ticks = useMemo(
    () =>
      Array.from({ length: 144 }, (_, i) => {
        const angle = (i * 2.5 - 90) * (Math.PI / 180)
        const major = i % 12 === 0
        const medium = i % 4 === 0
        const inner = major ? 321 : medium ? 328 : 334
        const outer = 344
        return (
          <line
            key={i}
            x1={360 + Math.cos(angle) * inner}
            y1={360 + Math.sin(angle) * inner}
            x2={360 + Math.cos(angle) * outer}
            y2={360 + Math.sin(angle) * outer}
            className={major ? 'radar-tick radar-tick-major' : medium ? 'radar-tick radar-tick-mid' : 'radar-tick'}
          />
        )
      }),
    [],
  )

  return (
    <div className={`deck-radar deck-radar-${phase}`}>
      <div className="deck-radar-sweep" />
      <svg className="deck-radar-svg" viewBox="0 0 720 720" aria-hidden="true">
        <g className="radar-rotor radar-rotor-slow">
          <circle cx="360" cy="360" r="313" className="radar-ring radar-ring-dashed" />
          <path d="M360 47A313 313 0 0 1 625 193" className="radar-arc radar-arc-bright" />
          <path d="M360 47A313 313 0 0 0 97 194" className="radar-arc" />
        </g>
        <g className="radar-rotor radar-rotor-fast">
          <circle cx="360" cy="360" r="274" className="radar-ring radar-ring-dotted" />
          <path d="M360 86A274 274 0 0 1 589 209" className="radar-arc radar-arc-short" />
          <path d="M360 86A274 274 0 0 0 127 221" className="radar-arc radar-arc-short" />
        </g>
        <circle cx="360" cy="360" r="344" className="radar-ring radar-ring-outer" />
        <circle cx="360" cy="360" r="321" className="radar-ring radar-ring-inner" />
        <circle cx="360" cy="360" r="230" className="radar-ring radar-ring-inner" />
        <circle cx="360" cy="360" r="183" className="radar-ring radar-ring-dashed" />
        <circle cx="360" cy="360" r="146" className="radar-ring radar-ring-inner" />
        <path d="M360 16v688M16 360h688" className="radar-axis" />
        <path d="M117 117 603 603M603 117 117 603" className="radar-axis radar-axis-dim" />
        {ticks}
        <g className="radar-sector-marks">
          <path d="M360 25v18m335 317h-18M360 695v-18M25 360h18" />
          <path d="M360 67v22m271 271h-22M360 653v-22M89 360h22" />
          <path d="M266 56h188M266 664h188M56 266v188M664 266v188" />
        </g>
        <g className="radar-labels">
          <text x="360" y="67">N / 000</text>
          <text x="641" y="364">E / 090</text>
          <text x="360" y="664">S / 180</text>
          <text x="78" y="364">W / 270</text>
          <text x="360" y="121">REACTOR ARRAY</text>
          <text x="360" y="607">J.A.R.V.I.S. // LOCAL NODE</text>
        </g>
        <g className="radar-targets">
          <circle cx="471" cy="243" r="5" /><circle cx="471" cy="243" r="13" />
          <circle cx="247" cy="439" r="4" /><circle cx="247" cy="439" r="11" />
          <path d="m525 353 7 7-7 7-7-7 7-7Zm-177-198 6 6-6 6-6-6 6-6Z" />
        </g>
      </svg>
      <div className="deck-radar-center" aria-hidden="true">
        <span className="deck-radar-center-kicker">CORE / {phase === 'offline' ? 'DORMANT' : 'ACTIVE'}</span>
        <span className="deck-radar-center-line" />
        <span className="deck-radar-center-code">JARVIS-01</span>
      </div>
      <div className="deck-radar-callout deck-radar-callout-left"><i />GRID / VISUAL 01</div>
      <div className="deck-radar-callout deck-radar-callout-right">AXIS / 360°<i /></div>
      <div className="deck-radar-coordinate">RADIAL DISPLAY <span>·</span> VISUAL LAYER / NOT A SENSOR</div>
    </div>
  )
}

function TraceGraph({
  samples,
  max,
  label,
}: {
  samples: number[]
  max: number
  label: string
}) {
  const points = useMemo(() => {
    if (!samples.length) return ''
    const range = Math.max(max, 1)
    return samples.map((sample, index) => {
      const x = samples.length <= 1 ? 260 : (index / (samples.length - 1)) * 260
      const y = 42 - (Math.min(Math.max(sample, 0), range) / range) * 34
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }, [max, samples])
  const last = samples[samples.length - 1] ?? 0
  const lastY = 42 - (Math.min(Math.max(last, 0), Math.max(max, 1)) / Math.max(max, 1)) * 34

  return (
    <svg className="deck-trace-graph" role="img" viewBox="0 0 260 48" preserveAspectRatio="none" aria-label={label}>
      <path d="M0 10H260M0 24H260M0 38H260" className="deck-trace-grid" />
      {points && <path d={`M0 43 L${points} L260 43 Z`} className="deck-trace-area" />}
      {points && <polyline points={points} className="deck-trace-line" />}
      {points && <circle cx="260" cy={lastY} r="2.1" className="deck-trace-dot" />}
    </svg>
  )
}

function SchematicTracePanel({
  title,
  code,
  samples,
  label,
  className = '',
}: {
  title: string
  code: string
  samples: number[]
  label: string
  className?: string
}) {
  return (
    <PanelFrame title={title} code={code} className={`deck-panel-mini deck-mini-schematic ${className}`}>
      <div className="deck-mini-readout">
        <span>ILLUSTRATIVE TRACE</span>
        <strong>STATIC<small> / NOT LIVE</small></strong>
      </div>
      <TraceGraph samples={samples} max={1} label={`${label}; illustrative schematic, not live telemetry`} />
      <div className="deck-mini-foot"><span>SCHEMATIC / NOT LIVE</span><span>NO SENSOR DATA</span></div>
    </PanelFrame>
  )
}

function StatusLine({
  label,
  value,
  active,
}: {
  label: string
  value: string
  active?: boolean
}) {
  return (
    <div className="deck-status-line">
      <span className={`deck-led ${active ? 'deck-led-on' : ''}`} />
      <span className="deck-status-label">{label}</span>
      <span className="deck-status-value">{value}</span>
    </div>
  )
}

function TopologyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="deck-host-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

type HostProfile = { cores: string; memory: string; network: string; webgl: string }

const EMPTY_HOST: HostProfile = { cores: '—', memory: '—', network: '—', webgl: 'CHECKING' }

type NavigatorProfile = Navigator & {
  deviceMemory?: number
  connection?: { effectiveType?: string }
}

function currentNetworkLabel(nav = navigator as NavigatorProfile) {
  if (!navigator.onLine) return 'OFFLINE'
  return nav.connection?.effectiveType?.toUpperCase() ?? 'ONLINE'
}

function useHostProfile(): HostProfile {
  const [host, setHost] = useState<HostProfile>(EMPTY_HOST)

  useEffect(() => {
    const nav = navigator as NavigatorProfile
    const updateNetwork = () => setHost((current) => ({ ...current, network: currentNetworkLabel(nav) }))
    const frame = window.requestAnimationFrame(() => {
      const canvas = document.createElement('canvas')
      let webgl = false
      try {
        webgl = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
      } catch {
        webgl = false
      }
      setHost({
        cores: nav.hardwareConcurrency ? String(nav.hardwareConcurrency).padStart(2, '0') : '—',
        memory: nav.deviceMemory ? `~${nav.deviceMemory} GB` : 'PRIVATE',
        network: currentNetworkLabel(nav),
        webgl: webgl ? 'READY' : 'UNAVAILABLE',
      })
    })
    window.addEventListener('online', updateNetwork)
    window.addEventListener('offline', updateNetwork)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('online', updateNetwork)
      window.removeEventListener('offline', updateNetwork)
    }
  }, [])

  return host
}

function CommandDeckView({ onStart }: { onStart: () => void }) {
  const phase = useStore((s) => s.phase)
  const connected = useStore((s) => s.connected)
  const turns = useStore((s) => s.turns.length)
  const activeTool = useStore((s) => s.activeTool)
  const error = useStore((s) => s.error)
  const voice = useStore((s) => s.voice)
  const gestures = useStore((s) => s.gestures)
  const looking = useStore((s) => s.looking)
  const ui = useStore((s) => s.ui)
  const bridge = useBridgeHealth()
  const modelManagerOpen = useStore((s) => s.modelManagerOpen)
  const setModelManagerOpen = useStore((s) => s.setModelManagerOpen)
  const closeModelManager = useCallback(() => setModelManagerOpen(false), [setModelManagerOpen])

  const [clock, setClock] = useState('00:00:00')
  const [fps, setFps] = useState(0)
  const [mic, setMic] = useState(0)
  const [micMonitoring, setMicMonitoring] = useState(false)
  const [micHistory, setMicHistory] = useState<number[]>([])
  const [fpsHistory, setFpsHistory] = useState<number[]>([])
  const host = useHostProfile()
  const micPct = Math.round(mic * 100)

  useEffect(() => {
    const tickClock = () => {
      const now = new Date()
      setClock(new Intl.DateTimeFormat(undefined, {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(now))
    }
    tickClock()
    const id = window.setInterval(tickClock, 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const openModelStack = (event: KeyboardEvent) => {
      const target = event.target
      const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      if (typing || useStore.getState().commandPaletteOpen || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        const current = useStore.getState()
        current.setModelManagerOpen(!current.modelManagerOpen)
      }
    }
    window.addEventListener('keydown', openModelStack)
    return () => window.removeEventListener('keydown', openModelStack)
  }, [])

  useEffect(() => {
    const update = () => {
      const active = analyserActive()
      setMicMonitoring((current) => current === active ? current : active)
      if (active) {
        // Read the input analyser directly. The reactor's shared level switches
        // to JARVIS's speaker output while he talks, which is not microphone data.
        const level = micLevel()
        setMic(level)
        setMicHistory((history) => [...history.slice(-51), level])
      } else {
        setMic(0)
        setMicHistory((history) => history.length ? [] : history)
      }
    }
    update()
    const id = window.setInterval(update, 90)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let raf = 0
    let frames = 0
    let start = performance.now()
    const sample = (now: number) => {
      frames += 1
      if (now - start >= 1000) {
        const measured = Math.round((frames * 1000) / (now - start))
        setFps(measured)
        setFpsHistory((history) => [...history.slice(-51), measured])
        frames = 0
        start = now
      }
      raf = requestAnimationFrame(sample)
    }
    raf = requestAnimationFrame(sample)
    return () => cancelAnimationFrame(raf)
  }, [])

  const bridgeLabel =
    bridge.mode === 'view' ? 'STATIC VIEW' :
    bridge.mode === 'checking' ? 'SCANNING' :
    bridge.mode === 'online' ? 'BRIDGE LINK' : 'NO BRIDGE'
  const bridgeOn = bridge.mode === 'online'
  const healthModels = bridge.payload?.models ?? []
  const slots = healthModels.length
    ? healthModels.map((item) => ({
        name: item.slot.toUpperCase(),
        detail: item.model ?? item.note ?? 'MODEL SLOT',
        ready: item.ok ?? item.state === 'ready',
        state: item.state,
      }))
    : FALLBACK_SLOTS.map((item) => ({
        name: item.slot,
        detail: bridge.mode === 'view' ? 'LOCAL RUNTIME NOT EXPOSED' : item.hint,
        ready: false,
        state: undefined as string | undefined,
      }))

  return (
    <div className={`command-deck phase-${phase}${modelManagerOpen ? ' model-manager-open' : ''}`} role="region" aria-label="JARVIS tactical command interface">
      <div className="deck-screen-grid" aria-hidden="true" />
      <div className="deck-frame" aria-hidden="true">
        <i className="deck-frame-corner deck-frame-tl" />
        <i className="deck-frame-corner deck-frame-tr" />
        <i className="deck-frame-corner deck-frame-bl" />
        <i className="deck-frame-corner deck-frame-br" />
      </div>

      <header className="deck-header">
        {ui.chrome.brand && (
          <div className="deck-brand">
            <BrandMark />
            <div className="deck-brand-copy">
              <span className="deck-brand-overline">LOCAL-FIRST INTELLIGENCE</span>
              <strong>COMMAND NODE / 01</strong>
              <span className="deck-brand-sub">TACTICAL INTERFACE <i /> BROWSER CLIENT</span>
            </div>
          </div>
        )}
        <div className="deck-masthead" aria-hidden="true">
          <span>LOCAL INTELLIGENCE / TACTICAL DISPLAY</span>
          <strong>J.A.R.V.I.S.</strong>
          <i />
        </div>
        <div className="deck-head-state">
          <div className="deck-clock-block">
            <span>LOCAL TIME / {Intl.DateTimeFormat().resolvedOptions().timeZone?.replace('_', ' ') || 'SYSTEM'}</span>
            <strong>{clock}</strong>
          </div>
          <div className="deck-link-state">
            <i className={bridgeOn ? 'deck-led deck-led-on' : 'deck-led'} />
            <span><b>{bridgeLabel}</b><small>{bridge.mode === 'view' ? 'HOSTED FRONT-END / NO BRIDGE' : bridgeOn ? (bridge.payload?.summary ?? 'LOCAL RUNTIME READY') : 'WAITING FOR LOCAL RUNTIME'}</small></span>
          </div>
        </div>
      </header>

      <main className="deck-main">
        {ui.chrome.systems && (
          <aside className="deck-side deck-side-left" aria-label="System diagnostics">
            <PanelFrame title="INTERFACE SCHEMATIC" code="01" className="deck-panel-sensor">
              <SensorSchematic />
              <div className="deck-status-stack">
                <StatusLine label="VOICE CHANNEL" value={phase === 'listening' ? 'RECEIVING' : phase === 'offline' ? 'STANDBY' : phase === 'boot' ? 'BOOTING' : phase === 'waking' ? 'WAKING' : 'ARMED'} active={phase !== 'offline'} />
                <StatusLine label="LOCAL BRIDGE" value={bridge.mode === 'online' ? 'ONLINE' : bridge.mode === 'view' ? 'LOCAL ONLY' : bridge.mode === 'checking' ? 'SCANNING' : 'OFFLINE'} active={bridgeOn} />
                <StatusLine label="MCP SYSTEMS" value={connected.length ? String(connected.length).padStart(2, '0') + ' LINKED' : 'AWAITING'} active={connected.length > 0} />
              </div>
            </PanelFrame>

            <PanelFrame title="HOST PROFILE" code="02" className="deck-panel-host">
              <div className="deck-host-grid">
                <TopologyMetric label="LOGICAL CORES" value={host.cores} />
                <TopologyMetric label="MEMORY EST." value={host.memory} />
                <TopologyMetric label="RENDER LOOP" value={`${fps || '—'} FPS`} />
                <TopologyMetric label="WEBGL STATUS" value={host.webgl} />
              </div>
              <div className="deck-host-foot"><span>NETWORK</span><b>{host.network}</b><i className={navigator.onLine ? 'deck-led deck-led-on' : 'deck-led'} /></div>
            </PanelFrame>

          </aside>
        )}

        <section className="deck-center" aria-label="Core reactor visualization">
          <div className="deck-center-head"><span><i />REACTOR ARRAY</span><span>AXIS / 00-360</span></div>
          <RadarScale phase={phase} />
          <div className="deck-center-data deck-center-data-left"><span>ENGINE STATE</span><b>{PHASE_LABEL[phase]}</b></div>
          <div className="deck-center-data deck-center-data-right"><span>FRAME SYNC</span><b>{fps || '—'} FPS</b><i className="deck-data-bars deck-frame-bars">{Array.from({ length: 6 }, (_, index) => <i key={index} style={{ height: `${Math.max(8, Math.min(100, (fps / 60) * (45 + index * 10)))}%` }} />)}</i></div>
          <div className="deck-center-foot"><span>PHASE / {PHASE_LABEL[phase]}</span><span>SESSION / {String(turns).padStart(3, '0')}</span></div>
        </section>

        <aside className="deck-side deck-side-right" aria-label="Live telemetry">
          <PanelFrame title="INPUT / AUDIO TRACE" code="04" className="deck-panel-mini deck-mini-audio">
            <div className="deck-mini-readout"><span>{micMonitoring ? 'MIC LEVEL / LIVE' : 'MIC LEVEL / NO LOCAL METER'}</span><strong>{micMonitoring ? String(micPct).padStart(3, '0') : '—'}<small>{micMonitoring ? '%' : ' N/A'}</small></strong></div>
            <TraceGraph samples={micMonitoring ? micHistory : []} max={1} label={micMonitoring ? 'Recent measured microphone level samples' : 'No active microphone analyser; no live trace is shown'} />
            <div className="deck-mini-foot"><span>{micMonitoring ? (phase === 'listening' ? 'CAPTURING VOICE' : 'BROWSER INPUT') : 'LOCAL METER INACTIVE'}</span><span>{micMonitoring ? '0–100%' : 'NO DATA'}</span></div>
          </PanelFrame>

          <PanelFrame title="RENDER / FRAME TRACE" code="05" className="deck-panel-mini deck-mini-render">
            <div className="deck-mini-readout"><span>MEASURED FRAME RATE</span><strong>{fps || '—'}<small> FPS</small></strong></div>
            <TraceGraph samples={fpsHistory} max={120} label="Recent measured animation frame rate" />
            <div className="deck-mini-foot"><span>REQUEST ANIMATION FRAME</span><span>0–120 FPS</span></div>
          </PanelFrame>

          <SchematicTracePanel
            title="VISION / EDGE PROFILE"
            code="06"
            samples={SCHEMATIC_TRACES[0]}
            label="Vision edge profile"
            className="deck-mini-vision"
          />
          <SchematicTracePanel
            title="WHISPER / SPECTRAL GATE"
            code="07"
            samples={SCHEMATIC_TRACES[1]}
            label="Optional Whisper spectral gate"
            className="deck-mini-whisper"
          />
          <SchematicTracePanel
            title="INTENT / ROUTING TRACE"
            code="08"
            samples={SCHEMATIC_TRACES[2]}
            label="Multilingual intent routing"
            className="deck-mini-intent"
          />
          <SchematicTracePanel
            title="AUTOPILOT / RESOURCE CURVE"
            code="09"
            samples={SCHEMATIC_TRACES[3]}
            label="RAM-aware model autopilot"
            className="deck-mini-autopilot"
          />
        </aside>
      </main>

      <section className="deck-bottom-band" aria-label="System routing and session data">
        <PanelFrame title="ROUTE DIAGRAM / SCHEMATIC" code="09" className="deck-bottom-panel deck-bottom-route">
          <NetworkMap />
        </PanelFrame>

        <PanelFrame title="LOCAL MODEL ROUTING MATRIX" code="10" className="deck-bottom-panel deck-bottom-models">
          <div className="deck-matrix-head"><span>ROUTE</span><span>MODEL / CONFIGURATION</span><span>STATE</span></div>
          <div className="deck-matrix-rows">
            {slots.map((slot) => (
              <div className="deck-matrix-row" key={slot.name}>
                <b>{slot.name}</b>
                <span title={slot.detail}>{slot.detail}</span>
                <strong className={slot.ready ? 'deck-matrix-ready' : ''}>
                  {bridge.mode === 'view' ? 'LOCAL ONLY' : bridge.mode === 'online' ? (slot.ready ? 'READY' : slot.state === 'unsupported' ? 'RAM LIMIT' : slot.state === 'unknown' ? 'OFFLINE' : 'MISSING') : bridge.mode === 'checking' ? 'CHECKING' : 'NO LINK'}
                </strong>
              </div>
            ))}
          </div>
          <div className="deck-matrix-foot"><span>ROUTING / LOCAL-FIRST</span><span>{bridge.payload?.summary ?? (bridge.mode === 'view' ? 'STATIC WEB VIEW' : 'AWAITING BRIDGE HEALTH')}</span></div>
        </PanelFrame>

        <PanelFrame title="CONNECTED SYSTEMS" code="11" className="deck-bottom-panel deck-bottom-links">
          <div className="deck-link-list">
            {connected.length ? connected.map((name) => (
              <div className="deck-link-chip" key={name}><i className="deck-led deck-led-on" /><span>{name}</span><b>LINKED</b></div>
            )) : <div className="deck-link-empty"><i className="deck-led" />NO MCP CONNECTIONS REPORTED</div>}
          </div>
          <div className="deck-matrix-foot"><span>ACTIVE INTEGRATIONS</span><span>{String(connected.length).padStart(2, '0')}</span></div>
        </PanelFrame>

        <PanelFrame title="LIVE EVENT REGISTER" code="12" className="deck-bottom-panel deck-bottom-events">
          <div className="deck-register-grid">
            <div><span>LOCAL TIME</span><b>{clock}</b></div>
            <div><span>SESSION ITEMS</span><b>{String(turns).padStart(3, '0')}</b></div>
            <div><span>ACTIVE TOOL</span><b>{activeTool ? activeTool.replace(/[_-]/g, ' ').toUpperCase() : 'NONE'}</b></div>
            <div><span>PHASE</span><b>{PHASE_LABEL[phase]}</b></div>
          </div>
          {error && <div className="deck-register-alert"><i>!</i>{error}</div>}
        </PanelFrame>
      </section>

      <footer className="deck-footer">
        <div className="deck-footer-brand"><span className="deck-footer-emblem">J</span><span>J.A.R.V.I.S. / CLIENT</span><i />LOCAL-FIRST SESSION</div>
        <div className="deck-footer-center"><span className="deck-footer-line" /><span>{phase === 'offline' ? 'VOICE STANDBY / TEXT CHAT READY' : phase === 'dormant' ? 'SAY “HEY JARVIS”' : PHASE_LABEL[phase]}</span><span className="deck-footer-line" /></div>
        <div className="deck-footer-actions">
          {phase === 'offline' ? (
            <button className="deck-power-button" type="button" onClick={onStart}>
              <i className="deck-power-glyph" /> INITIALISE SYSTEM
            </button>
          ) : (
            <>
              <span><kbd>SPACE</kbd> TALK</span>
              <span><kbd>G</kbd> {gestures ? 'STOP HANDS' : 'HANDS'}{looking ? ' / LOOKING' : ''}</span>
              {voice && <span className="deck-voice-hint"><kbd>V</kbd> {voice.replace(/\(.*?\)/g, '').trim()}</span>}
              <button type="button" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))}>
                <kbd>D</kbd> DIAGNOSTICS
              </button>
              <span><kbd>ESC</kbd> STANDBY</span>
            </>
          )}
          <button
            className="deck-model-stack-button"
            type="button"
            aria-expanded={modelManagerOpen}
            onClick={() => setModelManagerOpen(!modelManagerOpen)}
          >
            <kbd>M</kbd> {modelManagerOpen ? 'CLOSE STACK' : 'MODEL STACK'}
          </button>
        </div>
      </footer>
      {modelManagerOpen && (
        <Suspense fallback={null}>
          <ModelManager onClose={closeModelManager} />
        </Suspense>
      )}
    </div>
  )
}

export const CommandDeck = memo(CommandDeckView)
