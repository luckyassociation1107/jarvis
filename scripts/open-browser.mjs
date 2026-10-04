/**
 * Open a URL in the user's default browser.
 *
 * Used by the setup flow, which is the one place this project deliberately
 * reaches out of the terminal: installation is a choice, a choice needs a
 * surface, and a surface the user has to go and find is a surface they will not
 * use. Everything it opens is a loopback URL served by a process they started.
 *
 * Best-effort by design. A machine with no browser, or a user who set
 * JARVIS_NO_BROWSER=1, both get `false` and a printed URL instead — nothing
 * here is worth failing a start over.
 */
import { spawn } from 'node:child_process'

export function openBrowser(url, { env = process.env } = {}) {
  if (env.JARVIS_NO_BROWSER === '1' || env.CI) return false
  // `start` is a cmd builtin and its first quoted argument is the window title,
  // which is why the empty string is there — without it, a URL with an & in it
  // would be read as the title and never opened.
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, windowsHide: true })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}
