import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GB = 1024 ** 3
let pullCalls = 0
let ollamaOnline = true
let installedNames = new Set()
const ollama = createServer((req, res) => {
  if (req.url === '/api/tags') {
    if (!ollamaOnline) {
      res.writeHead(503)
      return res.end('offline')
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ models: [...installedNames].map((name) => ({ name })) }))
  }
  if (req.url === '/api/pull') {
    pullCalls++
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    return res.end('{"status":"success"}\n')
  }
  res.writeHead(404)
  res.end()
})

await new Promise((resolve) => ollama.listen(0, '127.0.0.1', resolve))
process.env.JARVIS_OLLAMA_URL = `http://127.0.0.1:${ollama.address().port}`

// The saved allocation lives in a temp file so a developer's real
// models/ram-allocation.json can never change what these tests assert.
const configDir = await mkdtemp(join(tmpdir(), 'jarvis-ram-config-'))
process.env.JARVIS_RAM_CONFIG = join(configDir, 'ram-allocation.json')

let tempDir
const mockRuntimeScope = join(process.cwd(), 'node_modules', '@lumen-labs-dev')
const mockRuntimePackage = join(mockRuntimeScope, 'whisper-node')
let mockRuntimeCreated = false
let mockRuntimeScopeCreated = false
try {
  const {
    ALLOCATION,
    plan,
    planSummary,
    budget,
    install,
    whisperFileReady,
    tierProfiles,
    ladder,
    parseShare,
    parseCapGb,
    saveAllocation,
    readAllocationConfig,
    resolveAllocation,
  } = await import('../bridge/autopilot.mjs')
  const tiers = [0.5, 0.75, 1, 2, 3, 4, 8, 12, 16, 20, 24, 28, 32]
  const snapshots = new Map()
  for (const ramGb of tiers) {
    const total = ramGb * GB
    const p = plan({ total, free: total, gpuInfo: null, share: 1 })
    snapshots.set(ramGb, p)

    assert.equal(p.budget.share, 1, `${ramGb} GB explicit share is used verbatim`)
    assert.equal(p.budget.sharePercent, 100, `${ramGb} GB share renders as a percentage`)
    assert.equal(p.budget.capGb, null, `${ramGb} GB has no hard cap unless one is set`)
    assert.equal(p.budget.models, Math.floor(total), `${ramGb} GB AI ceiling is all free RAM at a 100% share`)
    assert.equal(p.effectiveModelBytes, p.budget.models, `${ramGb} GB active model ceiling equals the allocation`)
    assert.ok(p.budget.unallocated <= total, `${ramGb} GB unallocated RAM never exceeds the host`)
    assert.ok(p.maxResidentBytes <= p.effectiveModelBytes, `${ramGb} GB combined model/TTS peak`)
    assert.ok(p.choices.chat, `${ramGb} GB shows the closest abliterated chat pick`)
    assert.ok(p.choices.vision, `${ramGb} GB keeps an explicit multimodal vision pick`)
    assert.ok(p.choices.reason, `${ramGb} GB shows the closest abliterated coding pick`)
    assert.ok(p.choices.tts, `${ramGb} GB always has a TTS path`)
    assert.ok(/abliterat/i.test(p.choices.chat.model), `${ramGb} GB chat remains abliterated`)
    assert.ok(p.choices.vision.multimodal, `${ramGb} GB vision choice accepts images`)
    assert.equal(p.choices.chat.model, p.choices.reason.model, `${ramGb} GB shares one model across chat and coding`)
    assert.equal(p.choices.chat.multilingual, true, `${ramGb} GB chat is tagged multilingual`)
    assert.equal(p.choices.reason.englishOnly, true, `${ramGb} GB coding model is tagged English-only`)
    assert.ok(!p.choices.speech || !/\.en\./i.test(p.choices.speech.file), `${ramGb} GB Whisper choice is multilingual`)
    for (const [slot, rung] of Object.entries(p.choices)) {
      if (rung.fits) assert.ok(rung.residentBytes <= p.effectiveModelBytes, `${ramGb} GB ${slot} fit flag is truthful`)
    }
    const uniqueExpectedDownloads = new Map()
    for (const rung of Object.values(p.choices)) {
      if (!rung.fits) continue
      const key = rung.kind === 'whisper' ? `whisper:${rung.file}` : rung.kind === 'tts' ? `tts:${rung.model}` : `ollama:${rung.model}`
      uniqueExpectedDownloads.set(key, rung.bytes)
    }
    assert.equal(p.totalDownloadBytes, [...uniqueExpectedDownloads.values()].reduce((sum, bytes) => sum + bytes, 0), `${ramGb} GB shared assets count once`)
    assert.ok(p.totalDownloadBytes >= 0, `${ramGb} GB download estimate is non-negative`)
  }

  // The allocation model: an explicit share, an explicit cap, and the two
  // together. A cap always wins when it is the smaller of the two.
  const quarterShare = plan({ total: 16 * GB, free: 8 * GB, gpuInfo: null, share: 0.25 })
  assert.equal(quarterShare.budget.models, Math.floor(8 * GB * 0.25), 'a 25% share takes a quarter of free RAM')
  assert.equal(quarterShare.budget.unallocated, 8 * GB - quarterShare.budget.models, 'unallocated RAM is reported honestly')
  assert.ok(/0\.8b|2b/.test(quarterShare.choices.chat.model), 'a 2 GB allocation steps down to a small rung')
  const capped = plan({ total: 32 * GB, free: 32 * GB, gpuInfo: null, share: 1, capGb: 6 })
  assert.equal(capped.budget.models, Math.floor(6 * GB), 'the hard cap wins when it is smaller than the share')
  assert.equal(capped.budget.capGb, 6, 'the cap is reported for the UI')
  assert.equal(capped.choices.chat.parametersB, 4.54, 'a 6 GB cap selects the 4.54B rung, not the 9.65B one')
  assert.equal(capped.choices.chat.quant, 'Q4_K_M', 'the cap steps the quantization down honestly')
  const bothLimits = plan({ total: 32 * GB, free: 16 * GB, gpuInfo: null, share: 0.5, capGb: 20 })
  assert.equal(bothLimits.budget.models, Math.floor(8 * GB), 'share applies to free RAM before the cap is compared')

  assert.equal(ALLOCATION.share, 1, 'the default share is all currently free RAM')
  assert.equal(ALLOCATION.capGb, null, 'there is no hard cap by default')
  assert.equal(budget(8 * GB, 4 * GB, { share: 1, capGb: null, source: 'default' }).models, 4 * GB, 'the budget arithmetic is share x free')
  assert.equal(budget(8 * GB, 4 * GB, { share: 0.5, capGb: null, source: 'default' }).unallocated, 2 * GB, 'half of free RAM stays unallocated at a 50% share')

  // Share/cap parsing accepts the shorthands a human would type.
  assert.equal(parseShare('80'), 0.8, 'a bare 80 reads as a percentage')
  assert.equal(parseShare('80%'), 0.8, 'a percent sign is accepted')
  assert.equal(parseShare('0.8'), 0.8, 'a fraction is accepted')
  assert.equal(parseShare('1'), 1, '1 means everything free')
  assert.equal(parseShare('100'), 1, '100 means everything free')
  assert.equal(parseShare('0'), null, 'a zero share is refused')
  assert.equal(parseShare('150'), null, 'an over-100 share is refused')
  assert.equal(parseShare('lots'), null, 'garbage is refused')
  assert.equal(parseShare(null), null, 'unset stays unset')
  assert.equal(parseCapGb('12'), 12)
  assert.equal(parseCapGb(0), null, 'a zero cap means no cap')
  assert.equal(parseCapGb(-4), null, 'a negative cap is refused')
  assert.equal(parseCapGb('nope'), null, 'a non-numeric cap is refused')

  // Saved settings round-trip and take precedence over the environment.
  assert.deepEqual(readAllocationConfig(), { share: null, capGb: null }, 'nothing is saved by default')
  const saved = await saveAllocation({ share: 75, capGb: 6 })
  assert.equal(saved.ok, true, 'a valid allocation saves')
  assert.deepEqual(readAllocationConfig(), { share: 0.75, capGb: 6 }, 'the saved file round-trips')
  assert.deepEqual(
    { share: resolveAllocation().share, capGb: resolveAllocation().capGb, source: resolveAllocation().source },
    { share: 0.75, capGb: 6, source: 'saved' },
    'saved settings are the resolved allocation',
  )
  process.env.JARVIS_RAM_SHARE = '40'
  assert.equal(resolveAllocation().share, 0.75, 'saved settings beat the environment')
  assert.equal(resolveAllocation({ config: { share: null, capGb: null } }).share, 0.4, 'the environment is the fallback')
  assert.equal(resolveAllocation({ config: { share: null, capGb: null }, share: 20 }).share, 0.2, 'explicit options win over everything')
  delete process.env.JARVIS_RAM_SHARE
  assert.equal((await saveAllocation({ share: 0 })).ok, false, 'an invalid share is refused instead of guessed')
  assert.equal((await saveAllocation({ capGb: -1 })).ok, false, 'an invalid cap is refused instead of guessed')
  await saveAllocation({ share: null, capGb: null })
  assert.deepEqual(readAllocationConfig(), { share: null, capGb: null }, 'clearing the saved settings restores the defaults')
  assert.equal(resolveAllocation().source, 'default', 'with nothing saved or set, the default allocation applies')
  assert.equal(plan({ total: 8 * GB, free: 8 * GB, gpuInfo: null }).budget.models, 8 * GB, 'the default plan takes all free RAM')

  const catalogue = tierProfiles({ share: 1 })
  assert.equal(catalogue.length, 33, 'catalogue covers 500 MB and every integer tier from 1 to 32 GB')
  assert.equal(catalogue[0].ramGb, 0.5)
  assert.equal(catalogue.at(-1).ramGb, 32)
  assert.equal(catalogue[7].aiCapGb, 7, 'catalogue rows apply the requested share to each tier')
  assert.ok(ladder().vision.rungs.every((rung) => /abliterat/i.test(rung.model) && rung.multimodal), 'all advertised local vision models are abliterated and multimodal')
  assert.equal(catalogue.every((tier) => Boolean(tier.slots.vision?.model && tier.slots.vision.multimodal)), true, 'all 33 reference tiers include a multimodal vision route')
  assert.equal(snapshots.get(0.5).choices.chat.fits, false, '500 MB chat is honestly best-effort only')
  assert.equal(snapshots.get(0.5).choices.vision.fits, false, '500 MB vision is present but honestly best-effort only')
  assert.equal(snapshots.get(0.5).choices.vision.mode, 'best-effort', 'under-budget vision is never described as a safe fit')
  assert.equal(snapshots.get(0.5).choices.tts.engine, 'system', '500 MB uses zero-model system TTS')
  assert.ok(snapshots.get(0.5).skipped.some((item) => item.cap === 'vision'), '500 MB vision is not automatically run as if it fits')
  assert.equal(snapshots.get(1).choices.chat.fits, false, '1 GB cannot fit the 1.30 GB smallest multimodal rung')
  assert.ok(snapshots.get(1).choices.speech?.multilingual, '1 GB can use a multilingual Whisper tier')
  assert.ok(snapshots.get(1).skipped.some((item) => item.cap === 'vision'), '1 GB plan labels its vision route best-effort')
  assert.equal(snapshots.get(2).choices.vision.fits, true, '2 GB is the first reference tier where the 0.873B Q8 multimodal model fits')
  assert.match(snapshots.get(2).choices.chat.model, /qwen3\.5-abliterated:0\.8b/)
  assert.equal(snapshots.get(3).choices.vision.parametersB, 2.27, '3 GB selects the 2.27B rung')
  assert.equal(snapshots.get(3).choices.vision.quant, 'Q4_K_M', '3 GB takes the Q4_K_M quantization of that rung')
  assert.equal(snapshots.get(4).choices.vision.quant, 'Q8_0', '4 GB upgrades the 2.27B rung to Q8_0')
  assert.equal(snapshots.get(8).choices.vision.parametersB, 9.65, '8 GB selects the 9.65B rung')
  assert.equal(snapshots.get(12).choices.chat.quant, 'Q4_K_M', '12 GB is not yet enough for the 12.3 GB Q8_0 9.65B rung')
  assert.equal(snapshots.get(16).choices.chat.parametersB, 27.8, '16 GB reaches the higher-parameter text rung')
  assert.equal(snapshots.get(16).choices.chat.quant, 'Q2_K', '16 GB selects the Q2_K text/coding candidate')
  assert.match(snapshots.get(16).choices.chat.model, /Huihui-Qwen3\.5-27B-abliterated-GGUF:Q2_K/)
  assert.equal(snapshots.get(16).choices.vision.parametersB, 9.65, '16 GB keeps native Q8_0 for reliable image input')
  assert.notEqual(snapshots.get(16).choices.chat.model, snapshots.get(16).choices.vision.model, '16 GB necessarily splits text/coding from native vision')
  assert.equal(snapshots.get(20).choices.chat.parametersB, 27.8, '20 GB reaches the 27.8B Q4_K_M rung')
  assert.equal(snapshots.get(20).choices.chat.quant, 'Q4_K_M')
  assert.equal(snapshots.get(20).choices.vision.model, snapshots.get(20).choices.chat.model, '20 GB shares one multimodal tag again')
  assert.equal(snapshots.get(28).choices.chat.parametersB, 36, '28 GB reaches the 36B Q4_K_M rung')
  assert.equal(snapshots.get(32).choices.chat.quant, 'Q4_K_M', '32 GB takes the largest rung that fits the allocation')
  assert.equal(snapshots.get(32).choices.vision.multimodal, true)
  assert.ok(Math.abs(snapshots.get(32).totalDownloadBytes / GB - 24.86) < 0.03, '32 GB counts the shared 36B tag, Whisper and Kokoro once each')
  assert.match(snapshots.get(32).choices.tts.engine, /kokoro/)
  const highMemoryQ8 = plan({ total: 52 * GB, free: 52 * GB, gpuInfo: null, share: 1 })
  assert.equal(highMemoryQ8.choices.chat.quant, 'Q8_0', '27B/36B Q8_0 is used when the allocation covers 46 GB')
  assert.equal(highMemoryQ8.choices.tts.engine, 'kokoro', '52 GB has room for browser-cached Kokoro')
  assert.equal(highMemoryQ8.choices.tts.dtype, 'fp32', '52 GB selects Kokoro FP32')
  const highMemory36BF16 = plan({ total: 80 * GB, free: 80 * GB, gpuInfo: null, share: 1 })
  assert.equal(highMemory36BF16.choices.vision.parametersB, 36)
  assert.equal(highMemory36BF16.choices.vision.quant, 'F16', '36B F16 is available only when its resident estimate fits')
  assert.match(highMemory36BF16.choices.tts.engine, /system/, 'the 80 GB plan keeps headroom with system TTS')
  const below125B = plan({ total: 95 * GB, free: 95 * GB, gpuInfo: null, share: 1 })
  assert.equal(below125B.choices.vision.parametersB, 36, '125B stays out until its 96 GB resident estimate fits the allocation')
  assert.equal(below125B.choices.vision.quant, 'F16', 'the largest fitting native rung steps down to 36B F16')
  const first125B = plan({ total: 96 * GB, free: 96 * GB, gpuInfo: null, share: 1 })
  assert.equal(first125B.choices.vision.parametersB, 125, 'the native 125B rung first fits at 96 GB free with a 100% share')
  assert.match(first125B.choices.tts.engine, /system/, 'the first-fit 96 GB plan preserves headroom with system TTS')
  const workstation125B = plan({ total: 256 * GB, free: 256 * GB, gpuInfo: null, share: 1 })
  assert.equal(workstation125B.choices.vision.parametersB, 125, '256 GB workstation profile unlocks the official 125B model')
  assert.equal(workstation125B.choices.vision.model, 'huihui_ai/qwen3.5-abliterated:122B')
  assert.equal(workstation125B.choices.vision.quant, 'Q4_K_M')
  assert.equal(workstation125B.choices.vision.multimodal, true, '125B high-memory vision rung supports images')
  assert.ok(workstation125B.maxResidentBytes <= workstation125B.effectiveModelBytes, '125B resident estimate stays inside the allocation')
  assert.equal(workstation125B.choices.tts.engine, 'kokoro', '256 GB workstation tier has room for local neural TTS')
  assert.equal(workstation125B.choices.tts.dtype, 'fp32', 'highest-memory profile selects Kokoro FP32')
  assert.ok(Math.abs(workstation125B.maxResidentBytes / GB - 97.5) < 0.03, '125B plus Kokoro FP32 stays inside the workstation allocation')
  assert.ok(Math.abs(workstation125B.totalDownloadBytes / GB - 81.86) < 0.03, '125B shared tag, multilingual Whisper, and browser Kokoro count once in disk estimates')
  // A 50% share on a 256 GB host behaves like a 128 GB allocation.
  const workstationHalf = plan({ total: 256 * GB, free: 256 * GB, gpuInfo: null, share: 0.5 })
  assert.equal(workstationHalf.budget.models, 128 * GB, 'a 50% share halves the ceiling')
  assert.equal(workstationHalf.choices.vision.parametersB, 125, 'the 125B rung still fits a 128 GB allocation')
  assert.match(planSummary(snapshots.get(0.5)), /best-effort/i)
  assert.match(planSummary(snapshots.get(32)), /AI share 100%/, 'the summary leads with the user-facing share')
  assert.equal(snapshots.get(32).allocation.sharePercent, 100, 'the plan carries the resolved allocation for the UI')
  assert.ok(!/40%|35%|25%/.test(snapshots.get(32).notes.join(' ')), 'no fixed OS/apps/AI split remains in the plan notes')

  // A small/corrupt file is not treated as an installed Whisper model.
  tempDir = await mkdtemp(join(tmpdir(), 'jarvis-autopilot-test-'))
  const corruptWhisper = join(tempDir, 'ggml-tiny-q5_1.bin')
  await writeFile(corruptWhisper, 'incomplete')
  assert.equal(await whisperFileReady(corruptWhisper), false, 'incomplete Whisper file is not ready')

  // Make the selected Ollama tags already present in a local mock server, then
  // invoke the installer twice. It must reuse them and never call /api/pull.
  const kokoroPlan = snapshots.get(24)
  const selectedWithoutWhisper = {
    ...kokoroPlan,
    choices: Object.fromEntries(Object.entries(kokoroPlan.choices).filter(([cap]) => cap !== 'speech')),
  }
  assert.equal(selectedWithoutWhisper.choices.tts.engine, 'kokoro', '24 GB plan exercises browser-local Kokoro')
  installedNames = new Set(Object.values(selectedWithoutWhisper.choices)
    .filter((rung) => rung.fits && rung.model && rung.kind !== 'tts' && rung.kind !== 'whisper')
    .map((rung) => rung.model))

  const firstInstall = await install({ planned: selectedWithoutWhisper, dir: tempDir })
  const secondInstall = await install({ planned: selectedWithoutWhisper, dir: tempDir })
  assert.equal(pullCalls, 0, 'already-installed Ollama models are not pulled on repeated installs')
  assert.ok(firstInstall.log.filter((item) => item.cap !== 'tts').every((item) => item.ok && item.skipped), 'first install reuses all pre-existing Ollama tags')
  assert.ok(secondInstall.log.filter((item) => item.cap !== 'tts').every((item) => item.ok && item.skipped), 'second install remains idempotent')
  const ttsResult = firstInstall.log.find((item) => item.cap === 'tts')
  assert.ok(ttsResult?.ok && ttsResult.skipped && /cached on first Kokoro use/i.test(ttsResult.note), 'Kokoro is deferred to the browser cache, not pulled by the bridge')

  // The root installer may target only fitted planner routes that actually use
  // its local Ollama server; other slot weights must remain untouched.
  const allInstalledNames = new Set(installedNames)
  installedNames.delete(selectedWithoutWhisper.choices.chat.model)
  const pullsBeforeSlotFilter = pullCalls
  const chatOnlyInstall = await install({
    planned: selectedWithoutWhisper,
    dir: tempDir,
    onlyOllamaSlots: ['chat'],
  })
  const chatOnlyChat = chatOnlyInstall.log.find((item) => item.cap === 'chat')
  const chatOnlyVision = chatOnlyInstall.log.find((item) => item.cap === 'vision')
  const chatOnlyReason = chatOnlyInstall.log.find((item) => item.cap === 'reason')
  assert.ok(chatOnlyChat?.ok && !chatOnlyChat.skipped, 'an explicitly allowed missing Ollama slot is installed')
  assert.ok(chatOnlyVision?.ok && chatOnlyVision.skipped && /not routed to the local Ollama/i.test(chatOnlyVision.note), 'an unselected vision route does not download planner weights')
  assert.ok(chatOnlyReason?.ok && chatOnlyReason.skipped && /not routed to the local Ollama/i.test(chatOnlyReason.note), 'an unselected coding route does not download planner weights')
  assert.equal(pullCalls, pullsBeforeSlotFilter + 1, 'slot-filtered installation pulls only the allowed missing model tag')
  installedNames = allInstalledNames

  // A fit=false rung remains a reported skip even if other chosen models fit
  // and Ollama is online. A fully over-budget 500 MB plan also performs no pulls.
  const mixedPlan = {
    ...selectedWithoutWhisper,
    choices: { ...selectedWithoutWhisper.choices, reason: { ...selectedWithoutWhisper.choices.reason, fits: false } },
  }
  const mixedInstall = await install({ planned: mixedPlan, dir: tempDir })
  const coderSkip = mixedInstall.log.find((item) => item.cap === 'reason')
  assert.ok(coderSkip?.ok && coderSkip.skipped && coderSkip.fits === false, 'non-fitting coding rung is skipped honestly')
  const lowRamInstall = await install({ planned: snapshots.get(0.5), dir: tempDir })
  assert.ok(lowRamInstall.log.filter((item) => ['chat', 'vision', 'reason'].includes(item.cap)).every((item) => item.ok && item.skipped && item.fits === false), 'best-effort chat, vision, and coding models are not silently downloaded below the allocation')
  assert.equal(pullCalls, pullsBeforeSlotFilter + 1, 'neither non-fitting plan triggers an additional Ollama download')

  // At 4 GB with a 100% share, the smallest shared multimodal model and
  // multilingual Whisper fit. Simulate Ollama being offline and Hugging Face
  // serving a correctly sized stream; Whisper should still install
  // independently.
  const offlinePlan = plan({ total: 4 * GB, free: 4 * GB, gpuInfo: null, share: 1 })
  assert.ok(offlinePlan.choices.speech?.fits, '4 GB plan selects a fitting multilingual Whisper file')
  assert.ok(offlinePlan.choices.chat.fits && offlinePlan.choices.vision.fits && offlinePlan.choices.reason.fits, '4 GB plan selects the shared multimodal model for all three routed roles')
  if (!existsSync(mockRuntimeScope)) {
    await mkdir(mockRuntimeScope, { recursive: true })
    mockRuntimeScopeCreated = true
  }
  if (!existsSync(mockRuntimePackage)) {
    await mkdir(mockRuntimePackage, { recursive: true })
    await writeFile(join(mockRuntimePackage, 'package.json'), JSON.stringify({ name: '@lumen-labs-dev/whisper-node', version: 'test', main: 'index.cjs' }))
    await writeFile(join(mockRuntimePackage, 'index.cjs'), 'module.exports = {}')
    mockRuntimeCreated = true
  }

  const originalFetch = globalThis.fetch
  const expectedWhisperBytes = offlinePlan.choices.speech.bytes
  globalThis.fetch = async (resource, options) => {
    const url = String(resource)
    if (!url.startsWith('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/')) return originalFetch(resource, options)
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const body = new ReadableStream({
      pull(controller) {
        if (sent >= expectedWhisperBytes) return controller.close()
        const next = chunk.subarray(0, Math.min(chunk.byteLength, expectedWhisperBytes - sent))
        sent += next.byteLength
        controller.enqueue(next)
      },
    })
    return new Response(body, { status: 200, headers: { 'content-length': String(expectedWhisperBytes) } })
  }
  ollamaOnline = false
  try {
    const offlineInstall = await install({ planned: offlinePlan, dir: tempDir })
    const chatOffline = offlineInstall.log.find((item) => item.cap === 'chat')
    const codeOffline = offlineInstall.log.find((item) => item.cap === 'reason')
    const whisperInstalled = offlineInstall.log.find((item) => item.cap === 'speech' && item.id === offlinePlan.choices.speech.file)
    assert.ok(chatOffline?.ok && chatOffline.skipped && /Ollama is offline/i.test(chatOffline.note), 'fitting chat model is skipped cleanly while Ollama is offline')
    assert.ok(codeOffline?.ok && codeOffline.skipped && /Ollama is offline/i.test(codeOffline.note), 'fitting coder is skipped cleanly while Ollama is offline')
    assert.ok(whisperInstalled?.ok && !whisperInstalled.skipped, 'Whisper can install while Ollama is offline')
    assert.equal(await whisperFileReady(join(tempDir, offlinePlan.choices.speech.file)), true, 'completed Whisper download passes the full-file check')
    assert.equal(pullCalls, pullsBeforeSlotFilter + 1, 'offline model slots do not trigger additional Ollama pulls')
  } finally {
    globalThis.fetch = originalFetch
    ollamaOnline = true
  }

  console.log(`PASS  ${tiers.length} deterministic RAM profiles (0.5–32 GB)`)
  console.log('PASS  user-chosen share of free RAM, optional hard cap, saved/env/override precedence, and no fixed 35/25/40 split')
  console.log('PASS  unique downloads, truthful fit flags, mandatory multimodal vision, and high-memory Q8/F16/125B rungs')
  console.log('PASS  over-allocation skips, mock-Ollama idempotence, slot-filtered install routes, offline Whisper install, corrupt-file detection, and browser-cached Kokoro')
} finally {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  if (mockRuntimeCreated) await rm(mockRuntimePackage, { recursive: true, force: true })
  if (mockRuntimeScopeCreated) await rm(mockRuntimeScope, { recursive: true, force: true })
  await rm(configDir, { recursive: true, force: true })
  await new Promise((resolve, reject) => ollama.close((error) => error ? reject(error) : resolve()))
}

// --- the catalogue a person chooses from ------------------------------------
//
// The planner still exists, but it no longer decides what gets downloaded: the
// catalogue is shown, the person picks one model for each of three jobs, and
// only that choice is installed. These checks are about that contract.
{
  const { catalogue, defaultSelection, filterCatalogue, readSelection, writeSelection } = await import('../bridge/catalogue.mjs')
  const { installSelection } = await import('../bridge/autopilot.mjs')

  const selectionDir = await mkdtemp(join(tmpdir(), 'jarvis-selection-'))
  process.env.JARVIS_MODEL_SELECTION = join(selectionDir, 'model-selection.json')
  try {
    const cat = catalogue()
    assert.deepEqual(cat.slots.map((slot) => slot.id), ['chat', 'vision', 'coder'], 'the catalogue offers exactly the three jobs')
    assert.ok(cat.machine.budgetGb > 0 && cat.machine.totalRamGb > 0, 'the catalogue says what this machine has to spend')

    for (const slot of cat.slots) {
      assert.ok(slot.entries.length >= 13, `${slot.id} lists the whole ladder, not one rung`)
      assert.equal(slot.defaultModel, slot.entries[0].id, `${slot.id} opens on its smallest rung, so a first run is minutes not hours`)
      const sizes = slot.entries.map((entry) => entry.downloadGb)
      assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b), `${slot.id} is ordered smallest download first`)
      for (const entry of slot.entries) {
        assert.equal(typeof entry.fits, 'boolean', `${entry.id} says whether it fits, rather than being hidden`)
        assert.ok(entry.quant && entry.parametersB > 0, `${entry.id} names its parameters and quantization`)
        if (slot.id === 'vision') assert.equal(entry.multimodal, true, 'nothing in the vision column is blind')
      }
    }
    assert.equal(readSelection(), null, 'nothing is chosen until the person chooses')

    const defaults = defaultSelection(cat)
    const saved = writeSelection(defaults)
    assert.deepEqual(readSelection(), { ...saved }, 'what was chosen is what is remembered next launch')

    assert.throws(() => writeSelection({ chat: 'nope:latest', vision: defaults.vision, coder: defaults.coder }), /not a chat model/i, 'a tag that is not in the catalogue is refused')
    assert.throws(() => writeSelection({ chat: defaults.chat, vision: 'hf.co/mradermacher/Huihui-Qwen3.5-27B-abliterated-GGUF:Q2_K', coder: defaults.coder }), /not a vision model/i, 'a tag with no vision row cannot fill the vision slot, and the vision column has no blind rows to offer')
    assert.throws(() => writeSelection({ chat: defaults.chat }), /all three slots/i, 'a partial choice is refused')

    const narrow = filterCatalogue(cat.slots, { maxDownloadGb: 2, fitOnly: true, quants: ['Q8_0'] })
    assert.ok(narrow.every((slot) => slot.entries.every((entry) => entry.downloadGb <= 2 && entry.fits && entry.quant === 'Q8_0')), 'filters only ever hide, they never relabel')
    assert.ok(narrow.some((slot) => slot.entries.length > 0), 'the small rungs survive a tight filter')

    const big = Object.fromEntries(cat.slots.map((slot) => [slot.id, slot.entries.at(-1).id]))
    writeSelection(big)
    const dry = await installSelection(big, { dry: true })
    assert.equal(dry.plan.choices.chat.model, big.chat, 'chat downloads the model that was chosen, not the one the ladder would have picked')
    assert.equal(dry.plan.choices.vision.model, big.vision, 'vision follows the choice too')
    assert.equal(dry.plan.choices.reason.model, big.coder, 'and the coder choice is what the reasoning pipeline routes to')
    assert.equal(dry.plan.choices.speech?.fits, false, 'a catalogue download does not drag the speech weights along')
    assert.ok(dry.plan.notes.some((note) => /chosen by hand/i.test(note)), 'the plan says out loud that a person picked these')

    console.log(`PASS  the catalogue lists ${cat.slots.reduce((n, slot) => n + slot.entries.length, 0)} models across chat/vision/coder with truthful per-device fit flags and smallest-first defaults`)
    console.log('PASS  the chosen three are saved, validated (unknown tag, wrong slot, partial choice all refused), and are the only three that download')
  } finally {
    delete process.env.JARVIS_MODEL_SELECTION
    await rm(selectionDir, { recursive: true, force: true })
  }
}
