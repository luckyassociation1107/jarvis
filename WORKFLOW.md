# How JARVIS works

JARVIS is a browser HUD connected to a local Node bridge and open-weight models
running on your machine. The browser is the face; the bridge is the AI runtime,
model planner, and tool host. No hosted model API is required.

## The parts

```text
Browser HUD (src/, React + Vite + Three.js)
        │ WebSocket + local HTTP endpoints
        ▼
Node bridge (bridge/server.mjs)
        ├── local OpenAI-compatible model server (Ollama by default)
        ├── multilingual intent and translation flow
        ├── model/RAM autopilot and optional local Whisper STT
        └── built-in and configured MCP tools
```

`src/` contains the browser interface, voice interaction, reactor, panels, and
visuals. `bridge/` runs on the user's machine and connects the HUD to local
models and tools. The default model endpoint is
`http://localhost:11434/v1`; Ollama is the simplest compatible runtime, but
llama.cpp, LM Studio, and vLLM can be used by changing the model URL.

## Our model workflow

The defaults are local, open-weight models:

| Slot | Default | Use |
|---|---|---|
| `chat` | `huihui_ai/qwen2.5-abliterate:0.5b` | conversation and intent extraction |
| `vision` | `huihui_ai/qwen2.5-vl-abliterated:3b` | image questions; optional/manual slot |
| `reason` | `dagbs/qwen2.5-coder-7b-instruct-abliterated` | code and tool-oriented turns |

The pipeline is configured in `bridge/local-llm.mjs`. `bridge/language.mjs`
uses the small local chat slot to translate and extract intents from non-English
requests; English requests skip that extra step. The selected model then answers
or emits a tool call, and the bridge runs the tool and feeds the result back for
the next turn.

The model autopilot is our RAM-aware download workflow in
`bridge/autopilot.mjs`:

- It reserves 35% of RAM for the OS, 25% for other running apps, and budgets up
to 40% for models.
- Chat and coding variants climb round-robin so one capability does not consume
the whole budget. Whisper speech models are budgeted separately.
- Vision is excluded from the automatic plan; it remains an optional configured
slot and is not pulled by the autopilot.
- `GET /autopilot` previews the plan. `POST /autopilot/install` explicitly
starts downloads. Starting JARVIS never silently begins a multi-gigabyte pull.

Ollama must be installed and running before the install endpoint can pull models.
The autopilot does not install the model server. `GET /models` reports which
configured slots Ollama already has.

## What happens in a turn

1. The browser listens for the wake phrase and captures speech using the
   browser's speech-recognition API.
2. The bridge optionally normalizes a non-English request through the local
   language/intent step.
3. `pickModel()` routes the request to chat, vision, or reasoning based on its
   content and configured slots.
4. `local-llm.mjs` calls the local model through the OpenAI-compatible chat
   completions interface. The model can answer directly or request an MCP tool.
5. The bridge applies its tool permission gate, executes allowed calls, and
   returns tool results to the model for another round.
6. The HUD renders the answer and speaks it with the browser's configured voice.

Effectful tools are denied by default. To enable them, run
`npm run bridge:writes` only after reviewing `decideTool()` in
`bridge/server.mjs`. The model cannot grant itself permission.

## Run it locally

```bash
npm install
npm run setup       # preflight only; checks, does not install
npm start           # bridge + browser HUD
```

Open <http://localhost:5173> in Chrome or Edge and click **INITIALISE**. The
bridge uses `localhost:8787`; the model server defaults to Ollama at
`localhost:11434`.

To preview the machine-specific model plan and then explicitly install it, while
the bridge is running:

```bash
curl http://localhost:8787/autopilot
curl -X POST http://localhost:8787/autopilot/install
```

## GitHub Pages

The GitHub Pages deployment is the same browser interface, built as a static
site. It does not deploy the Node bridge, Ollama, or any model weights. Because
the hosted page is served over HTTPS while the local bridge is intentionally
restricted to trusted local development origins, the hosted page is for viewing
the interface; run the app locally to use the AI and tools.

## Limits and privacy

- The local models and bridge stay on your computer. The hosted GitHub Pages
  build contains the front-end only, not model weights or credentials.
- Browser speech-recognition behavior depends on Chrome/Edge and may use the
  browser vendor's recognition service. For an explicit local transcription
  endpoint, configure the optional Whisper binary and model.
- A local model's tool-call reliability depends on the model size and quality;
  the loop and the tools can be present while a very small model still declines
  or formats a call incorrectly.
- `npm run setup` is a preflight and does not install software. Model downloads happen only
  after an explicit autopilot install request or an explicit `ollama pull`.
