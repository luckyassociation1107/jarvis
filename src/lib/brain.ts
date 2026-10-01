import * as bridge from './bridge'
import type { Msg } from './bridge'
import type { Blade, Panel } from '../store'

export type { AskHandlers, Msg } from './bridge'
export type { ConnectionState } from './bridge'

/**
 * The brain. There is one, and it is the bridge.
 *
 * This module used to choose between two backends: the local Node bridge, and
 * the browser calling a hosted model API directly. The second is gone. It
 * required an API key inlined into the JavaScript bundle — readable by anyone
 * who opened devtools on a deployed page — and it could only reach remote HTTP
 * MCP servers, which ruled out every local one. It was also the only part of
 * the project with a bill attached.
 *
 * What is left runs a model on your own machine, through a local process that
 * keeps whatever credentials it needs off the client entirely.
 *
 * `history` is still accepted and ignored. App.tsx passes it because the
 * transcript is a list of messages either way, but the bridge owns the
 * conversation — the model's context lives in its session, and mirroring it
 * here would mean two versions of the truth to keep in step.
 */
export const usingBridge = true

/** One question, streamed back. `history` is unused; see the note above. */
export async function ask(
  prompt: string,
  _history: Msg[],
  handlers: bridge.AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  return bridge.ask(prompt, handlers)
}

export async function warm(): Promise<void> {
  await bridge.warmBridge()
}

/** The bridge reports its server list once on connect, from its own config. */
export function watchServers(fn: (servers: string[]) => void): void {
  bridge.watchServers(fn)
}

/** HUD panels are pushed mid-turn by the `display` tool, not returned by ask(). */
export function watchPanels(fn: (panel: Panel) => void): void {
  bridge.watchPanels(fn)
}

/** Blades — the big surface — arrive the same way, from the `blade` tool. */
export function watchBlades(fn: (blade: Blade) => void): void {
  bridge.watchBlades(fn)
}

/**
 * Redressing the interface — theme, reactor, orbiting objects, effects — is
 * pushed down the socket mid-turn by the `ui_*` tools, which live in an
 * in-process MCP server inside the bridge.
 */
export function watchUi(fn: (op: string, args: any) => void): void {
  bridge.watchUi(fn)
}

/**
 * The one thing the bridge asks US for.
 *
 * Every other channel here is the bridge volunteering something mid-turn. A
 * camera frame is the exception — the hardware is in the browser and the model
 * is in the bridge — so this handler answers a request rather than receiving a
 * push.
 */
export function watchCapture(
  fn: (req: bridge.CaptureRequest) => Promise<bridge.CaptureResult>,
): void {
  bridge.watchCapture(fn)
}

/**
 * Barge-in. Stops the answer and settles whatever `ask()` call is outstanding,
 * so the caller's await always returns.
 */
export function cancel(): void {
  bridge.cancel()
}

/** The older name for `cancel()`. */
export function interrupt(): void {
  cancel()
}

/**
 * Whether the brain is reachable right now.
 *
 * The socket *is* the session, so this is the honest answer to "is JARVIS
 * alive" — there is no connection between turns to be down.
 */
export function isConnected(): boolean {
  return bridge.isConnected()
}

/**
 * Connection state, for the UI.
 *
 * Worth surfacing because a drop wipes the conversation: all of JARVIS's memory
 * of the exchange lives in the session behind the socket, while the transcript
 * on screen still shows it. So the reconnect is loud rather than invisible.
 */
export function watchConnection(
  fn: (state: bridge.ConnectionState) => void,
): void {
  bridge.watchConnection(fn)
}

/** Labels for the HUD's SYSTEMS rail. */
export function connectedLabels(): string[] {
  return bridge.bridgeServers()
}
