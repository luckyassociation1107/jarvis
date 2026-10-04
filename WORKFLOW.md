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
        └── built-in and configured MCP tools (browser, camera, command line, desktop)
```

The default model endpoint is `http://localhost:11434/v1`. Ollama is the
recommended runtime; llama.cpp, LM Studio and vLLM can use the OpenAI-compatible
route. Ollama is installed by *you*, from the link the setup page gives you — no
script here runs an installer, silently or with `sudo`. `npm run setup` hosts
that page (`bridge/installer.mjs` serving `GET /install`) on the bridge's own
port and opens it in your browser; if no bridge is running, it starts one for
the setup session. `npm start` opens the same page when the plan has no Ollama
or a model slot that is not ready, and starts an installed local Ollama CLI when
one is available.

## RAM planner and models

There is no fixed split. At bridge startup the planner samples how much RAM is
free right now — `MemAvailable` on Linux, so reclaimable page cache counts —
and gives the AI the share the user asked for, 100% by default, optionally
bounded by a hard gigabyte cap. The share comes from the MODEL STACK panel
(APPLY / RESCAN), from `JARVIS_RAM_SHARE` / `JARVIS_RAM_CAP_GB`, or from the
saved `models/ram-allocation.json`; changing it re-plans the running bridge
immediately, and it can always be re-sampled without a restart. Whatever is not
allocated simply stays free for the rest of the machine.

Chat, vision and reason remain distinct routes but share the same weights at
most allocations; their disk download counts once, and Ollama can keep a shared
tag warm between those routes. Local model inference is serialized to enforce
the one-model resident peak: switching to a different local tag or local Whisper
unloads the retained tag first, even if another route can use it later. The next
request reloads it as needed.

- All chat/coding models are abliterated instruct builds. Native Ollama rungs
  progress from 0.873B Q8_0, through 2.27B and 4.54B in Q4_K_M/Q8_0, to 9.65B
  Q4_K_M/Q8_0, 27.8B Q4_K_M and 36.0B Q4_K_M where the allocation fits. Higher
  rungs continue with 27.8B Q8_0 (30/35 GB download/resident), 36B Q8_0
  (39/46 GB), and 36B F16 (72/80 GB). Beyond these, the native 122B tag (125B
  parameters, Q4_K_M, 81 GB download) is offered only when the allocation can
  cover its conservative 96 GB resident estimate. On a big enough host, Kokoro
  FP32 can also fit beside it; the reference catalogue itself remains 33 rows
  through 32 GB.
- Vision is present in all 33 reference profiles and always uses a multimodal
  rung. At the smallest allocations the 0.873B model (1.30 GB resident) is
  displayed as **best-effort only**; it is neither auto-installed nor run as a
  fit. Larger allocations reach the 27.8B Q2_K GGUF candidate (12.4 GB resident)
  for chat/coding while vision stays on a native multimodal Ollama tag; that
  Q2_K import is untested here and never receives image requests. Vision
  capability metadata is checked before pixels are sent.
- Whisper picks multilingual quantized models, not `.en` variants; the selected
  fitting model and runtime are downloaded by the setup page (or the HUD's
  INSTALL SELECTED STACK button) when you press the button.
- When the allocation is smaller than the smallest model (a 1 GB machine, or
  any share that leaves under a gigabyte), the 0.873B model is clearly
  best-effort and is skipped. Whisper base can still fit. At 500 MB even local Whisper is outside
  the allocation; browser/OS fallbacks are used.

The **MODEL STACK** HUD panel (key `M`) shows the live plan and a 33-row
500 MB–32 GB reference catalogue for the current share. The catalog is
informational; it never installs every tier. `GET /autopilot` is read-only,
`POST /autopilot/config` only saves the share/cap and re-plans, and
`POST /autopilot/install` is the single user-triggered download action — the
same endpoint behind both the panel's INSTALL SELECTED STACK button and the
setup page. It downloads only the selected fitting Ollama models, Whisper model
and speech runtime; existing assets are reused, and other tiers and over-budget
best-effort models are skipped. Neither the endpoint nor any script runs a
system installer for Ollama: the page links it and re-checks `runtime` when you
say you installed it. `npm run doctor` is the read-only preflight.

## A turn

0. Before the model is asked anything, `bridge/capability.mjs` probes the host —
   OS and core count, free RAM and disk, the desktop session and what it is
   missing, which common programs are installed, whether writes are on and how
   the shell is policed, which local model slots are filled, which MCP servers
   are connected — and appends that block to the system prompt. It is refreshed
   every turn, so a plan is made against the machine as it is now rather than as
   it was at boot. The prompt's CAPABILITY FIRST rules use it: check, then act;
   if the exact thing is impossible, plan the nearest version the machine can
   do; only then say plainly what cannot be done and what is missing.
1. The browser listens for a wake phrase and captures speech. The opening of
   each answer is held for a few dozen characters: an announcement of an action
   that never happens is discarded, and a refusal that arrives before any tool
   has run is re-asked once with the capability block pushed forward, so what
   the user hears is the answer that checked the machine.

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

## Machine control and permissions

Three built-in servers reach the machine, and all of them share one write gate:

- `jarvis_windows` — the original Windows-only inventory: visible windows
  read-only, with focus, minimize, maximize, restore, a normal close message and
  a fixed launch allowlist only registered in write mode.
- `jarvis_shell` — the command line. `command_info` and `list_processes` are
  read-only; `run_command` exists only in write mode, runs the command with no
  shell in between, and is checked against an allowlist of programs
  (`JARVIS_SHELL_ALLOW` extends it, `JARVIS_SHELL_MODE=full` skips it) plus a
  deny list that holds in every mode. Working directories are confined to home,
  temp and the project unless `JARVIS_SHELL_ROOTS` adds more.
- `jarvis_desktop` — the rest of the desktop on Windows, macOS and Linux:
  installed apps, windows, pointer, keyboard and typed text. `list_apps`,
  `list_windows` and `desktop_capabilities` are read-only; `launch_app`,
  `quit_app`, `focus_window`, `window_action`, `type_text`, `press_keys`,
  `move_mouse`, `click` and `scroll` are registered only in write mode.

Run `npm run bridge:writes` or `npm start -- --writes` for the acting surface.
`npm run test:control` checks the policy helpers and per-platform arguments
without running a command or moving a pointer. `desktop_capabilities` reports
what this session can actually do — a headless host, a Wayland session or a
missing `xdotool`/`cliclick` is stated rather than silently ignored. This is not
an unrestricted shell and does not produce an EXE or desktop bundle. Other
effectful MCP tools remain behind the same write gate.

## Local setup

Installation happens in your browser, not in a script. After cloning/extracting:

```bash
npm ci
npm run setup
```

`npm run setup` (`scripts/install-web.mjs`) reuses a bridge already answering on
port 8787, or starts `bridge/server.mjs` for the session; it prints
`http://localhost:8787/install?hud=…` and opens it in the default browser. That
page is the installer: it reads `runtime` (platform, arch, RAM, free disk,
whether Ollama is present), lists the stack rungs the RAM planner offers — the
same catalogue as MODEL STACK — and downloads the stack you pick through
`POST /autopilot/install`, streaming each step. It is served by the bridge
itself, same-origin with those endpoints, so Node alone is enough. Ollama is a
separate program: the page links the official installer for your platform and
offers **Re-check**; it never installs it for you. The server-side pieces stay
apart: `npm run doctor` reports, `npm run setup` hosts the page, `npm run
models:install` is the scripted download path used by tests.

The platform scripts still exist and no longer install anything themselves:

```powershell
.\build.ps1
```

```bash
bash ./build.sh
```

They check for Node.js 20+ and npm. If Node is missing, `build.ps1` tries
WinGet; `build.sh` uses a version manager/Homebrew or downloads and verifies a
user-local Node 24 LTS binary. If Windows blocks the script, invoke it with
`powershell -ExecutionPolicy Bypass -File .\build.ps1`. They then install missing
npm packages, vendor required browser assets, build the web UI, run the
read-only `npm run doctor` preflight, and start the bridge and Vite together —
and because `npm start` is what launches them, the setup page opens
automatically whenever the stack is incomplete. Open the printed URL in Chrome
or Edge, click **INITIALISE**, and allow the microphone. Keep the terminal open;
Ctrl-C stops the app. `bash ./build.sh --skip-ai-models` or
`.\build.ps1 -SkipAiModels` builds and launches without the model checks (they
now only point at the setup page); `--no-launch` / `-NoLaunch` skips the launch.
The scripts remain web-only: no desktop/EXE bundle. Ollama defaults to port
`11434`; the bridge uses port `8787`.


For a manual development workflow, run `npm ci`, `npm run build`, and
`npm start`.

## The terminal client

The HUD is one client of the bridge, not the only one. `npm run cli`
(`scripts/cli.mjs`) is a two-way chat surface over the same WebSocket: your
messages in, the model's answer streamed back, and one line per execution
(`⚙ shell ▸ run_command`) so a turn that used a tool is visibly a turn that used
a tool. `/status` prints the RAM plan, the state of each model slot and bridge
health; `/help` lists commands; the first Ctrl-C interrupts the turn and the
second exits. `npm run cli -- --once "question"` answers once with the reply on
stdout and notes on stderr, which is what the smoke suite drives. Because the
terminal has no camera, it answers a frame request with a truthful refusal
rather than holding the turn open.

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
