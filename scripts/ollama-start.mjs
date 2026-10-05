/**
 * Start the local model runtime (Ollama) if it is not already answering.
 *
 * This is the one piece of startup that both launchers need and neither should
 * own: `npm start` runs it before the bridge so a first-time user gets a working
 * brain, and the installed desktop app runs it inside its own bridge process so
 * a double-clicked .exe does the same thing without a Node install. Sharing the
 * code is not tidiness for its own sake — this function holds the two decisions
 * that are easy to get subtly different between two copies: which binary counts
 * as "installed", and where that binary keeps its weights.
 *
 * The child belongs to the caller: it is returned, never registered globally, so
 * whoever started it can take it down again on exit. A model server still
 * holding port 11434 after the window was closed is exactly the kind of leftover
 * that makes people distrust an installer.
 */

import { spawn, spawnSync } from 'node:child_process'
import {
  canStartLocalOllama,
  configuredModelBaseUrl,
  configuredModelName,
  displayEndpoint,
  isLocalOllamaApi,
  MODEL_SLOTS,
  ollamaListenAddress,
} from './ollama-endpoints.mjs'
import { plan as planRam } from '../bridge/autopilot.mjs'
import { findRuntimeBinary, runtimeModelsDir, runtimePlan as portableRuntimePlan } from '../bridge/portable-runtime.mjs'

const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

/** Which slots are pointed at a model server we are allowed to start ourselves. */
export function localModelSlots(ollamaUrl = DEFAULT_OLLAMA_URL, plan = planRam()) {
  return MODEL_SLOTS.filter((slot) => {
    const model = configuredModelName(slot, plan.choices[slot])
    return Boolean(model) && isLocalOllamaApi(configuredModelBaseUrl(slot), ollamaUrl)
  })
}

/**
 * @param {{
 *   ollamaUrl?: string,
 *   env?: NodeJS.ProcessEnv,
 *   log?: (line: string) => void,
 *   warn?: (line: string) => void,
 *   timeout?: number,
 * }} [options]
 * @returns {Promise<{ child: import('node:child_process').ChildProcess | null, url: string, ready: boolean }>}
 */
export async function startOllamaIfNeeded({
  ollamaUrl = process.env.JARVIS_OLLAMA_URL?.replace(/\/+$/, '') ?? DEFAULT_OLLAMA_URL,
  env = process.env,
  log = console.log,
  warn = console.warn,
  timeout = 15_000,
} = {}) {
  const endpointLabel = displayEndpoint(ollamaUrl)
  if (!localModelSlots(ollamaUrl).length) return { child: null, url: ollamaUrl, ready: false }

  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (response.ok) {
      log(`Ollama is already responding at ${endpointLabel}.`)
      return { child: null, url: ollamaUrl, ready: true }
    }
  } catch { /* start the installed daemon below */ }

  if (!canStartLocalOllama(ollamaUrl)) {
    warn(`Ollama at ${endpointLabel} is unavailable and cannot be started directly. The interface will still start; local model replies need the configured server.`)
    return { child: null, url: ollamaUrl, ready: false }
  }

  // The runtime this project downloaded for itself counts as installed: it is
  // the same binary, and a machine that used the setup page's one click should
  // not be told it has nothing until the user adds Ollama to PATH.
  const portables = portableRuntimePlan({ env })
  const binary = findRuntimeBinary(portables, env) ?? 'ollama.exe'
  const check = spawnSync(binary, ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 5000 })
  if (check.error || check.status !== 0) {
    warn('Ollama is not reachable and no runtime was found. The interface will still start; local model replies need a model server — the setup page can download one into this app.')
    return { child: null, url: ollamaUrl, ready: false }
  }

  const childEnv = {
    ...env,
    OLLAMA_HOST: ollamaListenAddress(ollamaUrl),
    // Models pulled by the setup page go to this app's own folder, so an
    // install that brought its own runtime keeps everything together and easy
    // to remove. A system Ollama keeps its own data directory: those weights
    // are the user's, not ours to relocate.
    ...(binary === portables.path ? { OLLAMA_MODELS: runtimeModelsDir(env) } : {}),
  }

  const child = spawn(binary, ['serve'], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let spawnError = null
  child.stdout?.on('data', (chunk) => log(`[ollama] ${String(chunk).trimEnd()}`))
  child.stderr?.on('data', (chunk) => warn(`[ollama] ${String(chunk).trimEnd()}`))
  child.once('error', (error) => {
    spawnError = error
    warn(`[ollama] could not start: ${error.message}`)
  })
  child.once('exit', (code) => {
    warn(`[ollama] server exited (${code}); local inference may be unavailable.`)
  })

  log(`Starting the local Ollama server at ${endpointLabel}…`)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline && child.exitCode === null && !spawnError) {
    try {
      const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(900) })
      if (response.ok) {
        log('Ollama is ready for local model requests.')
        return { child, url: ollamaUrl, ready: true }
      }
    } catch { /* wait for the daemon to bind its local port */ }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  warn('Ollama did not become ready before the startup wait ended. The interface will still start.')
  return { child, url: ollamaUrl, ready: false }
}
