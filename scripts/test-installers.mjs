import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  canStartLocalOllama,
  configuredModelBaseUrl,
  configuredModelName,
  displayEndpoint,
  hasExplicitModelOverride,
  isLocalOllamaApi,
  isLoopbackHost,
  ollamaListenAddress,
} from './ollama-endpoints.mjs'

function runNode(script, args, env, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (status, signal) => {
      clearTimeout(timeout)
      resolve({ status, signal, stdout, stderr })
    })
  })
}

assert.equal(isLoopbackHost('localhost'), true)
assert.equal(isLoopbackHost('127.0.0.1'), true)
assert.equal(isLoopbackHost('127.14.2.3'), true)
assert.equal(isLoopbackHost('::1'), true)
assert.equal(isLoopbackHost('192.168.1.8'), false)
assert.equal(isLoopbackHost('127.999.0.1'), false)

assert.equal(
  isLocalOllamaApi('http://localhost:11434/v1', 'http://127.0.0.1:11434'),
  true,
  'localhost and 127.0.0.1 identify the same local Ollama endpoint',
)
assert.equal(
  isLocalOllamaApi('http://[::1]:11434/v1/', 'http://localhost:11434/'),
  true,
  'IPv6 loopback and localhost aliases match after URL normalization',
)
assert.equal(isLocalOllamaApi('http://127.0.0.2:11434/v1', 'http://localhost:11434'), false)
assert.equal(isLocalOllamaApi('http://localhost:11435/v1', 'http://127.0.0.1:11434'), false)
assert.equal(isLocalOllamaApi('https://localhost:11434/v1', 'http://127.0.0.1:11434'), false)
assert.equal(isLocalOllamaApi('http://localhost:11434/api/v1', 'http://127.0.0.1:11434'), false)
assert.equal(isLocalOllamaApi('http://192.168.1.10:11434/v1', 'http://192.168.1.10:11434'), false)
assert.equal(isLocalOllamaApi('not a URL', 'http://localhost:11434'), false)

assert.equal(canStartLocalOllama('http://localhost:11434'), true)
assert.equal(canStartLocalOllama('http://[::1]:11434/'), true)
assert.equal(canStartLocalOllama('https://localhost:11434'), false)
assert.equal(canStartLocalOllama('http://localhost:11434/proxy'), false)
assert.equal(canStartLocalOllama('http://192.168.1.10:11434'), false)
assert.equal(ollamaListenAddress('http://[::1]:11434'), '[::1]:11434')
assert.equal(ollamaListenAddress('http://localhost'), 'localhost:80')
assert.equal(ollamaListenAddress('https://localhost:11434'), null)

const defaultEnv = {}
assert.equal(configuredModelBaseUrl('chat', defaultEnv), 'http://localhost:11434/v1')
assert.equal(configuredModelBaseUrl('vision', {
  JARVIS_MODEL_BASE_URL: 'http://localhost:11434/v1/',
  JARVIS_MODEL_VISION_URL: 'http://127.0.0.1:11434/v1/',
}), 'http://127.0.0.1:11434/v1')
assert.equal(configuredModelBaseUrl('chat', {
  JARVIS_MODEL_BASE_URL: 'http://localhost:11434/v1',
  JARVIS_MODEL_CHAT_URL: 'http://127.0.0.1:11435/v1',
  JARVIS_MODEL_NAME: 'manual:tag',
}), 'http://localhost:11434/v1', 'a model pin follows the bridge and ignores per-slot URLs')
assert.equal(configuredModelName('chat', { fits: true, model: 'planned:tag' }, { JARVIS_MODEL_CHAT: 'custom:tag' }), 'custom:tag')
assert.equal(configuredModelName('chat', { fits: false, model: 'best-effort:tag' }, {}), null)
assert.equal(hasExplicitModelOverride('chat', { JARVIS_MODEL_CHAT: '' }), true)
assert.equal(hasExplicitModelOverride('vision', { JARVIS_MODEL_NAME: 'manual:tag' }), true)
assert.equal(hasExplicitModelOverride('reason', {}), false)
assert.equal(
  displayEndpoint('http://user:secret@localhost:11434/v1?token=private#fragment'),
  'http://localhost:11434/v1',
  'endpoint output does not reveal URL credentials, query values or fragments',
)

// Exercise the real, read-only planner CLI under an alias configuration. This
// prints a RAM plan only; it does not install Ollama or download model weights.
const bootstrapPath = fileURLToPath(new URL('./model-bootstrap.mjs', import.meta.url))
const baseEnv = { ...process.env }
for (const key of [
  'JARVIS_MODEL_NAME',
  'JARVIS_MODEL_CHAT',
  'JARVIS_MODEL_VISION',
  'JARVIS_MODEL_REASON',
  'JARVIS_MODEL_CHAT_URL',
  'JARVIS_MODEL_VISION_URL',
  'JARVIS_MODEL_REASON_URL',
]) delete baseEnv[key]
Object.assign(baseEnv, {
  JARVIS_OLLAMA_URL: 'http://127.0.0.1:11434',
  JARVIS_MODEL_BASE_URL: 'http://localhost:11434/v1',
})
const planner = spawnSync(process.execPath, [bootstrapPath, '--plan-json'], {
  cwd: process.cwd(),
  env: baseEnv,
  encoding: 'utf8',
  timeout: 20_000,
})
assert.equal(planner.status, 0, planner.stderr || 'model-bootstrap --plan-json exited unsuccessfully')
const planOutput = JSON.parse(planner.stdout)
assert.deepEqual(planOutput.installableOllamaSlots, planOutput.fittedOllamaSlots, 'loopback aliases still route planner model installs to local Ollama')

const overrideEnv = {
  ...baseEnv,
  JARVIS_MODEL_CHAT: 'manual:tag',
  JARVIS_MODEL_VISION_URL: 'http://localhost:12345/v1',
}
const overridePlanner = spawnSync(process.execPath, [bootstrapPath, '--plan-json'], {
  cwd: process.cwd(),
  env: overrideEnv,
  encoding: 'utf8',
  timeout: 20_000,
})
assert.equal(overridePlanner.status, 0, overridePlanner.stderr || 'overridden model-bootstrap plan exited unsuccessfully')
const overrideOutput = JSON.parse(overridePlanner.stdout)
assert.ok(!overrideOutput.installableOllamaSlots.includes('chat'), 'a manually selected model is never replaced by a planner pull')
assert.ok(!overrideOutput.installableOllamaSlots.includes('vision'), 'a slot on another server is not installed into the default Ollama')

// A successful but empty /models response is a known-empty inventory, not an
// indication that every selected model is already installed. The preflight
// must inspect per-slot URLs instead of silently checking only the shared URL.
const modelServer = createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ object: 'list', data: [] }))
  }
  res.writeHead(404)
  res.end()
})
await new Promise((resolve, reject) => {
  modelServer.once('error', reject)
  modelServer.listen(0, '127.0.0.1', resolve)
})
try {
  const port = modelServer.address().port
  const setupPath = fileURLToPath(new URL('./setup.mjs', import.meta.url))
  const setup = await runNode(setupPath, [], {
    ...baseEnv,
    JARVIS_MODEL_BASE_URL: 'http://127.0.0.1:1/v1',
    JARVIS_MODEL_CHAT_URL: `http://127.0.0.1:${port}/v1`,
    JARVIS_MODEL_VISION_URL: `http://127.0.0.1:${port}/v1`,
    JARVIS_MODEL_REASON_URL: `http://127.0.0.1:${port}/v1`,
  })
  assert.equal(setup.status, 0, setup.stderr || 'read-only preflight exited unsuccessfully')
  assert.match(setup.stdout, new RegExp(`Model server reachable at http://127\\.0\\.0\\.1:${port}/v1 — 0 models listed`))
  assert.match(setup.stdout, /chat\s+huihui_ai\/qwen3\.5-abliterated:[^\n]+ is not loaded\./)
  assert.doesNotMatch(setup.stdout, /chat\s+huihui_ai\/qwen3\.5-abliterated:[^\n]+ cannot be verified/)
} finally {
  await new Promise((resolve, reject) => modelServer.close((error) => error ? reject(error) : resolve()))
}

console.log('PASS  loopback alias normalization, endpoint/port/path safeguards, and safe endpoint display')
console.log('PASS  configured model routes/overrides, read-only plan, per-slot preflight, and empty inventory handling')
