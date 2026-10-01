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

let tempDir
const mockRuntimeScope = join(process.cwd(), 'node_modules', '@lumen-labs-dev')
const mockRuntimePackage = join(mockRuntimeScope, 'whisper-node')
let mockRuntimeCreated = false
let mockRuntimeScopeCreated = false
try {
  const { BUDGET, plan, planSummary, install, whisperFileReady, tierProfiles, ladder } = await import('../bridge/autopilot.mjs')
  const tiers = [0.5, 0.75, 1, 2, 4, 8, 12, 16, 24, 32]
  const snapshots = new Map()
  for (const ramGb of tiers) {
    const total = ramGb * GB
    const p = plan({ total, free: total, gpuInfo: null })
    snapshots.set(ramGb, p)

    assert.equal(p.budget.os, Math.floor(total * 0.35), `${ramGb} GB OS split`)
    assert.equal(p.budget.apps, Math.floor(total * 0.25), `${ramGb} GB app split`)
    assert.equal(p.budget.models, Math.floor(total * 0.40), `${ramGb} GB AI cap`)
    assert.ok(p.effectiveModelBytes <= p.budget.models, `${ramGb} GB active model ceiling`)
    assert.ok(p.maxResidentBytes <= p.effectiveModelBytes, `${ramGb} GB combined model/TTS peak`)
    assert.ok(p.choices.chat, `${ramGb} GB shows the closest abliterated chat pick`)
    assert.ok(p.choices.reason, `${ramGb} GB shows the closest abliterated coding pick`)
    assert.ok(p.choices.tts, `${ramGb} GB always has a TTS path`)
    assert.ok(/abliterat/i.test(p.choices.chat.model), `${ramGb} GB chat remains abliterated`)
    assert.equal(p.choices.chat.multilingual, true, `${ramGb} GB chat is tagged multilingual`)
    assert.ok(/abliterat/i.test(p.choices.reason.model), `${ramGb} GB coding remains abliterated`)
    assert.equal(p.choices.reason.englishOnly, true, `${ramGb} GB coding model is tagged English-only`)
    assert.ok(!p.choices.speech || !/\.en\./i.test(p.choices.speech.file), `${ramGb} GB Whisper choice is multilingual`)
    for (const [slot, rung] of Object.entries(p.choices)) {
      if (rung.fits) assert.ok(rung.residentBytes <= p.effectiveModelBytes, `${ramGb} GB ${slot} fit flag is truthful`)
    }
    assert.ok(p.totalDownloadBytes >= 0, `${ramGb} GB download estimate is non-negative`)
  }

  assert.equal(BUDGET.os + BUDGET.apps + BUDGET.models, 1)
  const catalogue = tierProfiles()
  assert.equal(catalogue.length, 33, 'catalogue covers 500 MB and every integer tier from 1 to 32 GB')
  assert.equal(catalogue[0].ramGb, 0.5)
  assert.equal(catalogue.at(-1).ramGb, 32)
  assert.ok(ladder().vision.rungs.every((rung) => /abliterat/i.test(rung.model)), 'all advertised local vision models are abliterated')
  assert.equal(snapshots.get(0.5).choices.chat.fits, false, '500 MB chat is honestly best-effort only')
  assert.equal(snapshots.get(0.5).choices.tts.engine, 'system', '500 MB uses zero-model system TTS')
  assert.ok(snapshots.get(0.5).skipped.some((item) => item.cap === 'vision'), '500 MB plan does not promise local vision')
  assert.equal(snapshots.get(1).choices.chat.fits, false, '1 GB 0.5B chat does not exceed the 0.4 GB cap')
  assert.ok(snapshots.get(1).choices.speech?.multilingual, '1 GB can use the multilingual tiny Whisper tier when current free RAM allows')
  assert.ok(snapshots.get(1).skipped.some((item) => item.cap === 'vision'), '1 GB plan does not promise general vision')
  assert.ok(snapshots.get(2).skipped.some((item) => item.cap === 'vision'), '2 GB plan does not promise general vision')
  assert.ok(snapshots.get(4).skipped.some((item) => item.cap === 'vision'), '4 GB does not download a non-abliterated vision substitute')
  assert.ok(snapshots.get(8).skipped.some((item) => item.cap === 'vision'), '8 GB still reports vision unsupported below the supplied VLM memory floor')
  assert.match(snapshots.get(12).choices.vision.model, /qwen2\.5-vl-abliterated:3b/)
  assert.match(snapshots.get(12).choices.reason.model, /q3_k_m/)
  assert.match(snapshots.get(16).choices.reason.model, /dagbs\/qwen2\.5-coder-7b.*q4_k_m/i)
  assert.match(snapshots.get(32).choices.chat.model, /:14b/)
  assert.match(snapshots.get(32).choices.reason.model, /:14b/)
  assert.match(snapshots.get(32).choices.tts.engine, /kokoro/)
  assert.match(planSummary(snapshots.get(0.5)), /best-effort/i)

  // A small/corrupt file is not treated as an installed Whisper model.
  tempDir = await mkdtemp(join(tmpdir(), 'jarvis-autopilot-test-'))
  const corruptWhisper = join(tempDir, 'ggml-tiny-q5_1.bin')
  await writeFile(corruptWhisper, 'incomplete')
  assert.equal(await whisperFileReady(corruptWhisper), false, 'incomplete Whisper file is not ready')

  // Make the selected Ollama tags already present in a local mock server, then
  // invoke the installer twice. It must reuse them and never call /api/pull.
  const eightGb = snapshots.get(8)
  const selectedWithoutWhisper = {
    ...eightGb,
    choices: Object.fromEntries(Object.entries(eightGb.choices).filter(([cap]) => cap !== 'speech')),
  }
  assert.equal(selectedWithoutWhisper.choices.tts.engine, 'kokoro', '8 GB plan exercises browser-local Kokoro')
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

  // A fit=false rung remains a reported skip even if other chosen models fit
  // and Ollama is online. A fully over-cap 500 MB plan also performs no pulls.
  const mixedPlan = {
    ...selectedWithoutWhisper,
    choices: { ...selectedWithoutWhisper.choices, reason: { ...selectedWithoutWhisper.choices.reason, fits: false } },
  }
  const mixedInstall = await install({ planned: mixedPlan, dir: tempDir })
  const coderSkip = mixedInstall.log.find((item) => item.cap === 'reason')
  assert.ok(coderSkip?.ok && coderSkip.skipped && coderSkip.fits === false, 'non-fitting coding rung is skipped honestly')
  const lowRamInstall = await install({ planned: snapshots.get(0.5), dir: tempDir })
  assert.ok(lowRamInstall.log.filter((item) => ['chat', 'reason'].includes(item.cap)).every((item) => item.ok && item.skipped && item.fits === false), 'best-effort text models are not silently downloaded below the RAM cap')
  assert.equal(pullCalls, 0, 'neither non-fitting plan triggers an Ollama download')

  // At 1.5 GB, the tiny abliterated chat/coder and multilingual Whisper base
  // fit the cap. Simulate Ollama being offline and Hugging Face serving a
  // correctly sized stream; Whisper should still install independently.
  const offlinePlan = plan({ total: 1.5 * GB, free: 1.5 * GB, gpuInfo: null })
  assert.ok(offlinePlan.choices.speech?.fits, '1.5 GB plan selects a fitting multilingual Whisper file')
  assert.ok(offlinePlan.choices.chat.fits && offlinePlan.choices.reason.fits, '1.5 GB plan also selects fitting text models')
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
    assert.equal(pullCalls, 0, 'offline model slots do not trigger Ollama pulls')
  } finally {
    globalThis.fetch = originalFetch
    ollamaOnline = true
  }

  console.log(`PASS  ${tiers.length} deterministic RAM profiles (0.5–32 GB)`)
  console.log('PASS  fixed 35/25/40 budget, combined TTS/model peak, truthful fit flags, abliterated multilingual chat and English-only coding')
  console.log('PASS  Whisper language policy, per-tier TTS, vision limits, and 7B Q2/Q3/Q4 coder quantization')
  console.log('PASS  over-cap skips, mock-Ollama idempotence, offline Whisper install path, corrupt-file detection, and browser-cached Kokoro')
} finally {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  if (mockRuntimeCreated) await rm(mockRuntimePackage, { recursive: true, force: true })
  if (mockRuntimeScopeCreated) await rm(mockRuntimeScope, { recursive: true, force: true })
  await new Promise((resolve, reject) => ollama.close((error) => error ? reject(error) : resolve()))
}
