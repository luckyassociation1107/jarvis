/**
 * Smoke test for the local-model brain.
 *
 * Spins up a stub OpenAI-compatible server that (a) streams a sentence, then
 * (b) asks for a tool, then (c) answers with the tool's result — which is the
 * whole agent loop in three moves. Then drives the real bridge over a real
 * WebSocket and asserts the browser-visible frames.
 *
 * Not a unit test. It exists to prove the wiring is right: that the bridge
 * connects its MCP servers, converts their schemas, calls the model, executes
 * the tool it asks for, feeds the result back, and streams the final answer.
 * Any of those can be broken by a refactor that still type-checks.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

const PORT = 8791
const MODEL_PORT = 11499
const MODEL = 'stub-model'
// Use distinct deterministic route sentinels so this smoke harness can observe
// chat/reason/vision dispatch, even though the real catalogue shares one Qwen3.5
// multimodal tag across those slots. The stub exposes only `stub-model`; the
// local route still runs with these configured ids to exercise the full bridge.
const CHAT = 'smoke/qwen3.5-chat'
const REASON = 'smoke/qwen3.5-reason'
const VISION = 'smoke/qwen3.5-vision'

// Keep this test deterministic regardless of the runner's real RAM or Ollama.
process.env.JARVIS_BRIDGE_PORT = String(PORT)
process.env.JARVIS_MODEL_BASE_URL = `http://localhost:${MODEL_PORT}/v1`
process.env.JARVIS_OLLAMA_URL = `http://localhost:${MODEL_PORT}`
process.env.JARVIS_MODEL_CHAT = CHAT
process.env.JARVIS_MODEL_REASON = REASON
process.env.JARVIS_MODEL_VISION = VISION
process.env.JARVIS_ALLOW_NO_ORIGIN = '1'
// Allocation changes made through the HTTP API must land in a throwaway file,
// never in the developer's real models/ram-allocation.json.
process.env.JARVIS_RAM_CONFIG = join(tmpdir(), `jarvis-smoke-ram-${process.pid}.json`)

// --- the stub model server -------------------------------------------------
let calls = 0
let sawToolAsk = false
let sawToolResult = false
/** The `model` field of every request, in order. Proves the routing. */
const asked = []
/** How many times the chat slot has been asked. It gets one chance to fail. */
let chatHits = 0
/** Set when the chat slot narrates instead of acting. */
let sawChatNarrate = false
/** Set when the bridge challenged a refusal before speaking it. */
let sawDeclineRetry = false
let visionSawImage = false
/** Tool names the model was offered, from the first request that carried any. */
let offeredTools = null
/** The system prompt the model was actually sent, once it carried the machine block. */
let systemSeen = null
let visionSawIntent = false
let coderSawCombinedVisionPrompt = false
let coderSawEnglishTranslation = false
let visionCapabilityProbeCount = 0
const resourceEvents = []
const http = createServer((req, res) => {
  if (req.url === '/api/tags') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ models: [{ name: MODEL }] }))
  }
  if (req.url === '/api/show' && req.method === 'POST') {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const { model } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      visionCapabilityProbeCount++
      const capabilities = model === 'smoke/qwen3.5-text-only' ? ['completion'] : ['completion', 'vision']
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ capabilities, model_info: {} }))
    })
    return
  }
  if (req.url === '/api/chat' && req.method === 'POST') {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      if (payload.keep_alive === 0) resourceEvents.push(`unload:${payload.model}`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ model: payload.model, done: true, done_reason: 'unload' }))
    })
    return
  }
  if (req.url === '/test/speech-started' && req.method === 'POST') {
    resourceEvents.push('speech')
    res.writeHead(204)
    return res.end()
  }
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ data: [{ id: MODEL }] }))
  }
  if (req.url !== '/v1/chat/completions') {
    res.writeHead(404)
    return res.end()
  }
  const body = []
  req.on('data', (c) => body.push(c))
  req.on('end', () => {
    const payload = JSON.parse(Buffer.concat(body).toString())
    if (payload.stream === false) {
      resourceEvents.push(`inference:${payload.model}`)
      const userText = lastText(payload.messages)
      let result
      if (payload.model === VISION) {
        visionSawImage = (payload.messages ?? []).some((message) => Array.isArray(message.content) && message.content.some((part) => part?.type === 'image_url'))
        visionSawIntent = /blueprint|code|screenshot/i.test(userText)
        result = 'A bright cyan circular status display sits centered between two compact navigation panels.'
      } else {
        const nonEnglish = [...userText].some((character) => character.codePointAt(0) > 127)
        const english = nonEnglish ? 'Debug this Python function and explain the fix.' : userText
        const isCode = /\b(code|program|function|script|debug)\b/i.test(english)
        result = {
          language: nonEnglish ? 'te' : 'en',
          english,
          intent: isCode ? 'code' : 'chat',
          target: isCode ? 'Python function' : '',
          prompt: isCode ? 'Debug the Python function, propose a corrected implementation, and explain the fix in English.' : english,
          confidence: 0.95,
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      const content = typeof result === 'string' ? result : JSON.stringify(result)
      return res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    }
    calls++
    asked.push(payload.model)
    const userText = lastText(payload.messages)
    if (payload.model === REASON && /bright cyan circular status display/i.test(userText) && /blueprint|code/i.test(userText)) {
      coderSawCombinedVisionPrompt = true
    }
    if (payload.model === REASON && /High-level English coding prompt: Debug the Python function/i.test(userText)) {
      coderSawEnglishTranslation = true
    }
    const system = (payload.messages ?? []).find((message) => message.role === 'system' && typeof message.content === 'string' && message.content.includes('WHAT THIS MACHINE CAN DO'))
    if (system && !systemSeen) systemSeen = system.content
    const askedForTool = (payload.tools ?? []).length > 0
    if (askedForTool && !offeredTools) {
      offeredTools = (payload.tools ?? []).map((tool) => tool?.function?.name).filter(Boolean)
    }
    const hasToolResult = (payload.messages ?? []).some((m) => m.role === 'tool')
    const isChat = payload.model === CHAT
    const wantsTool = /screenshot/i.test(lastText(payload.messages))
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

    // A refusal is challenged once, with the capability block pushed forward.
    // The stub refuses on the first ask and works with what it has on the
    // second, which is the behaviour the bridge is supposed to force.
    const nudged = (payload.messages ?? []).some(
      (m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('do not decline a task you have not checked'),
    )
    if (nudged && /convert this clip/i.test(lastText(payload.messages))) {
      sawDeclineRetry = true
      send({ choices: [{ delta: { content: 'The encoder is missing. ' } }] })
      send({ choices: [{ delta: { content: 'I used what is here instead, sir.' } }] })
      send({ choices: [{ finish_reason: 'stop' }] })
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    if (/convert this clip/i.test(lastText(payload.messages))) {
      send({ choices: [{ delta: { content: 'I cannot convert that, sir.' } }] })
      send({ choices: [{ finish_reason: 'stop' }] })
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    // The chat slot's one chance to fail: narrate a tool call instead of
    // making it. This is the failure that is invisible — fluent, confident,
    // and completely inert, with no error anywhere.
    if (isChat && chatHits++ === 0 && askedForTool) {
      send({ choices: [{ delta: { content: 'I will now open the browser and search for that. First I will change the theme to match your request, and then I will display the result on your HUD.' } }] })
      sawChatNarrate = true
    } else if (wantsTool && !hasToolResult) {
      // Turn 2: the model asks for a tool, split across chunks the way real
    // servers split it, so the accumulator is exercised.
      // Split across two chunks, the way real servers split it, so the
      // accumulator is exercised rather than assumed.
      send({
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'mcp__jarvis__blade', arguments: '{"kind":"markup","ti' } }] } }],
      })
      send({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tle":"Smoke test","html":"<b>hi</b>"}' } }] } }],
      })
      sawToolAsk = true
    } else {
      // The third turn is the one that proves the result came back: it can only
      // be reached if a tool message was appended to the conversation.
      if (hasToolResult) sawToolResult = true
      // Turn 1 and turn 3: plain streamed text.
      send({ choices: [{ delta: { content: 'Good evening, ' } }] })
      send({ choices: [{ delta: { content: 'sir.' } }] })
    }
    send({ choices: [{ finish_reason: 'stop' }] })
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
/** The last thing the user actually said, so the stub can tell turns apart. */
const lastText = (messages = []) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      return m.content.filter((p) => p?.type === 'text').map((p) => p.text).join(' ')
    }
  }
  return ''
}

await new Promise((r) => http.listen(MODEL_PORT, r))

// --- the bridge, pointed at the stub ---------------------------------------
// Importing the module starts the bridge as a side effect — it binds the port
// and serves. Nothing is used from it directly, which is the point: this drives
// it over a real socket, exactly as the browser does.
const _bridge = await import('./bridge/server.mjs').catch((err) => {
  console.error('FAIL: bridge would not load:', err.message)
  process.exit(1)
})

const autopilotResponse = await fetch(`http://localhost:${PORT}/autopilot`)
const autopilotData = await autopilotResponse.json()
const speechPlan = autopilotData.fits?.find((slot) => slot.id === 'speech')
const validTierStates = new Set(['fits', 'best-effort', 'unavailable'])
const tierCatalogOkay = Array.isArray(autopilotData.tiers)
  && autopilotData.tiers.length === 33
  && autopilotData.tiers[0]?.ramGb === 0.5
  && autopilotData.tiers.at(-1)?.ramGb === 32
  && autopilotData.tiers.every((tier) => {
    const slots = tier.slots
    if (!slots?.chat?.model || !slots?.reason?.model || !slots?.vision?.model) return false
    // Chat and coding always share a tag; vision shares it too whenever the
    // allocation fits one multimodal model, and splits only when a larger
    // text rung means vision must stay on its own native multimodal tag.
    const routeModelsOkay = slots.chat.model === slots.reason.model
    return Object.values(slots).every((slot) => validTierStates.has(slot.state) && slot.fits === (slot.state === 'fits'))
      && routeModelsOkay
      && slots.vision.multimodal === true
      && ['fits', 'best-effort'].includes(slots.vision.state)
      && /abliterat/i.test(slots.vision.model)
  })
const setupPage = await fetch(`http://localhost:${PORT}/install`).then((r) => (r.ok ? r.text() : null)).catch(() => null)
const runtimeData = await fetch(`http://localhost:${PORT}/autopilot/runtime`).then((r) => r.json()).catch(() => null)
const autopilotChecks = [
  ['/autopilot exposes a boolean Ollama status for ModelManager', typeof autopilotData.ollama === 'boolean'],
  ['/autopilot reports the host facts the setup page installs against', (() => {
    const runtime = autopilotData.runtime ?? {}
    const portable = runtime.portable ?? {}
    return ['platform', 'arch', 'ollamaInstalled', 'downloadUrl'].every((key) => runtime[key] !== undefined)
      && (runtime.diskFreeGb === null || Number.isFinite(runtime.diskFreeGb))
      && Number.isFinite(runtime.totalRamGb)
      && typeof portable.supported === 'boolean' && typeof portable.present === 'boolean'
      // On Windows there is an archive to offer; anywhere else the field is
      // empty on purpose, because offering a Windows zip to a host that cannot
      // unpack it would be the lie this project keeps refusing to tell.
      && (portable.supported ? Boolean(portable.asset) : portable.asset === null)
  })()],
  ['the setup page is served by the bridge itself, and shows the catalogue', Boolean(setupPage) && setupPage.includes('J.A.R.V.I.S — setup') && setupPage.includes('Install everything') && setupPage.includes('models/catalogue') && setupPage.includes('models/download')],
  ['/autopilot/runtime offers the real Windows archive the one-click install would fetch', (() => {
    const variants = runtimeData?.variants ?? []
    if (process.platform !== 'win32') {
      // This runner is the Linux test host, not the product's target. It must
      // claim no archive at all rather than a name it cannot use.
      return variants.length === 0 && runtimeData?.plan?.supported === false && runtimeData.plan.path === null
    }
    const first = variants.find((variant) => variant.id === 'default')
    return Boolean(first)
      && typeof first.name === 'string' && first.name.length > 0
      && first.url.startsWith('http')
      && first.kind === 'zip'
      && typeof first.sizeBytes === 'number'
      && typeof runtimeData.plan?.path === 'string'
  })()],
  ['the one-click button asks the bridge for the runtime as well as the chosen three', Boolean(setupPage) && /models\/download/.test(setupPage) && /runtime:\s*!\(state\.plan/.test(setupPage) && /chat: state\.pick\.chat/.test(setupPage)],
  ['the setup page installs the runtime silently instead of sending anyone to a download page', Boolean(setupPage) && (process.platform === 'win32' ? setupPage.includes('/VERYSILENT') : setupPage.includes('install:ollama')) && !setupPage.includes('target="_blank"') && !setupPage.includes(autopilotData.runtime.downloadUrl)],
  ['/autopilot returns the RAM and selected-slot fields used by ModelManager', Boolean(autopilotData.ram && Number.isFinite(autopilotData.ram.effectiveModelGb)) && Array.isArray(autopilotData.fits) && autopilotData.fits.every((slot) => typeof slot.id === 'string' && typeof slot.kind === 'string' && typeof slot.fits === 'boolean' && Number.isFinite(slot.downloadGb) && Number.isFinite(slot.residentGb))],
  ['/autopilot reports the user-share allocation instead of a fixed OS/apps split', (() => {
    const ram = autopilotData.ram ?? {}
    const ramFields = ['totalGb', 'freeGb', 'currentFreeGb', 'unallocatedGb', 'modelsGb', 'effectiveModelGb', 'sharePercent']
    return ramFields.every((field) => Number.isFinite(ram[field]))
      && ram.sharePercent > 0 && ram.sharePercent <= 100
      && ram.capGb === null
      && ram.modelsGb <= ram.currentFreeGb + 0.01
      && !Number.isFinite(ram.osGb) && !Number.isFinite(ram.appsGb)
      && autopilotData.allocation?.sharePercent === ram.sharePercent
  })()],
  ['/autopilot returns model-status slots and notes', Array.isArray(autopilotData.modelSlots) && Array.isArray(autopilotData.notes)],
  ['/autopilot includes 33 truthful RAM profiles with a multimodal vision slot in every tier', tierCatalogOkay],
  ['/autopilot exposes explicit model size and quant metadata for routed slots', (() => {
    const slots = Object.fromEntries((autopilotData.fits ?? []).map((slot) => [slot.id, slot]))
    return Boolean(slots.chat?.parametersB && slots.reason?.parametersB
      && slots.vision?.multimodal && slots.vision.parametersB
      && slots.vision.quant && Number.isFinite(slots.chat.downloadGb))
  })()],
  ['auto STT can identify only an explicitly selected Whisper slot', !speechPlan || (speechPlan.kind === 'whisper' && typeof speechPlan.fits === 'boolean')],
]

const ws = new WebSocket(`ws://localhost:${PORT}`)
const frames = []
const tools = []
let sawReady = false
let sentAsk = false

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out waiting for frames')), 20000)
  ws.on('open', () => {})
  ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString())
    frames.push(f)
    if (f.type === 'ready') {
      sawReady = true
      console.log(`  ready  servers: ${JSON.stringify(f.servers)}`)
      if (!sentAsk && Array.isArray(f.servers) && f.servers.length >= 7) {
        sentAsk = true
        ws.send(JSON.stringify({ type: 'ask', id: 'q1', text: 'Take a screenshot of my phone.' }))
      }
    }
    if (f.type === 'tool') tools.push(f.name)
    if (f.type === 'text') process.stdout.write(`  text   ${JSON.stringify(f.delta)}\n`)
    if (f.type === 'done') {
      console.log(`  done   ${JSON.stringify(f.text)}`)
      clearTimeout(timer)
      resolve()
    }
    if (f.type === 'error') {
      console.log(`  ERROR  ${f.message}`)
      clearTimeout(timer)
      reject(new Error(f.message))
    }
  })
  ws.on('error', reject)
})

// --- assertions ------------------------------------------------------------
const text = frames.filter((f) => f.type === 'text').map((f) => f.delta).join('')
const done = frames.find((f) => f.type === 'done')
// The ready frame arrives twice — once from config on connect, once from the
// live tool list once the servers have joined. Only the second is meaningful.
const readyServers = frames.filter((f) => f.type === 'ready').pop()?.servers ?? []
const checks = [
  ['the bridge started and served a socket', sawReady],
  ['all seven built-in MCP servers connected', readyServers.length >= 7],
  ['the command line and desktop servers are in the live union', readyServers.includes('jarvis_shell') && readyServers.includes('jarvis_desktop')],
  ['the model is told what this machine can do, not left to imagine it', Boolean(systemSeen) && /CAPABILITY FIRST/.test(systemSeen) && systemSeen.includes(`Host: ${process.platform}`)],
  ['the machine block states the write state truthfully', Boolean(systemSeen) && /Acting tools: off/.test(systemSeen) && /writes are off, so run_command is not registered/.test(systemSeen)],
  ['the read-only shell and desktop tools reach the model', Boolean(offeredTools?.includes('mcp__jarvis_shell__command_info') && offeredTools?.includes('mcp__jarvis_shell__list_processes') && offeredTools?.includes('mcp__jarvis_desktop__desktop_capabilities') && offeredTools?.includes('mcp__jarvis_desktop__list_apps') && offeredTools?.includes('mcp__jarvis_desktop__list_windows'))],
  ['no acting tool is offered while writes are off', Boolean(offeredTools) && !offeredTools.some((name) => /^(mcp__jarvis_shell__run_command|mcp__jarvis_desktop__(click|type_text|press_keys|launch_app|quit_app|move_mouse|scroll|focus_window|window_action))$/.test(name))],
  ['the model was asked twice (answer -> tool -> answer)', calls === 2],
  ['the model was offered the tools', sawToolAsk],
  ['the tool it asked for was announced on the HUD', tools.includes('mcp__jarvis__blade')],
  ['a blade was pushed to the browser', frames.some((f) => f.type === 'blade')],
  ['the tool result was fed back to the model', sawToolResult],
  ['the final answer streamed in pieces', text.length > 0],
  ['the answer is the model\'s second turn', Boolean(done?.text.includes('sir'))],
  ['a tool-shaped question was sent to the reason slot', asked[0] === REASON],
]

// --- phase two: the chat slot narrating instead of acting -------------------
// Phase one routes to the reason slot, so it never exercises the fast one. This
// does. It asks a question with no tool words, gets an inert answer, and the
// net has to catch it before the browser hears a word of it.
const ws2 = new WebSocket(`ws://localhost:${PORT}`)
const frames2 = []
let sentAsk2 = false
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out waiting for frames (phase 2)')), 20000)
  ws2.on('open', () => {})
  ws2.on('message', (raw) => {
    const f = JSON.parse(raw.toString())
    frames2.push(f)
    if (f.type === 'ready' && !sentAsk2 && Array.isArray(f.servers) && f.servers.length >= 7) {
      sentAsk2 = true
      ws2.send(JSON.stringify({ type: 'ask', id: 'q2', text: 'good evening' }))
    }
    if (f.type === 'done') { clearTimeout(timer); resolve() }
    if (f.type === 'error') { clearTimeout(timer); reject(new Error(f.message)) }
  })
  ws2.on('error', reject)
})
const spoken2 = frames2.filter((f) => f.type === 'text').map((f) => f.delta).join('')
const done2 = frames2.find((f) => f.type === 'done')
const asked2 = asked.slice(2) // everything after phase one's two requests

const netChecks = [
  ['the chat slot narrated instead of acting', sawChatNarrate],
  ['a tool-free question still went to the fast slot first', asked2[0] === CHAT],
  ['the turn was retried on the reason slot', asked2[1] === REASON],
  ['the inert answer never reached the browser', !spoken2.includes('I will now open the browser')],
  ['a real answer was spoken in its place', done2?.text?.includes('sir') ?? false],
]

// Exercise the real multilingual and vision preparation path against the stub.
// This verifies that intent extraction, image analysis, prompt fusion, and
// downstream code routing happen in the intended order without claiming a live
// Ollama conversation.
const { runTurn, modelVisionCapability } = await import('./bridge/local-llm.mjs')
const teluguMessage = { role: 'user', content: 'ఈ Python ఫంక్షన్‌ని డీబగ్ చేయి' }
const translatedConversation = [teluguMessage]
const translatedReply = await runTurn({
  messages: translatedConversation,
  clients: new Map(),
  gate: () => true,
})
const multilingualChecks = [
  ['a Telugu coding request is translated into an English coding brief', coderSawEnglishTranslation],
  ['translated multilingual code intent is routed to the coding model', asked.at(-1) === REASON],
  ['the routed code request reaches an answer', translatedReply.includes('sir')],
]

const visionConversation = [{
  role: 'user',
  content: [
    { type: 'text', text: 'Code an English implementation of the visual layout shown.' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } },
  ],
}]
const visionReply = await runTurn({
  messages: visionConversation,
  clients: new Map(),
  gate: () => true,
  translate: false,
})
const unsupportedVision = await modelVisionCapability(`http://localhost:${MODEL_PORT}/v1`, 'smoke/qwen3.5-text-only')
const visionChecks = [
  ['the vision model receives both pixels and the original user intent', visionSawImage && visionSawIntent],
  ['Ollama vision capability is checked before sending image input', visionCapabilityProbeCount > 0],
  ['a text-only GGUF import is rejected for image requests', unsupportedVision?.supported === false && /image requests are blocked/i.test(unsupportedVision.error ?? '')],
  ['vision observations and coding intent are fused for the coding model', coderSawCombinedVisionPrompt],
  ['the fused vision/code request reaches an answer', visionReply.includes('sir')],
]

// Verify the one-model-at-a-time budget around shared route tags, the distinct
// 32 GB vision model, and local Whisper. This uses a second module instance with
// the same mock Ollama, not the host's installed-model state.
const resourceEventStart = resourceEvents.length
const memoryEnvKeys = ['JARVIS_MODEL_CHAT', 'JARVIS_MODEL_REASON', 'JARVIS_MODEL_VISION']
const priorMemoryEnv = Object.fromEntries(memoryEnvKeys.map((key) => [key, process.env[key]]))
let memoryTestError = ''
try {
  process.env.JARVIS_MODEL_CHAT = 'smoke/shared-text'
  process.env.JARVIS_MODEL_REASON = 'smoke/shared-text'
  process.env.JARVIS_MODEL_VISION = 'smoke/native-vision'
  const guardedLLM = await import(`./bridge/local-llm.mjs?memory-test=${Date.now()}`)
  await guardedLLM.complete('chat', [{ role: 'user', content: 'chat test' }])
  await guardedLLM.complete('reason', [{ role: 'user', content: 'reason test' }])
  await guardedLLM.complete('vision', [{ role: 'user', content: 'vision test' }])
  await guardedLLM.complete('chat', [{ role: 'user', content: 'speech follows' }])
  await guardedLLM.withLocalSpeechModel(async () => {
    const response = await fetch(`http://localhost:${MODEL_PORT}/test/speech-started`, { method: 'POST' })
    if (!response.ok) throw new Error(`speech reservation callback returned HTTP ${response.status}`)
  })
} catch (error) {
  memoryTestError = String(error?.message ?? error)
} finally {
  for (const key of memoryEnvKeys) {
    if (priorMemoryEnv[key] === undefined) delete process.env[key]
    else process.env[key] = priorMemoryEnv[key]
  }
}
const memoryEvents = resourceEvents.slice(resourceEventStart)
const expectedMemoryEvents = [
  'inference:smoke/shared-text',
  'inference:smoke/shared-text',
  'unload:smoke/shared-text',
  'inference:smoke/native-vision',
  'unload:smoke/native-vision',
  'inference:smoke/shared-text',
  'unload:smoke/shared-text',
  'speech',
]
const memoryChecks = [
  ['shared chat/reason weights stay warm, but distinct vision weights are unloaded before the switch', !memoryTestError && JSON.stringify(memoryEvents.slice(0, 5)) === JSON.stringify(expectedMemoryEvents.slice(0, 5))],
  ['the local Whisper reservation unloads the retained LLM before speech inference', !memoryTestError && JSON.stringify(memoryEvents.slice(5)) === JSON.stringify(expectedMemoryEvents.slice(5))],
]

// --- phase three: a refusal is challenged before it is spoken ---------------
// The machine can do this task with what it has. The first answer gives up
// anyway, which is the failure that reads as a limit rather than a decision.
// The bridge has to catch it, re-ask with the machine's facts, and only speak
// the answer that checked.
const ws3 = new WebSocket(`ws://localhost:${PORT}`)
const frames3 = []
let sentAsk3 = false
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for frames (phase 3)')), 20000)
    ws3.on('open', () => {})
    ws3.on('message', (raw) => {
      const f = JSON.parse(raw.toString())
      frames3.push(f)
      if (f.type === 'ready' && !sentAsk3 && Array.isArray(f.servers) && f.servers.length >= 7) {
        sentAsk3 = true
        ws3.send(JSON.stringify({ type: 'ask', id: 'q3', text: 'Convert this clip to mp4.' }))
      }
      if (f.type === 'done') { clearTimeout(timer); resolve() }
      if (f.type === 'error') { clearTimeout(timer); reject(new Error(f.message)) }
    })
    ws3.on('error', reject)
  })
} catch (error) {
  frames3.push({ type: 'error', message: error.message })
}
const spoken3 = frames3.filter((f) => f.type === 'text').map((f) => f.delta).join('')
const declineChecks = [
  ['a refusal with no check behind it was challenged', sawDeclineRetry],
  ['the unchecked refusal never reached the browser', spoken3.length > 0 && !/cannot/i.test(spoken3)],
  ['the answer that used what the machine has was spoken instead', /instead/.test(spoken3)],
]

// --- phase four: the terminal client ----------------------------------------
// The same bridge, the same frames, no browser. This is the client people
// debug with, so it has to show the answer and every tool the model ran.
// Spawned asynchronously on purpose: the bridge is in this process, so a
// blocking spawn would starve the very server the client is connecting to.
const cli = await new Promise((resolve) => {
  const child = spawn(process.execPath, ['scripts/cli.mjs', '--once', 'Take a screenshot of my phone.', '--url', `ws://localhost:${PORT}`], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const timer = setTimeout(() => { child.kill('SIGKILL') }, 30000)
  child.once('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }) })
  child.once('error', (error) => { clearTimeout(timer); resolve({ status: -1, stdout, stderr: String(error.message) }) })
})
const cliChecks = [
  ['the terminal client answers through the same bridge', cli.status === 0],
  ['it shows the tool the model executed', /blade/.test(cli.stderr ?? '')],
  ['it prints the final answer on stdout', /Good evening, sir\./.test(cli.stdout ?? '')],
]

// Routing is a pure function of the conversation, so it is checked directly
// rather than inferred from what a stub happened to be sent. One case per slot,
// because the middle one fails silently: a text model shown a photograph
// describes the prompt instead of the picture, with total confidence.
const IMG = [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } }]
const routingModule = await import('./bridge/local-llm.mjs').catch(() => null)
const routing = routingModule?.pickModel
const technicalSlot = routingModule?.PIPELINE?.coder?.model ? 'coder' : 'reason'
const routingChecks = routing
  ? [
      ['an image routes to the vision slot', routing([{ role: 'user', content: IMG }]) === 'vision'],
      [`a technical question routes to the ${technicalSlot} slot`, routing([{ role: 'user', content: 'why does this regex fail?' }]) === technicalSlot],
      ['a tool-shaped question routes to the reason slot', routing([{ role: 'user', content: 'take a screenshot of my phone' }]) === 'reason'],
      ['a plain greeting routes to the chat slot', routing([{ role: 'user', content: 'say good evening' }]) === 'chat'],
      ['an image in a tool result also routes to vision', routing([
        { role: 'user', content: 'look at me' },
        { role: 'tool', tool_call_id: 'c', content: IMG },
      ]) === 'vision'],
    ]
  : [['pickModel is exported', false]]

let failed = 0
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failed++
}
const loopPassed = checks.length - failed

console.log(`\n  models asked, in order: ${asked.join(' -> ')}`)
let autopilotFailed = 0
for (const [name, ok] of autopilotChecks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) autopilotFailed++
}
let routeFailed = 0
for (const [name, ok] of routingChecks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) routeFailed++
}
let netFailed = 0
for (const [name, ok] of netChecks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) netFailed++
}
let multilingualFailed = 0
for (const [name, ok] of multilingualChecks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) multilingualFailed++
}
let visionFailed = 0
for (const [name, ok] of visionChecks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) visionFailed++
}
let memoryFailed = 0
for (const [name, ok] of memoryChecks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) memoryFailed++
}
if (memoryTestError) console.error(`  model-memory test error: ${memoryTestError}`)
if (netFailed) failed += netFailed
if (autopilotFailed) failed += autopilotFailed
if (routeFailed) failed += routeFailed
if (multilingualFailed) failed += multilingualFailed
if (visionFailed) failed += visionFailed
if (memoryFailed) failed += memoryFailed

// The allocation is the user's to change at runtime. Drive the real endpoint
// the MODEL STACK panel uses and confirm the plan follows the saved share.
const allocationChecks = []
try {
  const before = await (await fetch(`http://localhost:${PORT}/autopilot`)).json()
  const setResponse = await fetch(`http://localhost:${PORT}/autopilot/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ share: 50 }),
  })
  const setData = await setResponse.json()
  const after = await (await fetch(`http://localhost:${PORT}/autopilot`)).json()
  allocationChecks.push(
    ['POST /autopilot/config accepts a share and reports the new ceiling', setResponse.ok === true && setData.ok === true && setData.ram.sharePercent === 50],
    ['a 50% share halves the AI ceiling measured against free RAM', Math.abs(after.ram.modelsGb - after.ram.currentFreeGb * 0.5) < 0.05],
    ['the saved share survives into the next plan read', after.ram.allocationSource === 'saved' && after.allocation?.share === 0.5],
    ['the endpoint refuses a nonsense share instead of guessing', (await fetch(`http://localhost:${PORT}/autopilot/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ share: 900 }) })).status === 400],
    ['the endpoint refuses unknown options', (await fetch(`http://localhost:${PORT}/autopilot/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nope: 1 }) })).status === 400],
    ['RESCAN re-plans without changing the saved share', await (async () => {
      const response = await fetch(`http://localhost:${PORT}/autopilot/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rescan: true }) })
      const data = await response.json()
      return response.ok && data.changed === false && data.ram.sharePercent === 50
    })()],
    ['the plan before the change was not already 50%', before.ram.sharePercent !== 50 || before.ram.allocationSource !== 'saved'],
  )
  await fetch(`http://localhost:${PORT}/autopilot/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ share: null, capGb: null }) })
} catch (error) {
  allocationChecks.push([`allocation endpoint error: ${error.message}`, false])
}
console.log('')
let declineFailed = 0
for (const [name, ok] of declineChecks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) declineFailed++
}
failed += declineFailed
console.log('')
let cliFailed = 0
for (const [name, ok] of cliChecks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) cliFailed++
}
failed += cliFailed
console.log('')
let allocationFailed = 0
for (const [name, ok] of allocationChecks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) allocationFailed++
}
failed += allocationFailed
await rm(process.env.JARVIS_RAM_CONFIG, { force: true })

console.log(`\n  ${loopPassed}/${checks.length} loop checks, ${autopilotChecks.length - autopilotFailed}/${autopilotChecks.length} autopilot contract, ${declineChecks.length - declineFailed}/${declineChecks.length} decline challenge, ${cliChecks.length - cliFailed}/${cliChecks.length} terminal client, ${routingChecks.length - routeFailed}/${routingChecks.length} routing, ${netChecks.length - netFailed}/${netChecks.length} net, ${multilingualChecks.length - multilingualFailed}/${multilingualChecks.length} multilingual, ${visionChecks.length - visionFailed}/${visionChecks.length} vision, ${memoryChecks.length - memoryFailed}/${memoryChecks.length} memory, ${allocationChecks.length - allocationFailed}/${allocationChecks.length} allocation`)

ws.close()
ws2.close()
http.close()
process.exit(failed ? 1 : 0)
