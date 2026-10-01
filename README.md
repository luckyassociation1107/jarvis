# J.A.R.V.I.S.

A browser voice assistant with an Iron Man holographic interface. Say
**"Hey Jarvis"**, he wakes, listens, and does real things through your tools —
searches the web, drives your phone, reads your screen, controls his own
interface. The face is a web page (React + Vite + Three.js + custom GLSL). The
brain is an open-weight model running on your own machine.

**No hosted LLM account or API key is required.** Inference runs through a
local Node bridge against your own model server. Model downloads come
from their publishers, web tools fetch the pages you ask for, and browser
speech-recognition behavior depends on the selected engine. The one ongoing cost is
your own hardware and power.

**How it all fits together:** [`WORKFLOW.md`](WORKFLOW.md) — the three layers,
what happens when you speak, and what the whole thing is for.

**What that trade actually costs.** A hosted frontier model reads a JSON schema
and calls a tool correctly almost every time. An 8B model on a laptop does it
perhaps half the time, and a small one mostly narrates what it would do instead.
Everything in this project works with any model you can run — pick the largest
one your machine will hold, because that is the whole tuning knob. If you want a
model with no content filter, look for the "abliterated" or "dolphin" builds:
they are ordinary open-weight models with refusal training removed and run
through the same local interface. JARVIS adds no model-level refusal layer;
effectful tools still have a separate default-deny permission gate.

---

## Model slots and multilingual workflow

JARVIS routes each turn to a RAM-selected local model:

| Slot | Capability | RAM-selected model family |
|---|---|---|
| `chat` | multilingual conversation, intent extraction, English translation | abliterated Qwen2.5 instruct, 0.5B–14B |
| `vision` | image understanding | supplied abliterated Qwen2.5-VL 3B/7B only; unavailable below its memory floor |
| `reason` | English-only coding, tool use and technical reasoning | abliterated Qwen coder, including DAGBS 7B Q2/Q3/Q4 tags |
| `speech` | local multilingual speech-to-text | quantized multilingual Whisper.cpp; never `.en`-only |
| `tts` | spoken responses | system/browser voice at tight budgets; browser-cached Kokoro at tiers with headroom |

`bridge/language.mjs` extracts intent and translates non-English requests into
English before model/tool routing. English input skips translation. For example,
a Telugu request can keep its original text while the downstream task gets an
English rewrite. Real inference still requires the local bridge and model server;
this environment has not completed a full Ollama-backed conversation.

## RAM autopilot and explicit installation

The plan preserves the requested allocation:

```
35%  operating system
25%  other running applications
40%  maximum JARVIS allocation
```

Chat, vision, coding and Whisper run sequentially. The planner compares each
model's estimated active-memory requirement (weights plus runtime/context
headroom) with the same 40% ceiling; it does **not** add every downloaded file
as if all models must stay loaded at once. The bridge asks Ollama to unload a
model after a request. The model estimates are conservative guides, not hardware
guarantees, and current free RAM can lower the selected tier further.

| Total RAM | JARVIS cap | Chat | Vision | Coding | Whisper STT | TTS | Selected assets* |
|---:|---:|---|---|---|---|---|---:|
| 500 MB | 0.20 GB | 0.5B best-effort; not installed | unavailable | 0.5B best-effort; not installed | unavailable | Browser/OS | 0.00 GB |
| 1 GB | 0.40 GB | 0.5B best-effort; not installed | unavailable | 0.5B best-effort; not installed | multilingual base | Browser/OS | 0.06 GB |
| 2 GB | 0.80 GB | 0.5B | unavailable | 0.5B | multilingual small | Browser/OS | 0.96 GB |
| 4 GB | 1.60 GB | 1.5B | unavailable | 1.5B | large-v3-turbo | Browser/OS | 2.60 GB |
| 8 GB | 3.20 GB | 3B | unavailable | 3B | large-v3-turbo | Kokoro Q8 | 4.42 GB |
| 12 GB | 4.80 GB | 3B | Qwen2.5-VL 3B | DAGBS 7B Q3_K_M | large-v3-turbo | Browser/OS | 9.44 GB |
| 16 GB | 6.40 GB | 7B | Qwen2.5-VL 3B | DAGBS 7B Q4_K_M | large-v3-turbo | Browser/OS | 13.14 GB |
| 24 GB | 9.60 GB | 7B | Qwen2.5-VL 7B | DAGBS 7B Q4_K_M | large-v3-turbo | Kokoro FP32 | 16.26 GB |
| 32 GB | 12.80 GB | 14B | Qwen2.5-VL 7B | abliterated coder 14B | large-v3-turbo | Kokoro FP32 | 24.86 GB |

The 1 GB profile is deliberately honest: the smallest abliterated Q4 chat and
coder weights are about 398 MB each, but runtime estimates are about 510 MB and
the whole JARVIS allowance is only 400 MB. Those two slots are shown as
best-effort for comparison but are not auto-installed or treated as runnable.
The smallest Whisper tier fits at 1 GB; at 500 MB even that local STT model is
outside budget. The only local vision choices are the supplied abliterated
Qwen2.5-VL variants: the 3B file is about 3.2 GB and estimates 4.1 GB resident,
so it first fits at 12 GB total. No aligned low-memory VLM is substituted.

*Selected-asset totals include the chosen model weights and, where applicable,
the browser-cached Kokoro asset (fetched on first use). They are maximum
catalogue estimates before reusing anything already installed; downloads for
other RAM tiers are never included. Actual live planning can step down when
current free memory is lower than the reference profile.

Chat and coding downloads are abliterated instruct models only; the planner
refuses a non-abliterated chat/coding entry. Vision has its own explicitly
multimodal ladder. Whisper is multilingual (not `.en`) and is not a chat model.

Open **MODEL STACK** in the HUD (or press **M**) to inspect the live RAM plan,
all 33 reference tiers from 500 MB through 32 GB, selected models, estimates and
limits. `GET /autopilot` is read-only. The panel's **INSTALL SELECTED STACK**
button remains an explicit manual action. The root `build.ps1` / `build.sh`
workflow instead automates first-run setup: it checks for Ollama, installs it
from the official installer only when a fitting local Ollama model is selected,
starts it if needed, then downloads only this machine's selected fitting chat,
vision, coding and Whisper assets. Existing packages, model tags, runtime and
Whisper files are reused; other RAM tiers and non-fitting best-effort weights are
never bulk-downloaded. Kokoro is fetched and cached by the browser on first use
when the RAM plan selects it. No desktop bundle or EXE is created. The separate
`npm run setup` command remains a read-only preflight.

## Setup and Windows controls

After cloning or extracting the repository, run the platform script from its
root folder:

```powershell
.\build.ps1
```

```bash
bash ./build.sh
```

The scripts check for Node.js 20+ and npm. If Node is missing, `build.ps1`
tries WinGet; `build.sh` uses a version manager/Homebrew or downloads and
SHA-256-verifies a user-local Node 24 LTS binary. If Windows blocks the `.ps1`
by execution policy, use `powershell -ExecutionPolicy Bypass -File .\build.ps1`.
The script then installs missing/stale npm packages from `package-lock.json`,
vendors the hand-tracking runtime if needed, builds the **web UI**, and runs a
read-only preflight. It then checks for Ollama and
installs it only if this machine's RAM plan has a fitting local chat, vision or
coding model. It checks/starts the local Ollama service, reuses existing model
tags and Whisper files, installs only the selected fitting model tier plus the
Whisper runtime when needed, then launches the local bridge and Vite app. Other
RAM tiers are shown in the catalogue but are not downloaded. A high-memory
machine can require over 24 GB of model downloads; the script prints the
selected plan and size estimate before pulling. Keep the terminal open and press
**Ctrl-C** to stop the processes.

Use `bash ./build.sh --skip-ai-models` or `./build.ps1 -SkipAiModels` to build
and launch without installing Ollama/model weights. Use `--no-launch` or
`-NoLaunch` to finish setup/build/model checks without starting the local web
servers. Neither entry point creates a desktop bundle or EXE.

`npm run setup` is a standalone preflight only: it changes nothing. For manual
workflows, `npm ci`, `npm run build`, `npm run models:plan`,
`npm run models:install`, and `npm start` are separate commands. The browser
STT/TTS choices default to RAM autopilot; Kokoro speech assets are fetched by the
browser on first use when selected. Chrome or Edge still needs to be installed
for the best microphone experience; the setup script does not replace the
user's browser.

The bridge includes a Windows window manager when run on Windows. Window
inventory is read-only by default. Focus, minimize, maximize, restore, close
(via the application's normal close message), and launching a small allowlist
of apps require the explicit write-enabled bridge (`npm run bridge:writes`, or
`npm start -- --writes`). It is not an unrestricted shell or a packaged Windows
agent. GitHub Pages continues to host the UI only.

## Uncensored models, enforced

A standing requirement for chat, coding and the supplied vision family, so it
is checked rather than assumed. `plan()` refuses a chat, coder or vision
catalogue entry without the `abliterat` marker. No aligned model is substituted
when an abliterated rung does not fit. Whisper is a multilingual speech
recogniser, not a chat model.


## Verification status

Official Ollama catalogue entries and published model-size tags were checked
while building the planner. `npm run test:autopilot` passes ten deterministic
profiles from 0.5–32 GB and mocked checks for non-fitting skips, Ollama-tag
idempotence, offline Whisper installation, incomplete-file rejection, and the
browser-cached Kokoro path. `npm run smoke` exercises the bridge and tool loop,
RAM-plan response shape and 33-tier catalogue/statuses, Telugu-to-English
code-intent routing, and vision prompt fusion against a local stub model
server. These are deterministic/mock checks, not model inference. No full Ollama-backed conversation, real Whisper
transcription/model download, or Windows desktop action has been verified in
this workspace. GitHub Pages hosts the UI only.

## Model manager and local speech

`GET /models` compares the dynamic chat/vision/coding slots with Ollama's
installed tags. `GET /autopilot` reports the live RAM allocation, selected
variants, estimated active memory, expected downloads and unsupported
capabilities; it also exposes the full RAM-tier catalogue. The HUD's
`POST /autopilot/install` action remains user-triggered. The root setup scripts
handle Ollama installation and selected model setup automatically; the endpoint
itself never launches a system installer.

**Speech-to-text:** RAM autopilot selects local multilingual Whisper when it fits
and has been installed; the root build scripts check/download the selected file
and runtime. If it cannot fit or is unavailable, `auto` falls back to browser
recognition, which depends on Chrome/Edge and may use the browser's recognition
service. To force local-only input set `VITE_STT_ENGINE=whisper`; recorded audio
is posted only to the local bridge's `/stt` endpoint. GitHub Pages cannot reach
that bridge.

**Text-to-speech:** RAM autopilot chooses browser-cached Kokoro when its
estimated resident use fits alongside the largest selected model; otherwise it
uses browser/OS SpeechSynthesis. Kokoro's selected `bm_` voice is English, while
system voices and language coverage depend on the installed OS/browser. Kokoro
weights are fetched and cached by the browser on first use; failures fall back
to system speech.

## The shape of this repo

One browser HUD backed by a Node bridge and your own local models:

```
src/ + index.html        browser HUD — voice, reactor, panels
bridge/                  local Node bridge — model pipeline, tools, autopilot
scripts/                 preflight, RAM/model bootstrap, build assets, local start helpers
build.ps1 / build.sh     platform setup, web build, selected model setup, and launch
smoke.mjs                bridge checks
```

The browser is the interface; the bridge is the AI runtime and tool host. They
run together locally with `npm start`. There is no second desktop front-end or
separate app build.

GitHub Pages publishes the browser UI at
<https://luckyassociation1107.github.io/jarvis/>. It is a static preview only:
the bridge and local model stay on your own machine, and the hosted page cannot
connect to that local runtime. Use the local `npm start` workflow for an actual
AI session.

---

## Requirements

**In one line:** the root setup script, a supported local model runtime when
models fit, and a real browser for microphone/WebGL. Ollama is recommended.

- **A model server.** [Ollama](https://ollama.com) is the default. The root
  `build.ps1` / `build.sh` checks for it and installs it from the official
  installer only when the detected RAM plan needs a fitting local Ollama model.
  llama.cpp, LM Studio and vLLM remain available through their OpenAI-compatible
  endpoints; custom endpoints are not overwritten by the Ollama bootstrap.
- **Node.js 20 or newer** and the project npm packages. The root scripts check
  and bootstrap Node where supported, then install missing/stale packages from
  the lockfile.
- **Google Chrome or Microsoft Edge**, in a **real browser window** — not an
  embedded preview pane. Preview panes (including the one inside editors) block
  microphone access, so the page loads and looks right but never hears you.
  JARVIS also needs WebGL, which these browsers provide.
- **Optional: MCP servers**, if you want JARVIS to reach anything outside this
  machine. He reads `~/.claude.json` for them, which is where they already live
  on a machine that has ever run Claude Code — not because this project needs
  it. With none configured he still answers, still talks, and still drives his
  own interface.

`npm run setup` is a friendly read-only preflight: it checks the RAM-selected
plan and configured model server, but installs nothing. The root build scripts
perform the automated first-run dependency and selected-model setup. Browser
installation remains user-controlled; Chrome or Edge should already be
available for microphone use.

---

## Quick start

The recommended first-run path is `build.ps1` on Windows or `build.sh` on
macOS/Linux. If you prefer manual commands:

```bash
npm ci
npm run build
npm run setup       # advisory preflight; no downloads or system changes
npm start           # local bridge + Vite browser HUD
```

Open the local Vite URL (normally <http://localhost:5173>) in Chrome or Edge,
click **INITIALISE**, allow the microphone, and say **“Hey Jarvis”**. Local
inference requires a running model server and a model that fits the selected
RAM plan; review the plan and explicitly install fitting models from MODEL
STACK. The endpoint is available at `localhost:8787` when the bridge is running.

For separate terminals, use `npm run bridge` for the local AI/tool service and
`npm run dev` for the HUD. The GitHub Pages page is only a static view; it does
not host Ollama or the Node bridge.

## How it works

JARVIS is two processes. The browser is the face and the voice; the bridge is
the brain and the hands.

```
  ┌─ browser (the face) ───────────────┐        ┌─ bridge (the brain) ─────────────┐
  │  "Hey Jarvis" wake word            │        │  Node · bridge/server.mjs        │
  │  local VAD  →  speech to text      │   ws   │  local-llm.mjs                   │
  │  reactor UI (Three.js + GLSL)      │◄─────► │   → your model server            │
  │  text to speech                    │  8787  │  spawns your MCP servers         │
  │  heads-up display                  │        │  permission gate (decideTool)    │
  └────────────────────────────────────┘        └──────────────────────────────────┘
```

Everything you see and hear happens in the browser. The bridge is a single Node
process (`bridge/server.mjs`) that talks to a local model over the OpenAI
chat-completions protocol — see `bridge/local-llm.mjs`. They talk over a
WebSocket (plus a few HTTP endpoints) on `ws://localhost:8787`.

**Why a bridge at all?** Two reasons, and neither is about the model.

1. A browser tab cannot spawn the local stdio MCP servers — `android`,
   `playwright`, and the rest. The bridge can.
2. Whatever credential the model server wants stays here, in a process, rather
   than being inlined into a JavaScript bundle where anyone with devtools can
   read it.

**The model slots are chosen by RAM and request type.** `JARVIS_MODEL_BASE_URL`
says where the server lives (Ollama's default is
`http://localhost:11434/v1`). `chat`, `vision` and `reason` may select different
model sizes and quantizations; unavailable slots are reported rather than
substituted with a text-only model. The HUD's Model Stack and `/health` report
missing or RAM-limited slots.

### The voice pipeline

The loop is designed so that nothing silently dies and barge-in feels natural.

- **Detection is local.** An energy-based voice-activity detector
  (`src/lib/vad.ts`) decides when you are speaking. It is instant, cannot quietly
  fail, and is what makes **barge-in** work — speak while JARVIS is talking and he
  stops, without waiting for a transcript to say so.
- **Transcription** defaults to RAM autopilot (`VITE_STT_ENGINE=auto`): local
  multilingual Whisper when the selected model/runtime is installed and fits,
  otherwise browser `SpeechRecognition` when available. Chrome/Edge browser
  recognition may use the browser vendor's service. Set
  `VITE_STT_ENGINE=whisper` to force local-only STT; recorded audio is converted
  to 16 kHz mono WAV and sent only to the local bridge.
- **Speaking** also follows RAM autopilot (`VITE_TTS_ENGINE=auto`). Tight
  budgets use browser/OS `speechSynthesis`; tiers with sufficient headroom select
  Kokoro in the tab. The browser downloads and caches its selected Q8 (~86 MB)
  or FP32 (~330 MB) voice on first use. If Kokoro cannot load, speech falls back
  to the system voice; unavailable system voices/languages depend on the browser
  and operating system.

There is no hosted voice key or account. Browser speech capabilities vary, so
use Chrome or Edge in a real browser window and allow microphone access; embedded
previews block microphone access.

---

## What JARVIS can do

Beyond answering, JARVIS reaches every MCP server on your machine, and can drive
his own interface.

### Your tools

Every server in your `~/.claude.json` is connected explicitly. Depending on what
you have installed, that is roughly:

- **Web & search** — `exa`, `lottie-search`, `mcp-registry`
- **Your phone** — `android`
- **The browser** — `playwright`

These are all optional. With none of them configured JARVIS still answers, still
talks, still looks through the camera, and still drives his own interface —
the built-in display, UI, camera, browser and Windows read-only inventory
servers are part of the bridge. Windows control actions remain behind the
explicit write gate.

A few things you can say:

- *"What's happening in AI this week?"*
- *"Take a screenshot of my phone."*
- *"Open my GitHub notifications."*
- *"Look at me."*

> **A note on what was removed.** This project used to advertise a long list of
> paid MCP servers — image and video generation, hosted voice, hosted search —
> and the README told you to sign up for them. They are gone, along with the
> subscriptions. What is left either runs on your machine or has a free tier.
> The `display`, `blade`, `ui_*`, `look` and `watch` tools that make JARVIS
> himself are built into the bridge and need nothing from anyone.

### JARVIS controls the interface

He drives the UI through MCP tools the bridge exposes:

- `ui_theme` — accent, background, per-phase colours
- `ui_reactor` — colour, scale, intensity, spin, and style (`ring` | `sphere` | `wire`), visibility
- `ui_orbit` — put images in orbit around the reactor
- `ui_chrome` — show or hide rails, transcript, badges
- `ui_effect` — `glitch` | `pulse` | `scan` | `shake` | `flash`
- `ui_screen` — clear
- `ui_reset` — back to defaults

So *"make it red, hide the systems list, put that render in orbit"* is a spoken
command.

### The heads-up display

JARVIS authors panels with a `display` tool against a fixed `.hud-*` design
system. The browser sanitises the markup (DOMPurify, a class allowlist and a
strict CSP) before rendering. Rich media works — images, `<video>`, and
YouTube/Vimeo embeds. Remote images and video are fetched **server-side** through
the bridge (`/img` and `/media`, both SSRF-guarded), so hotlink-blocked news
thumbnails still appear and the page never beacons your IP to a host the model
chose.

---

## Controls

| Key / phrase | Does |
|---|---|
| **"Hey Jarvis"** | Wake him |
| **Space** | Talk without the wake word |
| Just speak | Interrupt him mid-sentence (barge-in) |
| **V** | Cycle the browser voice |
| **Escape** | Stand down |
| **D** | Live diagnostics panel |
| **T** | One-line audio self-test |
| **M** | RAM / Model Stack panel |

---

## The boot sequence

Power-up plays a four-beat Iron Man start-up (`src/ui/Boot.tsx`): an
"INITIATING SYSTEM" status bar with a segmented progress bar and boot log; then
concentric reticle rings resolving into "J.A.R.V.I.S"; then a suit schematic;
then the triangular arc reactor lighting up — with a start-up sound under it
(`public/audio/boot-music.mp3`).

---

## Configuration

Everything is optional in bridge mode. Frontend settings live in `.env.local`
(copy `.env.example`); bridge settings are environment variables.

### Bridge

| Variable | Default | Effect |
|---|---|---|
| `JARVIS_MODEL_BASE_URL` | `http://localhost:11434/v1` | Where the model server listens |
| `JARVIS_MODEL_CHAT` | RAM-selected | Override the planner's conversation/intent model |
| `JARVIS_MODEL_VISION` | RAM-selected or unavailable | Override the planner's image model |
| `JARVIS_MODEL_REASON` | RAM-selected | Override the planner's abliterated coding/tool model |
| `JARVIS_OLLAMA_URL` | `http://localhost:11434` | Ollama management/download API root |
| `JARVIS_MODEL_*_URL` | inherits the base URL | Move one slot to another machine |
| `JARVIS_MODEL_NAME` | — | Pins every slot to one model |
| `JARVIS_MODEL_API_KEY` | — | Only for servers that insist on a non-empty header |
| `JARVIS_MODEL_TEMPERATURE` | `0.6` | Sampling temperature |
| `JARVIS_MODEL_MAX_TURNS` | `8` | Tool-calling rounds per question |
| `JARVIS_MODEL_TIMEOUT_MS` | `180000` | Whole-turn timeout, tools and all |
| `JARVIS_BRIDGE_PORT` | `8787` | Port for the WebSocket + HTTP endpoints |
| `JARVIS_ALLOW_WRITES` | off | `1` allows effectful tools (see below) |
| `JARVIS_ALLOWED_ORIGINS` | local dev | Extra WebSocket origins to accept |
| `JARVIS_ALLOW_NO_ORIGIN` | off | Accept connections with no `Origin` header |
| `JARVIS_FILE_ROOTS` | — | Roots the `/file` endpoint may serve from |

### Frontend (`.env.local`)

| Variable | Effect |
|---|---|
| `VITE_BRIDGE_URL` | Where to reach the bridge |
| `VITE_STT_ENGINE` | `auto`, `browser` or `whisper` |
| `VITE_TTS_ENGINE` | `auto`, `system` or `kokoro` |
| `VITE_KOKORO_VOICE` | Voice for the Kokoro engine |

### The pipeline

`bridge/autopilot.mjs` selects the model/quant rung from the RAM plan, unless a
`JARVIS_MODEL_*` environment variable explicitly overrides that slot. Images
route to `vision`; coding, technical and tool-shaped turns route to `reason`;
ordinary conversation and multilingual intent translation use `chat`. A missing
vision model produces a clear RAM-limit error rather than a confident guess from
a text-only model. Ollama models are asked to unload after each request so the
slots can be used sequentially.

All auto-selected chat and coding models are abliterated instruct builds. The
vision and Whisper ladders are separate capabilities, not chat/coding substitutes.
Model estimates and fit flags are shown in the Model Stack; they are not a
promise that every model will run on every device.

### Adding a model server

Point `JARVIS_MODEL_BASE_URL` at it and restart the bridge. `/health` reports
whether the model is reachable, and the boot line says so either way — a bridge
whose model is missing tells you on startup rather than failing on your first
question.

---

## Enabling actions

The tool gate starts **read-only**. Search, generation and lookups run freely;
anything effectful — send, tap, delete, install, pay — is denied. Voice is a poor
interface for a confirmation dialog, so the decision is made ahead of time in
`decideTool()` in `bridge/server.mjs`, not at the moment of use. This gate is the
only authority: it is applied in the bridge's own tool loop, before anything
runs, and nothing the model says can talk its way past it.

It is worth knowing that this gate now matters more than it used to. The brain is
a local model rather than a hosted one, and a local model is far more willing to
attempt a tool call it has misunderstood — so the default-deny is doing real
work, not standing in for a model that would not have tried.

To allow effectful tools (phone, browser driving, sending), run the bridge this
way instead:

```bash
npm run bridge:writes
```

> Read `decideTool()` before you do. *"Hey Jarvis, clean up my downloads folder"*
> means something rather different with writes enabled.

---

## Troubleshooting

**I can't hear him, or he can't hear me.** Press **D** for the diagnostics panel
— it states plainly whether he is hearing you and whether he is producing sound.
Press **T** for a one-line audio self-test.

**No voice at all.** You must be in **Chrome or Edge**, in a **real browser
window** (not an embedded preview), and you must have **allowed the microphone**.

**Bridge not reachable.** Check that `npm run bridge` is still running in its
terminal, and that nothing else is holding port `8787`.

**He answers but never uses a tool.** This is the local-model trade, and it is
the most common disappointment. The tools are all there and the loop is correct —
the model is the variable. Try a larger one. `JARVIS_DEBUG=1` on the bridge
prints every tool call and its verdict, which will tell you whether the model is
declining to call or calling something that gets denied.

**"I cannot reach my model server."** The bridge says this in the answer rather
than failing silently, and `/health` reports it too. Start the server:
`ollama run llama3.1`, or point `JARVIS_MODEL_BASE_URL` wherever yours lives.

---

## Security

All of this lives in `bridge/server.mjs`:

- The WebSocket accepts only local dev origins (add more with
  `JARVIS_ALLOWED_ORIGINS`).
- `/file`, `/img` and `/media` validate the scheme, confine to allowed roots,
  resolve the real path, and refuse private and loopback addresses (SSRF guard).
- The tool gate (`decideTool`) is default-deny for effectful MCP tools.
- A strict CSP in `index.html`; model-authored panel HTML is sanitised.

---

## Credits & licence

MIT.

The boot sound and any tracks in `public/audio/` ship with the project for the
demo. If you go on to monetise something built on this, clearing the rights to
that audio is your responsibility.
