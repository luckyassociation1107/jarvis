/**
 * JARVIS Workflow Automation — create and run multi-step workflows.
 *
 * "Every morning 8AM: check Gmail → summarize → post Slack"
 * "When battery < 20%: save all work → notify → dim screen"
 */

import { store, recall, getRoutines } from './memory.mjs'
import { execSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { complete } from './local-llm.mjs'

const WORKFLOWS_DIR = resolve('models/workflows')
mkdirSync(WORKFLOWS_DIR, { recursive: true })

/* ──────────────── Workflow storage ──────────────────────────── */

/**
 * Create a workflow from natural language.
 */
export async function createWorkflow(description) {
  const response = await complete('reason', [
    { role: 'system', content: `You are a workflow automation designer. Convert natural language into a structured workflow.

Respond in JSON:
{
  "name": "short name",
  "description": "what this workflow does",
  "trigger": {
    "type": "time|event|manual",
    "config": {"time": "08:00", "days": ["Mon","Tue","Wed","Thu","Fri"]} or {"event": "battery_low"} or {}
  },
  "steps": [
    {"id": 1, "action": "open_app|search|read|write|send|wait|check", "params": {}, "description": "what this step does"}
  ],
  "notifications": true
}` },
    { role: 'user', content: `Create a workflow: ${description}` },
  ], { maxTokens: 800 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    const workflow = JSON.parse(response.slice(start, end + 1))

    // Save to disk
    const id = workflow.name.toLowerCase().replace(/\s+/g, '-')
    const file = join(WORKFLOWS_DIR, `${id}.json`)
    writeFileSync(file, JSON.stringify(workflow, null, 2))

    return { ok: true, workflow, file }
  } catch {
    return { ok: false, error: 'Could not parse workflow', raw: response }
  }
}

/**
 * List all saved workflows.
 */
export function listWorkflows() {
  try {
    const files = require('node:fs').readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.json'))
    return files.map((f) => {
      const data = JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), 'utf8'))
      return { id: f.replace('.json', ''), ...data }
    })
  } catch {
    return []
  }
}

/**
 * Run a workflow.
 */
export async function runWorkflow(workflowId, { onLog = () => {}, onStep = () => {} } = {}) {
  const file = join(WORKFLOWS_DIR, `${workflowId}.json`)
  if (!existsSync(file)) return { ok: false, error: `Workflow not found: ${workflowId}` }

  const workflow = JSON.parse(readFileSync(file, 'utf8'))
  onLog(`Running workflow: ${workflow.name}`)

  const results = []
  for (const step of workflow.steps ?? []) {
    onStep(step)
    onLog(`  Step ${step.id}: ${step.description}`)

    try {
      const result = await executeStep(step)
      results.push({ step: step.id, ok: true, result })
      onLog(`  ✓ Step ${step.id} done`)
    } catch (error) {
      results.push({ step: step.id, ok: false, error: error.message })
      onLog(`  ✗ Step ${step.id} failed: ${error.message}`)
    }
  }

  return { ok: results.every((r) => r.ok), workflow: workflow.name, results }
}

async function executeStep(step) {
  switch (step.action) {
    case 'open_app':
      const { openApp } = await import('./app-launcher.mjs')
      return openApp(step.params.app ?? step.params.url)
    case 'search':
      return { result: `Searching: ${step.params.query}` }
    case 'wait':
      await new Promise((r) => setTimeout(r, (step.params.seconds ?? 5) * 1000))
      return { result: 'Waited' }
    case 'check':
      return { result: `Checking: ${step.params.what}` }
    default:
      return { result: `Action: ${step.action}` }
  }
}

export default { createWorkflow, listWorkflows, runWorkflow }