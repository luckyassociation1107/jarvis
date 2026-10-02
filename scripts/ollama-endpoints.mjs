import { isIP } from 'node:net'

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
export const DEFAULT_MODEL_BASE_URL = `${DEFAULT_OLLAMA_URL}/v1`
export const MODEL_SLOTS = Object.freeze(['chat', 'vision', 'reason'])

function parseHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ''))
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

function cleanHostname(hostname) {
  return String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

export function isLoopbackHost(hostname) {
  const host = cleanHostname(hostname)
  if (host === 'localhost' || host === '::1') return true
  if (isIP(host) !== 4) return false
  const [first, second, third, fourth] = host.split('.').map(Number)
  return first === 127
    && [second, third, fourth].every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
}

function effectivePort(url) {
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

function normalizedPath(pathname) {
  return String(pathname ?? '').replace(/\/+$/, '')
}

function sameHost(left, right) {
  const leftHost = cleanHostname(left.hostname)
  const rightHost = cleanHostname(right.hostname)
  if (leftHost === rightHost) return true
  const loopbackAliases = new Set(['localhost', '127.0.0.1', '::1'])
  return loopbackAliases.has(leftHost) && loopbackAliases.has(rightHost)
}

/** True when a configured OpenAI /v1 endpoint is this local Ollama API root. */
export function isLocalOllamaApi(modelBaseUrl, ollamaRootUrl = DEFAULT_OLLAMA_URL) {
  const model = parseHttpUrl(modelBaseUrl)
  const ollama = parseHttpUrl(ollamaRootUrl)
  if (!model || !ollama) return false
  if (!isLoopbackHost(model.hostname) || !isLoopbackHost(ollama.hostname)) return false
  if (model.protocol !== ollama.protocol || effectivePort(model) !== effectivePort(ollama)) return false
  if (!sameHost(model, ollama)) return false

  const rootPath = normalizedPath(ollama.pathname)
  const expectedModelPath = `${rootPath}/v1` || '/v1'
  return normalizedPath(model.pathname) === expectedModelPath
}

/** Only a plain loopback Ollama root can be served directly by `ollama serve`. */
export function canStartLocalOllama(ollamaRootUrl = DEFAULT_OLLAMA_URL) {
  const url = parseHttpUrl(ollamaRootUrl)
  if (!url || url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) return false
  if (url.username || url.password) return false
  return normalizedPath(url.pathname) === ''
}

/** Format a validated HTTP endpoint as Ollama's HOST:PORT setting. */
export function ollamaListenAddress(ollamaRootUrl = DEFAULT_OLLAMA_URL) {
  const url = parseHttpUrl(ollamaRootUrl)
  if (!url || !canStartLocalOllama(ollamaRootUrl)) return null
  const hostname = cleanHostname(url.hostname)
  const host = hostname.includes(':') ? `[${hostname}]` : hostname
  return `${host}:${effectivePort(url)}`
}

export function configuredModelBaseUrl(slot, env = process.env) {
  const name = String(slot ?? '').toUpperCase()
  if (!MODEL_SLOTS.includes(String(slot ?? '').toLowerCase())) throw new Error(`Unknown model slot: ${slot}`)
  const shared = String(env.JARVIS_MODEL_BASE_URL ?? DEFAULT_MODEL_BASE_URL).replace(/\/+$/, '')
  const perSlot = env.JARVIS_MODEL_NAME ? null : env[`JARVIS_MODEL_${name}_URL`]
  return String(perSlot ?? '').replace(/\/+$/, '') || shared
}

export function configuredModelName(slot, choice, env = process.env) {
  const name = String(slot ?? '').toUpperCase()
  if (!MODEL_SLOTS.includes(String(slot ?? '').toLowerCase())) throw new Error(`Unknown model slot: ${slot}`)
  return env.JARVIS_MODEL_NAME
    ?? env[`JARVIS_MODEL_${name}`]
    ?? (choice?.fits ? choice.model : null)
}

export function hasExplicitModelOverride(slot, env = process.env) {
  const name = String(slot ?? '').toUpperCase()
  if (!MODEL_SLOTS.includes(String(slot ?? '').toLowerCase())) throw new Error(`Unknown model slot: ${slot}`)
  return env.JARVIS_MODEL_NAME != null || env[`JARVIS_MODEL_${name}`] != null
}

/** Safe for installer/preflight logs: omit credentials, query parameters and fragments. */
export function displayEndpoint(value) {
  try {
    const url = new URL(String(value ?? ''))
    if (!['http:', 'https:'].includes(url.protocol)) return '(invalid endpoint)'
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return '(invalid endpoint)'
  }
}
