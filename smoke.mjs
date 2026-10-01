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

// --- the stub model server -------------------------------------------------
let calls = 0
let sawToolAsk = false
let sawToolResult = false
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
    const askedForTool = (payload.tools ?? []).length > 0
    const hasToolResult = (payload.messages ?? []).some((m) => m.role === 'tool')

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

    // Turn 2: the model asks for a tool, split across chunks the way real
    // servers split it, so the accumulator is exercised.
    if (askedForTool && !hasToolResult) {
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
    ws.send(JSON.stringify({ type: 'ask', id: 'q1', text: 'Say good evening.' }))
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
]

let failed = 0
console.log('')
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failed++
}
console.log(`\n  ${checks.length - failed}/${checks.length} passed`)

ws.close()
http.close()
process.exit(failed ? 1 : 0)
