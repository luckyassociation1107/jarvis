/**
 * A local, open-source brain.
 *
 * JARVIS used to think with Claude Code, run headless through the Agent SDK.
 * That is a good brain and a paid one, and the rest of this project is free, so
 * it is replaced here by any model you can run on your own machine.
 *
 * The contract is OpenAI's chat-completions API, which is not an accident of
 * design — it is what every local runtime has converged on. So this one client
 * talks to all of them without knowing which it is talking to:
 *
 *   Ollama      http://localhost:11434/v1    ollama run llama3.1
 *   llama.cpp    http://localhost:8080/v1     ./llama-server -m model.gguf
 *   LM Studio    http://localhost:1234/v1     (GUI, load a model, start server)
 *   vLLM         http://localhost:8000/v1
 *
 * Nothing here is specific to any of them, and no key is needed: local servers
 * accept anything. JARVIS_MODEL_API_KEY exists only for the ones that insist on
 * a non-empty header.
 *
 * What is given up by leaving a hosted model, stated plainly: tool use. A
 * frontier model reads a JSON schema and calls a tool correctly almost every
 * time. A 8B model running on a laptop does it perhaps half the time, and a
 * small one mostly narrates what it would do instead. The tools are all here
 * and the loop is correct — the model is the variable. Pick the largest one
 * your machine will hold; that is the whole tuning knob.
 *
 *   node bridge/server.mjs
 */

/**
 * Which model. `llama3.1` because it is what `ollama run llama3.1` gives you and
 * it handles tool calling at all. Anything your runtime can load works here —
 * see the uncensored note in the README for the ones worth trying instead.
 */
export const BRIDGE_MODEL_NAME = process.env.JARVIS_MODEL_NAME ?? 'llama3.1'

/**
 * Where the model lives. Ollama's default, because it is the one command that
 * gets a working local model running on any machine.
 */
/** Where the model server is, trailing slash trimmed. Exported for the banner. */
export const MODEL_URL = (
  process.env.JARVIS_MODEL_BASE_URL ?? 'http://localhost:11434/v1'
).replace(/\/+$/, '')

/** Some servers want *something* in the header even with no auth. */
const API_KEY = process.env.JARVIS_MODEL_API_KEY ?? 'jarvis-local'

/** Tool-use attempts per question before giving up and answering in prose. */
const MAX_TURNS = Number(process.env.JARVIS_MODEL_MAX_TURNS ?? 8)

/** Sampling. Low on purpose: a spoken answer should not be adventurous. */
const TEMPERATURE = Number(process.env.JARVIS_MODEL_TEMPERATURE ?? 0.6)

/** Connect timeout, separate from the read timeout below. */
const CONNECT_TIMEOUT_MS = 5_000

/** A whole turn, tools and all. Local models are slow; do not cut them off. */
const TURN_TIMEOUT_MS = Number(process.env.JARVIS_MODEL_TIMEOUT_MS ?? 180_000)

// ---------------------------------------------------------------------------
// Tool shaping
// ---------------------------------------------------------------------------

/**
 * MCP tool name -> what the model sees.
 *
 * The `mcp__<server>__<tool>` convention is kept deliberately. The permission
 * gate in server.mjs parses it, the HUD badge prints it, and renaming tools at
 * the boundary would mean two names for one thing — the exact place bugs live.
 *
 * @param {{ name: string, description?: string, inputSchema?: object }[]} mcpTools
 * @returns {object[]} OpenAI `tools` array
 */
export function toOpenAiTools(mcpTools) {
  return mcpTools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      // An absent schema is an absent argument list, not an error. Ollama
      // rejects a tool with no `parameters` at all, so it is filled in here.
      parameters: t.inputSchema ?? { type: 'object', properties: {} },
    },
  }))
}

/**
 * An MCP tool result -> an OpenAI tool message.
 *
 * Images are the reason this is a function and not a spread. MCP returns them
 * as base64 content blocks; OpenAI wants a data URL. A vision model can then
 * actually see them, and a text-only model ignores the image and keeps the
 * text beside it, which is the right failure — it still gets the words.
 *
 * @param {string} toolCallId
 * @param {object} result - MCP CallToolResult
 */
function toolResultMessage(toolCallId, result) {
  const blocks = Array.isArray(result?.content) ? result.content : []
  const parts = []
  for (const b of blocks) {
    if (b?.type === 'text') parts.push({ type: 'text', text: String(b.text ?? '') })
    else if (b?.type === 'image' && b.data) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${b.mimeType ?? 'image/jpeg'};base64,${b.data}` },
      })
    }
  }
  // An empty result is a dead end for the model — it has nothing to reason
  // from and will guess. Say so instead.
  if (!parts.length) parts.push({ type: 'text', text: '(the tool returned nothing)' })
  const content = parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    // Marked so the model can tell a failure from a success. Ollama passes the
    // flag through; a model that ignores it simply reads the words.
    ...(result?.isError ? { is_error: true } : {}),
    content,
  }
}

/**
 * Tolerant JSON parse for tool arguments.
 *
 * Small models emit `{"a": 1,}` and `{'a': 1}` and a bare `1`. A parse failure
 * here would abort the whole turn over a trailing comma, so the arguments are
 * repaired or dropped to an empty object and the tool is called anyway — most
 * tools validate their own input and will say what was wrong.
 */
function parseArgs(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    /* fall through to repair */
  }
  const attempts = [
    raw.replace(/,\s*([}\]])/g, '$1'), // trailing commas
    raw.replace(/'/g, '"'), // single quotes
    raw.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"'),
  ]
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      /* keep trying */
    }
  }
  // Last resort: the outermost braces, parsed as far as they go.
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1))
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      /* give up */
    }
  }
  console.warn('[jarvis] unparseable tool arguments, calling with none:', raw.slice(0, 120))
  return {}
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * Reads one chat-completions stream, handing text out as it arrives.
 *
 * Written against the wire format rather than a client library on purpose:
 * every local runtime implements the same five event shapes and no two of them
 * agree on anything else, so a hand parser is both smaller and more portable
 * than any SDK that claims to support "OpenAI-compatible" servers.
 *
 * @returns {Promise<{ text: string, toolCalls: object[] }>}
 */
async function streamChat({ messages, tools, signal, onDelta }) {
  const res = await fetch(`${MODEL_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: BRIDGE_MODEL_NAME,
      messages,
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      temperature: TEMPERATURE,
      stream: true,
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // The single most common failure by far, and the one worth naming: the
    // server is up but the model is not pulled. Ollama answers 404 with a
    // sentence saying so, and "404" alone sends people looking for a port
    // problem that does not exist.
    const hint = /not found|no such model|does not exist/i.test(body)
      ? ` — is the model pulled? \`ollama pull ${BRIDGE_MODEL_NAME}\``
      : ''
    throw new Error(`model server replied ${res.status} ${res.statusText}${hint}: ${body.slice(0, 300)}`)
  }
  if (!res.body) throw new Error('model server returned no body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  /** Tool calls, keyed by stream index — they arrive split across chunks. */
  const calls = new Map()

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line, and a frame may be split
    // across reads. Only complete frames are parsed.
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let chunk
      try {
        chunk = JSON.parse(payload)
      } catch {
        continue // a keep-alive or a partial frame; neither is fatal
      }

      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue

      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content
        onDelta?.(delta.content)
      }

      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? 0
        const slot =
          calls.get(i) ?? { id: tc.id ?? `call_${i}`, name: '', args: '' }
        // id and name arrive on the first chunk of a call and never again;
        // arguments are split arbitrarily across the rest.
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name += tc.function.name
        if (tc.function?.arguments) slot.args += tc.function.arguments
        calls.set(i, slot)
      }
    }
  }

  return {
    text,
    toolCalls: [...calls.values()]
      .filter((c) => c.name)
      .map((c) => ({ id: c.id, name: c.name, arguments: c.args })),
  }
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

/**
 * Runs one question to completion, calling tools as many times as it takes.
 *
 * @param {object} spec
 * @param {Array<{role: string, content: unknown}>} spec.messages - the
 *   conversation so far, oldest first. Mutated in place: the assistant reply
 *   and every tool result are appended, so the caller's array *is* the history.
 * @param {Map<string, import('@modelcontextprotocol/sdk/client/index.js').Client>} spec.clients
 * @param {(name: string) => boolean} spec.gate - permission check
 * @param {(name: string) => void} [spec.onToolStart] - announced before it runs
 * @param {(name: string, failed: boolean) => void} [spec.onToolEnd]
 * @param {(delta: string) => void} [spec.onDelta] - streamed text
 * @param {AbortSignal} [spec.signal] - interrupt
 * @returns {Promise<string>} the final answer, in full
 */
export async function runTurn({
  messages,
  clients,
  gate,
  onToolStart,
  onToolEnd,
  onDelta,
  signal,
}) {
  const tools = toOpenAiTools(
    [...clients.entries()].flatMap(([server, client]) =>
      (client.__jarvisTools ?? []).map((t) => ({
        ...t,
        name: `mcp__${server}__${t.name}`,
      })),
    ),
  )

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const { text, toolCalls } = await streamChat({
      messages,
      tools,
      signal,
      onDelta,
    })

    // No tool call means the model is done, whatever else it said.
    if (!toolCalls.length) return text

    // The assistant turn has to be recorded verbatim, including the tool calls
    // — the API rejects a tool message that does not follow the call it answers.
    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      })),
    })

    for (const call of toolCalls) {
      const server = call.name.startsWith('mcp__')
        ? call.name.split('__')[1]
        : null
      const tool = call.name.split('__').slice(2).join('__')
      const client = server ? clients.get(server) : undefined

      // Announced before the gate, not after: a denied tool is one the user
      // never sees run, and the badge has to be about what actually happened.
      const allowed = Boolean(client) && gate(call.name)
      if (allowed) onToolStart?.(call.name)
      else console.log(`[jarvis] tool ${call.name} -> deny`)

      let result
      if (!client) {
        result = {
          isError: true,
          content: [
            {
              type: 'text',
              text: `No such tool: ${call.name}. Use one of the tools you have been given.`,
            },
          ],
        }
      } else if (!allowed) {
        // Worded so it can be passed on as one plain sentence. The persona is
        // forbidden from reading a command aloud, so none appears here.
        result = {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                'Blocked: JARVIS is running in read-only mode and cannot take ' +
                'actions that change anything. Tell the user this action is ' +
                'unavailable until they enable write access on the machine.',
            },
          ],
        }
      } else {
        try {
          result = await client.callTool({
            name: tool,
            arguments: parseArgs(call.arguments),
          })
        } catch (err) {
          // A crashed tool must not end the turn. Handed back as a failure the
          // model can report in a sentence and move on.
          result = {
            isError: true,
            content: [
              { type: 'text', text: `The tool failed: ${err?.message ?? err}` },
            ],
          }
        }
      }

      onToolEnd?.(call.name, result?.isError === true)
      messages.push(toolResultMessage(call.id, result))
    }
  }

  // Ran out of turns. Answering from what is already gathered is better than
  // silence, and far better than an error the user cannot act on.
  const last = [...messages].reverse().find((m) => m.role === 'assistant')
  return (
    last?.content ??
    'I gathered what I could but ran out of steps before I could finish. Ask me again and I will be more direct about it.'
  )
}

// ---------------------------------------------------------------------------
// Boot check
// ---------------------------------------------------------------------------

/**
 * Is the model actually there?
 *
 * Asked once at boot and reported on `/health`, because a bridge that starts
 * happily and then fails on the first question is the worst possible shape:
 * the browser shows a connected assistant that cannot think, and nothing says
 * why. A missing model is the most common first-run problem, so it is named
 * here rather than discovered by the user mid-sentence.
 *
 * @returns {Promise<{ ok: boolean, model: string, error?: string }>}
 */
export async function modelStatus() {
  const started = Date.now()
  try {
    const res = await fetch(`${MODEL_URL}/models`, {
      headers: { authorization: `Bearer ${API_KEY}` },
      signal: AbortSignal.any([
        AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      ]),
    })
    if (!res.ok) {
      return {
        ok: false,
        model: BRIDGE_MODEL_NAME,
        error: `${res.status} ${res.statusText}`,
      }
    }
    const body = await res.json()
    const ids = (body?.data ?? []).map((m) => m?.id).filter(Boolean)
    // Ollama answers with the bare name, others with `namespace/name`. Compare
    // on the tail so both shapes count as a match.
    const have = ids.some((id) => id === BRIDGE_MODEL_NAME || id.endsWith(`/${BRIDGE_MODEL_NAME}`))
    return {
      ok: have || ids.length === 0,
      model: BRIDGE_MODEL_NAME,
      error: have || ids.length === 0
        ? undefined
        : `model not loaded — available: ${ids.slice(0, 8).join(', ')}`,
    }
  } catch (err) {
    return {
      ok: false,
      model: BRIDGE_MODEL_NAME,
      error: `${err?.message ?? err} (is the model server running on ${MODEL_URL}?)`,
    }
  } finally {
    if (process.env.JARVIS_DEBUG === '1') {
      console.log(`[jarvis] model probe took ${Date.now() - started}ms`)
    }
  }
}
