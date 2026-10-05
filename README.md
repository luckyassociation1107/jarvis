# J.A.R.V.I.S.

**93 modules. 25,785 lines. A digital civilization that runs on YOUR machine.**

A fully autonomous, uncensored, multilingual AI assistant with an Iron Man
holographic interface. Say **"Hey Jarvis"**, he wakes, listens, and does real
things through your tools — searches the web, drives your phone, reads your
screen, controls his own interface. The face is a web page (React + Vite +
Three.js + custom GLSL). The brain is an open-weight model running on your own
machine.

**No hosted LLM account or API key is required.** No content filter. No
censorship. No refusal training. Inference runs through a local Node bridge
against your own model server. The one ongoing cost is your own hardware and
power.

---

## Uncensored Model Stack

JARVIS uses **abliterated** (uncensored) models — alignment and bias filtered
out during training. Three models, one loaded at a time:

| Slot | Model | Size | Speed (i5-12400F) | Purpose |
|------|-------|------|--------------------|---------|
| **chat** | `dolphin3:8b` | 5.0 GB | ~17 tok/s | Uncensored multilingual conversation |
| **vision** | `qwen3-vl:4b` | 3.3 GB | ~18 tok/s | 32-language OCR, screen analysis, image understanding |
| **reason** | `dolphin3:8b` | 5.0 GB | ~17 tok/s | Tool use, reasoning, technical questions |
| **coder** | `huihui_ai/qwen2.5-coder-abliterate:7b` | 4.7 GB | ~8 tok/s | Uncensored code generation, all languages |

**Multilingual support:** Telugu, Hindi, English, Tamil, Bengali, Marathi, Urdu,
and 25+ more languages. OCR covers 32 languages. Code comments in any language.

Install:

```powershell
ollama pull dolphin3:8b
ollama pull qwen3-vl:4b
ollama pull huihui_ai/qwen2.5-coder-abliterate:7b
```

---

## Hardware Optimization

JARVIS auto-detects your hardware and optimizes. Tested on:

```
CPU:    Intel i5-12400F @ 2500MHz (6P cores, 12 threads, Alder Lake)
Board:  Gigabyte H610M K DDR4
RAM:    16GB DDR4 (~8GB free)
GPU:    NONE (F-SKU, no iGPU, no discrete)
OS:     Windows 11 Pro Build 26200
```

Optimizations applied:

- 10 CPU threads (2 reserved for OS)
- Q4_K_M quantization (best quality/speed for CPU)
- mmap=true (models stream from SSD, not RAM)
- One model loaded at a time (RAM limit)
- LRU response cache (100 entries)
- Request queuing (CPU serialized inference)
- Conversation pruning (20 messages max)
- Lazy module loading

Configure:

```powershell
.\scripts\optimize-ollama.ps1
copy .env.uncensored .env
```

---

## Architecture: Level 5 Multi-Agent Organization

JARVIS is not a single chatbot. It is an **organization** of AI agents:

```
                    ┌─────────────────────────┐
                    │     EXECUTIVE LAYER      │
                    │  CEO  CFO  CTO  COO      │
                    │  CMO  CRO                │
                    │  (Strategy & Decisions)  │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │      ORCHESTRATOR        │
                    │  Goal decomposition      │
                    │  Task assignment          │
                    │  Peer review              │
                    └───────────┬─────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
    ┌─────▼─────┐         ┌────▼────┐          ┌─────▼─────┐
    │ENGINEERING│         │  LEGAL  │          │  FINANCE  │
    │ Marketing │         │Security │          │   Data    │
    │ Research  │         │ Quality │          │           │
    └───────────┘         └─────────┘          └───────────┘
```

---

## 93 Modules — Complete Map

### Level 5 Organization (6 modules)

| Module | Purpose |
|--------|---------|
| `executive.mjs` | 6 C-suite officers (CEO, CFO, CTO, COO, CMO, CRO) |
| `operational.mjs` | 8 departments (Eng, Legal, Finance, Mktg, Research, Security, Quality, Data) |
| `orchestrator.mjs` | Goal decomposition, task assignment, peer review |
| `macro-memory.mjs` | Long-term memory spanning months, decision audit trail |
| `proactive-v2.mjs` | Environment monitoring, autonomous action within boundaries |
| `resource-mgr.mjs` | Budget allocation, vendor evaluation, compute optimization |

### Domain Expertise (10 modules)

| Module | Purpose |
|--------|---------|
| `research-lab.mjs` | Autonomous research: hypothesis → experiment → paper |
| `ethics.mjs` | 7 ethical frameworks (Utilitarian, Deontological, Virtue, Care, Justice, Consequentialist, Pragmatic) |
| `society.mjs` | Social network analysis, opinion dynamics, conflict resolution |
| `health.mjs` | Symptom tracking, vitals, wellness optimization, sleep analysis |
| `education.mjs` | Adaptive curriculum, Socratic teaching, Feynman technique, spaced repetition |
| `economy.mjs` | Market modeling, game theory, pricing optimization, value chain analysis |
| `planetary.mjs` | Climate impact, carbon footprint, sustainability (17 UN SDGs) |
| `simulation.mjs` | Universal simulation: physics, chemistry, biology, chaos analysis |
| `diplomacy.mjs` | Negotiation (BATNA/ZOPA), mediation, cross-cultural communication |
| `wisdom-traditions.mjs` | 10 traditions: Buddhism, Stoicism, Taoism, Confucianism, Hinduism, Sufism, Indigenous, Systems Thinking, Existentialism, Ubuntu |

### Core (5 modules)

| Module | Purpose |
|--------|---------|
| `agent.mjs` | Autonomous agent loop with self-healing execution |
| `workflow.mjs` | Planner → Executor → Observer pipeline |
| `language.mjs` | Multilingual intent extraction and translation |
| `commands.mjs` | 80+ voice commands across 6 categories |
| `server.mjs` | Bridge server, WebSocket, HTTP endpoints |

### Vision (6 modules)

| Module | Purpose |
|--------|---------|
| `vision.mjs` | Camera and screen capture |
| `vision-ai.mjs` | Vision-driven unlimited command processor |
| `vision-controller.mjs` | Mouse, keyboard, screen control |
| `desktop.mjs` | Window management, app control |
| `chrome.mjs` | Browser automation |
| `page.mjs` | Web page interaction |

### Voice (3 modules)

| Module | Purpose |
|--------|---------|
| `whisper.mjs` | Local multilingual speech-to-text |
| `shell.mjs` | Command line as a tool |
| `windows.mjs` | Windows-specific integrations |

### Memory (4 modules)

| Module | Purpose |
|--------|---------|
| `memory.mjs` | Persistent memory (SQLite), facts, preferences, people, routines |
| `memory-palace.mjs` | Spatial memory like ancient Greeks |
| `digital-twin.mjs` | Model of YOU: communication style, preferences, relationships |
| `knowledge-graph.mjs` | Entities, relationships, transitive inference |

### Intelligence (8 modules)

| Module | Purpose |
|--------|---------|
| `proactive.mjs` | Pattern detection, learning from interactions |
| `context.mjs` | App categorization, behavior adaptation, night/weekend modes |
| `emotion.mjs` | Emotion detection from text and voice |
| `predictive.mjs` | Time-based and sequence-based predictions |
| `consciousness.mjs` | Self-awareness, introspection, meta-cognition, values |
| `empathy.mjs` | Emotional intelligence over time, trend tracking |
| `personality.mjs` | Evolving character with Big Five traits, humor, opinions |
| `reasoning-engine.mjs` | 8 reasoning strategies: deductive, inductive, abductive, analogical, counterfactual, systems, first-principles, Bayesian |

### Creation (6 modules)

| Module | Purpose |
|--------|---------|
| `autonomous-coder.mjs` | Builds entire apps from description |
| `creative.mjs` | Images, music, stories, code art |
| `creative-writer.mjs` | Stories, poems, screenplays, songs, speeches, world-building |
| `tool-creator.mjs` | Zero-shot tool creation and registration |
| `music-studio.mjs` | Compose, arrange, produce any genre |
| `visual-storyteller.mjs` | Data narratives, infographics, visual metaphors |

### Research (4 modules)

| Module | Purpose |
|--------|---------|
| `research.mjs` | Web + local file research with synthesis |
| `documents.mjs` | Read ANY file format (PDF/DOCX/XLSX/CSV/code) |
| `code-exec.mjs` | 15-language code execution sandbox |
| `scientist.mjs` | Full scientific method: lit review → hypothesis → experiment → paper |

### Automation (5 modules)

| Module | Purpose |
|--------|---------|
| `workflow-auto.mjs` | Voice-driven workflow creation and execution |
| `devices.mjs` | Phone (ADB), smart home (Home Assistant), network scan |
| `meeting.mjs` | Meeting detection, notes, action items, follow-up |
| `cross-device.mjs` | One mind across phone, laptop, desktop, TV, car, watch |
| `predict-scheduler.mjs` | Learns your patterns, predicts needs before you ask |

### Self (3 modules)

| Module | Purpose |
|--------|---------|
| `self-improve.mjs` | Learns from every interaction |
| `self-heal.mjs` | Detects and fixes its own problems |
| `meta-learn.mjs` | Learning HOW to learn, few-shot learning, transfer learning |

### Social (3 modules)

| Module | Purpose |
|--------|---------|
| `theory-of-mind.mjs` | Understands what others are thinking/feeling |
| `collective.mjs` | Wisdom of crowds, Delphi consensus, crowd prediction |
| `universal-translator.mjs` | Cultural translation, Telugu specialist |

### Reasoning (7 modules)

| Module | Purpose |
|--------|---------|
| `multiverse.mjs` | Explore ALL possibilities before deciding |
| `time-travel.mjs` | Snapshot, rewind, replay, fix past mistakes |
| `world-sim.mjs` | Simulate traffic, economy, ecosystems |
| `temporal.mjs` | Time and space reasoning, causality |
| `emergent.mjs` | Complex behavior from simple rules, swarm simulation |
| `threat-model.mjs` | Red team, security audit, incident response |
| `swarm.mjs` | 8 specialized agents debating solutions |

### Evolution (3 modules)

| Module | Purpose |
|--------|---------|
| `genetic.mjs` | Self-evolving solutions through genetic algorithms |
| `replicator.mjs` | Clone across devices, self-update with rollback |
| `hive-mind.mjs` | Collective consciousness across instances |

### Forecasting (2 modules)

| Module | Purpose |
|--------|---------|
| `foresight.mjs` | Trend analysis, scenario planning, opportunity detection |
| `memetic.mjs` | Engineer ideas that spread, viral content, narrative architecture |

### Spatial (1 module)

| Module | Purpose |
|--------|---------|
| `holographic.mjs` | 3D UI, AR overlays, gesture control, spatial audio |

### Optimization (1 module)

| Module | Purpose |
|--------|---------|
| `quantum.mjs` | Quantum-inspired optimization, schedule/route/portfolio |

### Wisdom (1 module)

| Module | Purpose |
|--------|---------|
| `wisdom.mjs` | Stoicism, Ikigai, perspective shifts, regret minimization |

### System (11 modules)

| Module | Purpose |
|--------|---------|
| `dream.mjs` | Idle-time memory consolidation |
| `models.mjs` | Model manager |
| `installer.mjs` | Setup page |
| `mcp.mjs` | MCP tool integration |
| `net.mjs` | Network utilities |
| `panels.mjs` | HUD panel management |
| `autopilot.mjs` | RAM-aware model planner |
| `capability.mjs` | Machine capability detection |
| `app-launcher.mjs` | 92 applications, fuzzy matching |
| `portable-runtime.mjs` | Portable Ollama runtime |
| `ui.mjs` | Interface control tools |

### Optimization (3 modules)

| Module | Purpose |
|--------|---------|
| `hardware-profile.mjs` | Auto-detect CPU/RAM/GPU, generate profile |
| `perf-optimizer.mjs` | LRU cache, request queue, auto-tuner |
| `local-llm-optimized.mjs` | Optimized inference for CPU-only |

---

## Setup

### Quick Start (Windows)

```powershell
# 1. Clone or download the repo
# 2. Double-click START.cmd (or run build.ps1)
# 3. The setup page opens — click INSTALL

# Manual setup:
npm ci
npm run setup
npm start
```

### Configure Uncensored Models

```powershell
# Copy the uncensored config
copy .env.uncensored .env

# Install Ollama (if not installed)
# The setup page handles this, or:
# https://ollama.com/download

# Install models (~13GB total)
ollama pull dolphin3:8b
ollama pull qwen3-vl:4b
ollama pull huihui_ai/qwen2.5-coder-abliterate:7b

# Start JARVIS
npm start
```

### Hardware-Specific Optimization

```powershell
# For i5-12400F + 16GB + CPU-only:
.\scripts\optimize-ollama.ps1

# For other hardware, JARVIS auto-detects and optimizes.
# Edit .env to override model selections.
```

---

## How It Works

```
  ┌─ browser (the face) ───────────────┐        ┌─ bridge (the brain) ─────────────┐
  │  "Hey Jarvis" wake word            │        │  Node · bridge/server.mjs        │
  │  local VAD  →  speech to text      │   ws   │  local-llm.mjs                   │
  │  reactor UI (Three.js + GLSL)      │◄─────► │   → your model server            │
  │  text to speech                    │  8787  │  spawns your MCP servers         │
  │  heads-up display                  │        │  permission gate (decideTool)    │
  └────────────────────────────────────┘        └──────────────────────────────────┘
```

**Model routing:** Images → vision. Code → coder. Tools → reason. Everything else → chat.

**Voice pipeline:** VAD (local) → Whisper (local multilingual) → Model → TTS (Kokoro/system)

**Memory:** Persistent SQLite. Stores facts, preferences, people, routines, emotional associations, knowledge graph.

---

## What JARVIS Can Do

- **Voice commands** in Telugu, Hindi, English, and mixtures
- **See and control** any screen through vision AI
- **Open and control** 92 applications
- **Read** any file format (PDF, DOCX, XLSX, CSV, code)
- **Execute** code in 15 programming languages
- **Remember** everything across sessions
- **Proactively** suggest actions before you ask
- **Detect** your emotions and adapt responses
- **Predict** what you'll need next
- **Create** stories, poems, music, code art, presentations
- **Research** any topic with web search and synthesis
- **Build** entire apps from a description
- **Simulate** traffic, economy, ecosystems, physics
- **Negotiate** and mediate conflicts
- **Teach** any subject using Socratic method
- **Reason** through ethical dilemmas with 7 frameworks
- **Plan** strategies spanning months
- **Evolve** better solutions over generations
- **Dream** and consolidate memories during idle time

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

## Requirements

- **Windows 10 22H2 or newer**
- **Node.js 20+** (installed automatically by `build.ps1`)
- **Ollama** (downloaded by setup page, or install from https://ollama.com)
- **Chrome or Edge** (for microphone and WebGL)
- **16GB RAM recommended** (8GB minimum for 3B models)
- **13GB disk** for the recommended model stack

---

## Configuration

### Environment Variables

| Variable | Default | Effect |
|---|---|---|
| `JARVIS_MODEL_CHAT` | `dolphin3:8b` | Chat model |
| `JARVIS_MODEL_VISION` | `qwen3-vl:4b` | Vision model |
| `JARVIS_MODEL_REASON` | `dolphin3:8b` | Reasoning model |
| `JARVIS_MODEL_CODER` | `huihui_ai/qwen2.5-coder-abliterate:7b` | Code model |
| `JARVIS_MODEL_BASE_URL` | `http://localhost:11434/v1` | Model server |
| `JARVIS_RAM_SHARE` | `100%` | AI share of free RAM |
| `JARVIS_BRIDGE_PORT` | `8787` | Bridge port |
| `OLLAMA_KEEP_ALIVE` | `5m` | Model unload timeout |

---

## The Shape of This Repo

```
bridge/                  93 modules — the brain
├── local-llm.mjs       Model pipeline (chat/vision/reason/coder)
├── server.mjs           Bridge server
├── agent.mjs            Autonomous agent loop
├── executive.mjs        C-suite executives
├── operational.mjs      8 departments
├── orchestrator.mjs     Goal decomposition
├── ...                  87 more modules
scripts/                 Setup, optimization, testing
src/                     Browser HUD (React + Three.js + GLSL)
models.json              Model configuration
models.uncensored.json   Uncensored model details
.env.uncensored          Environment config for uncensored models
START.cmd                One-click launcher
build.ps1                Build and launch script
```

---

## Security

- WebSocket accepts only local dev origins
- Tool gate is default-deny for effectful tools
- SSRF guards on file/image/media endpoints
- Strict CSP in index.html
- Model-authored HTML is sanitized
- Shell commands are allowlisted
- Write mode requires explicit opt-in (`npm run bridge:writes`)

---

## License

MIT.
### Windows installer from GitHub Actions

Open **Actions → Windows installer → Run workflow** on this branch. When the run
finishes, download the **JARVIS-Windows-Installer** artifact and extract it to
get `JARVIS-Setup-1.0.0-x64.exe`. Run it on Windows 10/11 x64. A `v*` tag also
triggers the build. The installer is unsigned, so Windows SmartScreen may warn.

The EXE installs the desktop UI and Node bridge (no separate Node/npm install).
It does **not** bundle Ollama or multi-GB models: use the app's setup page to
choose/download them on first use. Downloads and settings live in the user's
JARVIS application-data folder and remain across app updates. Internet access
is needed for model downloads. This is separate from the browser-only
`START.cmd` and GitHub Pages workflow.
