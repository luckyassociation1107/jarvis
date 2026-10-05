/** Throwaway probe: the two-phase bridge stage against a stub model. */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { createServer as createHttp } from 'node:http'
import { join } from 'node:path'
const BRIDGE = '/home/user/jarvis/bridge/server.mjs'
const modelTags = ['stub']
const currentPlan = { choices: { chat: { fits: true, model: 'stub' }, reason: { fits: true, model: 'stub' }, vision: { fits: true, model: 'stub' } } }
const RUNTIME_URL = 'http://127.0.0.1:11555'
let bridgeChild = null
let bridgeSocket = null
const heading = (line) => console.log(`\n== ${line}`)
const step = (line) => console.log(`   ${line}`)
function oneLine(text) { return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) }
function finish(code) { process.exitCode = code }
mkdirSync('/tmp/probe-root', { recursive: true })
rmSync('/tmp/probe-root/models', { recursive: true, force: true })
process.chdir('/tmp/probe-root')
let calls = 0
const seen = []
const http = createHttp((req, res) => {
  if (req.url === '/api/tags') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({models:[{name:'stub'}]})) }
  if (req.url === '/api/show') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({capabilities:['completion','vision'],model_info:{}})) }
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end() }
  const body = []
  req.on('data', (c) => body.push(c))
  req.on('end', () => {
    const payload = JSON.parse(Buffer.concat(body).toString())
    const messages = payload.messages ?? []
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const userText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '')
    const toolResults = messages.filter((m) => m.role === 'tool')
    seen.push(`${payload.reasoning_effort ?? 'default'}/${payload.max_tokens ?? '-'}`)
    console.log(`   [stub] call ${++calls} reasoning=${payload.reasoning_effort ?? 'default'} max_tokens=${payload.max_tokens ?? '-'} tools=${Array.isArray(payload.tools) ? payload.tools.length : 0}`)
    const stream = (delta, finishReason = 'stop') => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: payload.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: payload.model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }
    if (/run_command/.test(userText) && !/Remember this word/i.test(userText)) {
      if (toolResults.length === 0) {
        return stream({ role: 'assistant', content: '', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'mcp__jarvis_shell__run_command', arguments: JSON.stringify({ command: 'echo BANANA>live-proof.txt', why: 'probe' }) } }] })
      }
      return stream({ role: 'assistant', content: 'DONE' })
    }
    if (/fruit/i.test(userText) || /word did I ask/i.test(userText)) return stream({ role: 'assistant', content: 'BANANA' })
    if (/Remember this word/i.test(userText)) return stream({ role: 'assistant', content: 'OK' })
    return stream({ role: 'assistant', content: 'Good morning. Ready to assist you.' })
  })
})
await new Promise((r) => http.listen(11555, '127.0.0.1', r))

/* ------------------------------------------------------------ the bridge stage */

/**
 * Drive the bridge the way the interface does, with the model that was just
 * installed — in two phases, because one configuration cannot be honest for
 * both jobs.
 *
 * Phase one is conversation: thinking switched off and a 700-token ceiling,
 * because a thinking 2B spends its whole budget reasoning and answers with an
 * empty string (measured: 1,900 tokens still going at the 180 s turn limit for
 * "say hello"). Greeting, then a word given and asked back — socket, session,
 * answer path, context.
 *
 * Phase two is work, and runs the configuration the app itself ships: thinking
 * on and room to use it, because calling a tool is the reasoning path. The
 * model is asked to run one command, and the file that command should produce
 * is read off the disk. A 2B model that narrates instead of acting is reported,
 * not pretended away — so this half is informational and the verdict does not
 * hang on a small model's tool discipline.
 */
async function runBridgeStage() {
  const checks = []
  const noteLines = []
  const workDir = join(process.cwd(), 'models', 'live-bridge')
  mkdirSync(workDir, { recursive: true })
  const bridgeEntry = BRIDGE
  const proof = join(workDir, 'live-proof.txt')
  // Pin the bridge to the very weights this run pulled and just prompted, by
  // name and by URL. Left to plan for itself it would usually agree, and
  // "usually" is not a thing to build a verdict on.
  const slot = (name) => (currentPlan.choices[name]?.fits ? currentPlan.choices[name].model : null) ?? modelTags[0]
  const chatTag = slot('chat')

  /** Start a bridge and wait for it to answer /health. */
  const startBridge = async (extraEnv, label) => {
    const port = await freePort()
    const log = []
    bridgeChild = spawn(process.execPath, [bridgeEntry], {
      cwd: workDir,
      windowsHide: true,
      env: {
        ...process.env,
        JARVIS_BRIDGE_PORT: String(port),
        JARVIS_ALLOW_NO_ORIGIN: '1',
        JARVIS_ALLOW_WRITES: '1',
        JARVIS_SHELL_ROOTS: workDir,
        JARVIS_OLLAMA_URL: RUNTIME_URL,
        JARVIS_MODEL_BASE_URL: `${RUNTIME_URL}/v1`,
        JARVIS_MODEL_CHAT: chatTag,
        JARVIS_MODEL_REASON: slot('reason'),
        JARVIS_MODEL_VISION: slot('vision'),
        JARVIS_MODEL_CHAT_URL: `${RUNTIME_URL}/v1`,
        JARVIS_MODEL_REASON_URL: `${RUNTIME_URL}/v1`,
        JARVIS_MODEL_VISION_URL: `${RUNTIME_URL}/v1`,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    bridgeChild.stdout.on('data', (chunk) => log.push(String(chunk).trimEnd()))
    bridgeChild.stderr.on('data', (chunk) => log.push(String(chunk).trimEnd()))

    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
        if (response.ok) return port
      } catch { /* still starting: the MCP servers join first */ }
      await sleep(700)
    }
    throw new Error(`the ${label} bridge did not answer /health within 90 s — ${log.slice(-3).join(' | ') || 'no output'}`)
  }

  /** Connect a socket and hand back a way to ask a question and wait for its end. */
  const openSession = async (port) => {
    // The same client smoke.mjs drives the bridge with; the global WebSocket
    // has a different event API and the bridge's frames are JSON either way.
    const { WebSocket: Client } = await import('ws')
    bridgeSocket = new Client(`ws://127.0.0.1:${port}`)
    const frames = []
    bridgeSocket.on('message', (raw) => {
      try { frames.push(JSON.parse(raw.toString())) } catch { /* not for us */ }
    })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the bridge did not accept a socket within 20 s')), 20_000)
      bridgeSocket.once('open', () => { clearTimeout(timer); resolve() })
      bridgeSocket.once('error', (error) => { clearTimeout(timer); reject(error) })
    })
    let asked = 0
    const ask = async (text, timeoutMs = 300_000) => {
      const id = `live${++asked}`
      const from = frames.length
      bridgeSocket.send(JSON.stringify({ type: 'ask', id, text }))
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const mine = frames.slice(from).filter((frame) => frame.ask === id || frame.id === id)
        const done = mine.find((frame) => frame.type === 'done')
        const failed = mine.find((frame) => frame.type === 'error')
        if (done) return { text: done.text ?? '', tools: mine.filter((frame) => frame.type === 'tool').map((frame) => frame.name), error: null }
        if (failed) return { text: '', tools: [], error: failed.message ?? 'the bridge reported an error' }
        await sleep(400)
      }
      return { text: '', tools: [], error: `no answer within ${Math.round(timeoutMs / 1000)} s` }
    }
    return { frames, ask }
  }

  const stopBridge = async () => {
    try { bridgeSocket?.close() } catch { /* already closed */ }
    bridgeSocket = null
    if (bridgeChild && bridgeChild.exitCode === null && bridgeChild.signalCode === null) {
      try { bridgeChild.kill() } catch { /* already gone */ }
    }
    bridgeChild = null
    await sleep(500)
  }

  try {
    /* ---- phase one: does the bridge hold a conversation? ------------------ */
    const fastPort = await startBridge({
      // Ollama turns thinking on for the Qwen3.5 family by default, and the
      // OpenAI-compatible endpoint this client speaks ignores Ollama's own
      // `think` field — a capped call then spends every token reasoning and
      // answers with nothing. "none" is the documented way to switch it off
      // there, and what makes a turn on a runner-sized CPU finish.
      JARVIS_MODEL_REASONING: 'none',
      JARVIS_MODEL_MAX_TOKENS: '700',
      JARVIS_MODEL_TIMEOUT_MS: '300000',
    }, 'first')
    const fast = await openSession(fastPort)
    const ready = await waitForFrame(fast.frames, (frame) => frame.type === 'ready' && Array.isArray(frame.servers) && frame.servers.length >= 7, 60_000)
    checks.push({
      name: 'tools joined',
      ok: Boolean(ready),
      evidence: ready ? `${ready.servers.length} servers: ${ready.servers.join(', ')}` : 'no ready frame listing seven servers',
    })

    const greeting = await fast.ask('Say hello in one short sentence.')
    const greetingText = (greeting.text ?? '').trim()
    checks.push({
      name: 'conversation',
      ok: Boolean(greetingText) && !greeting.error,
      evidence: greeting.error ? greeting.error : `the bridge answered over its own socket: "${oneLine(greetingText)}"`,
    })

    // The word is given and then asked back. Without the second turn this only
    // proves the model can talk; with it, the *session* carries what the user
    // said, which is the difference between an assistant and a one-shot
    // endpoint. A weak model word-finds badly, so a miss is re-asked with the
    // one cue that narrows it — still answerable only from the history.
    const told = await fast.ask('Remember this word: BANANA. Reply with the single word OK.')
    let recall = await fast.ask('What word did I ask you to remember? Reply with that one word only.')
    let recallText = (recall.text ?? '').trim()
    if (!/BANANA/i.test(recallText)) {
      step('RETRY   memory        the word did not come back; asking again with the cue that it was a fruit')
      recall = await fast.ask('It was the name of a fruit. Reply with that fruit only.')
      recallText = (recall.text ?? '').trim()
    }
    checks.push({
      name: 'memory',
      ok: /BANANA/i.test(recallText),
      evidence: recall.error
        ? recall.error
        : `"${oneLine(recallText)}" for a word given in the previous turn (that turn answered "${oneLine((told.text ?? '').trim()) || told.error || 'nothing'}")`,
    })
    noteLines.push('', 'Bridge phase one — JARVIS_MODEL_REASONING=none, JARVIS_MODEL_MAX_TOKENS=700 (a thinking 2B answers a capped turn with an empty string).')
    await stopBridge()

    /* ---- phase two: will the model do a job with a tool? ------------------ */
    const workPort = await startBridge({
      // The app's own configuration here: thinking on and room for it, because
      // tool calling is the reasoning path. The ceiling is only a guard against
      // a turn that never ends.
      JARVIS_MODEL_MAX_TOKENS: '3000',
      JARVIS_MODEL_TIMEOUT_MS: '600000',
    }, 'second')
    const worker = await openSession(workPort)
    await waitForFrame(worker.frames, (frame) => frame.type === 'ready' && Array.isArray(frame.servers) && frame.servers.length >= 7, 60_000)

    const jobAsk = (command) => `Run this command on my machine now: \`${command}\` — use the tool mcp__jarvis_shell__run_command. Do not answer in words before the command has run. Once it has run, reply with the single word DONE.`
    let workTurn = await worker.ask(jobAsk('echo BANANA>live-proof.txt'), 600_000)
    let ranIt = existsSync(proof) && /BANANA/i.test(readFileSync(proof, 'utf8'))
    if (!ranIt) {
      step('RETRY   a real command  no file after the first ask; asking once more, naming the tool, the argument and the file')
      workTurn = await worker.ask('Use mcp__jarvis_shell__run_command right now with command set to exactly `echo BANANA>live-proof.txt`. Then reply DONE.', 600_000)
      ranIt = existsSync(proof) && /BANANA/i.test(readFileSync(proof, 'utf8'))
    }
    checks.push({
      name: 'a real command',
      ok: ranIt,
      optional: true,
      evidence: ranIt
        ? `the model called ${workTurn.tools.join(', ') || 'mcp__jarvis_shell__run_command'} and live-proof.txt now contains BANANA`
        : workTurn.error
          ? `the turn failed: ${workTurn.error}`
          : `no file written — tools announced: [${workTurn.tools.join(', ') || 'none'}], answer: "${oneLine((workTurn.text ?? '').trim())}"`,
    })
    noteLines.push(
      `Tool turn: announced [${workTurn.tools.join(', ') || 'none'}]${workTurn.error ? `, failed: ${workTurn.error}` : `, said "${oneLine((workTurn.text ?? '').trim())}"`}.`,
      'Bridge phase two — the app\'s own configuration: thinking on, JARVIS_MODEL_MAX_TOKENS=3000 (tool calling is the reasoning path).',
    )
    return { checks, noteLines }
  } catch (error) {
    // Deliberately not optional. An unrunnable stage once reported itself as an
    // informational line and the run went green on 0/0 bridge checks — a
    // self-test that cannot test anything must say so at the top of its voice.
    checks.push({ name: 'the bridge ran a turn', ok: false, evidence: `could not be driven: ${error?.message ?? error}` })
    return { checks, noteLines }
  } finally {
    await stopBridge()
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function waitForFrame(frames, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = frames.find(predicate)
    if (found) return found
    await sleep(400)
  }
  return null
}


const work = await runBridgeStage()
for (const c of work.checks) console.log(`   [${c.ok ? 'PASS' : c.optional ? 'INFO' : 'FAIL'}] ${c.name}: ${c.evidence}`)
console.log(work.noteLines.join('\n'))
console.log('model calls (reasoning/max_tokens):', JSON.stringify(seen))
const proof = '/tmp/probe-root/models/live-bridge/live-proof.txt'
console.log('proof file:', existsSync(proof) ? JSON.stringify(readFileSync(proof, 'utf8')) : 'MISSING')
process.exit(0)
