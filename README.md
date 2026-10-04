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

JARVIS routes each turn deliberately. RAM autopilot normally assigns one
abliterated Qwen3.5 multimodal tag across chat, vision and coding. When the
allocation is large enough a higher-parameter rung is selected; when it is
tight, the plan steps down honestly and keeps image support on a native Ollama
vision rung rather than guessing from a text-only model:

| Slot | Capability | RAM-selected model |
|---|---|---|
| `chat` | multilingual conversation, intent extraction, English translation | shared Qwen3.5 abliterated multimodal rung |
| `vision` | image understanding and visual question answering | the same image-capable rung; present in every RAM profile |
| `reason` | coding, tool use and technical reasoning | the same instruct model, routed separately for code/actions |
| `speech` | local multilingual speech-to-text | quantized multilingual Whisper.cpp; never `.en`-only |
| `tts` | spoken responses | system/browser voice at tight budgets; browser-cached Kokoro when memory allows |

`bridge/language.mjs` extracts intent and translates non-English requests into
English before model/tool routing. English input skips translation. For example,
a Telugu request can keep its original text while the downstream task gets an
English rewrite. Chat, vision and reason remain separate routes. Where they
share a tag, its weights are downloaded once and can stay warm between those
routes. If a different local tag or Whisper needs the same reserved memory, the
bridge serializes the work and unloads the retained tag first; the next request
reloads it. Overrides can still pin individual slots to another local
model/server.

## RAM allocation and explicit installation

There is no fixed OS/apps/AI split. The planner looks at how much RAM is free
right now and gives the AI the share you ask for — **all of it by default** —
optionally bounded by a hard gigabyte cap:

```
JARVIS_RAM_SHARE=80    # 80% of free RAM (0.8 and "80%" also work)
JARVIS_RAM_CAP_GB=12   # optional hard ceiling; wins when it is smaller
```

Whatever you do not allocate simply stays free for the rest of the machine.
Set the share from the MODEL STACK panel with the slider and cap field (APPLY
saves it; RESCAN re-samples free memory and rebuilds the plan), or with the two
environment variables above. The panel persists your choice to
`models/ram-allocation.json` (`JARVIS_RAM_CONFIG` relocates that file), and the
bridge re-plans immediately, without a restart, so the next turn already routes
to whatever the new ceiling selects. On Linux, free RAM means the kernel's
`MemAvailable` — reclaimable page cache counts as free, so the number matches
what a system monitor shows — and `os.freemem()` elsewhere.

The planner compares each selected model's estimated active-memory requirement
(weights plus runtime/context headroom) with that ceiling. Routes that use the
same tag share its download and may share residency; switching to a different
local tag or Whisper releases the previous JARVIS-managed local Ollama model
first, preserving the sequential peak estimate. Browser TTS has a separate
resident allowance. Estimates are conservative guides, not hardware
guarantees. Free RAM is sampled when the bridge starts and at every APPLY or
RESCAN; other applications growing later is the reason the share and cap exist.

The table below is the reference catalogue at the **default 100% share with all
reported RAM free**, so it reads as "what this machine would get if nothing else
were running". Lower the share and every row scales with it.

| Total RAM | JARVIS cap | Chat | Vision | Coding / reason | Whisper STT | TTS | Unique selected assets* | Peak resident estimate |
|---:|---:|---|---|---|---|---|---:|---:|
| 500 MB | 0.50 GB | 873M Q8_0 · best-effort | 873M Q8_0 · best-effort | 873M Q8_0 · best-effort | base Q5_1 | Browser/OS | 0.06 GB | 0.33 GB |
| 1 GB | 1.00 GB | 873M Q8_0 · best-effort | 873M Q8_0 · best-effort | 873M Q8_0 · best-effort | small Q5_1 | Browser/OS | 0.19 GB | 0.68 GB |
| 2 GB | 2.00 GB | 873M Q8_0 · fit | 873M Q8_0 · fit | 873M Q8_0 · fit | large-v3-turbo Q5_0 | Browser/OS | 1.54 GB | 1.35 GB |
| 3 GB | 3.00 GB | 2.27B Q4_K_M · fit | 2.27B Q4_K_M · fit | 2.27B Q4_K_M · fit | large-v3-turbo Q5_0 | Browser/OS | 2.44 GB | 2.35 GB |
| 4 GB | 4.00 GB | 2.27B Q8_0 · fit | 2.27B Q8_0 · fit | 2.27B Q8_0 · fit | large-v3-turbo Q5_0 | Kokoro Q8 | 3.32 GB | 3.88 GB |
| 5 GB | 5.00 GB | 4.54B Q4_K_M · fit | 4.54B Q4_K_M · fit | 4.54B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro Q8 | 3.92 GB | 4.83 GB |
| 6 GB | 6.00 GB | 4.54B Q4_K_M · fit | 4.54B Q4_K_M · fit | 4.54B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 4.16 GB | 5.60 GB |
| 7 GB | 7.00 GB | 4.54B Q8_0 · fit | 4.54B Q8_0 · fit | 4.54B Q8_0 · fit | large-v3-turbo Q5_0 | Kokoro Q8 | 5.82 GB | 6.83 GB |
| 8 GB | 8.00 GB | 9.65B Q4_K_M · fit | 9.65B Q4_K_M · fit | 9.65B Q4_K_M · fit | large-v3-turbo Q5_0 | Browser/OS | 7.14 GB | 7.80 GB |
| 9 GB | 9.00 GB | 9.65B Q4_K_M · fit | 9.65B Q4_K_M · fit | 9.65B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro Q8 | 7.22 GB | 8.53 GB |
| 10 GB | 10.00 GB | 9.65B Q4_K_M · fit | 9.65B Q4_K_M · fit | 9.65B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 7.46 GB | 9.30 GB |
| 11 GB | 11.00 GB | 9.65B Q4_K_M · fit | 9.65B Q4_K_M · fit | 9.65B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 7.46 GB | 9.30 GB |
| 12 GB | 12.00 GB | 9.65B Q4_K_M · fit | 9.65B Q4_K_M · fit | 9.65B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 7.46 GB | 9.30 GB |
| 13 GB | 13.00 GB | 27.8B Q2_K · fit | 9.65B Q8_0 · fit | 27.8B Q2_K · fit | large-v3-turbo Q5_0 | Browser/OS | 22.44 GB | 12.40 GB |
| 14 GB | 14.00 GB | 27.8B Q2_K · fit | 9.65B Q8_0 · fit | 27.8B Q2_K · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 22.76 GB | 13.90 GB |
| 15 GB | 15.00 GB | 27.8B Q2_K · fit | 9.65B Q8_0 · fit | 27.8B Q2_K · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 22.76 GB | 13.90 GB |
| 16 GB | 16.00 GB | 27.8B Q2_K · fit | 9.65B Q8_0 · fit | 27.8B Q2_K · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 22.76 GB | 13.90 GB |
| 17 GB | 17.00 GB | 27.8B Q2_K · fit | 9.65B Q8_0 · fit | 27.8B Q2_K · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 22.76 GB | 13.90 GB |
| 18 GB | 18.00 GB | 27.8B Q2_K · fit | 9.65B Q8_0 · fit | 27.8B Q2_K · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 22.76 GB | 13.90 GB |
| 19 GB | 19.00 GB | 27.8B Q2_K · fit | 9.65B Q8_0 · fit | 27.8B Q2_K · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 22.76 GB | 13.90 GB |
| 20 GB | 20.00 GB | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | large-v3-turbo Q5_0 | Browser/OS | 17.54 GB | 20.00 GB |
| 21 GB | 21.00 GB | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro Q8 | 17.62 GB | 20.73 GB |
| 22 GB | 22.00 GB | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 17.86 GB | 21.50 GB |
| 23 GB | 23.00 GB | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 17.86 GB | 21.50 GB |
| 24 GB | 24.00 GB | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 17.86 GB | 21.50 GB |
| 25 GB | 25.00 GB | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 17.86 GB | 21.50 GB |
| 26 GB | 26.00 GB | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 17.86 GB | 21.50 GB |
| 27 GB | 27.00 GB | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | 27.8B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 17.86 GB | 21.50 GB |
| 28 GB | 28.00 GB | 36B Q4_K_M · fit | 36B Q4_K_M · fit | 36B Q4_K_M · fit | large-v3-turbo Q5_0 | Browser/OS | 24.54 GB | 28.00 GB |
| 29 GB | 29.00 GB | 36B Q4_K_M · fit | 36B Q4_K_M · fit | 36B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro Q8 | 24.62 GB | 28.73 GB |
| 30 GB | 30.00 GB | 36B Q4_K_M · fit | 36B Q4_K_M · fit | 36B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 24.86 GB | 29.50 GB |
| 31 GB | 31.00 GB | 36B Q4_K_M · fit | 36B Q4_K_M · fit | 36B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 24.86 GB | 29.50 GB |
| 32 GB | 32.00 GB | 36B Q4_K_M · fit | 36B Q4_K_M · fit | 36B Q4_K_M · fit | large-v3-turbo Q5_0 | Kokoro FP32 | 24.86 GB | 29.50 GB |

Vision is required and stays visible in all 33 reference profiles. At 500 MB
and 1 GB, its smallest rung (0.873B Q8_0, estimated 1.30 GB resident) is
labelled **best-effort only**; it is not auto-downloaded or invoked as though it
fits. With the default all-free-RAM share, the first reference tier where it
fits is 2 GB. Rows scale with the share: at 50%, for example, the 16 GB row
behaves roughly like the 8 GB row above it.

Above 12 GB of allocation the ladder reaches the **27.8B Q2_K** text/coding rung
(10.9 GB estimate including the repository's separate image-projector file,
12.4 GB resident) while vision stays on a native multimodal Ollama tag. That
HF-to-Ollama import has not been verified by this project; the image route never
relies on it, and Ollama's vision metadata is checked before sending pixels.
Larger shared rungs follow: 27.8B Q4_K_M (17 GB download, 20 GB resident) and
36.0B Q4_K_M (24 GB download, 28 GB resident). The extended native ladder then
offers 27.8B Q8_0 (30/35 GB download/resident), 36B Q8_0 (39/46 GB), and 36B
F16 (72/80 GB) as progressively higher-memory tiers. At the top is Ollama's
native **122B tag (125B parameters, Q4_K_M)** at about 81 GB download / 96 GB
estimated resident, selected only when your allocation is at least that large —
with the default 100% share that means roughly 200+ GB of free RAM, or any
smaller machine whose user explicitly set a share/cap that big. On such a host
the plan can also select multilingual Whisper and browser-cached Kokoro FP32.
These remain multimodal, and every plan re-checks current free memory; the
workstation rungs sit outside the 33-row 0.5–32 GB reference catalogue.

The small tiers show vision as **best-effort only** and never auto-run it.
High-end Q8 rungs are used wherever the allocation allows them.

*Unique selected-asset totals count each distinct selected LLM tag once, plus
the selected Whisper file and (where chosen) browser-cached Kokoro asset. They
are catalogue estimates before reusing anything already installed; other RAM
tiers are never downloaded. Actual live planning steps down when current free
memory is lower than the reference profile, or when the user's share is below
100%.

Chat, vision and coding use abliterated instruct builds only; the planner
refuses a non-abliterated model. Every advertised vision rung is multimodal.
Whisper is multilingual (not `.en`) and is not a chat model. The candidate
Qwen3.5 family and HF multimodal GGUF are documented by
[Ollama](https://ollama.com/huihui_ai/qwen3.5-abliterated) and
[Hugging Face](https://huggingface.co/mradermacher/Huihui-Qwen3.5-27B-abliterated-GGUF).
The higher-memory Q8/F16 options are in the [official Ollama tag catalogue](https://ollama.com/huihui_ai/qwen3.5-abliterated/tags); the top model's size and quantization are listed on its [122B tag page](https://ollama.com/huihui_ai/qwen3.5-abliterated:122B).
The RAM-selected vision path stays on native Ollama tags rather than relying on
an unverified third-party projector import.

Open **MODEL STACK** in the HUD (or press **M**) to inspect the live RAM plan,
all 33 reference tiers from 500 MB through 32 GB, selected models, estimates and
limits, and to set the AI's share of free RAM. `GET /autopilot` is read-only;
`POST /autopilot/config` saves a share/cap and re-plans live (the panel's APPLY
and RESCAN buttons), and never downloads anything. The **INSTALL SELECTED STACK**
button and the setup page both call `POST /autopilot/install`, and that call is
the only thing that downloads model weights. Nothing downloads a tier you did
not pick: existing packages, model tags, runtime and Whisper files are reused,
and other RAM tiers and non-fitting best-effort weights are never bulk-fetched.
Kokoro is fetched and cached by the browser on first use when the RAM plan
selects it. No desktop bundle or EXE is created.

**Nothing in this repository installs a program for you.** Every entry point —
`npm run setup`, `build.sh`, `build.ps1` — either hosts the setup page or points
at it; the page links the official installer for your platform, and you run it.
That includes Ollama, which is never installed silently and never with `sudo`
on your behalf.

## Setup: the page does the installing

Installation is a page in your own browser, not a script in this repo. npm
starts a small local host for that page and opens it:

```bash
npm run setup
```

That runs `scripts/install-web.mjs`. If a bridge is already answering on
`JARVIS_BRIDGE_PORT` (8787 by default) it reuses it; otherwise it starts
`bridge/server.mjs` for the setup session, which is why Node and this repo are
the only prerequisites. It then prints and opens:

```
http://localhost:8787/install?hud=http://localhost:5173
```

The page is served by the bridge itself, on the same origin as the install
endpoints, so it needs no build step, no CDN and no other server. It shows the
`runtime` block read off your machine — platform, architecture, total RAM, free
disk, and whether Ollama is present — then the stack rungs the RAM planner
offers for that machine, the same `tierProfiles` the MODEL STACK panel shows.
Pick the rung that matches what you have, press the button, and the page
downloads *that* stack: the selected chat/vision/coding tag (downloaded once
when the routes share it), the Whisper file, and the speech runtime. Progress
streams step by step; if a step is skipped the page says why rather than
pretending it succeeded.

Ollama itself is a program, and the page does not install it silently. It links
[yours](https://ollama.com/download) — `OllamaSetup.exe`, `Ollama.dmg`,
`ollama-linux-amd64.tgz`, or the official `curl -fsSL https://ollama.com/install.sh | sh`
one-liner on Linux — and offers a **Re-check** button that re-reads `runtime`
instead of guessing. Install it, restart it, re-check, and the model downloads
run. On a machine where a complete stack is already present the page says so and
you can close it.

`npm start` also opens that page automatically when the plan has no Ollama or a
model slot that is not `ready`; pass `--no-open` to keep it shut. In the HUD the
same work is the **INSTALL SELECTED STACK** button in MODEL STACK.

The platform scripts build and launch; they no longer install anything
themselves:

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
The setup skips ONNX Runtime's optional Node-only CUDA provider by default; the
browser TTS path uses the web runtime, and Ollama manages chat-model GPU use.
Set `ONNXRUNTIME_NODE_INSTALL_CUDA=v12` before running the setup script only if
another Node-side ONNX workload specifically needs that CUDA provider. The
script then installs missing/stale npm packages from `package-lock.json`,
vendors the hand-tracking runtime if needed, builds the **web UI**, runs the
read-only `npm run doctor` preflight, and launches the bridge and Vite app (and
`npm start` opens the setup page when the stack is incomplete). Keep the
terminal open and press **Ctrl-C** to stop the processes. No desktop bundle or
EXE is created.

Use `bash ./build.sh --skip-ai-models` or `./build.ps1 -SkipAiModels` to build
and launch without checking for Ollama or model weights; those flags now only
print the setup-page pointer. Use `--no-launch` or `-NoLaunch` to finish
build/model checks without starting the local web servers.

For manual workflows, `npm ci`, `npm run build`, `npm run doctor`,
`npm run setup`, and `npm start` are separate commands. `npm run models:install`
still exists for scripted installs and the test suite, but no build script calls
it. The browser STT/TTS choices default to RAM autopilot; Kokoro speech assets
are fetched by the browser on first use when selected. Chrome or Edge still
needs to be installed for the best microphone experience; the setup page does
not replace the user's browser.

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
while building the planner. `npm run test:autopilot` passes 13 deterministic
RAM profiles and mocked checks for share/cap parsing, saved-vs-environment
precedence, the hard cap winning over the share, non-fitting skips, Ollama-tag
idempotence, slot-filtered installer routing, offline Whisper installation,
incomplete-file rejection, and the browser-cached Kokoro path.
`npm run test:installers` covers loopback endpoint aliases, manual/per-slot
overrides, and read-only preflight behavior against a mock model server.
`npm run test:control` covers the command-line policy (parsing, the allowlist
and deny rules in both modes, working-directory roots), the desktop control
surface (key-combo parsing, per-platform arguments for Windows, macOS and
Linux, quoting of typed text, capability gaps, app discovery and launch
matching) and the capability block (what a headless, read-only Linux host says
about itself, and what a write-enabled one says instead) without running a
command or moving a pointer.
`npm run smoke` exercises the bridge and tool loop, RAM-plan response shape and
33-tier catalogue/statuses, the served `/install` setup page and its `runtime`
contract, the terminal client answering through the same bridge in one-shot
mode, the live `/autopilot/config` share change,
Telugu-to-English code-intent routing, vision prompt fusion, the machine block
the model is actually sent (including its truthful write state), the fact that
the acting shell/desktop tools are absent from the model's tool list while
writes are off, and that an unchecked refusal is challenged and replaced before
the browser hears it, against a local stub model server. These are deterministic/mock
checks, not model inference. No full Ollama-backed conversation, real Whisper
transcription/model download, or Windows/macOS desktop action has been verified
in this workspace — that control code is exercised only through the arguments
it builds, since the sandbox has no display server, `xdotool` or `wmctrl`.
GitHub Pages hosts the UI only.

## Model manager and local speech

`GET /models` compares the dynamic chat/vision/coding slots with Ollama's
installed tags. `GET /autopilot` reports the live RAM allocation (free RAM now,
your share, the resulting ceiling, and how much was left unallocated), selected
variants, estimated active memory, expected downloads and unsupported
capabilities; it also exposes the full RAM-tier catalogue for your current
share. `POST /autopilot/config` writes `{ share, capGb }` (both optional, plus
`rescan: true` to just re-sample memory) to `models/ram-allocation.json` and
rebuilds the plan immediately. The HUD's **INSTALL SELECTED STACK** and the
`/install` page both call `POST /autopilot/install`, and both are user-triggered:
the bridge downloads model files through Ollama, but never launches a system
installer or a package manager for you.

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
scripts/                 setup page host, doctor preflight, terminal client, build assets, start helpers
build.ps1 / build.sh     Node/npm check, web build, preflight, and launch (no silent installs)
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

- **A model server.** [Ollama](https://ollama.com) is the default, and the
  setup page links its official installer for your platform so *you* install it.
  No build script installs it, silently or otherwise. llama.cpp, LM Studio and
  vLLM remain available through their OpenAI-compatible endpoints; custom
  endpoints are never overwritten.
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

`npm run setup` opens the browser setup page described above; it hosts and
serves it, and every download on it is one you press the button for. `npm run
doctor` is the read-only preflight next to it — machine, RAM plan and model
server state, changing nothing. Browser installation remains user-controlled;
Chrome or Edge should already be available for microphone use.

---

## Quick start

The recommended first-run path is:

```bash
npm ci
npm run setup       # hosts the setup page and opens it in your browser
```

On that page pick the stack for your machine and let it download; install
Ollama from the link it gives you if you have none. Then:

```bash
npm start           # local bridge + Vite browser HUD
```

`build.ps1` / `build.sh` wrap the same sequence on Windows and macOS/Linux:
dependency check, web build, read-only preflight, launch. Open the local Vite
URL (normally <http://localhost:5173>) in Chrome or Edge, click **INITIALISE**,
allow the microphone, and say **“Hey Jarvis”**. Local inference requires a
running model server and a model that fits the selected RAM plan; review the
plan and install fitting models from MODEL STACK (or the setup page). The
endpoint is available at `localhost:8787` when the bridge is running.

For separate terminals, use `npm run bridge` for the local AI/tool service and
`npm run dev` for the HUD. The GitHub Pages page is only a static view; it does
not host Ollama or the Node bridge.

## The same assistant in a terminal

The browser is the face, not the brain. Everything the HUD does it does over a
WebSocket frame protocol on port 8787, so a terminal is a first-class client —
you, the answer, and every tool JARVIS reaches for, with nothing rendered for
looks:

```bash
npm run cli
```

```
  J.A.R.V.I.S · cli
  ws://localhost:8787 · 6 servers
  /help for commands · Ctrl-C leaves

you › take a screenshot of my phone        # an example turn
  ⚙ blade ▸ screenshot
  Sent it to the phone.
```

It prints your messages, streams the reply as the model produces it, and shows
each execution as a `⚙ server ▸ action` line, so a turn that quietly used a tool
is visibly a turn that used a tool. `/status` prints the RAM plan, each model
slot with its state, and bridge health; `/help` lists the commands. The first
**Ctrl-C** interrupts a running turn, the second leaves.

For scripts and pipes, one-shot mode keeps the answer clean:

```bash
answer=$(npm run -s cli -- --once "what is on my screen?")   # stdout = answer
```

Notes, tool lines and errors go to stderr in that mode, and the exit code is 1
with the bridge's own message when the model is unreachable. Point it elsewhere
with `--url ws://host:port` or `JARVIS_CLI_URL`; `--no-color` strips the ANSI
colours. The terminal has no camera, and it says so instead of staying silent
when a vision tool asks for a frame.

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

**Text chat and voice share the same local model session.** Open **TEXT CHAT**
in the HUD to type a message and read a streamed reply; this works without
initialising the voice loop, granting microphone access, or enabling speech
output. The chat console reports live bridge, Ollama, model, and RAM-plan status,
and marks the tools used for each answer. Use the same thread with the wake word
when voice is more convenient.

Open **COMMANDS** or press **Ctrl/Cmd + K** to search system actions, launch the
model stack, clear the transcript, toggle HUD surfaces, or run a display scan.
The 3D scene follows pointer movement gently and slows down for the operating
system's reduced-motion preference; neural speech and the WebGL scene are split
from the initial shell so the controls can appear first.

Beyond answering, JARVIS reaches every MCP server on your machine, and can drive
his own interface.

### Your tools

Every server in your `~/.claude.json` is connected explicitly. Depending on what
you have installed, that is roughly:

- **Web & search** — `exa`, `lottie-search`, `mcp-registry`
- **Your phone** — `android`
- **The browser** — `playwright`

These are all optional. With none of them configured JARVIS still answers, still
talks, still looks through the camera, still drives his own interface, and can
still run a command or open an application — the built-in display, UI, camera,
browser, command-line and desktop servers are part of the bridge. Every acting
tool in all of them remains behind the one explicit write gate.

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

### JARVIS controls the machine

Two more built-in servers reach past the interface, on Windows, macOS and Linux
alike. Both start read-only; their acting tools are not registered at all unless
the bridge runs in write mode.

- **`jarvis_shell`** — the command line. `run_command` runs one command in a
  working directory and returns stdout, stderr, the exit code and whether it
  timed out; `list_processes` answers *"is it still running"* and *"what is on
  that port"*; `command_info` says whether a program exists before a promise is
  made about it.
- **`jarvis_desktop`** — everything else. `list_apps` enumerates installed
  applications, `launch_app` starts one, `list_windows` / `focus_window` /
  `window_action` bring one forward, move it, minimize, maximize or close it, and
  `type_text`, `press_keys`, `move_mouse`, `click` and `scroll` drive what is in
  front of you. `desktop_capabilities` reports whether this session can do any of
  that at all, and what to install if it cannot.

The shell is deliberately the most restricted surface in the project, because a
command line is not a tool call — it is a general-purpose escape hatch. By
default every program in the command has to be in an allowlist
(`bridge/shell.mjs`), so `git status`, `npm test`, `ffmpeg`, `docker ps` and the
like run, and an unknown program is refused **by name** with the reason, rather
than failing quietly. A deny list (formatting disks, recursive deletes of `/`
`~` or `*`, piping a download into a shell, power changes) applies in **every**
mode, including `full`. Working directories are confined to your home, the
temp directory and the project unless `JARVIS_SHELL_ROOTS` says otherwise.

Acting tools still sit behind the one write gate: `npm run bridge:writes`, as
described below. `run_command` never opens a shell, so a command line like
`rm -rf node_modules` is parsed and judged as written; text typed into another
application is passed as a single argument, never interpolated into a script.

On Linux, pointer and keyboard control need `xdotool`; window management needs
`wmctrl`. On macOS, `osascript` is used for everything except the pointer, which
needs `cliclick` (`brew install cliclick`). Windows needs nothing beyond
PowerShell, which is already there.

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
| `JARVIS_RAM_SHARE` | `100%` | AI share of currently free RAM (`80`, `0.8`, `"80%"`) |
| `JARVIS_RAM_CAP_GB` | — | Hard allocation ceiling in GB; wins when smaller than the share |
| `JARVIS_RAM_CONFIG` | `models/ram-allocation.json` | Where the panel's saved share/cap lives |
| `JARVIS_OLLAMA_URL` | `http://localhost:11434` | Ollama management/download API root |
| `JARVIS_MODEL_*_URL` | inherits the base URL | Move one slot to another machine |
| `JARVIS_MODEL_NAME` | — | Pins every slot to one model |
| `JARVIS_MODEL_API_KEY` | — | Only for servers that insist on a non-empty header |
| `JARVIS_MODEL_TEMPERATURE` | `0.6` | Sampling temperature |
| `JARVIS_MODEL_MAX_TURNS` | `8` | Tool-calling rounds per question |
| `JARVIS_MODEL_TIMEOUT_MS` | `180000` | Whole-turn timeout, tools and all |
| `JARVIS_BRIDGE_PORT` | `8787` | Port for the WebSocket + HTTP endpoints |
| `JARVIS_ALLOW_WRITES` | off | `1` allows effectful tools (see below) |
| `JARVIS_SHELL_MODE` | `allowlist` | `full` lets `run_command` run any program the deny list allows |
| `JARVIS_SHELL_ALLOW` | — | Extra programs for the allowlist, comma separated; a bare `*` lifts the check |
| `JARVIS_SHELL_ROOTS` | home, temp, project | Extra working-directory roots for `run_command`, comma separated |
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

`bridge/autopilot.mjs` selects the model/quant rung from the RAM allocation
(your share of free RAM, or `100%` by default), unless a `JARVIS_MODEL_*`
environment variable explicitly overrides that slot. Images
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

To allow effectful tools (phone, browser driving, sending, running commands,
clicking and typing), run the bridge this way instead:

```bash
npm run bridge:writes
```

> Read `decideTool()` before you do. *"Hey Jarvis, clean up my downloads folder"*
> means something rather different with writes enabled — and with
> `JARVIS_SHELL_MODE=full`, so does almost everything else.

Write mode is not one switch with one meaning. The browser and desktop servers
can be used while the command line stays on its allowlist, and the deny list
keeps holding either way. If you only want the interface and the odd script,
leave `JARVIS_SHELL_MODE` alone.

---

## How he decides

JARVIS is not allowed to answer "can you" from imagination. Before every
question, `bridge/capability.mjs` probes this machine — the OS and core count,
free RAM and disk, whether there is a desktop session and what it is missing,
which common programs are installed, whether writes are on and how the command
line is policed, which local model slots are filled, which servers are
connected — and appends that block to the system prompt. He plans against the
machine as it is now, not as it was at boot.

The rules that use it:

1. **Check before answering.** The block, plus `command_info`,
   `desktop_capabilities`, `list_apps` and `list_processes` for anything that
   may have changed. He never refuses a task he has not checked the machine for,
   and never promises one either.
2. **If it can be done, plan the route and take it** — the narrowest tool that
   finishes the job — then report what actually happened.
3. **If it cannot be done as asked, plan the nearest thing that can be**: the
   same end by another tool, a lower fidelity, a smaller local model, offline
   instead of online, the part that is possible now and the rest left staged.
   He says which trade he took.
4. **Only then does he say no**, naming the missing piece and what would unlock
   it. A policy refusal is reported as a permission, never as an impossibility,
   and a result he did not observe is never claimed as one.

Those rules are not just prompt text. The opening of every answer is held back
until it is clear he is answering rather than announcing an action or giving up.
A refusal that arrives before a single tool has been tried is challenged once,
with the machine's own facts pushed forward, and only the answer that checked is
spoken — a wrong "no" is never heard. A refusal *after* a tool has actually run
is the honest one, and is never challenged.

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
