/**
 * The setup page.
 *
 * Installation used to be a command: the build script decided which models fit
 * and pulled them, with no say from the person waiting. This page replaces that
 * with a choice and a single button. `npm run setup` hosts the bridge, opens the
 * default browser at /install, and everything from then on happens here: what
 * this machine is, whether the runtime is present, which stack to download, and
 * the progress of every file.
 *
 * It is served by the bridge rather than by Vite or a public site because it has
 * to talk to the bridge's own install endpoints, and because it must work on a
 * machine where the only thing installed so far is Node. So it is one file, no
 * build step, no external assets, and it degrades to readable text if the fetch
 * fails.
 */

/** Where the official installer lives for each platform. */
export const OLLAMA_DOWNLOAD = Object.freeze({
  win32: 'https://ollama.com/download/OllamaSetup.exe',
  darwin: 'https://ollama.com/download/Ollama.dmg',
  linux: 'https://ollama.com/download/ollama-linux-amd64.tgz',
})

/** The one-line command for the platforms where a package manager is normal. */
export const OLLAMA_COMMAND = 'curl -fsSL https://ollama.com/install.sh | sh'

const PLATFORM_NAME = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }

/**
 * The whole page, as a string.
 *
 * @param {{ platform?: string, port?: number, hudUrl?: string }} options
 */
export function installerPage({ platform = process.platform, port = 8787, hudUrl = null } = {}) {
  const download = OLLAMA_DOWNLOAD[platform] ?? OLLAMA_DOWNLOAD.linux
  const osName = PLATFORM_NAME[platform] ?? platform
  const runtimeLine = platform === 'win32'
    ? `Download the installer and run it, then come back and press re-check.`
    : platform === 'darwin'
      ? `Open the disk image and copy Ollama to Applications, then press re-check.`
      : `Unpack it anywhere on your PATH, or run the command below, then press re-check.`

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
  footer { max-width:1040px; margin:26px auto 0; padding:0 22px; color:var(--dim); font-family:var(--mono); font-size:11px; letter-spacing:.1em; }
</style>
</head>
<body>
<header>
  <div class="brand">J.A.R.V.I.S <span>· setup</span></div>
  <div class="sub">One button: the model runtime, then the stack you picked, downloaded by this bridge into this project's own folders. No installer, no administrator prompt, no system-wide changes.</div>
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
    <h2>3 · stack</h2>
    <div id="tiers" class="tiers"><span class="muted">loading the ladder…</span></div>
    <div class="actions">
      <button id="install" class="primary" disabled>Install everything</button>
      <span id="pick" class="muted">no stack selected</span>
      <span style="flex:1"></span>
      <label class="muted" style="font-size:13px"><input type="checkbox" id="fitsOnly"> show only what this machine can run</label>
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
  var DOWNLOAD = ${JSON.stringify(download)}
  var COMMAND = ${JSON.stringify(platform === 'linux' ? OLLAMA_COMMAND : null)}
  var HUD = ${JSON.stringify(hudUrl)}
  var OS = ${JSON.stringify(osName)}
  var state = { plan: null, tiers: [], selected: null, job: null, poll: null, fitsOnly: false, runtime: null, variant: 'default' }

  function el(id) { return document.getElementById(id) }
  function gb(n) { return (Math.round(n * 100) / 100) + ' GB' }
  function modelsOf(tier) {
    var seen = {}, out = []
    Object.keys(tier.slots || {}).forEach(function (cap) {
      var s = tier.slots[cap]
      var name = s.model || s.file
      if (!name || seen[name]) return
      seen[name] = 1
      out.push('<b>' + name + '</b>')
    })
    return out.join(' · ') || 'browser voice only'
  }

  function stat(label, value, cls) {
    return '<div class="stat"><b>' + label + '</b><span class="' + (cls || '') + '">' + value + '</span></div>'
  }

  function renderMachine() {
    var ram = state.plan.ram || {}
    el('machine').innerHTML =
      stat('platform', OS + ' · ' + (state.plan.runtime && state.plan.runtime.arch ? state.plan.runtime.arch : ''))
      + stat('memory', (ram.totalGb || '?') + ' GB', '')
      + stat('free now', (ram.freeGb || '?') + ' GB', (ram.freeGb || 0) > (ram.totalGb || 1) * 0.25 ? 'ok' : 'bad')
      + stat('disk free', (state.plan.runtime && state.plan.runtime.diskFreeGb != null ? state.plan.runtime.diskFreeGb + ' GB' : 'unknown'))
      + stat('ai ceiling', gb(ram.modelsGb || 0) + ' · ' + (ram.sharePercent || 0) + '% of free')
  }

  function renderRuntime() {
    var rt = state.plan.runtime || {}
    var running = state.plan.ollama
    var slots = (state.plan.modelSlots || []).filter(function (s) { return s.model })
    var ready = slots.filter(function (s) { return s.state === 'ready' }).length
    var portable = rt.portable || {}
    var html = '<div class="grid">'
      + stat('ollama', running ? 'running' : (rt.ollamaInstalled ? 'installed, not running' : 'not installed'), running ? 'ok' : 'bad')
      + stat('project runtime', portable.present ? 'ready in models/runtime' : (portable.supported ? 'not downloaded yet' : 'not published for this platform'), portable.present ? 'ok' : '')
      + stat('models ready', ready + ' / ' + slots.length, ready === slots.length && slots.length ? 'ok' : 'bad')
      + '</div>'
      + (running && ready < slots.length
        ? '<p class="note">Selected stack still needs ' + (slots.length - ready) + ' model' + (slots.length - ready === 1 ? '' : 's') + '. Pick a stack below and download it in one click.</p>'
        : '')
    if (!running) {
      var portable = rt.portable || {}
      var line
      if (rt.ollamaInstalled) {
        line = 'Ollama is installed but not answering. Press <b>Install everything</b> below and this page will start it for you; or start it yourself (<code>ollama serve</code>, or the desktop app) and press re-check.'
      } else if (portable.present) {
        line = 'The model runtime is already unpacked in this project (<code>' + (portable.path || '') + '</code>). Press <b>Install everything</b> below: it starts here, and the models follow.'
      } else {
        var chosen = chosenVariant()
        line = 'No model runtime yet. Press <b>Install everything</b> below and this page downloads the official standalone Ollama archive'
          + (chosen ? ' (<code>' + chosen.name + '</code>' + (chosen.sizeBytes ? ' · ' + gb(chosen.sizeBytes / 1073741824) : '') + ')' : '')
          + ' into this project, checks it against the release checksum, unpacks it, starts it, then downloads the stack you picked. Nothing is installed system-wide and nothing is added to your PATH.'
      }
      html += '<p class="note">' + line + '</p>'
      var variants = state.runtime && state.runtime.variants ? state.runtime.variants : []
      if (!rt.ollamaInstalled && !portable.present && variants.length > 1) {
        html += '<p class="note muted" style="font-size:13px">Which build? The default covers NVIDIA and CPU; AMD cards need their own build.</p><div class="tiers">'
        variants.forEach(function (v) {
          html += '<label class="tier' + (state.variant === v.id ? ' active' : '') + '"><input type="radio" name="rtvariant" value="' + v.id + '"' + (state.variant === v.id ? ' checked' : '') + '>'
            + '<span class="ram">' + (v.id === 'rocm' ? 'AMD · ROCm' : 'NVIDIA CUDA + CPU') + '</span>'
            + '<span class="meta">' + v.name + (v.sizeBytes ? ' · ' + gb(v.sizeBytes / 1073741824) : '') + (v.verified ? ' · checksum published' : '') + (state.runtime.rocmSuggested && v.id === 'rocm' ? ' · detected on this machine' : '') + '</span></label>'
        })
        html += '</div>'
      }
      html += '<p class="note muted" style="font-size:13px">Already have Ollama, or want it managed by the system? ' + ${JSON.stringify(runtimeLine)} + '</p>'
      html += '<div class="actions"><a href="' + DOWNLOAD + '" target="_blank" rel="noreferrer"><button>Download the ' + OS + ' installer instead</button></a>'
      if (COMMAND) html += '<code>' + COMMAND + '</code>'
      html += '<span style="flex:1"></span><button id="recheck">Re-check</button></div>'
    }
    el('runtime').innerHTML = html
    var again = el('recheck')
    if (again) again.onclick = load
    wireVariants()
  }

  function chosenVariant() {
    var list = (state.runtime && state.runtime.variants) || []
    for (var i = 0; i < list.length; i += 1) if (list[i].id === state.variant) return list[i]
    return list[0] || null
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

  function tierRow(tier) {
    var tooBig = tier.ramGb > (state.plan.runtime && state.plan.runtime.totalRamGb ? state.plan.runtime.totalRamGb : Infinity)
    var badges = ''
    if (tier.recommended) badges += '<span class="badge rec">recommended</span>'
    if (tooBig) badges += '<span class="badge big">larger than this machine</span>'
    return '<label class="tier' + (state.selected === tier.ramGb ? ' active' : '') + '" data-ram="' + tier.ramGb + '">'
      + '<input type="radio" name="tier" value="' + tier.ramGb + '"' + (state.selected === tier.ramGb ? ' checked' : '') + '>'
      + '<span class="ram">' + (tier.ramGb < 1 ? '500 MB' : tier.ramGb + ' GB') + '</span>'
      + '<span class="models">' + modelsOf(tier) + badges + '</span>'
      + '<span class="size">' + gb(tier.totalDownloadGb || 0) + '</span>'
      + '</label>'
  }

  function renderTiers() {
    var hostRam = (state.plan.runtime && state.plan.runtime.totalRamGb) || 0
    var show = state.tiers.filter(function (t) { return !state.fitsOnly || t.ramGb <= hostRam })
    el('tiers').innerHTML = show.map(tierRow).join('') || '<span class="muted">no stacks match</span>'
    Array.prototype.forEach.call(el('tiers').querySelectorAll('.tier'), function (row) {
      row.onclick = function () { pick(Number(row.getAttribute('data-ram'))) }
    })
    updatePick()
  }

  function pick(ramGb) {
    state.selected = ramGb
    renderTiers()
  }

  function updatePick() {
    var tier = state.tiers.filter(function (t) { return t.ramGb === state.selected })[0]
    var button = el('install')
    if (!tier || !state.plan.ollama) {
      button.disabled = true
    } else {
      button.disabled = false
    }
    el('pick').textContent = tier
      ? 'Install everything · ' + (tier.ramGb < 1 ? '500 MB' : tier.ramGb + ' GB') + ' stack · ' + gb(tier.totalDownloadGb || 0) + ' of models'
      : 'no stack selected'
  }

  function stepLine(step) {
    var label = ''
    if (step.phase === 'plan') label = 'planned · ' + (step.summary || '')
    else if (step.phase === 'pull') label = 'downloading ' + step.model + (step.total ? ' · ' + Math.round((step.completed / step.total) * 100) + '%' : '')
    else if (step.phase === 'whisper') label = 'downloading ' + step.file + (step.total ? ' · ' + Math.round((step.completed / step.total) * 100) + '%' : '')
    else if (step.phase === 'runtime') label = 'runtime · ' + (step.status || 'ready')
    else if (step.phase === 'runtime-download') label = 'runtime · ' + (step.status || 'downloading') + (step.total ? ' · ' + Math.round((step.completed / step.total) * 100) + '%' : '')
    else if (step.phase === 'runtime-unpack') label = 'runtime · ' + (step.status || 'unpacking')
    else if (step.phase === 'runtime-ready') label = 'runtime · ' + (step.status || 'ready')
    else if (step.phase === 'runtime-verify') label = 'runtime · ' + (step.status || 'verifying')
    else if (step.phase === 'skip') label = 'skipped ' + (step.model || step.cap || '') + (step.status ? ' · ' + step.status : '')
    else if (step.phase === 'browser-voice') label = 'voice · ' + (step.status || step.model || 'browser')
    else if (step.phase === 'done') label = 'finished · ' + step.installed + ' installed, ' + (step.skipped || 0) + ' skipped, ' + (step.failed || 0) + ' failed'
    else if (step.phase === 'error') label = 'error · ' + (step.message || '')
    else label = step.phase
    var runtimePhase = step.phase && step.phase.indexOf('runtime') === 0
    if (step.phase === 'runtime-verify') cls = 'now'
    var cls = step.phase === 'done' ? 'done' : step.phase === 'error' ? 'fail' : (step.phase === 'pull' || step.phase === 'whisper' || step.phase === 'runtime-download') ? 'now' : runtimePhase && step.ok === false ? 'fail' : ''
    return '<div class="step ' + cls + '"><span class="mark">' + (step.phase === 'done' ? '✓' : step.phase === 'error' ? '✗' : '›') + '</span><span>' + label + '</span></div>'
  }

  function renderProgress(job) {
    var steps = (job.steps || []).slice(-60)
    el('steps').innerHTML = steps.map(stepLine).join('') || '<div class="step muted">starting…</div>'
    el('steps').scrollTop = el('steps').scrollHeight
    var current = steps.filter(function (s) { return s.phase === 'pull' || s.phase === 'whisper' || s.phase === 'runtime-download' }).pop()
    if (current && current.total) el('bar').style.width = Math.min(100, Math.round((current.completed / current.total) * 100)) + '%'
    else if (job.state === 'running') el('bar').style.width = '8%'
    if (job.state !== 'running') {
      el('bar').style.width = job.state === 'completed' ? '100%' : '100%'
      var failed = job.state === 'failed' || job.state === 'partial'
      el('done').innerHTML = '<p class="note">' + (failed
        ? 'Partly finished. Anything that failed is listed above; press re-check and try again.'
        : 'Stack ready. Restart the bridge (Ctrl-C, then <code>npm start</code>) so the new models are routed.') + '</p>'
        + (HUD ? '<div class="actions"><a href="' + HUD + '"><button>Open JARVIS</button></a></div>' : '')
      if (state.poll) { clearInterval(state.poll); state.poll = null }
      load()
    }
  }

  function install() {
    if (!state.selected) return
    el('install').disabled = true
    el('done').innerHTML = ''
    fetch('autopilot/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ramGb: state.selected, runtime: true, runtimeVariant: state.variant }),
    }).then(function (r) { return r.json() }).then(function (res) {
      if (res.error) { el('steps').innerHTML = '<div class="step fail"><span class="mark">✗</span><span>' + res.error + '</span></div>'; return }
      state.job = res.jobId
      el('steps').innerHTML = '<div class="step now"><span class="mark">›</span><span>starting…</span></div>'
      if (state.poll) clearInterval(state.poll)
      state.poll = setInterval(poll, 1200)
      poll()
    }).catch(function (error) {
      el('steps').innerHTML = '<div class="step fail"><span class="mark">✗</span><span>' + error.message + '</span></div>'
    })
  }

  function poll() {
    if (!state.job) return
    fetch('autopilot/install/status?id=' + encodeURIComponent(state.job))
      .then(function (r) { return r.json() })
      .then(function (job) { if (job.error) return; renderProgress(job) })
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
    fetch('autopilot').then(function (r) { return r.json() }).then(function (plan) {
      state.plan = plan
      state.tiers = plan.tiers || []
      if (!state.selected) {
        var host = (plan.runtime && plan.runtime.totalRamGb) || 0
        var nearest = state.tiers.filter(function (t) { return t.ramGb <= host })[0]
        state.selected = (plan.ram && plan.ram.totalGb ? plan.ram.totalGb : nearest ? nearest.ramGb : 8)
        // the ladder is in 1 GB steps; snap to the nearest row at or below the host
        var exact = state.tiers.filter(function (t) { return t.ramGb === Math.floor(state.selected) })[0]
        state.selected = exact ? exact.ramGb : nearest ? nearest.ramGb : state.selected
      }
      state.tiers = state.tiers.map(function (t) {
        return Object.assign({}, t, { recommended: t.ramGb === state.selected })
      })
      renderMachine()
      renderRuntime()
      renderTiers()
    }).catch(function (error) {
      el('machine').innerHTML = '<div class="stat"><b>bridge</b><span class="bad">' + error.message + '</span></div>'
    })
  }

  el('install').onclick = install
  el('fitsOnly').onchange = function () { state.fitsOnly = this.checked; renderTiers() }
  load()
})()
</script>
</body>
</html>
`
}
