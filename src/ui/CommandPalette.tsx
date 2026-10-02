import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import './CommandPalette.css'

type Command = {
  id: string
  label: string
  detail: string
  keywords: string
  run: () => void
}

type CommandPaletteProps = {
  onStart: () => void
}

function CommandGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h10M4 17h16" />
      <path d="m17 10 3 2-3 2" />
    </svg>
  )
}

const PHASE_LABEL = {
  offline: 'VOICE STANDBY / TEXT READY',
  boot: 'SYSTEM STARTUP',
  dormant: 'READY / WAKE WORD',
  waking: 'WAKE SEQUENCE',
  listening: 'VOICE INPUT / LIVE',
  thinking: 'LOCAL INFERENCE',
  tooling: 'TOOL EXECUTION',
  speaking: 'VOICE OUTPUT',
} as const

export function CommandPalette({ onStart }: CommandPaletteProps) {
  const open = useStore((s) => s.commandPaletteOpen)
  const setOpen = useStore((s) => s.setCommandPaletteOpen)
  const setChatOpen = useStore((s) => s.setChatOpen)
  const setModelManagerOpen = useStore((s) => s.setModelManagerOpen)
  const phase = useStore((s) => s.phase)
  const ui = useStore((s) => s.ui)
  const applyUi = useStore((s) => s.applyUi)
  const clearScreen = useStore((s) => s.clearScreen)
  const resetUi = useStore((s) => s.resetUi)
  const fireEffect = useStore((s) => s.fireEffect)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = useMemo<Command[]>(() => {
    const items: Command[] = [
      {
        id: 'chat',
        label: 'Open text chat',
        detail: 'Talk to the local model without enabling the microphone.',
        keywords: 'message conversation assistant text',
        run: () => setChatOpen(true),
      },
      {
        id: 'models',
        label: 'Open model and RAM stack',
        detail: 'Inspect the live RAM plan, model readiness, and local tools.',
        keywords: 'telemetry memory ram ollama models status',
        run: () => setModelManagerOpen(true),
      },
      {
        id: 'clear-chat',
        label: 'Clear conversation',
        detail: 'Remove the on-screen transcript for this page session.',
        keywords: 'reset transcript messages history',
        run: () => clearScreen('transcript'),
      },
      {
        id: 'clear-surfaces',
        label: 'Clear HUD surfaces',
        detail: 'Dismiss transient panels, cards, and blades.',
        keywords: 'close cards panels blades screen',
        run: () => clearScreen('panels'),
      },
      {
        id: 'toggle-transcript',
        label: `${ui.chrome.transcript ? 'Hide' : 'Show'} HUD transcript`,
        detail: 'Toggle the compact conversation readout on the main display.',
        keywords: 'conversation captions text display',
        run: () => applyUi({ chrome: { transcript: !ui.chrome.transcript } }),
      },
      {
        id: 'toggle-systems',
        label: `${ui.chrome.systems ? 'Hide' : 'Show'} systems rail`,
        detail: 'Toggle the live local-runtime and tool-status rail.',
        keywords: 'tools bridge status diagnostics telemetry',
        run: () => applyUi({ chrome: { systems: !ui.chrome.systems } }),
      },
      {
        id: 'toggle-tool-badge',
        label: `${ui.chrome.toolBadge ? 'Hide' : 'Show'} active-tool indicator`,
        detail: 'Toggle the live MCP execution indicator.',
        keywords: 'mcp tool execution activity',
        run: () => applyUi({ chrome: { toolBadge: !ui.chrome.toolBadge } }),
      },
      {
        id: 'scan',
        label: 'Run interface scan',
        detail: 'Play a brief, non-destructive HUD scan effect.',
        keywords: 'visual effect animation flourish',
        run: () => fireEffect('scan'),
      },
      {
        id: 'reset-hud',
        label: 'Reset HUD appearance',
        detail: 'Restore the default accent, reactor, and interface layout.',
        keywords: 'default theme colour color reset',
        run: resetUi,
      },
    ]
    if (phase === 'offline') {
      items.unshift({
        id: 'voice',
        label: 'Initialize voice control',
        detail: 'Start the optional microphone and voice assistant sequence.',
        keywords: 'power on microphone speech wake word',
        run: onStart,
      })
    }
    return items
  }, [
    applyUi,
    clearScreen,
    fireEffect,
    onStart,
    phase,
    resetUi,
    setChatOpen,
    setModelManagerOpen,
    ui.chrome.systems,
    ui.chrome.toolBadge,
    ui.chrome.transcript,
  ])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) =>
      `${command.label} ${command.detail} ${command.keywords}`.toLowerCase().includes(needle),
    )
  }, [commands, query])
  const selected = filtered.length ? Math.min(active, filtered.length - 1) : -1

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setOpen(!open)
        return
      }
      if (open && event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const run = (command: Command) => {
    setOpen(false)
    setQuery('')
    command.run()
  }

  const trapDialogTab = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'),
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => filtered.length ? (index + 1) % filtered.length : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => filtered.length ? (index - 1 + filtered.length) % filtered.length : 0)
    } else if (event.key === 'Enter' && selected >= 0) {
      event.preventDefault()
      run(filtered[selected])
    }
  }

  return (
    <div className="command-palette-layer">
      <button
        className="command-palette-trigger"
        type="button"
        aria-keyshortcuts="Control+K Meta+K"
        aria-expanded={open}
        aria-controls="jarvis-command-palette"
        onClick={() => setOpen(!open)}
      >
        <CommandGlyph />
        <span>COMMANDS</span>
        <kbd>⌘ / CTRL K</kbd>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="command-palette-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
          >
            <motion.section
              id="jarvis-command-palette"
              className={`command-palette command-palette-phase-${phase}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="command-palette-title"
              onKeyDownCapture={trapDialogTab}
              initial={{ opacity: 0, y: -12, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.985 }}
              transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            >
              <header className="command-palette-head">
                <div>
                  <span className="command-palette-kicker">J.A.R.V.I.S. / ACTION BUS</span>
                  <h2 id="command-palette-title">SYSTEM COMMANDS</h2>
                  <div className={`command-palette-phase-status command-phase-${phase}`} role="status" aria-live="polite">
                    <i aria-hidden="true" />{PHASE_LABEL[phase]}
                  </div>
                </div>
                <kbd>ESC</kbd>
              </header>
              <label className="command-palette-search">
                <span aria-hidden="true">⌕</span>
                <span className="sr-only">Filter system commands</span>
                <input
                  ref={inputRef}
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setActive(0)
                  }}
                  onKeyDown={onInputKeyDown}
                  placeholder="Search actions, systems, or tools…"
                  autoComplete="off"
                />
                <kbd>↵</kbd>
              </label>
              <div className="command-palette-list" role="listbox" aria-label="Available commands">
                {filtered.length ? filtered.map((command, index) => (
                  <button
                    className={`command-palette-item${index === selected ? ' is-active' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={index === selected}
                    key={command.id}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => run(command)}
                  >
                    <span className="command-palette-item-mark">{String(index + 1).padStart(2, '0')}</span>
                    <span className="command-palette-item-copy">
                      <strong>{command.label}</strong>
                      <small>{command.detail}</small>
                    </span>
                    <span className="command-palette-item-arrow" aria-hidden="true">↗</span>
                  </button>
                )) : (
                  <div className="command-palette-empty">NO MATCHING COMMANDS</div>
                )}
              </div>
              <footer className="command-palette-foot">
                <span><kbd>↑</kbd><kbd>↓</kbd> NAVIGATE</span>
                <span><kbd>ENTER</kbd> EXECUTE</span>
                <span>LOCAL ACTIONS / NO CLOUD</span>
              </footer>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
