#!/usr/bin/env node
/**
 * Turn a captured command log into a GitHub Actions error annotation.
 *
 * Why this exists: a job log is a zip served from
 * `results-receiver.actions.githubusercontent.com`, and that host is not
 * reachable from every client — from a locked-down sandbox the download fails
 * with `EOF`, which leaves "Process completed with exit code 1" as the only
 * evidence a build gives you. Check annotations come back over
 * `api.github.com`, so the tail of a failed command is echoed there instead.
 *
 * Usage: node scripts/ci-report.mjs "<annotation title>" <log file> [...]
 *
 * The message is escaped per the workflow-command spec (`%` -> `%25`,
 * newlines -> `%0A`) because a raw newline would end the annotation.
 */
import { readFileSync } from 'node:fs'

const [title, ...files] = process.argv.slice(2)
if (!title || files.length === 0) {
  console.error('usage: node scripts/ci-report.mjs "<title>" <log file> [...]')
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

console.log(`::error title=${escape(title)}::${escape(tail.join('\n'))}`)
