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
import { createServer } from 'node:http'
import { WebSocket } from 'ws'

const PORT = 8791
const MODEL_PORT = 11499
const MODEL = 'stub-model'
// The pipeline's real defaults. The stub answers /v1/models with only its own
// name, so the bridge's slot check reports them all missing — which is correct
// behaviour and also why the turn still runs: the model name is passed through
// regardless of what is loaded.
const CHAT = 'huihui_ai/qwen2.5-abliterate:0.5b'
const REASON = 'dagbs/qwen2.5-coder-7b-instruct-abliterated'

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
const http = createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ data: [{ id: MODEL }] }))
  }
  if (req.url !== '/v1/chat/completions') {
    res.writeHead(404)
    return res.end()
  }
  calls++
  const body = []
  req.on('data', (c) => body.push(c))
  req.on('end', () => {
    const payload = JSON.parse(Buffer.concat(body).toString())
    asked.push(payload.model)
    const askedForTool = (payload.tools ?? []).length > 0
    const hasToolResult = (payload.messages ?? []).some((m) => m.role === 'tool')
    const isChat = payload.model === CHAT
    const wantsTool = /screenshot/i.test(lastText(payload.messages))

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

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

const ws = new WebSocket(`ws://localhost:${PORT}`)
const frames = []
const tools = []
let sawReady = false

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out waiting for frames')), 20000)
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'ask', id: 'q1', text: 'Take a screenshot of my phone.' }))
  })
  ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString())
    frames.push(f)
    if (f.type === 'ready') {
      sawReady = true
      console.log(`  ready  servers: ${JSON.stringify(f.servers)}`)
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
  ['all four built-in MCP servers connected', readyServers.length >= 4],
  ['the model was asked twice (answer -> tool -> answer)', calls === 2],
  ['the model was offered the tools', sawToolAsk],
  ['the tool it asked for was announced on the HUD', tools.includes('mcp__jarvis__blade')],
  ['a blade was pushed to the browser', frames.some((f) => f.type === 'blade')],
  ['the tool result was fed back to the model', sawToolResult],
  ['the final answer streamed in pieces', text.length > 0],
  ['the answer is the model\'s second turn', Boolean(done?.text.includes('sir'))],
  ['a tool-shaped question was sent to the reason slot', asked[0] === 'dagbs/qwen2.5-coder-7b-instruct-abliterated'],
]

// --- phase two: the chat slot narrating instead of acting -------------------
// Phase one routes to the reason slot, so it never exercises the fast one. This
// does. It asks a question with no tool words, gets an inert answer, and the
// net has to catch it before the browser hears a word of it.
const ws2 = new WebSocket(`ws://localhost:${PORT}`)
const frames2 = []
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out waiting for frames (phase 2)')), 20000)
  ws2.on('open', () => ws2.send(JSON.stringify({ type: 'ask', id: 'q2', text: 'good evening' })))
  ws2.on('message', (raw) => {
    const f = JSON.parse(raw.toString())
    frames2.push(f)
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

// Routing is a pure function of the conversation, so it is checked directly
// rather than inferred from what a stub happened to be sent. One case per slot,
// because the middle one fails silently: a text model shown a photograph
// describes the prompt instead of the picture, with total confidence.
const IMG = [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } }]
const routing = await import('./bridge/local-llm.mjs')
  .then((m) => m.pickModel)
  .catch(() => null)
const routingChecks = routing
  ? [
      ['an image routes to the vision slot', routing([{ role: 'user', content: IMG }]) === 'vision'],
      ['a technical question routes to the reason slot', routing([{ role: 'user', content: 'why does this regex fail?' }]) === 'reason'],
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

console.log(`\n  models asked, in order: ${asked.join(' -> ')}`)
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
if (netFailed) failed += netFailed
if (routeFailed) failed += routeFailed

const loopPassed = checks.length - (failed - netFailed - routeFailed)
console.log(`\n  ${loopPassed}/${checks.length} loop checks, ${routingChecks.length - routeFailed}/${routingChecks.length} routing, ${netChecks.length - netFailed}/${netChecks.length} net`)

ws.close()
ws2.close()
http.close()
process.exit(failed ? 1 : 0)
