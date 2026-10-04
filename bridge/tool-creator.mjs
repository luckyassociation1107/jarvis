/**
 * JARVIS Zero-Shot Tool Creator — creates new tools on the fly.
 *
 * When the user asks for something JARVIS can't do, it:
 *   1. Understands what's needed
 *   2. Creates a new tool (writes the code)
 *   3. Registers it
 *   4. Uses it immediately
 *
 * "JARVIS, create a tool that checks if a website is down"
 * → JARVIS writes the tool, tests it, uses it.
 */

import { complete } from './local-llm.mjs'
import { execute } from './code-exec.mjs'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const TOOLS_DIR = resolve('models/tools')
mkdirSync(TOOLS_DIR, { recursive: true })

/* ──────────────── Tool registry ──────────────────────────── */

const registeredTools = new Map()

/**
 * Create a new tool from a description.
 */
export async function createTool(description, { onLog = () => {} } = {}) {
  onLog(`Creating tool: ${description}`)

  // Step 1: Design the tool
  const design = await complete('reason', [
    { role: 'system', content: `You are a tool designer. Create a Node.js module that implements a tool.

Respond in JSON:
{
  "name": "tool_name",
  "description": "what it does",
  "parameters": [{"name": "param1", "type": "string", "description": "...", "required": true}],
  "code": "// complete Node.js module code\\nexport default function toolName(params) { ... }",
  "test": "// test code to verify it works",
  "examples": [{"input": {...}, "expected": "..."}]
}` },
    { role: 'user', content: `Create a tool: ${description}` },
  ], { maxTokens: 3000 })

  let tool
  try {
    const start = design.indexOf('{')
    const end = design.lastIndexOf('}')
    tool = JSON.parse(design.slice(start, end + 1))
  } catch {
    return { ok: false, error: 'Could not design tool' }
  }

  // Step 2: Save the tool
  const file = join(TOOLS_DIR, `${tool.name}.mjs`)
  const code = tool.code.replace(/^```\w*\n?/m, '').replace(/\n?```$/m, '').trim()
  writeFileSync(file, code)
  onLog(`  ✓ Saved to ${file}`)

  // Step 3: Test the tool
  if (tool.test) {
    onLog(`  Testing…`)
    const testResult = execute(tool.test, 'javascript')
    if (testResult.ok) {
      onLog(`  ✓ Test passed`)
    } else {
      onLog(`  ⚠ Test failed: ${testResult.stderr?.slice(0, 100)}`)
    }
  }

  // Step 4: Register
  registeredTools.set(tool.name, {
    ...tool,
    file,
    created: new Date().toISOString(),
  })

  onLog(`  ✓ Tool "${tool.name}" registered`)

  return { ok: true, tool }
}

/**
 * Use a registered tool.
 */
export async function useTool(toolName, params) {
  const tool = registeredTools.get(toolName)
  if (!tool) return { ok: false, error: `Tool "${toolName}" not found. Available: ${[...registeredTools.keys()].join(', ')}` }

  try {
    const module = await import(tool.file)
    const fn = module.default ?? module[toolName]
    if (typeof fn !== 'function') return { ok: false, error: `Tool "${toolName}" does not export a function` }

    const result = await fn(params)
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/**
 * List all registered tools.
 */
export function listTools() {
  return [...registeredTools.values()].map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    created: t.created,
  }))
}

/**
 * Load previously saved tools.
 */
export function loadSavedTools() {
  try {
    const files = require('node:fs').readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.mjs'))
    for (const file of files) {
      const name = file.replace('.mjs', '')
      registeredTools.set(name, {
        name,
        file: join(TOOLS_DIR, file),
        description: `Saved tool: ${name}`,
        parameters: [],
        created: 'loaded',
      })
    }
    return files.length
  } catch {
    return 0
  }
}

export default { createTool, useTool, listTools, loadSavedTools }