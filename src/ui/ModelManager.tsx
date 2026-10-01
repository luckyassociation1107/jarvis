import { useCallback, useEffect, useMemo, useState } from 'react'
import { BRIDGE_HTTP_URL } from '../config'
import './ModelManager.css'

type PlannedSlot = {
  id: string
  kind: 'ollama' | 'whisper'
  model: string
  quant: string | null
  downloadGb: number
  residentGb: number
  fits: boolean
  mode?: string
  engine?: string
  dtype?: string | null
  quality?: number
  note?: string
  multilingual?: boolean
  englishOnly?: boolean
}

type TierSlot = {
  model: string | null
  fits: boolean
  state: 'fits' | 'best-effort' | 'unavailable'
  engine?: string | null
  dtype?: string | null
}

type TierProfile = {
  ramGb: number
  aiCapGb: number
  totalDownloadGb: number
  slots: Partial<Record<'chat' | 'vision' | 'reason' | 'speech' | 'tts', TierSlot>>
}

type PlanPayload = {
  summary: string
  ram: { totalGb: number; osGb: number; appsGb: number; modelsGb: number; effectiveModelGb: number; currentFreeGb: number }
  fits: PlannedSlot[]
  skipped: { id: string; model: string | null; needsGb: number; why: string }[]
  totalDownloadGb: number
  maxResidentGb: number
  notes: string[]
  ollama: boolean
  tiers?: TierProfile[]
}

type InstallJob = {
  id: string
  state: 'running' | 'completed' | 'partial' | 'failed'
  progress?: { phase?: string; cap?: string; model?: string; file?: string; status?: string; completed?: number | null; total?: number | null; error?: string }
  steps?: { phase?: string; cap?: string; model?: string; file?: string; status?: string; error?: string }[]
  result?: { id?: string; cap?: string; ok?: boolean; skipped?: boolean; note?: string; error?: string }[] | null
  error?: string | null
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

function formatStatus(job: InstallJob | null, starting: boolean) {
  if (starting) return 'STARTING INSTALLER'
  if (!job) return ''
  if (job.state === 'running') return `${String(job.progress?.phase ?? 'INSTALL').toUpperCase()} / RUNNING`
  if (job.state === 'completed') return 'INSTALL COMPLETE'
  if (job.state === 'partial') return 'PARTIAL / CHECK LOG'
  return 'INSTALL FAILED'
}

export function ModelManager({ onClose }: { onClose: () => void }) {
  const blocked = useMemo(() => pageCannotReachLocalBridge(), [])
  const [plan, setPlan] = useState<PlanPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [starting, setStarting] = useState(false)
  const [jobId, setJobId] = useState('')
  const [job, setJob] = useState<InstallJob | null>(null)

  const refresh = useCallback(async () => {
    if (blocked) return
    setLoading(true)
    setLoadError('')
    try {
      const response = await fetch(`${BRIDGE_HTTP_URL}/autopilot`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(data.error ?? `Local bridge returned HTTP ${response.status}`))
      setPlan(data as PlanPayload)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Local bridge is unavailable.')
    } finally {
      setLoading(false)
    }
  }, [blocked])

  useEffect(() => {
    void Promise.resolve().then(() => refresh())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, refresh])

  useEffect(() => {
    if (!jobId || blocked) return
    let live = true
    let interval = 0
    const poll = async () => {
      try {
        const response = await fetch(`${BRIDGE_HTTP_URL}/autopilot/install/status?id=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(String(data.error ?? `Installer status returned HTTP ${response.status}`))
        if (!live) return
        const next = data as InstallJob
        setJob(next)
        if (next.state !== 'running') {
          window.clearInterval(interval)
          void refresh()
        }
      } catch (error) {
        if (live) setJob((current) => current ? { ...current, error: error instanceof Error ? error.message : 'Could not read installer status.' } : current)
      }
    }
    void poll()
    interval = window.setInterval(() => void poll(), 1000)
    return () => {
      live = false
      window.clearInterval(interval)
    }
  }, [jobId, blocked, refresh])

  const whisperSelected = Boolean(plan?.fits.some((slot) => slot.kind === 'whisper' && slot.fits))
  const canInstall = Boolean(plan && (plan.ollama || whisperSelected))

  const install = async () => {
    if (!plan || !canInstall || starting || job?.state === 'running') return
    setStarting(true)
    setLoadError('')
    setJob(null)
    try {
      const response = await fetch(`${BRIDGE_HTTP_URL}/autopilot/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(data.error ?? `Installer returned HTTP ${response.status}`))
      setJobId(String(data.jobId ?? ''))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not start the local installer.')
    } finally {
      setStarting(false)
    }
  }

  const progress = job?.progress
  const percent = progress?.completed && progress?.total
    ? Math.max(0, Math.min(100, Math.round((progress.completed / progress.total) * 100)))
    : 0
  const installerLabel = formatStatus(job, starting)
  const tierCell = (slot: TierSlot | undefined, capability: string) => {
    if (!slot) return 'UNAVAILABLE'
    if (capability === 'tts') return slot.engine === 'kokoro' ? `Kokoro ${String(slot.dtype ?? '').toUpperCase()}` : 'Browser / OS'
    if (!slot.model) return 'UNAVAILABLE'
    return slot.state === 'best-effort' ? `${slot.model} · best-effort only` : slot.model
  }

  return (
    <div className="model-manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="model-manager" role="dialog" aria-modal="true" aria-labelledby="model-manager-title">
        <header className="model-manager-head">
          <div>
            <span className="model-manager-kicker">J.A.R.V.I.S. / LOCAL CONTROL PLANE</span>
            <h2 id="model-manager-title">RAM / MODEL STACK</h2>
            <p>Autopilot chooses the largest per-task models that fit the reserved memory ceiling.</p>
          </div>
          <button type="button" className="model-manager-close" onClick={onClose} aria-label="Close model stack">×</button>
        </header>

        <div className="model-manager-status-row">
          <span className={`model-manager-link ${plan ? 'is-linked' : ''}`}><i />{blocked ? 'STATIC HOST / LOCAL BRIDGE BLOCKED' : plan ? 'LOCAL BRIDGE LINKED' : loading ? 'READING LOCAL PROFILE' : 'NO LOCAL BRIDGE'}</span>
          <span className="model-manager-summary">{plan?.summary ?? '35% OS / 25% APPS / 40% MAXIMUM AI'}</span>
        </div>

        {blocked ? (
          <div className="model-manager-message model-manager-warning">
            <b>GitHub Pages is UI-only.</b> Browser security prevents this hosted page from reading the visitor’s localhost. Run JARVIS locally with the bridge to inspect RAM or install models.
          </div>
        ) : loadError ? (
          <div className="model-manager-message model-manager-warning"><b>Bridge unavailable.</b> {loadError}</div>
        ) : loading && !plan ? (
          <div className="model-manager-message">Reading the local RAM plan…</div>
        ) : plan ? (
          <>
            <div className="model-manager-budget" aria-label="RAM allocation">
              <div className="budget-total"><span>HOST RAM</span><strong>{plan.ram.totalGb.toFixed(1)}<small> GB</small></strong></div>
              <div className="budget-segment budget-os"><i /><span>OS / 35%</span><b>{plan.ram.osGb.toFixed(1)} GB</b></div>
              <div className="budget-segment budget-apps"><i /><span>OTHER APPS / 25%</span><b>{plan.ram.appsGb.toFixed(1)} GB</b></div>
              <div className="budget-segment budget-ai"><i /><span>JARVIS CAP / 40%</span><b>{plan.ram.modelsGb.toFixed(1)} GB</b></div>
              <div className="budget-current"><span>ACTIVE-MODEL CEILING</span><b>{plan.ram.effectiveModelGb.toFixed(2)} GB</b><small>{plan.ram.currentFreeGb.toFixed(1)} GB currently free</small></div>
            </div>

            <div className="model-manager-grid">
              {plan.fits.map((slot) => (
                <article className={`model-slot-card slot-${slot.id} ${slot.fits ? 'slot-fit' : 'slot-best-effort'}`} key={slot.id}>
                  <div className="model-slot-top"><span>{slot.id === 'reason' ? 'CODING / REASON' : slot.id.toUpperCase()}</span><b>{slot.fits ? 'WITHIN PLAN' : 'BEST EFFORT'}</b></div>
                  <strong className="model-slot-model" title={slot.model}>{slot.model}</strong>
                  <div className="model-slot-meta"><span>{slot.multilingual ? 'MULTILINGUAL' : slot.englishOnly ? 'ENGLISH CODING' : slot.quant ?? slot.kind.toUpperCase()}</span><span>{slot.downloadGb.toFixed(2)} GB DOWNLOAD</span><span>≈{slot.residentGb.toFixed(2)} GB ACTIVE</span></div>
                  {slot.note && <p>{slot.note}</p>}
                </article>
              ))}
            </div>

            {plan.skipped.length > 0 && (
              <div className="model-manager-skipped">
                <b>CAPABILITY LIMITS</b>
                {plan.skipped.map((item) => <p key={item.id}><strong>{item.id.toUpperCase()}:</strong> {item.why}</p>)}
              </div>
            )}

            {plan.tiers && (
              <details className="model-manager-tiers">
                <summary>
                  <span>FULL RAM TIER CATALOGUE / 0.5–32 GB</span>
                  <small>33 reference profiles · opens for comparison</small>
                </summary>
                <p className="tier-catalog-note">These reference rows assume all reported RAM is free. The setup script selects only this machine’s fitting tier; it never downloads every row. Best-effort chat/coder entries and unsupported local capabilities are labelled honestly.</p>
                <div className="tier-table-wrap">
                  <table>
                    <thead><tr><th>RAM</th><th>JARVIS cap</th><th>Multilingual chat</th><th>Abliterated vision</th><th>English coding</th><th>Multilingual STT</th><th>TTS</th><th>Assets</th></tr></thead>
                    <tbody>
                      {plan.tiers.map((tier) => (
                        <tr key={tier.ramGb}>
                          <th scope="row">{tier.ramGb === 0.5 ? '500 MB' : `${tier.ramGb} GB`}</th>
                          <td>{tier.aiCapGb.toFixed(2)} GB</td>
                          <td title={tierCell(tier.slots.chat, 'chat')}>{tierCell(tier.slots.chat, 'chat')}</td>
                          <td title={tierCell(tier.slots.vision, 'vision')}>{tierCell(tier.slots.vision, 'vision')}</td>
                          <td title={tierCell(tier.slots.reason, 'reason')}>{tierCell(tier.slots.reason, 'reason')}</td>
                          <td title={tierCell(tier.slots.speech, 'speech')}>{tierCell(tier.slots.speech, 'speech')}</td>
                          <td title={tierCell(tier.slots.tts, 'tts')}>{tierCell(tier.slots.tts, 'tts')}</td>
                          <td>{tier.totalDownloadGb.toFixed(2)} GB</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            <div className="model-manager-notes">
              <div><span>SELECTED MODEL ASSETS</span><b>≈{plan.totalDownloadGb.toFixed(2)} GB</b></div>
              <div><span>PEAK MODEL + RETAINED TTS</span><b>≈{plan.maxResidentGb.toFixed(2)} GB</b></div>
              <ul>{plan.notes.map((note) => <li key={note}>{note}</li>)}</ul>
            </div>

            <div className="model-manager-install">
              <div className="model-install-copy">
                <span>{installerLabel || (canInstall ? 'EXPLICIT / USER-INITIATED' : 'NO FITTING LOCAL DOWNLOAD')}</span>
                <p>{plan.ollama ? 'Pull only RAM-fitting Ollama models and install multilingual Whisper. Best-effort models are not downloaded; browser-local Kokoro caches on first use only when selected.' : whisperSelected ? 'Ollama is offline; this action can still install the fitting multilingual Whisper runtime/model. Chat, coding and vision downloads are skipped until Ollama starts.' : 'No local model fits this RAM tier. Browser/OS speech remains available; increase memory or configure a remote model server. npm run setup is a preflight check only.'}</p>
              </div>
              <button type="button" onClick={() => void install()} disabled={!canInstall || starting || job?.state === 'running'}>
                {starting || job?.state === 'running' ? 'INSTALLING…' : plan.ollama ? 'INSTALL SELECTED STACK' : whisperSelected ? 'INSTALL WHISPER STT' : 'NO LOCAL MODEL FITS'}
              </button>
            </div>

            {job && (job.state === 'running' || job.result || job.error) && (
              <div className={`model-manager-job job-${job.state}`}>
                <div className="job-heading"><span>{installerLabel}</span><b>{progress?.cap?.toUpperCase() ?? progress?.phase?.toUpperCase() ?? '—'}</b></div>
                {job.state === 'running' && <div className="job-progress"><i style={{ width: `${percent}%` }} /></div>}
                {progress?.model && <p>{progress.model}</p>}
                {progress?.file && <p>{progress.file}</p>}
                {progress?.status && <p>{progress.status}{progress.total ? ` / ${percent}%` : ''}</p>}
                {job.error && <p className="job-error">{job.error}</p>}
                {job.result && <ul>{job.result.map((item, index) => <li key={`${item.id ?? item.cap}-${index}`} className={item.ok ? 'result-ok' : 'result-bad'}>{item.skipped ? 'SKIPPED' : item.ok ? 'READY' : 'FAILED'} / {item.cap ?? item.id}{item.error ? ` — ${item.error}` : item.note ? ` — ${item.note}` : ''}</li>)}</ul>}
              </div>
            )}
          </>
        ) : (
          <div className="model-manager-message">No RAM plan is available. <button type="button" onClick={() => void refresh()}>RETRY</button></div>
        )}

        <footer className="model-manager-foot">
          <span>UI DOWNLOADS ARE EXPLICIT</span><span>BUILD SCRIPTS INSTALL ONLY THE DETECTED FITTING TIER / PLAN VALUES ARE ESTIMATES</span>
          {!blocked && <button type="button" onClick={() => void refresh()} disabled={loading}>REFRESH PLAN</button>}
        </footer>
      </section>
    </div>
  )
}
