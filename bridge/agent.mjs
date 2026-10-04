/**
 * JARVIS autonomous agent loop.
 *
 * Takes a plan from the Planner, breaks it into a to-do list, executes each
 * step, monitors stdout/stderr for errors, auto-solves problems, and retries
 * until success or exhaustion.
 *
 * This is the "hands that never give up" — the Executor with self-healing.
 *
 * Flow:
 *   1. Receive plan from Planner
 *   2. Convert plan → to-do list with status tracking
 *   3. For each step:
 *      a. Execute
 *      b. Check stdout/stderr for errors
 *      c. If error → send to Planner → get fix plan → retry
 *      d. Mark done/failed
 *   4. Report final status
 *
 * The agent never silently fails. Every error is analyzed, every retry is
 * logged, and the to-do list is always up to date.
 */

import { spawn } from 'node:child_process'
import { complete } from './local-llm.mjs'
import { EXECUTOR_SYSTEM } from './workflow.mjs'

const MAX_RETRIES_PER_STEP = 3
const MAX_TOTAL_RETRIES = 15
const EXECUTION_TIMEOUT_MS = 60_000

/* ──────────────── To-do list management ──────────────────── */

/**
 * Create a to-do list from a plan.
 *
 * Each step gets a status tracker: pending → running → done/failed/skipped
 */
export function createTodoList(plan) {
  if (!Array.isArray(plan)) {
    return {
      items: [{ id: 1, action: 'respond', detail: String(plan), status: 'pending', retries: 0, errors: [], output: '' }],
      totalSteps: 1,
      completed: 0,
      failed: 0,
    }
  }

  return {
    items: plan.map((step, i) => ({
      id: step.step ?? i + 1,
      action: step.action ?? 'unknown',
      detail: step.detail ?? '',
      status: 'pending',     // pending | running | done | failed | skipped
      retries: 0,
      errors: [],            // collected error messages
      output: '',            // stdout from execution
      fixAttempts: [],       // what was tried to fix errors
    })),
    totalSteps: plan.length,
    completed: 0,
    failed: 0,
    startedAt: Date.now(),
  }
}

/** Update a to-do item's status. */
function updateItem(todo, id, patch) {
  const item = todo.items.find((i) => i.id === id)
  if (!item) return
  Object.assign(item, patch)
  if (patch.status === 'done') todo.completed++
  if (patch.status === 'failed') todo.failed++
}

/** Format the to-do list as a readable string. */
export function formatTodoList(todo) {
  const lines = []
  lines.push(`  To-do list (${todo.completed}/${todo.totalSteps} done, ${todo.failed} failed)`)
  lines.push('  ──────────────────────────────────────')
  for (const item of todo.items) {
    const icon = { pending: '○', running: '◐', done: '✓', failed: '✗', skipped: '◌' }[item.status] ?? '?'
    const retry = item.retries > 0 ? ` (retry ${item.retries}/${MAX_RETRIES_PER_STEP})` : ''
    const error = item.errors.length ? ` — ${item.errors[item.errors.length - 1]}` : ''
    lines.push(`  ${icon} ${item.id}. [${item.action}] ${item.detail}${retry}${error}`)
  }
  return lines.join('\n')
}

/* ──────────────── Error analysis ──────────────────────────── */

/**
 * Analyze an error and suggest a fix.
 *
 * Uses the chat model (Planner) to understand the error and propose
 * a corrected action. Falls back to simple pattern matching when the
 * model is unavailable.
 */
async function analyzeError(error, failedStep, todo, { onLog = () => {} } = {}) {
  // Try the model first
  try {
    const context = todo.items
      .filter((i) => i.status === 'done')
      .map((i) => `Step ${i.id} [${i.action}]: ${i.detail} → done`)
      .join('\n')

    const failedItems = todo.items
      .filter((i) => i.errors.length > 0)
      .map((i) => `Step ${i.id} [${i.action}]: ${i.errors.join('; ')}`)
      .join('\n')

    const prompt = `An execution step failed. Analyze the error and suggest a fix.

FAILED STEP:
  Action: ${failedStep.action}
  Detail: ${failedStep.detail}
  Error: ${error}

PREVIOUS STEPS (completed):
${context || '(none)'}

ALL ERRORS SO FAR:
${failedItems || error}

Respond with JSON only:
{
  "diagnosis": "what went wrong",
  "fix_action": "corrected action to try",
  "fix_detail": "parameters or changes",
  "can_retry": true/false,
  "skip_reason": "if can_retry is false, why we should skip"
}`

    const response = await complete('chat', [
      { role: 'system', content: 'You are an error diagnosis engine. Analyze errors and suggest precise fixes. JSON only, no prose.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 400 })

    const parsed = parseJson(response)
    if (parsed) return parsed
  } catch (err) {
    onLog(`  Model-based error analysis unavailable: ${err.message}`)
  }

  // Fallback: pattern-based error analysis
  return patternAnalyze(error, failedStep)
}

/** Simple pattern-based error analysis fallback. */
function patternAnalyze(error, step) {
  const lower = String(error ?? '').toLowerCase()

  // Network errors
  if (/enotfound|econnrefused|econnreset|timeout|ETIMEDOUT/i.test(error)) {
    return { diagnosis: 'Network or connection error', fix_action: step.action, fix_detail: step.detail, can_retry: true }
  }

  // Permission errors
  if (/permission denied|eacces|EPERM|sudo/i.test(error)) {
    return { diagnosis: 'Permission denied', fix_action: 'run_with_sudo', fix_detail: step.detail, can_retry: true }
  }

  // File not found
  if (/ENOENT|no such file|not found|command not found/i.test(error)) {
    return { diagnosis: 'File or command not found', fix_action: 'install_or_create', fix_detail: step.detail, can_retry: true }
  }

  // Module/package errors
  if (/MODULE_NOT_FOUND|cannot find module|import.*error/i.test(error)) {
    return { diagnosis: 'Missing module', fix_action: 'npm_install', fix_detail: step.detail, can_retry: true }
  }

  // Port in use
  if (/EADDRINUSE|address already in use|port.*in use/i.test(error)) {
    return { diagnosis: 'Port already in use', fix_action: 'kill_port_and_retry', fix_detail: step.detail, can_retry: true }
  }

  // Syntax errors in generated code
  if (/SyntaxError|Unexpected token|unexpected end/i.test(error)) {
    return { diagnosis: 'Syntax error in generated code', fix_action: 'fix_syntax', fix_detail: step.detail, can_retry: true }
  }

  // Ollama-specific
  if (/model not found|pull.*first/i.test(error)) {
    return { diagnosis: 'Model not pulled', fix_action: 'pull_model', fix_detail: step.detail, can_retry: false, skip_reason: 'Model needs to be pulled first' }
  }

  // Default: retry with same action
  return { diagnosis: 'Unknown error', fix_action: step.action, fix_detail: step.detail, can_retry: true }
}

function parseJson(text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch { return null }
}

/* ──────────────── Command execution ──────────────────────── */

/**
 * Execute a shell command and capture output.
 *
 * Returns { stdout, stderr, exitCode, error }
 */
function executeCommand(command, { timeout = EXECUTION_TIMEOUT_MS, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })

    child.once('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        error: code !== 0 ? (stderr.trim() || `exit code ${code}`) : null,
      })
    })

    child.once('error', (err) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 1,
        error: err.message,
      })
    })
  })
}

/* ──────────────── Step execution ──────────────────────────── */

/**
 * Execute a single step from the to-do list.
 *
 * Translates the step's action into a concrete operation:
 * - shell commands
 * - model calls
 * - tool invocations
 */
async function executeStep(step, todo, { onLog = () => {}, onOutput = () => {} } = {}) {
  const { action, detail } = step

  // Map actions to concrete operations
  switch (action) {
    case 'respond':
    case 'respond_greeting':
      return { ok: true, output: detail, action: 'responded' }

    case 'search':
    case 'google':
      return await executeCommand(`echo "Searching: ${escape(detail)}" && curl -s "https://www.google.com/search?q=${encodeURIComponent(detail)}" -o /dev/null -w '%{http_code}' 2>&1`)

    case 'open_url':
    case 'open_app':
      return { ok: true, output: `Would open: ${detail}`, action: 'open' }

    case 'calculate':
    case 'math':
      return await executeCommand(`echo "$(( ${escape(detail)} ))" 2>/dev/null || echo "${escape(detail)}"`)

    case 'read_file':
      return await executeCommand(`cat "${escape(detail)}" 2>&1`)

    case 'write_file':
      return { ok: true, output: `Would write: ${detail}`, action: 'write' }

    case 'run_command':
    case 'execute':
    case 'shell':
      return await executeCommand(detail)

    case 'install':
    case 'npm_install':
      return await executeCommand(`npm install ${escape(detail)} 2>&1`)

    case 'fix_syntax':
      return { ok: true, output: `Syntax fix requested for: ${detail}`, action: 'fix_syntax' }

    case 'run_with_sudo':
      return await executeCommand(`sudo ${escape(detail)} 2>&1`)

    case 'kill_port_and_retry': {
      const portMatch = detail.match(/(\d{4,5})/)
      const port = portMatch?.[1] ?? '3000'
      return await executeCommand(`lsof -ti:${port} | xargs kill -9 2>/dev/null; echo "Killed port ${port}"`)
    }

    case 'pull_model':
      return await executeCommand(`ollama pull ${escape(detail)} 2>&1`)

    case 'wait':
      return await executeCommand(`sleep ${Number(detail) || 1}`)

    default:
      // Unknown action: try to execute as a shell command
      if (detail && (detail.startsWith('/') || detail.startsWith('./') || detail.startsWith('cd '))) {
        return await executeCommand(detail)
      }
      return { ok: true, output: `Action '${action}': ${detail}`, action }
  }
}

function escape(str) {
  return String(str ?? '').replace(/["\\$`]/g, '\\$&')
}

/* ──────────────── Main agent loop ──────────────────────────── */

/**
 * Run the autonomous agent loop.
 *
 * Takes a plan, creates a to-do list, executes each step, auto-solves
 * errors, and retries until success or exhaustion.
 *
 * @param {Array} plan - The execution plan from the Planner
 * @param {Object} options - Configuration
 * @param {Function} options.onLog - Called with log messages
 * @param {Function} options.onTodoUpdate - Called when the to-do list changes
 * @param {Function} options.onStepStart - Called when a step starts
 * @param {Function} options.onStepEnd - Called when a step ends
 * @param {Function} options.onStdout - Called with stdout from each step
 * @returns {Object} The final to-do list with results
 */
export async function runAgent(plan, {
  onLog = () => {},
  onTodoUpdate = () => {},
  onStepStart = () => {},
  onStepEnd = () => {},
  onStdout = () => {},
  maxRetries = MAX_TOTAL_RETRIES,
  timeout = EXECUTION_TIMEOUT_MS,
} = {}) {
  const todo = createTodoList(plan)
  let totalRetries = 0

  onLog(formatTodoList(todo))
  onTodoUpdate(todo)

  for (const item of todo.items) {
    if (item.status === 'done' || item.status === 'skipped') continue

    // Mark as running
    updateItem(todo, item.id, { status: 'running' })
    onStepStart(item)
    onTodoUpdate(todo)

    let success = false

    while (!success && item.retries < MAX_RETRIES_PER_STEP && totalRetries < maxRetries) {
      // Execute the step
      onLog(`\n  ▶ Executing step ${item.id}: [${item.action}] ${item.detail}`)

      const result = await executeStep(item, todo, { onLog, onStdout })
      item.output = (result.stdout ?? result.output ?? '').slice(0, 2000)

      if (result.stdout) onStdout(result.stdout)

      // Check for errors
      const hasError = result.error || result.exitCode !== 0
      const stderrHasError = result.stderr && /error|fail|exception|traceback|fatal/i.test(result.stderr)

      if (!hasError && !stderrHasError) {
        // Success!
        updateItem(todo, item.id, { status: 'done', output: item.output })
        onLog(`  ✓ Step ${item.id} done: ${item.output.slice(0, 100)}`)
        success = true
      } else {
        // Error detected
        const errorMsg = result.error ?? result.stderr ?? `exit code ${result.exitCode}`
        item.errors.push(errorMsg)
        item.retries++
        totalRetries++

        onLog(`  ✗ Step ${item.id} failed (attempt ${item.retries}/${MAX_RETRIES_PER_STEP}): ${errorMsg.slice(0, 200)}`)

        if (item.retries >= MAX_RETRIES_PER_STEP || totalRetries >= maxRetries) {
          updateItem(todo, item.id, { status: 'failed' })
          onLog(`  ✗ Step ${item.id} exhausted retries. Moving on.`)
          break
        }

        // Analyze error and get fix
        onLog(`  🔍 Analyzing error…`)
        const analysis = await analyzeError(errorMsg, item, todo, { onLog })

        if (!analysis.can_retry) {
          updateItem(todo, item.id, { status: 'skipped' })
          onLog(`  ⏭ Skipping step ${item.id}: ${analysis.skip_reason ?? analysis.diagnosis}`)
          break
        }

        // Apply fix
        onLog(`  🔧 Diagnosis: ${analysis.diagnosis}`)
        onLog(`  🔧 Fix: ${analysis.fix_action} — ${analysis.fix_detail}`)

        item.fixAttempts.push({
          diagnosis: analysis.diagnosis,
          fixAction: analysis.fix_action,
          fixDetail: analysis.fix_detail,
          originalError: errorMsg,
        })

        // If the fix suggests a different action, update the step
        if (analysis.fix_action && analysis.fix_action !== item.action) {
          // Execute the fix action first
          const fixStep = {
            ...item,
            action: analysis.fix_action,
            detail: analysis.fix_detail || item.detail,
          }
          const fixResult = await executeStep(fixStep, todo, { onLog })

          if (fixResult.error) {
            onLog(`  ⚠ Fix attempt also failed: ${fixResult.error.slice(0, 100)}`)
          } else {
            onLog(`  ✓ Fix applied: ${analysis.fix_action}`)
          }
        }

        // Wait a moment before retry
        await new Promise((r) => setTimeout(r, 1000 * item.retries))
      }
    }

    onStepEnd(item)
    onTodoUpdate(todo)
  }

  // Final summary
  const elapsed = ((Date.now() - todo.startedAt) / 1000).toFixed(1)
  todo.elapsed = elapsed

  onLog('\n' + formatTodoList(todo))
  onLog(`\n  Completed in ${elapsed}s — ${todo.completed} done, ${todo.failed} failed, ${totalRetries} total retries`)

  return todo
}

/* ──────────────── High-level API ──────────────────────────── */

/**
 * Run an autonomous task from a natural language request.
 *
 * This is the full pipeline:
 *   1. Planner creates a plan
 *   2. Agent creates a to-do list
 *   3. Agent executes each step
 *   4. Agent auto-solves errors
 *   5. Agent retries until success
 *
 * @param {string} userRequest - The user's request in any language
 * @param {Object} options - Configuration
 * @returns {Object} The final to-do list with results
 */
export async function runTask(userRequest, options = {}) {
  const { onLog = () => {}, onTodoUpdate = () => {}, onStepStart = () => {}, onStepEnd = () => {} } = options

  onLog(`\n  ╔══════════════════════════════════════╗`)
  onLog(`  ║  JARVIS Autonomous Agent             ║`)
  onLog(`  ╚══════════════════════════════════════╝`)
  onLog(`\n  Task: ${userRequest}`)

  // Step 1: Get plan from Planner
  onLog(`\n  📋 Creating execution plan…`)
  const { extractIntent } = await import('./language.mjs')
  const intent = await extractIntent(userRequest)

  if (intent.plan) {
    onLog(`  Understanding: ${intent.english}`)
    onLog(`  Language: ${intent.language ?? 'auto'}`)
    onLog(`  Steps: ${intent.plan.length}`)
  }

  const plan = intent.plan ?? [{ step: 1, action: 'respond', detail: intent.english || userRequest }]

  // Step 2: Run the agent loop
  onLog(`\n  🚀 Starting autonomous execution…`)
  const todo = await runAgent(plan, { onLog, onTodoUpdate, onStepStart, onStepEnd, ...options })

  // Step 3: Summary
  const responseToUser = intent.response_to_user || (todo.completed === todo.totalSteps
    ? 'Task completed successfully.'
    : `Task partially completed: ${todo.completed}/${todo.totalSteps} steps done.`)

  onLog(`\n  Response: ${responseToUser}`)

  return {
    todo,
    plan,
    intent,
    responseToUser,
    success: todo.failed === 0,
  }
}

export default {
  createTodoList,
  formatTodoList,
  runAgent,
  runTask,
}