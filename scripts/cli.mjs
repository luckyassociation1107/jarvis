#!/usr/bin/env node
/**
 * JARVIS in a terminal.
 *
 * The browser HUD is the face, but nothing about the brain needs a face: the
 * bridge speaks a small frame protocol over one WebSocket, and everything that
 * matters — the question, the answer, every tool the model reaches for — fits in
 * a terminal. This is that client. It is also the honest one to debug with,
 * because nothing is rendered for looks: what it prints is what the bridge
 * actually said.
 *
 *   npm run cli                       interactive, ask anything
 *   npm run cli -- --once "hi"        one question, answer on stdout
 *   npm run cli -- --url ws://host:8787
 *
 * In one-shot mode the answer goes to stdout and anything else (tool lines,
 * errors, the banner) goes to stderr, so `jarvis=$(npm run -s cli -- --once ...)`
 * is a clean string.
 */
import { createInterface } from 'node:readline'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { WebSocket } from 'ws'

/**
 * `mcp__jarvis_shell__run_command` -> `shell ▸ run_command`.
 *
 * The wire name is namespaced for the model's benefit, not the reader's. A
 * client that prints it raw makes every action look like a serial number.
 */
export function toolLabel(name) {
  const raw = String(name ?? '')
  const parts = raw.startsWith('mcp__') ? raw.split('__') : []
  if (parts.length >= 3) {
    const server = parts[1].replace(/^jarvis_?/, '') || 'jarvis'
    return `${server} ▸ ${parts.slice(2).join('__')}`
  }
  return raw || 'tool'
}

/** One line summarising a frame, or null for frames worth ignoring. */
export function describeFrame(frame) {
  if (!frame || typeof frame !== 'object') return null
  if (frame.type === 'tool') return `⚙ ${toolLabel(frame.name)}`
  if (frame.type === 'blade') return `▤ blade · ${frame.blade?.title ?? 'untitled'}`
  if (frame.type === 'panel') return `▤ panel · ${frame.panel?.title ?? 'untitled'}`
  if (frame.type === 'ui') return `◈ ui · ${frame.op}`
  return null
}

/** Every error reads the same way on every surface: `! what went wrong`. */
export function errorLine(message) {
  return `! ${message ?? 'unknown error'}`
}

/** Parse argv. Exported so the argument contract is testable without a socket. */
export function parseArgs(argv) {
  const once = argv.includes('--once') ? argv[argv.indexOf('--once') + 1] ?? '' : null
  const urlAt = argv.indexOf('--url')
  return {
    once: argv.includes('--once') ? once : null,
    url: urlAt === -1 ? (process.env.JARVIS_CLI_URL ?? null) : argv[urlAt + 1] ?? null,
    color: !argv.includes('--no-color'),
  }
}

const BROADCAST = new Set(['ready', 'text', 'done', 'tool', 'error', 'blade', 'panel', 'ui'])
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const port = Number(process.env.JARVIS_BRIDGE_PORT ?? 8787)
  const url = args.url ?? `ws://localhost:${port}`
  const once = args.once
  const paint = (fn) => (text) => (args.color && process.stdout.isTTY ? fn(text) : text)
  const dimmed = paint(dim)
  const tool = paint(cyan)
  const failed = paint(red)

  const socket = new WebSocket(url, { origin: `http://localhost:${port}` })
  let servers = []
  let waiting = null
  let streamed = false

  const open = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 6000)
    socket.once('open', () => { clearTimeout(timer); resolve(true) })
    socket.once('error', (error) => {
      clearTimeout(timer)
      if (!once) console.error(failed(`Could not reach the bridge at ${url}: ${error.message}`))
      resolve(false)
    })
  })
  if (!open) {
    if (once) process.stderr.write(`could not reach the bridge at ${url}\n`)
    process.exit(1)
  }

  const say = (text) => {
    if (once) process.stderr.write(text + '\n')
    else process.stdout.write(text + '\n')
  }

  socket.on('message', (raw) => {
    let frame
    try {
      frame = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (frame.type === 'ready') {
      if (Array.isArray(frame.servers) && frame.servers.length) servers = frame.servers
      return
    }
    // Every broadcast the bridge sends is known here; anything else carrying an
    // id is a request for the client (the camera, today). A terminal cannot
    // answer it, and silence would hold the turn until its timeout, so it
    // answers with the truth in the shape the vision tools read.
    if (frame.id && !BROADCAST.has(frame.type)) {
      socket.send(JSON.stringify({ type: 'reply', id: frame.id, error: 'The terminal client has no camera; tell the user this is unavailable here and carry on.' }))
      return
    }
    if (frame.type === 'error') {
      if (waiting) {
        const pending = waiting
        waiting = null
        pending.reject(new Error(frame.message ?? 'turn failed'))
      } else {
        say(failed(errorLine(frame.message)))
      }
      return
    }
    const note = describeFrame(frame)
    if (note) {
      // An execution is the one thing worth noticing in a wall of scrollback.
      say(frame.type === 'tool' ? tool(note) : dimmed(note))
      return
    }
    if (frame.type === 'text') {
      process.stdout.write(frame.delta ?? '')
      streamed = true
      return
    }
    if (frame.type === 'done') {
      if (!streamed && frame.text) process.stdout.write(frame.text)
      process.stdout.write('\n')
      waiting?.resolve()
      waiting = null
    }
  })

  const ask = (text) =>
    new Promise((resolve, reject) => {
      waiting = { resolve, reject }
      streamed = false
      socket.send(JSON.stringify({ type: 'ask', id: `cli${Date.now()}`, text }))
    })

  if (once) {
    try {
      await ask(once)
      socket.close()
      process.exit(0)
    } catch (error) {
      const line = errorLine(error.message)
      if (args.color && process.stderr.isTTY) process.stderr.write(failed(line + '\n'))
      else process.stderr.write(line + '\n')
      process.exit(1)
    }
  }

  const summary = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2500) })
    .then((r) => r.json())
    .then((health) => health.summary)
    .catch(() => null)

  console.log('')
  console.log(cyan('  J.A.R.V.I.S · cli'))
  console.log(dimmed(`  ${url} · ${servers.length} servers${summary ? ` · ${summary}` : ''}`))
  console.log(dimmed('  /help for commands · Ctrl-C leaves'))
  console.log('')

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY })
  let busy = false
  const prompt = () => rl.setPrompt(cyan('you › '))
  prompt()

  rl.on('line', async (line) => {
    const text = line.trim()
    if (!text) return prompt()
    if (text === '/quit' || text === '/exit') return rl.close()
    if (text === '/help') {
      console.log(dimmed('  /status  machine, model and RAM summary'))
      console.log(dimmed('  /quit    leave'))
      return prompt()
    }
    if (text === '/status') {
      const health = await fetch(`http://localhost:${port}/health`).then((r) => r.json()).catch(() => null)
      const plan = await fetch(`http://localhost:${port}/autopilot`).then((r) => r.json()).catch(() => null)
      console.log(dimmed(`  ${plan?.summary ?? 'no plan'}`))
      for (const slot of plan?.modelSlots ?? []) {
        console.log(dimmed(`  ${slot.slot.padEnd(7)} ${slot.state.padEnd(12)} ${slot.model ?? 'none'}`))
      }
      if (health?.summary) console.log(dimmed(`  health: ${health.summary}`))
      return prompt()
    }
    if (busy) {
      console.log(dimmed('  still answering — Ctrl-C interrupts'))
      return prompt()
    }
    busy = true
    try {
      await ask(text)
    } catch (error) {
      console.log(red(`  ${errorLine(error.message)}`))
    } finally {
      busy = false
      prompt()
    }
  })

  rl.on('close', () => {
    socket.close()
    process.exit(0)
  })

  // First Ctrl-C interrupts the turn; a second one leaves. Voice clients work
  // this way and a terminal client should not need a different muscle memory.
  process.on('SIGINT', () => {
    if (busy) {
      socket.send(JSON.stringify({ type: 'interrupt' }))
      return
    }
    socket.close()
    process.exit(0)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
