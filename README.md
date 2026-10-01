# J.A.R.V.I.S.

A browser voice assistant with an Iron Man holographic interface. Say
**"Hey Jarvis"**, he wakes, listens, and does real things through your tools —
searches the web, drives your phone, reads your screen, controls his own
interface. The face is a web page (React + Vite + Three.js + custom GLSL). The
brain is an open-weight model running on your own machine.

**No hosted LLM account or API key is required.** Inference runs through a
local Node bridge against your own model server. Initial model downloads come
from their publishers, web tools fetch the pages you ask for, and browser
speech-recognition behavior depends on Chrome or Edge. The one ongoing cost is
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

## Model slots and the multilingual workflow

The pipeline routes by capability, not by one big model doing everything:

| Slot | Model | Job |
|---|---|---|
| `chat` | `huihui_ai/qwen2.5-abliterate:0.5b` | conversation, and intent extraction |
| `vision` | `huihui_ai/qwen2.5-vl-abliterated:3b` | optional image slot; not auto-downloaded |
| `reason` | `dagbs/qwen2.5-coder-7b-instruct-abliterated` | writes and debugs code |

`bridge/language.mjs` adds the piece that was absent: a **multilingual intent
extractor and English translator**. Say "computer lo chrome close cheyyu" and it
returns `{language: "te", intent: "close", target: "Chrome"}` plus an English
rewrite, so the models downstream never see a language they were not trained for.

Two deliberate choices in there:

**A separate slot, not the coder.** Intent extraction is classification, and a
0.5b model does it in under a second. Routing it through the 7b coder would
triple the latency of every command for no gain.

**Soft failure.** If the model is unreachable or returns something unparseable,
the caller gets the original text back with `language: null` and the router
proceeds in English exactly as before. A feature that breaks the assistant when
the model is down is not a feature.

`runTurn` gained a `translate` step that rewrites the last user message in
English, keeping the original visible to the model as well — so a mistranslation
is recoverable in context rather than silently wrong. English input skips it
entirely, so an English user pays no latency.

## Automated model install, quantization-aware

`GET /autopilot` reports what this machine can afford. `POST /autopilot/install`
downloads it. They are separate endpoints because a 7 GB pull must never happen
because something polled a URL.

The budget is the design:

```
35%  the OS           not negotiable, and not ours to spend
25%  everything else  browser, editor, and other running apps
40%  models           what is left, and all we may touch
```

Those numbers are not arbitrary. A loaded model is *resident*, so a 7b model is
not a 4.7 GB download, it is 4.7 GB permanently gone from everything else.
Spending more than the leftover 40% is how you get a machine that swaps.

The chat and coding ladders climb **round-robin**, and the planner skips a
rung that does not fit instead of stopping at the first miss. That prevents one
capability from taking the whole budget while another stays at its minimum.
The speech model is selected separately from the remaining budget. Verified
across the range:

| RAM | Model budget | Gets |
|---|---|---|
| 1 GB | 0.4 GB | chat 0.5b |
| 2 GB | 0.8 GB | chat 0.5b + whisper tiny |
| 4 GB | 1.6 GB | chat 1.5b + code 0.5b + whisper small |
| 6 GB | 2.4 GB | chat 1.5b + code 1.5b + whisper small |
| 8 GB | 3.2 GB | chat 3b + code 1.5b + whisper small |
| 12 GB | 4.8 GB | chat 3b + code 3b + whisper large-v3-turbo |
| 16 GB | 6.4 GB | same, speech maxed |
| 24 GB | 9.6 GB | chat 7b + code 7b |
| 32 GB | 12.8 GB | chat 7b + code 7b + whisper large |

Every model in both ladders is **abliterated**, from `huihui_ai/qwen2.5-abliterate`
and `huihui_ai/qwen2.5-coder-abliterate`, each spanning 0.5b to 14b. Nothing else
is downloaded. Vision is deliberately **excluded from the automatic RAM plan**:
the smallest useful multimodal model has a ~950 MB floor and is not part of the
chat-and-coding-only model ladder. The configurable vision slot remains optional;
the autopilot does not download it.

Whisper is exempt from the guard on purpose. It is a speech recogniser with no
chat behaviour, so it has no alignment to remove. The exemption sits next to the
rule rather than at the call site, so the two cannot drift apart.

Climbing is **round-robin, not best-first**. A best-first walk gives the whole
budget to whichever capability is listed first, and on a 24 GB machine that means
a 9 GB chat model beside a 0.4 GB coder — a machine that converses well and writes
code badly. Round-robin takes one rung from each in turn, so they climb together
and neither can starve the other.

The guard is verified to actually fire: replacing one entry with an aligned model
makes `plan()` throw, with the offender named.


## Setup and RAM-based model selection

`npm run setup` is an advisory preflight: it checks Node and the model server and
prints what is missing. **It does not install Ollama or download models.** The
RAM-aware download flow is explicit so a multi-gigabyte pull never happens just
because the app started:

```bash
npm install
npm run setup       # check prerequisites; changes nothing
npm start           # starts the local bridge and browser HUD
```

With the bridge running, inspect the plan first, then choose whether to install
it. These commands pull the models selected for the machine's available RAM:

```bash
curl http://localhost:8787/autopilot
curl -X POST http://localhost:8787/autopilot/install
```

Ollama must already be installed and running. The install endpoint pulls the
planned local models and the optional Whisper package; it does not install the
model server itself. Review the plan before calling the `POST` endpoint because
its downloads may be large.

## Uncensored models, enforced

A standing requirement, so it is *checked* rather than assumed. `plan()` calls
`assertUncensored()`, which fails loudly if any catalogue entry is not from an
abliterated / dolphin / hermes / nous family. Ollama's plain `qwen2.5` tags are
the aligned originals and are exactly what must not be installed. moondream and
the whisper files are out of scope — not chat models, no alignment to remove.


## What has actually been run

Most of this repo has never been executed. The exceptions are below, and they
were run on a real machine with a real Ollama, not simulated:

| | Result |
|---|---|
| Both model families exist on Ollama, every tag | verified, HTTP 200 |
| Byte sizes in the ladders | 0.5b 397 MB *(est. 398)*, 3b 1.9 GB, 7b 4.7 GB, 14b 9.0 GB — all match |
| `ollama pull` of the 0.5b | **succeeded**, 397 MB |
| Inference on the abliterated model | **`JARVIS ONLINE`**, 5 tokens in 2.02 s on CPU |
| `whisper-node@1.1.1` install | **succeeded** via npm |
| Whisper model download | **succeeded**, 30.7 MB *(est. 31)*, GGML magic `0x67676d6c` verified |
| `gpu()` on a machine with no GPU | correctly returned `null` |
| Full `autopilot.install()` end to end | **3 of 3 installed** |

The full browser voice-to-model-to-tool loop has not yet been verified end to end.

Two bugs came out of this and would never have come out of `node --check`:

- **The whisper binary URLs were invented.** Not merely wrong paths — whisper.cpp
  publishes *no prebuilt binaries at all*, not on HuggingFace, not in its GitHub
  releases (which have zero assets). The repo has also moved from
  `ggerganov/whisper.cpp` to `ggml-org/whisper.cpp`. The first version 404'd on
  every platform while reporting success.
- **A "valid GGML" check that was wrong about byte order.** The magic reads
  `lmgg` as ASCII and `0x67676d6c` as a little-endian uint32. Reading it the
  obvious way says the file is corrupt when it is fine.

## Model manager

`GET /models` asks Ollama what it has and compares that against the three slots,
so a missing model is named rather than surfacing as JARVIS silently failing to
think. Matching is on the model name before the tag, so `qwen2.5:latest` counts
as `qwen2.5:7b` — a user who pulled `:latest` should not be told they are missing
weights they already have.

`ensure(slot, {auto})` will pull, but only when asked. A 7 GB download should
never start as a side effect of booting. Pulls stream progress, because a 7 GB
download with no feedback is indistinguishable from a hang.

## Speech

**STT** can use the browser's SpeechRecognition API for the interactive HUD.
That API's implementation and network behavior depend on the browser. For an
explicit local path, `POST /stt` accepts a 16 kHz mono WAV and uses the optional
whisper.cpp binary and model configured with `JARVIS_WHISPER_BIN` and
`JARVIS_WHISPER_MODEL`.

Point it at your install:

```bash
export JARVIS_WHISPER_BIN=~/whisper.cpp/build/bin/whisper-cli
export JARVIS_WHISPER_MODEL=~/whisper.cpp/models/ggml-base.en.bin
```

Binary and model are checked separately, because those are two different problems
with two different fixes and one boolean sends people looking in the wrong place.

**TTS** is the narration net from earlier — local, no API, no key.

## The shape of this repo

One browser HUD backed by a Node bridge and your own local models:

```
src/ + index.html        browser HUD — voice, reactor, panels
bridge/                  local Node bridge — model pipeline, tools, autopilot
scripts/                 preflight and local start scripts
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

**In one line:** a local model server, Node.js, and Chrome or Edge. Ollama is the recommended model server.

- **A model server.** [Ollama](https://ollama.com) is the easiest option;
  keep its local service running so the bridge can reach it. llama.cpp, LM Studio
  and vLLM also work through their OpenAI-compatible endpoints. The RAM-aware
  autopilot uses the model families listed above; the model server itself is
  installed separately.
- **Node.js 20 or newer** from <https://nodejs.org>. This is a Node web app, so it is the one unavoidable runtime.
- **Google Chrome or Microsoft Edge**, in a **real browser window** — not an
  embedded preview pane. Preview panes (including the one inside editors) block
  microphone access, so the page loads and looks right but never hears you.
  JARVIS also needs WebGL, which these browsers provide.
- **Optional: MCP servers**, if you want JARVIS to reach anything outside this
  machine. He reads `~/.claude.json` for them, which is where they already live
  on a machine that has ever run Claude Code — not because this project needs
  it. With none configured he still answers, still talks, and still drives his
  own interface.

`npm run setup` is a friendly preflight after cloning. It checks whether your model server is reachable and reports missing prerequisites; it does not install software or models.

---

## Quick start

Install Ollama and start its local server first. Then, in the repository:

```bash
npm install
npm run setup       # advisory preflight; no downloads or system changes
npm start           # local bridge + Vite browser HUD
```

Open <http://localhost:5173> in Chrome or Edge, click **INITIALISE**, allow the
microphone, and say **“Hey Jarvis”**. The default chat model must be pulled before
it can answer; the RAM-aware autopilot offers a preview and explicit install
through `GET /autopilot` and `POST /autopilot/install` on `localhost:8787`.

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

**The models.** Three of them, by default, chosen per question — see
*The pipeline* below. `JARVIS_MODEL_BASE_URL` says where the server lives
(Ollama's default is `http://localhost:11434/v1`), and on startup the bridge
prints every slot and checks each is actually loaded, e.g.

```
[jarvis]   chat    huihui_ai/qwen2.5-abliterate:0.5b            @ http://localhost:11434/v1
[jarvis]   vision  huihui_ai/qwen2.5-vl-abliterated:3b          @ http://localhost:11434/v1
[jarvis]   reason  dagbs/qwen2.5-coder-7b-instruct-abliterated  @ http://localhost:11434/v1
```

A missing model is named at boot, with the `ollama run` line that fixes it,
rather than discovered by you mid-sentence.

### The voice pipeline

The loop is designed so that nothing silently dies and barge-in feels natural.

- **Detection is local.** An energy-based voice-activity detector
  (`src/lib/vad.ts`) decides when you are speaking. It is instant, cannot quietly
  fail, and is what makes **barge-in** work — speak while JARVIS is talking and he
  stops, without waiting for a transcript to say so.
- **Transcription** is the browser's own `SpeechRecognition` (Chrome/Edge),
  guarded by a heartbeat so it recovers when Chrome throttles it. Chrome
  throttling that API into silence with no event to catch is the failure this
  guard exists for.
- **Speaking** uses the browser's `speechSynthesis` by default. `VITE_TTS_ENGINE=kokoro`
  switches to a neural voice that runs in the tab — better sound, nothing leaving
  the machine, but it downloads ~86MB of weights and generates slower than
  realtime. If the OS voice is broken it latches over to Kokoro for the rest of
  the session, because a broken system voice fails identically every time and
  retrying it per sentence is worse than a worse timbre.

So there is no key, no account and no flag: speech works on a fresh install.
The one thing to know is that it has to be a real browser window.

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
those four are built into the bridge and cannot be missing.

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
| `JARVIS_MODEL_CHAT` | `huihui_ai/qwen2.5-abliterate:0.5b` | The fast slot |
| `JARVIS_MODEL_VISION` | `huihui_ai/qwen2.5-vl-abliterated:3b` | The slot that reads images |
| `JARVIS_MODEL_REASON` | `dagbs/qwen2.5-coder-7b-instruct-abliterated` | The slot that calls tools |
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
| `VITE_TTS_ENGINE` | `system` or `kokoro` |
| `VITE_KOKORO_VOICE` | Voice for the Kokoro engine |

### The pipeline

One model is a compromise: a small one answers fast and cannot use tools, a
large one uses tools and takes seconds per sentence. So JARVIS runs three, and
picks per question.

| Slot | Default | Reached for | RAM (Q4_K_M) |
|---|---|---|---|
| `chat` | `huihui_ai/qwen2.5-abliterate:0.5b` | Everything else. Conversation. | ~0.4 GB |
| `vision` | `huihui_ai/qwen2.5-vl-abliterated:3b` | Any turn with an image in it. | ~2.0 GB |
| `reason` | `dagbs/qwen2.5-coder-7b-instruct-abliterated` | Tool-shaped or technical questions. | ~4.7 GB |

Roughly 7.1 GB resident, which leaves a 16 GB machine comfortable. All three
usually share one Ollama; `JARVIS_MODEL_*_URL` moves one of them elsewhere if
you need to.

**All three are abliterated, and none of them are base models.** Those get
conflated, so: *base* means a model that was never taught to follow
instructions — it will not refuse you, and it will not understand you either,
and it cannot emit a function call, so JARVIS would silently stop using every
tool he has. *Abliterated* means an instruct build with the internal refusal
direction surgically removed, so it answers without hedging and still calls
tools. That is what uncensored should mean here, and it is what these are.

The choice is made **before** anything is streamed, which is the whole design.
Escalating afterwards would mean the browser had already spoken the smaller
model's answer, and *"I can't do that"* followed by doing it is worse than a
slightly slow answer. So it is a guess made up front, on three signals: an image
in the conversation means vision; a question that names a tool or reads as
technical means reason; everything else is the fast slot. The tool vocabulary is
spelled out from the twenty-two tools that actually exist, and it errs wide on
purpose — a false positive costs a second of latency, a false negative costs a
JARVIS who talks confidently and does nothing.

The slot is re-evaluated after every tool result, because a camera frame
arriving as a result makes it a vision question — and only a vision model can
read a photograph. A text model shown one describes the prompt instead, with
total confidence.

**And there is a net under the guess.** A small model asked to call a tool it
cannot call will often narrate instead — *"I will now open the browser and
search for that…"* — fluently, confidently, and with nothing whatsoever
happening. That failure throws no error and logs nothing, so the chat slot's
first few tokens are held back and checked. If it opens by announcing an action
it never takes, the turn is re-run on the reason slot and the first answer is
discarded. Nothing has been spoken yet, so the cost is a pause; the benefit is
that a silent, total failure becomes a slow, correct answer. The smoke test
covers it, because it is exactly the kind of thing that rots quietly.

**On the 0.5B.** It is the fast slot and it is also the weak link. It will
handle *"what's the weather"* and *"tell me a joke"*; it will not reliably
choose between twenty-two tools. If JARVIS stops using his tools, set
`JARVIS_MODEL_CHAT=qwen2.5-coder-7b-instruct-abliterated` and accept that every
answer now costs a 7B's latency. That one line is the trade, and it is yours to
make.

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
