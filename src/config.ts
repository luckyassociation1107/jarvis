/**
 * JARVIS configuration.
 *
 * Everything here is read from Vite env vars (.env.local) so no secrets are
 * committed. See .env.example for the full list.
 *
 * Note what is NOT here: no API key of any kind. The brain is a local model
 * reached through the bridge, and the bridge holds whatever credentials the
 * model server wants. Nothing in this file reaches a paid service.
 */

/**
 * Vite inlines a blank `.env` entry as an empty string, not as undefined, so
 * `??` never falls through to the default. Treat whitespace-only as unset
 * everywhere in this file.
 */
function str(raw: unknown): string | undefined {
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? undefined : value
}

/**
 * Fixed-choice options. An unrecognised value is nearly always a typo, and
 * quietly falling back to the default hides it until it costs you a take.
 */
function choice<T extends string>(
  name: string,
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = str(raw)
  if (value === undefined) return fallback
  if ((allowed as readonly string[]).includes(value)) return value as T
  console.warn(
    `[jarvis] ${name}="${value}" is not one of ${allowed.join(' | ')} — using "${fallback}".`,
  )
  return fallback
}

/**
 * The brain is the local bridge, always.
 *
 * There used to be a second option — the browser calling a hosted model API
 * itself — selected with VITE_BACKEND=direct. It is gone: it needed an API key
 * inlined into the JavaScript bundle, which anyone could read out of a deployed
 * page with devtools, and it could only reach remote MCP servers, so every
 * local one was out of reach. One path is simpler than two, and this is the one
 * that keeps a secret off the client.
 */
export const BACKEND = 'bridge' as const

/**
 * Where the bridge lives. Derived once here rather than in each of the three
 * places that talk to it, so moving off the default port is a single edit.
 * `wss://` maps to `https://` on its own, which is why this is a prefix swap
 * rather than a hardcoded scheme.
 */
export const BRIDGE_WS_URL = str(import.meta.env.VITE_BRIDGE_URL) ?? 'ws://localhost:8787'
export const BRIDGE_HTTP_URL = BRIDGE_WS_URL.replace(/^ws/, 'http')

/**
 * Speech engine.
 *
 *   'system' — the browser's own speechSynthesis. Starts on the next frame,
 *     costs nothing, but is capped by whatever voices the OS ships; on macOS
 *     the British male option is compact Daniel.
 *
 *   'kokoro' — an 82M-parameter neural TTS running entirely in the browser via
 *     ONNX. Four proper British male voices and far better sound, nothing
 *     leaving the machine. MEASURED ON THIS MACHINE at q8/WebGPU it generates
 *     about 2.2x slower than realtime — "Yes, sir?" took 3.3 seconds and a
 *     thirteen-word sentence took nine. That is not a conversation, so it is
 *     not the default. Try `fp32` (see kokoro.ts) before enabling it; int8
 *     quantisation often silently falls back to CPU on WebGPU, which is the
 *     likely cause.
 */
export const TTS_ENGINE: 'kokoro' | 'system' = choice(
  'VITE_TTS_ENGINE',
  import.meta.env.VITE_TTS_ENGINE,
  ['kokoro', 'system'] as const,
  'system',
)

/**
 * Which Kokoro voice. All four are British male:
 *   bm_george — measured RP baritone, closest to the character
 *   bm_fable  — warmer
 *   bm_lewis  — lower
 *   bm_daniel — brighter
 */
export const KOKORO_VOICE = choice(
  'VITE_KOKORO_VOICE',
  import.meta.env.VITE_KOKORO_VOICE,
  ['bm_george', 'bm_fable', 'bm_lewis', 'bm_daniel'] as const,
  'bm_george',
)

/**
 * Nothing.
 *
 * This object held an Anthropic key for the direct path, an ElevenLabs key and
 * voice id, and a Picovoice access key for the wake word. All four are gone
 * with the services they belonged to: the model runs locally behind the bridge,
 * speech runs on the browser's own synthesiser, and the wake word runs on the
 * browser's own recogniser. The export stays because call sites still import
 * it, and an empty record is an honest thing to hand them.
 */
export const env: Record<string, never> = {}

