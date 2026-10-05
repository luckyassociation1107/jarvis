/**
 * The setup page.
 *
 * Installation used to be a command: the build script decided which models fit
 * and pulled them, with no say from the person waiting. This page replaces that
 * with a catalogue and a choice. Every model the project knows is listed for the
 * three things a person actually asks for — chat, vision, and coding/reasoning —
 * with its download size, its resident size, its parameters and its
 * quantization, and with the ones this machine cannot hold marked rather than
 * hidden. The three the person ticked are the three that get downloaded.
 *
 * The runtime is not a browser problem either: Ollama is installed with Ollama's
 * own one-liner, over the CLI — `irm https://ollama.com/install.ps1 | iex` on
 * Windows and `curl -fsSL https://ollama.com/install.sh | sh` everywhere else.
 * Nobody is sent to a download page, and nothing is installed system-wide on a
 * machine where the script is blocked — the standalone build inside the project
 * is the fallback.
 *
 * It is served by the bridge rather than by Vite or a public site because it has
 * to talk to the bridge's own install endpoints, and because it must work on a
 * machine where the only thing installed so far is Node. So it is one file, no
 * build step, no external assets, and it degrades to readable text if the fetch
 * fails.
 */

/** The official installers, for people who would rather manage it themselves. */
export const OLLAMA_DOWNLOAD = Object.freeze({
  win32: 'https://ollama.com/download/OllamaSetup.exe',
  linux: 'https://ollama.com/download',
  darwin: 'https://ollama.com/download',
})

const PLATFORM_NAME = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' }

/**
 * The whole page, as a string.
 *
 * @param {{ platform?: string, port?: number, hudUrl?: string }} options
 */
export function installerPage({ platform = process.platform, port = 8787, hudUrl = null } = {}) {
  const osName = PLATFORM_NAME[platform] ?? platform
  const runtimeLine = platform === 'win32'
    ? 'Press <b>Install everything</b> below and this page installs the runtime with Ollama\'s own one-liner, over the CLI: <code>irm https://ollama.com/install.ps1 | iex</code>. That script verifies the installer is signed by Ollama Inc. and runs it silently (<code>OllamaSetup.exe /VERYSILENT</code>, per-user, no administrator) — no browser, no wizard, no download page. Then it starts Ollama and pulls the three models you chose. On a machine that blocks PowerShell or installers, the standalone build inside this project is unpacked instead.'
    : platform === 'linux' || platform === 'darwin'
      ? 'Press <b>Install everything</b> below and this page installs the runtime with Ollama\'s own one-liner, over the CLI: <code>curl -fsSL https://ollama.com/install.sh | sh</code>. Then it pulls the three models you chose. Prefer to do it yourself? <code>npm run install:ollama</code>, then press re-check.'
      : `This page sets up ${osName}; this host is ${platform}, so the project runtime cannot be unpacked here. Every other part still runs.`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>J.A.R.V.I.S — setup</title>
<style>
  :root { --ink:#0b0f16; --panel:#111827; --line:#1f2b3d; --text:#dbe6f2; --dim:#7c8ea3; --cyan:#6fd3ff; --amber:#ffb457; --green:#6ee7a8; --red:#ff7b7b; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  * { box-sizing:border-box; }
  body { margin:0; background:radial-gradient(1200px 600px at 50% -200px,#16233a 0%,var(--ink) 60%); color:var(--text); font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  main { max-width:1040px; margin:0 auto; padding:38px 22px 80px; }
  header { max-width:1040px; margin:0 auto; padding:34px 22px 6px; }
  .brand { font-family:var(--mono); letter-spacing:.34em; font-size:20px; color:#eaf3ff; }
  .brand span { color:var(--cyan); letter-spacing:.18em; }
  .sub { color:var(--dim); margin-top:8px; max-width:70ch; }
  .card { background:linear-gradient(180deg,#101a29,#0d1521); border:1px solid var(--line); border-radius:14px; padding:20px 22px; margin:18px 0; }
  h2 { font-family:var(--mono); font-size:12px; letter-spacing:.24em; color:var(--cyan); text-transform:uppercase; margin:0 0 14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .stat { background:#0b1320; border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .stat b { display:block; font-family:var(--mono); font-size:11px; letter-spacing:.12em; color:var(--dim); font-weight:500; text-transform:uppercase; }
  .stat span { font-size:17px; }
  .ok { color:var(--green); } .bad { color:var(--amber); } .muted { color:var(--dim); }
  button { font:inherit; background:#16243a; color:var(--text); border:1px solid var(--line); border-radius:9px; padding:9px 16px; cursor:pointer; }
  button:hover:not(:disabled) { border-color:var(--cyan); color:#fff; }
  button.primary { background:linear-gradient(180deg,#1d4f6d,#132f45); border-color:#2b6c92; color:#fff; font-weight:600; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  a { color:var(--cyan); }
  .tiers { display:flex; flex-direction:column; gap:8px; max-height:430px; overflow:auto; padding-right:6px; }
  .tier { display:grid; grid-template-columns:26px 92px 1fr auto; gap:12px; align-items:center; border:1px solid var(--line); border-radius:10px; padding:10px 12px; background:#0b1320; cursor:pointer; }
  .tier:hover { border-color:#33506f; }
  .tier.active { border-color:var(--cyan); background:#0f1c2c; }
  .tier input { accent-color:var(--cyan); }
  .tier .ram { font-family:var(--mono); font-size:15px; }
  .tier .models { font-size:13px; color:var(--dim); overflow:hidden; }
  .tier .models b { color:var(--text); font-weight:500; }
  .tier .size { font-family:var(--mono); font-size:13px; text-align:right; color:var(--dim); white-space:nowrap; }
  .badge { font-family:var(--mono); font-size:10px; letter-spacing:.1em; padding:2px 7px; border-radius:99px; border:1px solid var(--line); margin-left:6px; }
  .badge.rec { color:var(--ink); background:var(--cyan); border-color:var(--cyan); }
  .badge.big { color:var(--amber); border-color:#5a4526; }
  .actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:14px; }
  .steps { font-family:var(--mono); font-size:12.5px; max-height:300px; overflow:auto; margin-top:14px; }
  .step { display:flex; gap:10px; padding:3px 0; color:var(--dim); }
  .step .mark { width:16px; }
  .step.now { color:var(--text); }
  .step.done { color:var(--green); }
  .step.fail { color:var(--red); }
  .bar { height:6px; border-radius:99px; background:#0b1320; border:1px solid var(--line); overflow:hidden; margin-top:12px; }
  .bar > i { display:block; height:100%; width:0; background:linear-gradient(90deg,#2b6c92,var(--cyan)); transition:width .3s; }
  code { font-family:var(--mono); background:#0b1320; border:1px solid var(--line); border-radius:6px; padding:2px 6px; }
  .note { color:var(--dim); font-size:13px; margin-top:10px; }
  .filters { display:flex; gap:14px; flex-wrap:wrap; align-items:center; margin:0 0 14px; }
  .filters label { display:flex; gap:6px; align-items:center; font-family:var(--mono); font-size:11px; letter-spacing:.08em; color:var(--dim); text-transform:uppercase; }
  .filters select, .filters input[type=search] { font-family:system-ui,sans-serif; font-size:13px; text-transform:none; letter-spacing:0; color:var(--text); background:#0b1320; border:1px solid var(--line); border-radius:8px; padding:6px 8px; }
  .catalogue { display:grid; grid-template-columns:repeat(auto-fit,minmax(310px,1fr)); gap:14px; }
  .slot { border:1px solid var(--line); border-radius:12px; padding:12px; background:#0b1320; }
  .slothero { margin-bottom:8px; }
  .slothero b { font-family:var(--mono); font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--cyan); display:block; }
  .slothero span { font-size:12px; }
  .entry { display:flex; gap:10px; align-items:flex-start; border:1px solid transparent; border-radius:9px; padding:8px 9px; cursor:pointer; }
  .entry:hover { border-color:#33506f; }
  .entry.active { border-color:var(--cyan); background:#0f1c2c; }
  .entry input { margin-top:3px; accent-color:var(--cyan); }
  .entry .name { font-family:var(--mono); font-size:12px; word-break:break-all; }
  .entry .badges { display:block; margin-top:5px; }
  .badge.ok { color:var(--green); border-color:#25492f; }
  footer { max-width:1040px; margin:26px auto 0; padding:0 22px; color:var(--dim); font-family:var(--mono); font-size:11px; letter-spacing:.1em; }
</style>
</head>
<body>
<header>
  <div class="brand">J.A.R.V.I.S <span>· setup</span></div>
  <div class="sub">Pick one model for each of three jobs. This page installs the model runtime with Ollama's own CLI one-liner, then downloads exactly the three models you chose. Nothing is downloaded until you press the button.</div>
</header>
<main>
  <section class="card">
    <h2>1 · this machine</h2>
    <div id="machine" class="grid"><div class="stat"><b>status</b><span>probing…</span></div></div>
  </section>

  <section class="card">
    <h2>2 · runtime</h2>
    <div id="runtime"><span class="muted">checking for Ollama…</span></div>
  </section>

  <section class="card">
    <h2>3 · models — one for each job</h2>
    <p class="note">Everything this project knows about, with what it costs and what it needs. The small ones are ticked to start with; a bigger one is allowed, and marked when it will not fit here. <b>chat</b>, <b>vision</b> and <b>coder &amp; reasoning</b> all need a pick before the button wakes up.</p>
    <div class="filters">
      <label>biggest download <select id="fMaxGb"></select></label>
      <label>biggest model <select id="fMaxParams"></select></label>
      <label>quantization <select id="fQuant"></select></label>
      <label><input type="checkbox" id="fFit" checked> only what fits</label>
      <label>search <input id="fSearch" type="search" placeholder="model name" autocomplete="off"></label>
    </div>
    <div id="catalogue" class="catalogue"><span class="muted">loading the catalogue…</span></div>
    <div class="actions">
      <button id="install" class="primary" disabled>Install everything</button>
      <span id="pick" class="muted">choosing…</span>
      <span style="flex:1"></span>
    </div>
  </section>

  <section class="card">
    <h2>4 · progress</h2>
    <div class="bar"><i id="bar"></i></div>
    <div id="steps" class="steps"><div class="step muted">Nothing downloaded yet.</div></div>
    <div id="done"></div>
  </section>
</main>
<footer>bridge · http://localhost:${port} · setup page is served locally</footer>
<script>
(function () {
  var HUD = ${JSON.stringify(hudUrl)}
  var OS = ${JSON.stringify(osName)}
  var RUNTIME_LINE = ${JSON.stringify(runtimeLine)}
  var state = {
    cat: null,
    plan: null,
    pick: {},
    filters: { maxGb: '', maxParams: '', quant: '', fit: true, q: '' },
    filtersBuilt: false,
    job: null,
    poll: null,
    runtime: null,
    variant: 'default',
    variantChosen: false
  }

  function el(id) { return document.getElementById(id) }
  function gb(n) { return (Math.round(n * 100) / 100) + ' GB' }
  function esc(value) {
    return String(value).replace(/[&<>"]/g, function (c) {
      if (c === '&') return '&amp;'
      if (c === '<') return '&lt;'
      if (c === '>') return '&gt;'
      return '&quot;'
    })
  }
  function stat(label, value, cls) {
    return '<div class="stat"><b>' + label + '</b><span class="' + (cls || '') + '">' + value + '</span></div>'
  }
  function unique(values) {
    var seen = {}
    var out = []
    values.forEach(function (v) { if (v != null && v !== '' && !seen[v]) { seen[v] = 1; out.push(v) } })
    return out.sort(function (a, b) {
      return typeof a === 'number' ? a - b : String(a).localeCompare(String(b))
    })
  }

  function renderMachine(machine) {
    el('machine').innerHTML =
      stat('platform', OS)
      + stat('memory', (machine.totalRamGb || '?') + ' GB')
      + stat('free now', (machine.freeRamGb || '?') + ' GB', (machine.freeRamGb || 0) > (machine.totalRamGb || 1) * 0.25 ? 'ok' : 'bad')
      + stat('disk free', machine.freeDiskGb != null ? machine.freeDiskGb + ' GB' : 'unknown')
      + stat('ai ceiling', gb(machine.budgetGb || 0) + ' · ' + (machine.sharePercent || 0) + '% of free')
  }

  function buildFilters(cat) {
    if (state.filtersBuilt) return
    var all = []
    cat.slots.forEach(function (slot) { all = all.concat(slot.entries) })
    function fill(id, any, list) {
      var html = '<option value="">' + any + '</option>'
      list.forEach(function (value) {
        html += '<option value="' + esc(value.value) + '">' + esc(value.label) + '</option>'
      })
      el(id).innerHTML = html
    }
    fill('fMaxGb', 'any download', unique(all.map(function (e) { return e.downloadGb })).map(function (v) { return { value: v, label: v + ' GB or less' } }))
    fill('fMaxParams', 'any model', unique(all.map(function (e) { return e.parametersB })).map(function (v) { return { value: v, label: v + ' B or less' } }))
    fill('fQuant', 'any quant', unique(all.map(function (e) { return e.quant })).map(function (v) { return { value: v, label: v } }))
    state.filtersBuilt = true
  }

  function visible(entry) {
    var f = state.filters
    if (f.fit && !entry.fits) return false
    if (f.maxGb !== '' && entry.downloadGb > Number(f.maxGb)) return false
    if (f.maxParams !== '' && (entry.parametersB || 0) > Number(f.maxParams)) return false
    if (f.quant !== '' && entry.quant !== f.quant) return false
    if (f.q && entry.model.toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false
    return true
  }

  function entryRow(slot, entry) {
    var chosen = state.pick[slot.id] === entry.id
    var badges = '<span class="badge">' + entry.parametersB + ' B</span>'
      + '<span class="badge">' + esc(entry.quant) + '</span>'
      + '<span class="badge">' + gb(entry.downloadGb) + ' download</span>'
      + '<span class="badge">' + gb(entry.residentGb) + ' RAM</span>'
      + (entry.multimodal ? '<span class="badge">sees images</span>' : '')
      + (entry.fits ? '<span class="badge ok">fits here</span>' : '<span class="badge big">over the ceiling</span>')
    return '<label class="entry' + (chosen ? ' active' : '') + '" data-slot="' + slot.id + '" data-id="' + esc(entry.id) + '">'
      + '<input type="radio" name="slot-' + slot.id + '"' + (chosen ? ' checked' : '') + '>'
      + '<span><span class="name">' + esc(entry.model) + '</span><span class="badges">' + badges + '</span></span>'
      + '</label>'
  }

  function renderCatalogue() {
    var cat = state.cat
    if (!cat) return
    var html = ''
    cat.slots.forEach(function (slot) {
      var rows = slot.entries.filter(visible)
      html += '<div class="slot"><div class="slothero"><b>' + esc(slot.label) + '</b><span class="muted">' + esc(slot.purpose) + '</span></div>'
      html += rows.map(function (entry) { return entryRow(slot, entry) }).join('') || '<span class="muted">nothing in the catalogue matches these filters</span>'
      html += '</div>'
    })
    el('catalogue').innerHTML = html
    Array.prototype.forEach.call(el('catalogue').querySelectorAll('.entry'), function (row) {
      row.onclick = function () { pickModel(row.getAttribute('data-slot'), row.getAttribute('data-id')) }
    })
  }

  function pickModel(slotId, id) {
    state.pick[slotId] = id
    renderCatalogue()
    updatePick()
  }

  function findEntry(slotId, id) {
    var slot = (state.cat.slots || []).filter(function (candidate) { return candidate.id === slotId })[0]
    if (!slot) return null
    return slot.entries.filter(function (entry) { return entry.id === id })[0] || null
  }

  function updatePick() {
    if (!state.cat) return
    var missing = ['chat', 'vision', 'coder'].filter(function (slot) { return !state.pick[slot] })
    var button = el('install')
    button.disabled = missing.length > 0
    var total = 0
    Object.keys(state.pick).forEach(function (slotId) {
      var entry = findEntry(slotId, state.pick[slotId])
      if (entry) total += entry.downloadGb
    })
    var running = !!(state.plan && state.plan.ollama)
    el('pick').textContent = missing.length
      ? 'still to choose: ' + missing.join(', ')
      : 'three chosen · ' + gb(total) + ' of models' + (running ? '' : ' · runtime installs first')
    button.textContent = running ? 'Download my three' : 'Install everything'
  }

  function renderRuntime() {
    var plan = state.plan
    if (!plan) return
    var rt = plan.runtime || {}
    var running = !!plan.ollama
    var slots = (plan.modelSlots || []).filter(function (s) { return s.model })
    var ready = slots.filter(function (s) { return s.state === 'ready' }).length
    var html = '<div class="grid">'
      + stat('ollama', running ? 'running' : (rt.ollamaInstalled ? 'installed, not running' : 'not installed'), running ? 'ok' : 'bad')
      + stat('models ready', ready + ' / ' + slots.length, ready === slots.length && slots.length ? 'ok' : 'bad')
      + '</div>'
    if (!running) {
      html += '<p class="note">' + RUNTIME_LINE + '</p>'
      var variants = (state.runtime && state.runtime.variants) || []
      if (!rt.ollamaInstalled && variants.length > 1) {
        html += '<p class="note muted" style="font-size:13px">Which build? The default covers NVIDIA and CPU; AMD cards need their own build.</p><div class="tiers">'
        variants.forEach(function (v) {
          html += '<label class="tier' + (state.variant === v.id ? ' active' : '') + '"><input type="radio" name="rtvariant" value="' + v.id + '"' + (state.variant === v.id ? ' checked' : '') + '>'
            + '<span class="ram">' + (v.id === 'rocm' ? 'AMD · ROCm' : 'NVIDIA CUDA + CPU') + '</span>'
            + '<span class="meta">' + esc(v.name) + (v.sizeBytes ? ' · ' + gb(v.sizeBytes / 1073741824) : '') + (v.verified ? ' · checksum published' : '') + (state.runtime.rocmSuggested && v.id === 'rocm' ? ' · detected on this machine' : '') + '</span></label>'
        })
        html += '</div>'
      }
      html += '<div class="actions"><span style="flex:1"></span><button id="recheck">Re-check</button></div>'
    }
    el('runtime').innerHTML = html
    var again = el('recheck')
    if (again) again.onclick = load
    wireVariants()
  }

  function wireVariants() {
    var radios = document.querySelectorAll('input[name=rtvariant]')
    for (var i = 0; i < radios.length; i += 1) {
      radios[i].onchange = function (event) {
        state.variant = event.target.value
        state.variantChosen = true
        renderRuntime()
      }
    }
  }

  function stepLine(step) {
    var label = ''
    if (step.phase === 'plan') label = 'planned · ' + (step.summary || '')
    else if (step.phase === 'pull') label = 'downloading ' + step.model + (step.total ? ' · ' + Math.round((step.completed / step.total) * 100) + '%' : '')
    else if (step.phase === 'skip') label = 'already there · ' + (step.model || step.cap || '') + (step.status ? ' · ' + step.status : '')
    else if (step.phase === 'runtime') label = 'runtime · ' + (step.status || 'ready')
    else if (step.phase === 'runtime-download') label = 'runtime · ' + (step.status || 'downloading') + (step.total ? ' · ' + Math.round((step.completed / step.total) * 100) + '%' : '')
    else if (step.phase === 'runtime-install') label = 'runtime · ' + (step.status || 'running the official installer silently')
    else if (step.phase === 'runtime-unpack') label = 'runtime · ' + (step.status || 'unpacking')
    else if (step.phase === 'runtime-ready') label = 'runtime · ' + (step.status || 'ready')
    else if (step.phase === 'done') label = 'finished · ' + step.installed + ' installed, ' + (step.skipped || 0) + ' already there, ' + (step.failed || 0) + ' failed'
    else if (step.phase === 'error') label = 'error · ' + (step.message || '')
    else label = step.phase
    var runtimePhase = step.phase && step.phase.indexOf('runtime') === 0
    var cls = step.phase === 'done' ? 'done' : step.phase === 'error' ? 'fail' : (step.phase === 'pull' || step.phase === 'runtime-download' || step.phase === 'runtime-install') ? 'now' : runtimePhase && step.ok === false ? 'fail' : ''
    return '<div class="step ' + cls + '"><span class="mark">' + (step.phase === 'done' ? '✓' : step.phase === 'error' ? '✗' : '›') + '</span><span>' + esc(label) + '</span></div>'
  }

  function renderProgress(job) {
    var steps = (job.steps || []).slice(-60)
    el('steps').innerHTML = steps.map(stepLine).join('') || '<div class="step muted">starting…</div>'
    el('steps').scrollTop = el('steps').scrollHeight
    var current = steps.filter(function (s) { return s.phase === 'pull' || s.phase === 'runtime-download' }).pop()
    if (current && current.total) el('bar').style.width = Math.min(100, Math.round((current.completed / current.total) * 100)) + '%'
    else if (job.state === 'running') el('bar').style.width = '8%'
    if (job.state !== 'running') {
      el('bar').style.width = '100%'
      var failed = job.state === 'failed' || job.state === 'partial'
      el('done').innerHTML = '<p class="note">' + (failed
        ? 'Partly finished. Anything that failed is listed above; press the button again and it retries only what is missing.'
        : HUD
          ? 'Your three models are ready. Open JARVIS below — the first turn loads the weights into memory.'
          : 'Your three models are ready. Restart the bridge (Ctrl-C, then <code>npm start</code>) so the new models are routed.') + '</p>'
        + (HUD && !failed ? '<div class="actions"><a href="' + HUD + '"><button>Open JARVIS</button></a></div>' : '')
      if (state.poll) { clearInterval(state.poll); state.poll = null }
      load()
    }
  }

  function install() {
    var missing = ['chat', 'vision', 'coder'].filter(function (slot) { return !state.pick[slot] })
    if (missing.length) return
    el('install').disabled = true
    el('done').innerHTML = ''
    fetch('models/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat: state.pick.chat,
        vision: state.pick.vision,
        coder: state.pick.coder,
        runtime: !(state.plan && state.plan.ollama),
        variant: state.variant
      })
    }).then(function (r) { return r.json() }).then(function (res) {
      if (res.error) { el('steps').innerHTML = '<div class="step fail"><span class="mark">✗</span><span>' + esc(res.error) + '</span></div>'; el('install').disabled = false; return }
      state.job = res.jobId
      el('steps').innerHTML = '<div class="step now"><span class="mark">›</span><span>starting…</span></div>'
      if (state.poll) clearInterval(state.poll)
      state.poll = setInterval(poll, 1200)
      poll()
    }).catch(function (error) {
      el('steps').innerHTML = '<div class="step fail"><span class="mark">✗</span><span>' + esc(error.message) + '</span></div>'
      el('install').disabled = false
    })
  }

  function poll() {
    if (!state.job) return
    fetch('models/download/status?id=' + encodeURIComponent(state.job))
      .then(function (r) { return r.json() })
      .then(function (job) { if (job.error && job.state !== 'failed') return; renderProgress(job) })
      .catch(function () {})
  }

  function loadRuntime() {
    fetch('autopilot/runtime').then(function (r) { return r.json() }).then(function (data) {
      state.runtime = data
      if (data.rocmSuggested && !state.variantChosen) state.variant = 'rocm'
      renderRuntime()
    }).catch(function () { /* the rest of the page still works without it */ })
  }

  function load() {
    loadRuntime()
    fetch('models/catalogue').then(function (r) { return r.json() }).then(function (cat) {
      state.cat = cat
      if (!Object.keys(state.pick).length) state.pick = Object.assign({}, cat.defaults || {})
      buildFilters(cat)
      renderMachine(cat.machine)
      renderCatalogue()
      updatePick()
    }).catch(function (error) {
      el('catalogue').innerHTML = '<div class="stat"><b>bridge</b><span class="bad">' + esc(error.message) + '</span></div>'
    })
    fetch('autopilot').then(function (r) { return r.json() }).then(function (plan) {
      state.plan = plan
      renderRuntime()
      updatePick()
    }).catch(function () { /* the catalogue is still useful without the plan */ })
  }

  el('install').onclick = install
  ;['fMaxGb', 'fMaxParams', 'fQuant'].forEach(function (id) {
    el(id).onchange = function () {
      state.filters.maxGb = el('fMaxGb').value
      state.filters.maxParams = el('fMaxParams').value
      state.filters.quant = el('fQuant').value
      renderCatalogue()
    }
  })
  el('fFit').onchange = function () { state.filters.fit = this.checked; renderCatalogue() }
  el('fSearch').oninput = function () { state.filters.q = this.value; renderCatalogue() }
  load()
})()
</script>
</body>
</html>
`
}
