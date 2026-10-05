import { useCallback, useEffect, useMemo, useState } from 'react'
import { BRIDGE_HTTP_URL } from '../config'
import './ModelManager.css'

type PlannedSlot = {
  id: string
  kind: 'ollama' | 'whisper' | 'tts'
  model: string
  quant: string | null
  downloadGb: number
  residentGb: number
  fits: boolean
  mode?: string
  engine?: string
  dtype?: string | null
  quality?: number
  parametersB?: number
  multimodal?: boolean
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
  quant?: string | null
  parametersB?: number | null
  multimodal?: boolean
}

type TierProfile = {
  ramGb: number
  aiCapGb: number
  totalDownloadGb: number
  slots: Partial<Record<'chat' | 'vision' | 'reason' | 'speech' | 'tts', TierSlot>>
}

type RuntimeSlotStatus = {
  slot: string
  model: string | null
  state: 'ready' | 'missing' | 'unknown' | 'unsupported' | 'incompatible'
  note?: string | null
}

type PlanPayload = {
  summary: string
  ram: {
    totalGb: number
    freeGb: number
    currentFreeGb: number
    unallocatedGb: number
    modelsGb: number
    effectiveModelGb: number
    sharePercent: number
    capGb: number | null
    allocationSource: string
  }
  allocation?: { sharePercent: number; capGb: number | null; source: string } | null
  fits: PlannedSlot[]
  skipped: { id: string; model: string | null; needsGb: number; why: string }[]
  totalDownloadGb: number
  maxResidentGb: number
  notes: string[]
  ollama: boolean
  modelSlots?: RuntimeSlotStatus[]
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

function formatParameters(parametersB: number) {
  if (parametersB < 1) return `${Math.round(parametersB * 1000)}M`
  return `${Number.isInteger(parametersB) ? parametersB : parametersB.toFixed(2).replace(/0$/, '')}B`
}

export function ModelManager({ onClose }: { onClose: () => void }) {
  const blocked = useMemo(() => pageCannotReachLocalBridge(), [])
  const [plan, setPlan] = useState<PlanPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [starting, setStarting] = useState(false)
  const [jobId, setJobId] = useState('')
  const [job, setJob] = useState<InstallJob | null>(null)
  const [sharePercent, setSharePercent] = useState(100)
  const [capGb, setCapGb] = useState('')
  const [saving, setSaving] = useState(false)
  const [allocationNote, setAllocationNote] = useState('')

  const refresh = useCallback(async () => {
    if (blocked) return
    setLoading(true)
    setLoadError('')
    try {
      const response = await fetch(`${BRIDGE_HTTP_URL}/autopilot`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(data.error ?? `Local bridge returned HTTP ${response.status}`))
      const next = data as PlanPayload
      setPlan(next)
      setSharePercent(Math.round(next.ram.sharePercent))
      setCapGb(next.ram.capGb != null ? String(next.ram.capGb) : '')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Local bridge is unavailable.')
    } finally {
      setLoading(false)
    }
  }, [blocked])

  const postAllocation = useCallback(async (body: Record<string, unknown>, note: string) => {
    setSaving(true)
    setLoadError('')
    setAllocationNote('')
    try {
      const response = await fetch(`${BRIDGE_HTTP_URL}/autopilot/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(data.error ?? `Allocation update returned HTTP ${response.status}`))
      setAllocationNote(note)
      await refresh()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not update the allocation.')
    } finally {
      setSaving(false)
    }
  }, [refresh])

  const applyAllocation = useCallback(async () => {
    const trimmed = capGb.trim()
    const cap = trimmed === '' ? null : Number(trimmed)
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) {
      setAllocationNote('')
      setLoadError('Hard cap must be a positive number of GB, or left blank for no cap.')
      return
    }
    await postAllocation(
      { share: sharePercent, capGb: cap },
      `AI share saved: ${sharePercent}% of free RAM${cap === null ? '' : `, hard cap ${cap} GB`}. The bridge re-planned immediately.`,
    )
  }, [capGb, postAllocation, sharePercent])

  const rescan = useCallback(async () => {
    await postAllocation({ rescan: true }, 'Free RAM sampled again and the plan rebuilt against it.')
  }, [postAllocation])

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
        // `runtime: true` is the difference between "download the models" and
        // "make it work": if no model server is answering, the bridge fetches
        // Ollama's standalone build into the project and starts it first.
        body: JSON.stringify({ runtime: true }),
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
    const label = slot.parametersB != null
      ? `Qwen3.5 ${formatParameters(slot.parametersB)} · ${slot.quant ?? 'local'}${slot.multimodal ? ' · image input' : ' · text/coding'}`
      : slot.model
    return slot.state === 'best-effort' ? `${label} · best-effort only` : label
  }
  const visionRuntimeWarning = (slot: PlannedSlot) => {
    const runtime = plan?.modelSlots?.find((status) => status.slot === 'vision')
    return slot.id === 'vision' && runtime?.model === slot.model && runtime.state === 'incompatible'
      ? runtime.note ?? 'Ollama did not confirm image-input support for this model.'
      : null
  }

  // The catalogue is a page the bridge serves, and the desktop shell turns this
  // link into the setup window rather than a browser tab. Either way it is the
  // one place the three models are chosen, and this is how a person gets there
  // without hunting for a tray icon Windows hides by default.
  const setupUrl = `${BRIDGE_HTTP_URL}/install?hud=${encodeURIComponent(typeof window === 'undefined' ? '' : window.location.origin)}`

  return (
    <div className="model-manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="model-manager" role="dialog" aria-modal="true" aria-labelledby="model-manager-title">
        <header className="model-manager-head">
          <div>
            <span className="model-manager-kicker">J.A.R.V.I.S. / LOCAL CONTROL PLANE</span>
            <h2 id="model-manager-title">RAM / MODEL STACK</h2>
            <p>The models are chosen by hand — one for chat, one for vision, one for coding and reasoning — from the catalogue in the setup window. This panel reads what the RAM plan makes of that choice, and how much of your free memory the AI may take.</p>
          </div>
          <button type="button" className="model-manager-close" onClick={onClose} aria-label="Close model stack">×</button>
        </header>

        <div className="model-manager-catalogue">
          <div>
            <b>THE CATALOGUE</b>
            <span>Every model this project knows, with its download size, resident size, parameters and quantization, marked against this machine's RAM and disk. Nothing is downloaded until you pick three and press the button.</span>
          </div>
          <a className="model-manager-setup" href={setupUrl} target="_blank" rel="noreferrer">OPEN MODEL SETUP</a>
        </div>

        <div className="model-manager-status-row">
          <span className={`model-manager-link ${plan ? 'is-linked' : ''}`}><i />{blocked ? 'STATIC HOST / LOCAL BRIDGE BLOCKED' : plan ? 'LOCAL BRIDGE LINKED' : loading ? 'READING LOCAL PROFILE' : 'NO LOCAL BRIDGE'}</span>
          <span className="model-manager-summary">{plan?.summary ?? 'NO FIXED SPLIT / AI TAKES YOUR SHARE OF FREE RAM'}</span>
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
              <div className="budget-segment budget-free"><i /><span>FREE NOW</span><b>{plan.ram.freeGb.toFixed(1)} GB</b></div>
              <div className="budget-segment budget-share"><i /><span>AI SHARE</span><b>{plan.ram.sharePercent.toFixed(0)}%</b></div>
              <div className="budget-segment budget-ai"><i /><span>AI CEILING{plan.ram.capGb != null ? ` / ${plan.ram.capGb} GB CAP` : ''}</span><b>{plan.ram.modelsGb.toFixed(1)} GB</b></div>
              <div className="budget-current"><span>UNALLOCATED / LEFT TO THE MACHINE</span><b>{plan.ram.unallocatedGb.toFixed(2)} GB</b><small>plan made with {plan.ram.currentFreeGb.toFixed(1)} GB free · source: {plan.ram.allocationSource}</small></div>
            </div>

            <div className="model-manager-allocation">
              <div className="allocation-copy">
                <b>AI SHARE OF FREE RAM</b>
                <p>JARVIS takes the share you choose of whatever is free right now. No fixed OS/apps percentage is reserved for him; lower the share or set a hard cap to keep more breathing room.</p>
              </div>
              <label className="allocation-slider">
                <span>{sharePercent}%</span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={sharePercent}
                  onChange={(event) => setSharePercent(Number(event.target.value))}
                  disabled={saving}
                />
              </label>
              <label className="allocation-cap">
                <span>HARD CAP / GB</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="none"
                  value={capGb}
                  onChange={(event) => setCapGb(event.target.value)}
                  disabled={saving}
                />
              </label>
              <button type="button" onClick={() => void applyAllocation()} disabled={saving}>
                {saving ? 'APPLYING…' : 'APPLY'}
              </button>
              <button type="button" className="allocation-rescan" onClick={() => void rescan()} disabled={saving}>
                RESCAN FREE RAM
              </button>
            </div>
            {allocationNote && <div className="model-manager-message model-manager-allocation-note">{allocationNote}</div>}

            <div className="model-manager-grid">
              {plan.fits.map((slot) => (
                <article className={`model-slot-card slot-${slot.id} ${slot.fits ? 'slot-fit' : 'slot-best-effort'}`} key={slot.id}>
                  <div className="model-slot-top"><span>{slot.id === 'reason' ? 'CODING / REASON' : slot.id.toUpperCase()}</span><b>{slot.fits ? 'WITHIN PLAN' : 'BEST EFFORT'}</b></div>
                  <strong className="model-slot-model" title={slot.model}>{slot.parametersB != null ? `Qwen3.5 ${formatParameters(slot.parametersB)} / ABLITERATED` : slot.model}</strong>
                  <div className="model-slot-meta">
                    <span>{slot.multilingual ? 'MULTILINGUAL' : slot.englishOnly ? 'ENGLISH CODING' : 'LOCAL MODEL'}</span>
                    {slot.parametersB != null && <span>{formatParameters(slot.parametersB)} PARAMS</span>}
                    {slot.quant && <span>{slot.quant}</span>}
                    {slot.multimodal && <span>TEXT + IMAGE</span>}
                    <span>{slot.downloadGb.toFixed(2)} GB DOWNLOAD</span>
                    <span>≈{slot.residentGb.toFixed(2)} GB ACTIVE</span>
                  </div>
                  {visionRuntimeWarning(slot) && <p className="model-slot-runtime-warning">IMAGE CAPABILITY / {visionRuntimeWarning(slot)}</p>}
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
                <p className="tier-catalog-note">Rows assume all RAM is free and apply your current AI share{plan.ram.capGb != null ? ` and ${plan.ram.capGb} GB hard cap` : ''}. Vision is provisioned in every row. Rows where the shared allocation fits one tag show the same abliterated multimodal Qwen3.5 model across chat, vision and coding; larger allocations reach the higher-parameter rungs, up to the native 122B-tag / 125B Q4_K_M workstation model. Distinct tags count once each. At the smallest tiers the 0.8B Q8 model is best-effort only and never auto-run.</p>
                <div className="tier-table-wrap">
                  <table>
                    <thead><tr><th>RAM</th><th>JARVIS cap</th><th>Chat</th><th>Vision / image</th><th>Coding / reason</th><th>Multilingual STT</th><th>TTS</th><th>Assets</th></tr></thead>
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
