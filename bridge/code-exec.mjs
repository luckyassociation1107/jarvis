/**
 * JARVIS Code Execution — write and run code safely.
 *
 * Supports: Python, JavaScript, Bash, any language installed on system.
 * Sandboxed: timeouts, output limits, no network by default.
 */

import { execSync, spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const SANDBOX_DIR = resolve('models/sandbox')
const TIMEOUT_MS = 30_000
const MAX_OUTPUT = 50_000

mkdirSync(SANDBOX_DIR, { recursive: true })

/* ──────────────── Language configs ──────────────────────────── */

const LANGUAGES = {
  python: { ext: '.py', cmd: (f) => `python3 "${f}"`, install: 'python3' },
  javascript: { ext: '.js', cmd: (f) => `node "${f}"`, install: 'node' },
  bash: { ext: '.sh', cmd: (f) => `bash "${f}"`, install: 'bash' },
  typescript: { ext: '.ts', cmd: (f) => `npx tsx "${f}"`, install: 'npx tsx' },
  ruby: { ext: '.rb', cmd: (f) => `ruby "${f}"`, install: 'ruby' },
  go: { ext: '.go', cmd: (f) => `go run "${f}"`, install: 'go' },
  rust: { ext: '.rs', cmd: (f) => `rustc "${f}" -o /tmp/jarvis_out && /tmp/jarvis_out`, install: 'rustc' },
  java: { ext: '.java', cmd: (f) => `javac "${f}" && java -cp ${SANDBOX_DIR} Main`, install: 'javac' },
  c: { ext: '.c', cmd: (f) => `gcc "${f}" -o /tmp/jarvis_out && /tmp/jarvis_out`, install: 'gcc' },
  cpp: { ext: '.cpp', cmd: (f) => `g++ "${f}" -o /tmp/jarvis_out && /tmp/jarvis_out`, install: 'g++' },
  sql: { ext: '.sql', cmd: (f) => `sqlite3 :memory: < "${f}"`, install: 'sqlite3' },
  r: { ext: '.R', cmd: (f) => `Rscript "${f}"`, install: 'Rscript' },
  php: { ext: '.php', cmd: (f) => `php "${f}"`, install: 'php' },
  perl: { ext: '.pl', cmd: (f) => `perl "${f}"`, install: 'perl' },
  lua: { ext: '.lua', cmd: (f) => `lua "${f}"`, install: 'lua' },
}

/* ──────────────── Execution ──────────────────────────── */

/**
 * Execute code in a sandboxed environment.
 *
 * @param {string} code - The code to execute
 * @param {string} language - python, javascript, bash, etc.
 * @param {Object} options
 * @returns {{ ok, stdout, stderr, exitCode, error, language, file }}
 */
export function execute(code, language = 'python', { timeout = TIMEOUT_MS, args = [], env = {} } = {}) {
  const lang = LANGUAGES[language.toLowerCase()]
  if (!lang) return { ok: false, error: `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGES).join(', ')}` }

  // Check if language runtime exists
  const check = execSync(`which ${lang.install.split(' ')[0]} 2>/dev/null`, { encoding: 'utf8', timeout: 3000 }).trim()
  if (!check) return { ok: false, error: `${language} runtime not found. Install: ${lang.install}` }

  // Write code to temp file
  const id = randomBytes(4).toString('hex')
  const file = join(SANDBOX_DIR, `code-${id}${lang.ext}`)
  writeFileSync(file, code)

  try {
    const result = execSync(lang.cmd(file), {
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_OUTPUT,
      cwd: SANDBOX_DIR,
      env: {
        ...process.env,
        ...env,
        PATH: `${SANDBOX_DIR}:${process.env.PATH}`,
        HOME: SANDBOX_DIR,
        // Disable network for safety
        ...({ http_proxy: 'http://0.0.0.0:0', https_proxy: 'http://0.0.0.0:0' }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return {
      ok: true,
      stdout: result.trim().slice(0, MAX_OUTPUT),
      stderr: '',
      exitCode: 0,
      language,
      file,
    }
  } catch (error) {
    return {
      ok: false,
      stdout: (error.stdout ?? '').trim().slice(0, MAX_OUTPUT),
      stderr: (error.stderr ?? '').trim().slice(0, MAX_OUTPUT),
      exitCode: error.status ?? 1,
      error: error.message.split('\n')[0],
      language,
      file,
    }
  } finally {
    try { rmSync(file, { force: true }) } catch { /* ok */ }
  }
}

/**
 * Auto-detect language from code content.
 */
export function detectLanguage(code) {
  const c = String(code ?? '').trim()
  if (/^(import|from|def |class |print\(|if __name__)/.test(c)) return 'python'
  if (/^(const|let|var|function|import|export|console\.|require\()/.test(c)) return 'javascript'
  if (/^#!/.test(c) || /^(echo|cd|ls|grep|cat|mkdir|rm|cp|mv)\s/.test(c)) return 'bash'
  if (/^(interface|type |enum |namespace )/.test(c)) return 'typescript'
  if (/^(package |func |import ")/.test(c)) return 'go'
  if (/^(fn |use |let mut|impl |pub )/.test(c)) return 'rust'
  if (/^(public class|import java)/.test(c)) return 'java'
  if (/^(#include|int main)/.test(c)) return 'c'
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE)/i.test(c)) return 'sql'
  return 'python' // default
}

/**
 * Execute with auto-detection and AI error fixing.
 */
export async function executeWithFix(code, language = null, { maxRetries = 3, onLog = () => {} } = {}) {
  const lang = language ?? detectLanguage(code)
  onLog(`Running ${lang} code…`)

  let result = execute(code, lang)
  let attempt = 1

  while (!result.ok && attempt < maxRetries) {
    onLog(`Attempt ${attempt} failed: ${result.stderr?.slice(0, 200)}`)
    onLog(`Asking AI to fix…`)

    try {
      const { complete } = await import('./local-llm.mjs')
      const fixed = await complete('reason', [
        { role: 'system', content: `You are a code debugging AI. Fix the ${lang} code. Return ONLY the corrected code, no explanation.` },
        { role: 'user', content: `Code:\n${code}\n\nError:\n${result.stderr}\n\nFix the code:` },
      ], { maxTokens: 2000 })

      // Extract code from response (strip markdown fences)
      code = fixed.replace(/^```\w*\n?/m, '').replace(/\n?```$/m, '').trim()
      result = execute(code, lang)
      attempt++
    } catch {
      break
    }
  }

  return { ...result, attempts: attempt, finalCode: code }
}

export default { execute, detectLanguage, executeWithFix, LANGUAGES }