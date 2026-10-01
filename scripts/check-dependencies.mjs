#!/usr/bin/env node
/**
 * Check lockfile dependencies while tolerating JARVIS's optional, no-save
 * Whisper runtime. Everything else reported by npm ls is an incomplete tree.
 */
import { spawnSync } from 'node:child_process'

const windows = process.platform === 'win32'
const result = spawnSync(windows ? 'npm.cmd' : 'npm', ['ls', '--depth=0', '--json', '--no-color'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  shell: windows,
  windowsHide: true,
  timeout: 30_000,
  maxBuffer: 8 * 1024 * 1024,
})

if (result.error) {
  console.error(`Could not run npm dependency check: ${result.error.message}`)
  process.exit(1)
}

let report
try {
  report = JSON.parse(result.stdout || '{}')
} catch {
  console.error('npm ls did not return a parseable dependency report.')
  if (result.stderr) console.error(result.stderr.trim())
  process.exit(1)
}

const problems = Array.isArray(report.problems) ? report.problems : []
const allowed = /^extraneous: @lumen-labs-dev\/whisper-node@/i
const blocking = problems.filter((problem) => !allowed.test(String(problem)))
if (blocking.length || (result.status !== 0 && problems.length === 0)) {
  if (blocking.length) {
    console.error('Project dependency tree is incomplete:')
    for (const problem of blocking) console.error(`  ${problem}`)
  } else if (result.stderr) {
    console.error(result.stderr.trim())
  }
  process.exit(1)
}

process.exit(0)
