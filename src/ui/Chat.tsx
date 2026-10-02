import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BRIDGE_HTTP_URL } from '../config'
import { useStore, type Phase } from '../store'
import './Chat.css'

type ChatProps = {
  onSend: (message: string) => Promise<void>
}

type RuntimeSlot = {
  id?: string
  slot?: string
  model?: string | null
  state?: string
  fits?: boolean
}

type RuntimeSnapshot = {
  ram?: {
    totalGb?: number
    effectiveModelGb?: number
    currentFreeGb?: number
  }
  fits?: RuntimeSlot[]
  modelSlots?: RuntimeSlot[]
  ollama?: boolean
}

const PROMPT_IDEAS = [
  'What can you help me with?',
  'Explain this project simply.',
  'Give me three ideas for using JARVIS.',
]

const PHASE_STATUS: Record<Phase, string> = {
  offline: 'VOICE STANDBY / TEXT READY',
  boot: 'SYSTEM STARTUP',
  dormant: 'READY / WAKE WORD',
  waking: 'WAKE SEQUENCE',
  listening: 'VOICE INPUT / LIVE',
  thinking: 'LOCAL INFERENCE',
  tooling: 'TOOL EXECUTION',
  speaking: 'VOICE OUTPUT',
}

function formatLatency(milliseconds: number) {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(1)} s`
}

function ChatGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 5.75A2.75 2.75 0 0 1 7.25 3h9.5a2.75 2.75 0 0 1 2.75 2.75v7.5A2.75 2.75 0 0 1 16.75 16h-5.1l-4.4 3.2c-.62.45-1.5.01-1.5-.76V16.8a2.75 2.75 0 0 1-1.25-2.3v-8.75Z" />
      <path d="M8 8.5h8M8 11.5h5" />
    </svg>
  )
}

function SendGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12 20 4l-5.8 16-2.5-6.2L4 12Z" />
      <path d="m11.7 13.8 4-4" />
    </svg>
  )
}

function pageCannotReachLocalBridge() {
  if (typeof window === 'undefined') return true
  if (window.location.hostname.endsWith('.github.io')) return true
  try {
    const endpoint = new URL(BRIDGE_HTTP_URL, window.location.href)
    return window.location.protocol === 'https:' && endpoint.protocol === 'http:'
  } catch {
    return true
  }
}

function slotFor(snapshot: RuntimeSnapshot | null, key: string) {
  return snapshot?.modelSlots?.find((slot) => slot.slot === key)
    ?? snapshot?.fits?.find((slot) => slot.id === key)
}

export function Chat({ onSend }: ChatProps) {
  const turns = useStore((s) => s.turns)
  const phase = useStore((s) => s.phase)
  const activeTool = useStore((s) => s.activeTool)
  const error = useStore((s) => s.error)
  const open = useStore((s) => s.chatOpen)
  const setOpen = useStore((s) => s.setChatOpen)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [localError, setLocalError] = useState('')
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null)
  const [telemetryState, setTelemetryState] = useState<'checking' | 'online' | 'offline'>('checking')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const blocked = useMemo(() => pageCannotReachLocalBridge(), [])
  // Chat can intentionally replace an in-flight voice turn. Only serialize
  // typed sends against another typed send; keep overall phase activity for
  // the status display without locking the composer.
  const chatBusy = sending
  const sessionBusy = chatBusy || phase === 'thinking' || phase === 'tooling' || phase === 'speaking'
  const booting = phase === 'boot'
  const lastTurn = turns[turns.length - 1]
  const waitingForReply = chatBusy && lastTurn?.role !== 'jarvis'
  const chatPlan = slotFor(snapshot, 'chat')
  const chatModel = chatPlan?.model ?? null
  const chatModelState = chatPlan?.state
    ?? (chatPlan?.fits === true ? 'selected' : chatPlan?.fits === false ? 'not-fit' : 'unknown')
  const ram = snapshot?.ram

  useEffect(() => {
    if (!open) return
    let live = true
    let polling = false
    let activeController: AbortController | null = null

    const poll = async () => {
      if (polling) return
      polling = true
      const controller = new AbortController()
      activeController = controller
      const timeout = window.setTimeout(() => controller.abort(), 6500)
      try {
        const response = await fetch(`${BRIDGE_HTTP_URL}/autopilot`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(String(data.error ?? `Bridge returned HTTP ${response.status}`))
        if (live) {
          setSnapshot(data as RuntimeSnapshot)
          setTelemetryState('online')
        }
      } catch {
        if (live) {
          setSnapshot(null)
          setTelemetryState('offline')
        }
      } finally {
        window.clearTimeout(timeout)
        if (activeController === controller) activeController = null
        polling = false
      }
    }

    if (!blocked) {
      void poll()
      const interval = window.setInterval(() => void poll(), 20_000)
      return () => {
        live = false
        window.clearInterval(interval)
        activeController?.abort()
      }
    }
    return () => {
      live = false
    }
  }, [open, blocked])

  useEffect(() => {
    if (open) {
      const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
      return () => window.cancelAnimationFrame(frame)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const { commandPaletteOpen, modelManagerOpen } = useStore.getState()
      if (event.key !== 'Escape' || commandPaletteOpen || modelManagerOpen) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [open, turns, sending])

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const message = draft.trim()
    if (!message || chatBusy || booting) return

    setDraft('')
    setLocalError('')
    setSending(true)
    try {
      await onSend(message)
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'The message could not be sent.'
      setLocalError(reason)
      setDraft((current) => current || message)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const copyAnswer = async (id: string, text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.')
      await navigator.clipboard.writeText(text)
      setCopiedTurnId(id)
      setLocalError('')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not copy this answer.')
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  const bridgeLabel = blocked
    ? 'HOSTED / LOCAL LINK BLOCKED'
    : telemetryState === 'checking'
      ? 'SCANNING LOCAL BRIDGE'
      : telemetryState === 'online'
        ? 'BRIDGE API ONLINE'
        : 'BRIDGE OFFLINE'
  const chatSlotLabel = blocked
    ? 'LOCAL MODEL / PRIVATE'
    : telemetryState === 'offline'
      ? 'NO LIVE MODEL STATUS'
      : chatModelState === 'ready'
        ? 'MODEL READY'
        : chatModelState === 'missing'
          ? 'MODEL NOT INSTALLED'
          : chatModelState === 'unsupported' || chatModelState === 'not-fit'
            ? 'NO RAM-FIT MODEL'
            : chatModelState === 'selected'
              ? 'SELECTED / STATUS UNKNOWN'
              : 'MODEL STATUS UNKNOWN'
  const sessionStatus = activeTool ? `RUNNING / ${activeTool}` : PHASE_STATUS[phase]

  return (
    <div className="chat-layer">
      <button
        className={`chat-launcher${open ? ' chat-launcher-open' : ''}`}
        type="button"
        aria-expanded={open}
        aria-controls="jarvis-chat-window"
        onClick={() => setOpen(!open)}
      >
        <ChatGlyph />
        <span className="chat-launcher-copy">
          <strong>{open ? 'CLOSE CHAT' : 'TEXT CHAT'}</strong>
          <small>NO MICROPHONE NEEDED</small>
        </span>
        <span className="chat-launcher-key" aria-hidden="true">↵</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            id="jarvis-chat-window"
            className="chat-window"
            role="dialog"
            aria-label="Text chat with JARVIS"
            aria-modal="false"
            aria-busy={sessionBusy}
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <header className="chat-header">
              <div className="chat-heading">
                <div className="chat-eyebrow"><i /> LOCAL INTELLIGENCE / TEXT CHANNEL</div>
                <h2>CHAT WITH J.A.R.V.I.S.</h2>
                <p>Type a message. Voice input is optional.</p>
              </div>
              <button
                className="chat-close"
                type="button"
                aria-label="Close chat"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="chat-telemetry" aria-label="Live local-system status">
              <span className={`chat-telemetry-chip chat-link-${blocked ? 'blocked' : telemetryState}`} title={bridgeLabel}>
                <i aria-hidden="true" />{bridgeLabel}
              </span>
              <span className={`chat-telemetry-chip ${blocked ? 'chat-link-blocked' : snapshot?.ollama ? 'chat-status-good' : snapshot || telemetryState === 'offline' ? 'chat-status-offline' : ''}`}>
                <i aria-hidden="true" />OLLAMA {blocked ? 'PRIVATE' : telemetryState === 'offline' ? 'UNAVAILABLE' : snapshot ? (snapshot.ollama ? 'AVAILABLE' : 'OFFLINE') : '—'}
              </span>
              <span className="chat-telemetry-chip chat-model-chip" title={chatModel ?? 'No chat model selected'}>
                <i aria-hidden="true" />{blocked ? 'LOCAL MODEL / PRIVATE' : chatModel ? chatModel : 'CHAT MODEL / NOT SELECTED'}
              </span>
              <span className="chat-telemetry-chip chat-ram-chip">
                <i aria-hidden="true" />{ram
                  ? `RAM ${ram.totalGb?.toFixed(1) ?? '—'} GB · JARVIS ${ram.effectiveModelGb?.toFixed(1) ?? '—'} GB`
                  : blocked ? 'LOCAL RAM / PRIVATE' : 'RAM / —'}
              </span>
              <span className={`chat-telemetry-state ${chatModelState === 'ready' ? 'is-ready' : ''}`}>{chatSlotLabel}</span>
            </div>

            <div className="chat-session-line">
              <span className="chat-session-state">
                <span className={`chat-phase-wave chat-wave-${phase}`} aria-hidden="true">
                  <i /><i /><i /><i /><i />
                </span>
                <i className={`chat-led ${sessionBusy ? 'chat-led-active' : ''}`} />
                {booting ? 'SYSTEM STARTUP' : sessionStatus}
              </span>
              <span>{String(turns.filter((turn) => turn.role === 'user').length).padStart(2, '0')} TURNS</span>
            </div>

            <div className="chat-messages" ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions text">
              {turns.length === 0 ? (
                <div className="chat-welcome">
                  <div className="chat-welcome-mark"><ChatGlyph /></div>
                  <span className="chat-welcome-kicker">CHANNEL READY</span>
                  <h3>What would you like to know?</h3>
                  <p>Send a message to start a conversation with your configured JARVIS model. You can chat here without turning on the microphone.</p>
                  <div className="chat-prompt-ideas" aria-label="Suggested messages">
                    {PROMPT_IDEAS.map((idea) => (
                      <button key={idea} type="button" onClick={() => setDraft(idea)} disabled={chatBusy || booting}>
                        {idea}<span aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="chat-thread">
                  {turns.map((turn) => (
                    <motion.article
                      key={turn.id}
                      className={`chat-message chat-message-${turn.role}`}
                      initial={{ opacity: 0, y: 7 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <div className="chat-message-meta">
                        <span>{turn.role === 'user' ? 'YOU' : 'J.A.R.V.I.S.'}</span>
                        {turn.role === 'jarvis' && <i aria-hidden="true" />}
                        {turn.role === 'jarvis' && (
                          <button
                            className="chat-copy-button"
                            type="button"
                            disabled={!turn.text}
                            aria-label={copiedTurnId === turn.id ? 'Answer copied' : 'Copy answer'}
                            onClick={() => void copyAnswer(turn.id, turn.text)}
                          >
                            {copiedTurnId === turn.id ? 'COPIED' : 'COPY'}
                          </button>
                        )}
                      </div>
                      <div className="chat-message-body">{turn.text || (turn.role === 'jarvis' ? <span className="chat-cursor" /> : null)}</div>
                      {turn.role === 'jarvis' && turn.telemetry && (
                        <div className="chat-response-telemetry" aria-label="Measured local inference timing">
                          <span className="chat-response-telemetry-title">LOCAL INFERENCE</span>
                          <span><b>TTFT</b>{formatLatency(turn.telemetry.firstTokenMs)}</span>
                          <span><b>TURN</b>{formatLatency(turn.telemetry.totalMs)}</span>
                        </div>
                      )}
                      {turn.role === 'jarvis' && Boolean(turn.tools?.length) && (
                        <div className="chat-tool-trail" aria-label="Tools used for this reply">
                          <span className="chat-tool-trail-label">TOOL TRACE</span>
                          {turn.tools?.map((tool, index) => (
                            <span className="chat-tool-chip" key={`${turn.id}-${index}`}>
                              <i aria-hidden="true" />{tool}
                            </span>
                          ))}
                        </div>
                      )}
                    </motion.article>
                  ))}
                  {waitingForReply && (
                    <div className="chat-thinking" role="status">
                      <span className="chat-thinking-dots"><i /><i /><i /></span>
                      <span>{activeTool ? `Working with ${activeTool}…` : 'Thinking…'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {(localError || error) && (
              <div className="chat-error" role="alert">{localError || error}</div>
            )}

            <form className="chat-composer" onSubmit={(event) => void submit(event)}>
              <label className="sr-only" htmlFor="jarvis-chat-input">Message JARVIS</label>
              <textarea
                id="jarvis-chat-input"
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder={booting ? 'JARVIS is powering up…' : 'Message J.A.R.V.I.S…'}
                rows={1}
                maxLength={6000}
                disabled={booting || chatBusy}
              />
              <button
                className="chat-send"
                type="submit"
                aria-label={chatBusy ? 'JARVIS is responding' : 'Send message'}
                disabled={!draft.trim() || chatBusy || booting}
              >
                {chatBusy ? <span className="chat-send-spinner" /> : <SendGlyph />}
              </button>
            </form>
            <footer className="chat-footer">
              <span>ENTER TO SEND <i /> SHIFT + ENTER FOR NEW LINE</span>
              <span>CTRL / CMD + K · COMMANDS</span>
            </footer>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
