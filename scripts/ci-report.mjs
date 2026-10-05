#!/usr/bin/env node
/**
 * Turn a captured command log into a GitHub Actions check annotation.
 *
 * Why this exists: a job log is a zip served from
 * `results-receiver.actions.githubusercontent.com`, and that host is not
 * reachable from every client — from a locked-down sandbox the download fails
 * with `EOF`, which leaves "Process completed with exit code 1" as the only
 * evidence a build gives you. Check annotations come back over
 * `api.github.com`, so the tail of a failed command is echoed there instead.
 *
 * Usage: node scripts/ci-report.mjs [--level error|warning|notice] "<title>" <log file> [...]
 *
 * The default level is `error` because that is what the failure paths want;
 * a test that passed can still publish what it measured with `--level notice`,
 * which is how a live run's transcript reaches a reader without a job log.
 *
 * The message is escaped per the workflow-command spec (`%` -> `%25`,
 * newlines -> `%0A`) because a raw newline would end the annotation.
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const LEVELS = new Set(['error', 'warning', 'notice'])
let level = 'error'
if (argv[0] === '--level') {
  if (!LEVELS.has(argv[1])) {
    console.error(`unknown level: ${argv[1] ?? '(missing)'} — expected one of ${[...LEVELS].join(', ')}`)
    process.exit(2)
  }
  level = argv[1]
  argv.splice(0, 2)
}
const [title, ...files] = argv
if (!title || files.length === 0) {
  console.error('usage: node scripts/ci-report.mjs [--level error|warning|notice] "<title>" <log file> [...]')
  process.exit(2)
}

const LINES = 30
const WIDTH = 400

const escape = (value) => value
  .replaceAll('%', '%25')
  .replaceAll('\r', '')
  .replaceAll('\n', '%0A')

const text = files.map((file) => readFileSync(file, 'utf8')).join('\n').trimEnd()
const lines = text.length === 0 ? ['(the command produced no output)'] : text.split(/\r?\n/)
const tail = lines.slice(-LINES).map((line) => line.length > WIDTH ? `${line.slice(0, WIDTH)}…` : line)
if (lines.length > LINES) tail.unshift(`…${lines.length - LINES} earlier lines omitted`)

console.log(`::${level} title=${escape(title)}::${escape(tail.join('\n'))}`)
