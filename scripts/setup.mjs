#!/usr/bin/env node
// JARVIS preflight — a friendly, advisory check you run with `npm run setup`.
//
// It changes nothing and installs nothing. It looks at your machine, tells you
// what is ready and what is missing, and prints the two commands that start
// JARVIS. Every check degrades to a single friendly line if something is not
// there, and the script always exits 0 — it is advice, not a gate.
//
// The one check that matters is the model server, and it is the one thing here
// that cannot be defaulted around: everything else in this project runs on the
// user's machine for free, but a model still has to be running somewhere.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const tick = '  ok  '
const warn = ' note '
const info = '  ·   '

function line(tag, msg) {
  console.log(`[${tag}] ${msg}`)
}

console.log('')
console.log('JARVIS preflight — checking your machine (nothing is changed)')
console.log('------------------------------------------------------------')

// --- Node version --------------------------------------------------------
try {
  const major = Number(process.versions.node.split('.')[0])
  if (Number.isFinite(major) && major >= 20) {
    line(tick, `Node.js ${process.versions.node} (20+ required).`)
  } else {
    line(
      warn,
      `Node.js ${process.versions.node} is below 20. Please upgrade — the bridge needs Node 20 or newer.`,
    )
  }
} catch {
  line(warn, 'Could not read the Node.js version. JARVIS needs Node 20 or newer.')
}

// --- The model pipeline ---------------------------------------------------
/**
 * Three slots, and each is checked separately, because a missing one fails in a
 * way that is hard to read from the outside: JARVIS answers normally until you
 * ask him to look at something, and then he describes the prompt instead of the
 * picture. Naming the slot at boot is what makes that diagnosable.
 */
const MODEL_URL = (
  process.env.JARVIS_MODEL_BASE_URL ?? 'http://localhost:11434/v1'
).replace(/\/+$/, '')

const PIPELINE = [
  ['chat', process.env.JARVIS_MODEL_CHAT ?? 'huihui_ai/qwen2.5-abliterate:0.5b', 'conversation'],
  ['vision', process.env.JARVIS_MODEL_VISION ?? 'huihui_ai/qwen2.5-vl-abliterated:3b', 'images'],
  ['reason', process.env.JARVIS_MODEL_REASON ?? 'dagbs/qwen2.5-coder-7b-instruct-abliterated', 'tools and technical questions'],
]

let reachable = false
let loaded = []
try {
  const res = await fetch(`${MODEL_URL}/models`, {
    signal: AbortSignal.timeout(4000),
  })
  if (res.ok) {
    reachable = true
    loaded = ((await res.json())?.data ?? []).map((m) => m?.id).filter(Boolean)
  }
} catch {
  // Nothing there — the install advice below covers it.
}

if (!reachable) {
  line(warn, `No model server reachable at ${MODEL_URL}.`)
  line(info, 'This is the one thing JARVIS cannot do without — it is the brain.')
  line(info, 'Easiest option: install Ollama from https://ollama.com, then:')
  for (const [, model] of PIPELINE) line(info, `  ollama pull ${model}`)
  line(
    info,
    'Already running a model elsewhere (llama.cpp, LM Studio, vLLM)? Point',
  )
  line(info, 'JARVIS_MODEL_BASE_URL at it and this check will find it.')
} else {
  line(tick, `Model server reachable at ${MODEL_URL}${loaded.length ? ` — ${loaded.length} model${loaded.length === 1 ? '' : 's'} loaded` : ''}.`)
  for (const [slot, model, purpose] of PIPELINE) {
    // Ollama answers with the bare name, others with `namespace/name`.
    const have =
      loaded.length === 0 ||
      loaded.some((id) => id === model || id.endsWith(`/${model}`))
    if (have) {
      line(tick, `${slot.padEnd(7)} ${model} — ${purpose}`)
    } else {
      line(warn, `${slot.padEnd(7)} ${model} is NOT loaded — ${purpose} will not work.`)
      line(info, `Pull it with: ollama pull ${model}`)
    }
  }
  line(
    info,
    'All three defaults are abliterated — uncensored, and still able to call',
  )
  line(info, 'tools. See the pipeline note in the README.')
}

// --- MCP servers ---------------------------------------------------------
/**
 * Optional, and worth saying so.
 *
 * The bridge reads ~/.claude.json for MCP servers because that is where they
 * already live on a machine that has ever run Claude Code — not because this
 * project needs Claude Code. JARVIS is perfectly useful with none of them: its
 * own display, camera, browser and interface tools are built into the bridge.
 */
const claudeJsonPath = join(homedir(), '.claude.json')
let mcpCount = 0
try {
  const parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf8'))
  const servers =
    parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers
      ? parsed.mcpServers
      : {}
  mcpCount = Object.keys(servers).length
  if (mcpCount > 0) {
    line(
      tick,
      `~/.claude.json found with ${mcpCount} MCP server${mcpCount === 1 ? '' : 's'} configured.`,
    )
  } else {
    line(
      info,
      '~/.claude.json found, but no MCP servers are configured. JARVIS still answers and drives its own interface.',
    )
  }
} catch {
  line(
    info,
    'No ~/.claude.json found. Optional — JARVIS works with no MCP servers at all.',
  )
}

// --- Speech --------------------------------------------------------------
// Nothing to check. It runs in the browser, on the user's machine, with no key
// and no account. The only thing worth saying is what it needs, because it is
// the most common surprise: the page must be open in a real browser window.
line(
  tick,
  'Speech needs no key — it runs in the browser. Open the app in a real Chrome or Edge window (an embedded preview blocks the microphone).',
)

// --- How to run ----------------------------------------------------------
console.log('')
console.log('To run JARVIS, open two terminals:')
console.log('  1)  npm run bridge      # the brain (your local models, above)')
console.log('  2)  npm run dev         # the face (open http://localhost:5173 in Chrome)')
console.log('')
console.log('Then click INITIALISE and say "Hey Jarvis".')
console.log(
  'To let JARVIS take real actions (phone, browser, sending), run `npm run bridge:writes` instead of `npm run bridge`.',
)
console.log('')

process.exit(0)
