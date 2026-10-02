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
  const tiers = [0.5, 0.75, 1, 2, 3, 4, 8, 12, 16, 20, 24, 28, 32]
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
    assert.ok(p.choices.vision, `${ramGb} GB keeps an explicit multimodal vision pick`)
    assert.ok(p.choices.reason, `${ramGb} GB shows the closest abliterated coding pick`)
    assert.ok(p.choices.tts, `${ramGb} GB always has a TTS path`)
    assert.ok(/abliterat/i.test(p.choices.chat.model), `${ramGb} GB chat remains abliterated`)
    assert.ok(p.choices.vision.multimodal, `${ramGb} GB vision choice accepts images`)
    assert.equal(p.choices.chat.model, p.choices.reason.model, `${ramGb} GB shares one model across chat and coding`)
    if (ramGb === 32) {
      assert.notEqual(p.choices.chat.model, p.choices.vision.model, '32 GB uses the larger text/coding tag but retains a native Ollama vision tag')
    } else {
      assert.equal(p.choices.chat.model, p.choices.vision.model, `${ramGb} GB shares one model across chat and vision`)
    }
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

  assert.equal(BUDGET.os + BUDGET.apps + BUDGET.models, 1)
  const catalogue = tierProfiles()
  assert.equal(catalogue.length, 33, 'catalogue covers 500 MB and every integer tier from 1 to 32 GB')
  assert.equal(catalogue[0].ramGb, 0.5)
  assert.equal(catalogue.at(-1).ramGb, 32)
  assert.ok(ladder().vision.rungs.every((rung) => /abliterat/i.test(rung.model) && rung.multimodal), 'all advertised local vision models are abliterated and multimodal')
  assert.equal(catalogue.every((tier) => Boolean(tier.slots.vision?.model && tier.slots.vision.multimodal)), true, 'all 33 reference tiers include a multimodal vision route')
  assert.equal(snapshots.get(0.5).choices.chat.fits, false, '500 MB chat is honestly best-effort only')
  assert.equal(snapshots.get(0.5).choices.vision.fits, false, '500 MB vision is present but honestly best-effort only')
  assert.equal(snapshots.get(0.5).choices.vision.mode, 'best-effort', 'under-budget vision is never described as a safe fit')
  assert.equal(snapshots.get(0.5).choices.tts.engine, 'system', '500 MB uses zero-model system TTS')
  assert.ok(snapshots.get(0.5).skipped.some((item) => item.cap === 'vision'), '500 MB vision is not automatically run as if it fits')
  assert.equal(snapshots.get(1).choices.chat.fits, false, '1 GB 0.8B multimodal model does not exceed the 0.4 GB cap')
  assert.ok(snapshots.get(1).choices.speech?.multilingual, '1 GB can use the multilingual tiny Whisper tier when current free RAM allows')
  assert.ok(snapshots.get(1).skipped.some((item) => item.cap === 'vision'), '1 GB plan labels its vision route best-effort')
  assert.ok(snapshots.get(2).skipped.some((item) => item.cap === 'vision'), '2 GB plan labels its vision route best-effort')
  assert.ok(snapshots.get(3).skipped.some((item) => item.cap === 'vision'), '3 GB stays below the smallest model resident estimate')
  assert.equal(snapshots.get(4).choices.vision.fits, true, '4 GB is the first reference tier where the 0.8B Q8 multimodal model fits')
  assert.match(snapshots.get(4).choices.chat.model, /qwen3\.5-abliterated:0\.8b/)
  assert.equal(snapshots.get(8).choices.vision.parametersB, 2.27, '8 GB selects the 2.27B multimodal rung')
  assert.equal(snapshots.get(8).choices.vision.quant, 'Q8_0', '8 GB uses the highest native quant that fits its resident ceiling')
  assert.equal(snapshots.get(12).choices.vision.parametersB, 4.54, '12 GB selects the 4.54B Q4_K_M rung')
  assert.equal(snapshots.get(16).choices.vision.parametersB, 4.54, '16 GB remains within the conservative resident ceiling')
  assert.equal(snapshots.get(16).choices.vision.quant, 'Q8_0', '16 GB upgrades the 4.54B model to Q8_0')
  assert.equal(snapshots.get(24).choices.chat.parametersB, 9.65, '24 GB selects the 9.65B Q4_K_M rung')
  assert.equal(snapshots.get(32).choices.chat.parametersB, 27.8, '32 GB selects the higher-parameter chat rung')
  assert.equal(snapshots.get(32).choices.chat.quant, 'Q2_K', '32 GB selects the largest text model that fits the fixed resident ceiling')
  assert.match(snapshots.get(32).choices.chat.model, /Huihui-Qwen3\.5-27B-abliterated-GGUF:Q2_K/)
  assert.equal(snapshots.get(32).choices.reason.model, snapshots.get(32).choices.chat.model, '32 GB shares the high-parameter text model between chat and coding')
  assert.equal(snapshots.get(32).choices.vision.parametersB, 9.65, '32 GB keeps native Q8_0 for reliable image input')
  assert.equal(snapshots.get(32).choices.vision.quant, 'Q8_0')
  assert.equal(snapshots.get(32).choices.vision.multimodal, true)
  assert.ok(Math.abs(snapshots.get(32).totalDownloadBytes / GB - 22.44) < 0.03, '32 GB counts the distinct Q2_K and Q8_0 tags plus Whisper once each')
  assert.match(snapshots.get(32).choices.tts.engine, /system/)
  const highMemoryQ4 = plan({ total: 52 * GB, free: 52 * GB, gpuInfo: null })
  assert.equal(highMemoryQ4.choices.chat.parametersB, 27.8, '27.8B Q4_K_M is enabled only when its higher RAM estimate fits')
  assert.equal(highMemoryQ4.choices.chat.quant, 'Q4_K_M')
  const highMemory35B = plan({ total: 80 * GB, free: 80 * GB, gpuInfo: null })
  assert.equal(highMemory35B.choices.vision.parametersB, 36, '36B Q4_K_M is selected only above its safe RAM floor')
  assert.equal(highMemory35B.choices.vision.quant, 'Q4_K_M')
  const highMemory27BQ8 = plan({ total: 88 * GB, free: 88 * GB, gpuInfo: null })
  assert.equal(highMemory27BQ8.choices.vision.parametersB, 27.8, '27B Q8_0 replaces the 36B Q4 rung when its higher resident cost fits')
  assert.equal(highMemory27BQ8.choices.vision.quant, 'Q8_0')
  const highMemory36BQ8 = plan({ total: 116 * GB, free: 116 * GB, gpuInfo: null })
  assert.equal(highMemory36BQ8.choices.vision.parametersB, 36)
  assert.equal(highMemory36BQ8.choices.vision.quant, 'Q8_0', '36B Q8_0 is enabled at its high-memory floor')
  const highMemory36BF16 = plan({ total: 200 * GB, free: 200 * GB, gpuInfo: null })
  assert.equal(highMemory36BF16.choices.vision.parametersB, 36)
  assert.equal(highMemory36BF16.choices.vision.quant, 'F16', '36B F16 is available only when its resident estimate fits')
  const below125B = plan({ total: 239 * GB, free: 239 * GB, gpuInfo: null })
  assert.equal(below125B.choices.vision.parametersB, 36, '125B stays out until its 96 GB resident estimate fits the 40% cap')
  assert.equal(below125B.choices.vision.quant, 'F16', 'the largest fitting native rung steps down to 36B F16')
  const first125B = plan({ total: 240 * GB, free: 240 * GB, gpuInfo: null })
  assert.equal(first125B.choices.vision.parametersB, 125, 'the native 125B rung first fits at 240 GB total when RAM is fully free')
  assert.match(first125B.choices.tts.engine, /system/, 'the first-fit 240 GB plan preserves headroom with system TTS')
  const workstation125B = plan({ total: 256 * GB, free: 256 * GB, gpuInfo: null })
  assert.equal(workstation125B.choices.vision.parametersB, 125, '256 GB workstation profile unlocks the official 125B model')
  assert.equal(workstation125B.choices.vision.model, 'huihui_ai/qwen3.5-abliterated:122B')
  assert.equal(workstation125B.choices.vision.quant, 'Q4_K_M')
  assert.equal(workstation125B.choices.vision.multimodal, true, '125B high-memory vision rung supports images')
  assert.ok(workstation125B.maxResidentBytes <= workstation125B.effectiveModelBytes, '125B resident estimate stays inside the fixed planner cap')
  assert.equal(workstation125B.choices.tts.engine, 'kokoro', '256 GB workstation tier has room for local neural TTS')
  assert.equal(workstation125B.choices.tts.dtype, 'fp32', 'highest-memory profile selects Kokoro FP32')
  assert.ok(Math.abs(workstation125B.maxResidentBytes / GB - 97.5) < 0.03, '125B plus Kokoro FP32 remains below the fixed workstation cap')
  assert.ok(Math.abs(workstation125B.totalDownloadBytes / GB - 81.86) < 0.03, '125B shared tag, multilingual Whisper, and browser Kokoro count once in disk estimates')
  assert.match(planSummary(snapshots.get(0.5)), /best-effort/i)

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
  // and Ollama is online. A fully over-cap 500 MB plan also performs no pulls.
  const mixedPlan = {
    ...selectedWithoutWhisper,
    choices: { ...selectedWithoutWhisper.choices, reason: { ...selectedWithoutWhisper.choices.reason, fits: false } },
  }
  const mixedInstall = await install({ planned: mixedPlan, dir: tempDir })
  const coderSkip = mixedInstall.log.find((item) => item.cap === 'reason')
  assert.ok(coderSkip?.ok && coderSkip.skipped && coderSkip.fits === false, 'non-fitting coding rung is skipped honestly')
  const lowRamInstall = await install({ planned: snapshots.get(0.5), dir: tempDir })
  assert.ok(lowRamInstall.log.filter((item) => ['chat', 'vision', 'reason'].includes(item.cap)).every((item) => item.ok && item.skipped && item.fits === false), 'best-effort chat, vision, and coding models are not silently downloaded below the RAM cap')
  assert.equal(pullCalls, pullsBeforeSlotFilter + 1, 'neither non-fitting plan triggers an additional Ollama download')

  // At 4 GB, the smallest shared multimodal model and multilingual Whisper fit.
  // Simulate Ollama being offline and Hugging Face serving a correctly sized
  // stream; Whisper should still install independently.
  const offlinePlan = plan({ total: 4 * GB, free: 4 * GB, gpuInfo: null })
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
  console.log('PASS  fixed 35/25/40 budget, unique downloads, truthful fit flags, mandatory multimodal vision, and high-memory Q8/F16/125B rungs')
  console.log('PASS  mandatory vision profiles, best-effort safeguards, parameter counts, progressive quantization, multilingual STT and TTS')
  console.log('PASS  over-cap skips, mock-Ollama idempotence, slot-filtered install routes, offline Whisper install, corrupt-file detection, and browser-cached Kokoro')
} finally {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  if (mockRuntimeCreated) await rm(mockRuntimePackage, { recursive: true, force: true })
  if (mockRuntimeScopeCreated) await rm(mockRuntimeScope, { recursive: true, force: true })
  await new Promise((resolve, reject) => ollama.close((error) => error ? reject(error) : resolve()))
}
