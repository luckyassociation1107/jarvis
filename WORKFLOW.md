# How JARVIS works

JARVIS is a browser HUD connected to a local Node bridge and local open-weight
models. The browser is the face and voice interface; the bridge is the local
model router, RAM planner and tool host. GitHub Pages serves the UI only.

## Components

```text
Browser HUD (src/, React + Vite + Three.js)
        │ WebSocket + local HTTP endpoints
        ▼
Node bridge (bridge/server.mjs)
        ├── OpenAI-compatible model server (Ollama by default)
        ├── multilingual intent extraction and English translation
        ├── RAM-planned chat, vision and coding slots
        ├── optional local multilingual Whisper STT
        └── built-in and configured MCP tools, including Windows window controls
```

The default model endpoint is `http://localhost:11434/v1`. Ollama is the
recommended runtime; llama.cpp, LM Studio and vLLM can use the OpenAI-compatible
route. The root `build.ps1` / `build.sh` checks for Ollama and installs it only
when the selected fitting local plan needs Ollama-backed models; it starts the
service if it is not already responding. A manual `npm start` only runs the app
and starts an installed local Ollama CLI when available.

## RAM planner and models

The split is fixed: 35% OS, 25% other applications, and at most 40% for JARVIS.
At bridge startup, the planner samples total and current free RAM, then chooses
a Qwen3.5 abliterated multimodal rung by estimated resident memory with
runtime/context headroom. Restart the bridge to re-plan after free memory
changes. Chat, vision and reason remain distinct routes but share the same
weights at each normal tier; their disk download counts once, and Ollama can
keep a shared tag warm between those routes. Local model inference is serialized
to enforce the one-model resident peak: switching to a different local tag or
local Whisper unloads the retained tag first, even if another route can use it
later. The next request reloads it as needed.

- All chat/coding models are abliterated instruct builds. Native Ollama tiers
  progress from 0.873B Q8_0, through 2.27B and 4.54B in Q4_K_M/Q8_0, to 9.65B
  Q4_K_M/Q8_0, 27.8B Q4_K_M and 36.0B Q4_K_M where memory fits. High-memory
  rungs continue with 27.8B Q8_0 (30/35 GB download/resident), 36B Q8_0
  (39/46 GB), and 36B F16 (72/80 GB). Beyond these, the native 122B tag
  (125B parameters, Q4_K_M, 81 GB download) is offered only when its
  conservative 96 GB resident estimate fits—first around 240 GB total RAM
  under a fully free 40% cap. At 256 GB with
  enough free memory, Kokoro FP32 also fits beside it at an estimated 97.5 GB
  peak resident; the reference catalogue itself remains 33 rows through 32 GB.
- Vision is present in all 33 reference profiles and always uses a multimodal
  rung. At 500 MB–3 GB the smallest model estimates 1.30 GB resident and is
  displayed as **best-effort only**; it is neither auto-installed nor run as a
  fit. The first fully-free reference profile where it fits is 4 GB. At 32 GB,
  chat/coding use a 27.8B Q2_K GGUF candidate (12.4 GB resident) while vision
  uses native Ollama 9.65B Q8_0 (12.3 GB resident). The Q2_K Ollama import is
  untested here and never receives image requests. Vision capability metadata
  is checked before pixels are sent.
- Whisper picks multilingual quantized models, not `.en` variants; the selected
  fitting model and runtime are installed automatically by the root setup script
  when possible.
- At 1 GB total RAM, the AI cap is 0.4 GB, so the 0.873B model is clearly
  best-effort and is skipped. Whisper base can fit. At 500 MB even local Whisper
  is outside the reserved budget; browser/OS fallbacks are used.

The **MODEL STACK** HUD panel (key `M`) shows the live plan and a 33-row
500 MB–32 GB reference catalogue. The catalog is informational; it never
installs every tier. `GET /autopilot` is read-only. `POST /autopilot/install`
remains a separate user-triggered download action. The root `build.ps1` / `build.sh`
path checks, installs and starts Ollama when needed, then installs only selected
fitting Ollama models and the planned Whisper model/runtime. Existing assets are
reused; other tiers and over-budget best-effort models are skipped. Standalone
`npm run setup` stays an advisory preflight and installs nothing.

## A turn

1. The browser listens for a wake phrase and captures speech.
2. With `VITE_STT_ENGINE=whisper`, local VAD segments are converted to 16 kHz
   mono WAV and sent to the local bridge. Whisper auto-detects language. The
   default `browser` STT path remains dependent on Chrome/Edge.
3. `bridge/language.mjs` extracts intent and translates non-English text into
   English when needed.
4. `pickModel()` routes images to vision, coding/tool tasks to reason, and
   ordinary conversation to chat. If vision is under budget or not selected,
   image requests stop with a clear limit instead of falling through to a
   text-only model.
5. The bridge sends a chat-completion request to the local model. The model may
   answer or request an MCP tool; allowed results are fed back for the next turn.
6. The HUD renders the answer and speaks through system TTS or optional browser
   Kokoro TTS.

## Windows management and permissions

On Windows, `jarvis_windows` lists real visible windows read-only. Focus,
minimize, maximize, restore, normal close messages, and launching a fixed
allowlist are only registered when the bridge is explicitly run in write mode:
`npm run bridge:writes` or `npm start -- --writes`. This is not an unrestricted
shell and does not produce an EXE or desktop bundle. Other effectful MCP tools
remain behind the same write gate.

## Local setup

After cloning/extracting, use the root script for the current platform:

```powershell
.\build.ps1
```

```bash
bash ./build.sh
```

It checks for Node.js 20+ and npm. If Node is missing, `build.ps1` tries
WinGet; `build.sh` uses a version manager/Homebrew or downloads and verifies a
user-local Node 24 LTS binary. If Windows blocks the script, invoke it with
`powershell -ExecutionPolicy Bypass -File .uild.ps1`. It then installs missing
npm packages, vendors required browser assets, builds the web UI, and runs a
read-only preflight. By default it checks/installs Ollama only if a fitting local
chat/vision/coding slot needs it, starts the service, reuses installed files, and
automatically downloads only this machine's selected fitting models/Whisper
runtime. It then starts the bridge and Vite together. Open the printed URL in
Chrome or Edge, click **INITIALISE**, and allow the microphone. Keep the terminal
open; Ctrl-C stops the app. `bash ./build.sh --skip-ai-models` or
`.uild.ps1 -SkipAiModels` skips Ollama and model installs; `--no-launch` /
`-NoLaunch` runs setup/build/model checks without starting the app. The scripts
remain web-only: no desktop/EXE bundle. Ollama defaults to port `11434`; the
bridge uses port `8787`. Manual model setup remains available from MODEL STACK.


`npm run setup` is a separate preflight-only command: it changes nothing and
downloads no models. For a manual development workflow, run `npm ci`,
`npm run build`, and `npm start`.

## GitHub Pages

The hosted page is a static UI. It does not run the Node bridge, Ollama, Whisper,
or device tools. Browser security intentionally blocks the model panel from
probing localhost on the hosted HTTPS page; run JARVIS locally for inference,
local speech and device management.

## Privacy and limits

- Local model inference and local Whisper audio stay on the user's machine when
  the bridge/STT engine is configured locally.
- Browser `SpeechRecognition` behavior depends on the browser vendor and may use
  its recognition service; select Whisper for a local transcription path.
- A model's tool-call reliability depends on model size and quality. Presence of
  an MCP tool does not guarantee that a small model will call it correctly.
- Planner RAM figures are estimates; runtime, context length and other processes
  vary. At minimum RAM tiers some capabilities are honestly unavailable or
  marked best-effort.
