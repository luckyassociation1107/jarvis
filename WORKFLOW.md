# How JARVIS works, end to end

This is the whole system in one place: what the pieces are, what happens when
you speak to it, and what it is actually for.

---

## The three layers

```
┌─────────────────────────────────────────────────────────────┐
│  THE FACE                                                   │
│                                                             │
│  browser HUD (src/)        Flutter workspace (launcher/)    │
│  React + Three.js + GLSL   skins, dock, window manager      │
│         │                          │                        │
│         └──────────┬───────────────┘                        │
│                    │ WebSocket / MethodChannel              │
├────────────────────┼────────────────────────────────────────┤
│  THE BRIDGE (bridge/)  — Node, localhost only               │
│                                                             │
│  server.mjs      the HTTP + WS front door                   │
│  local-llm.mjs   the four model slots and the agent loop    │
│  language.mjs    multilingual intent → English              │
│  models.mjs      what is installed, what is missing         │
│  whisper.mjs     local speech-to-text                       │
│  mcp.mjs         the tool bridge                            │
│  vision.mjs      the camera                                 │
│  chrome.mjs      the browser                                │
├────────────────────┼────────────────────────────────────────┤
│  THE MODELS — Ollama, on your machine                       │
│                                                             │
│  chat    0.5b   conversation, intent extraction             │
│  vision  3b     sees the camera and the screen              │
│  reason  7b     writes and debugs code                      │
└─────────────────────────────────────────────────────────────┘
```

**Nothing here phones home.** No API keys, no accounts, no subscriptions. The
only network calls the bridge makes are to `localhost` and to pages you asked it
to fetch. The one cost is your own hardware.

---

## What happens when you speak

```
1.  You press Alt+Space and say something.

2.  SPEECH → TEXT
    Flutter records audio → POST /stt → whisper.cpp → a transcript.
    Local, so it works offline and no audio leaves the machine.
    (The browser HUD can use its own recogniser instead.)

3.  LANGUAGE → INTENT
    bridge/language.mjs sends the transcript to the 0.5b slot and gets back
    {language, english, intent, target, confidence}.

    "computer lo chrome close cheyyu"
      → {language: "te", intent: "close", target: "Chrome",
         english: "close chrome on the computer"}

    English input skips this step entirely, so English users pay no latency.

4.  ROUTING
    The English text goes to pickModel(), which chooses a slot:
      an image attached        → vision
      code-shaped question     → reason (the 7b coder)
      anything else            → chat

5.  THE AGENT LOOP
    The chosen model gets the conversation plus the tool list. It can either
    answer in prose or call a tool. If it calls a tool, the bridge runs it,
    feeds the result back, and asks again — up to 8 rounds before it gives up
    and answers in words.

6.  THE TOOLS
    mcp.mjs is the bridge to real capability: launch an app, read the screen,
    drive the camera, open a URL, move a window, run code. 22 of them.

7.  TEXT → SPEECH
    The reply goes through the TTS narration net — local, no API, no key.
```

The loop in step 5 is the part that makes this an agent rather than a chatbot.
Everything else is plumbing.

---

## The desktop side

The Flutter workspace is a separate front-end to the same bridge:

- **The grid** — every installed application, indexed, icons extracted in pure
  Dart from `.ico`/`.icns`/`.lnk`. Keyboard-driven, arrow keys and Enter.
- **The dock** — favourites, and on Windows a real taskbar via the native
  window manager: enumerate, focus, minimise, maximise, close, snap.
- **The skins** — a JSON file that says which widgets go where. Seven ship, four
  ported from real Rainmeter `.rmskin` files with palettes read out of their
  `.inc` definitions.
- **The widgets** — clock, system monitor, calendar, notes, weather, media, app
  count, reactor. System stats are real kernel32 reads via `dart:ffi`.
- **The icon wrapper** — every app icon clipped into the skin's shape, backed,
  tinted ~7% toward the accent, and framed. That wash is what makes a grid of
  icons from a dozen vendors read as one instrument panel.

It ships as a single `jarvis.exe` with an Inno Setup installer, built by CI on
every push.

---

## Memory: 500 MB to 32 GB

One `kernel32` call picks a tier:

| Tier | RAM | Icon cache | Blur | Reactor | Icon decode |
|---|---|---|---|---|---|
| minimal | < 2 GB | 8 MB | off | static | 48 px |
| low | 2–4 GB | 24 MB | off | 12 fps | 64 px |
| standard | 4–8 GB | 64 MB | on | 30 fps | 96 px |
| high | > 8 GB | 160 MB | on | 60 fps | 128 px |

Two things do the real work: `IconStore` is sized in **bytes** and evicts LRU
(Flutter's own `ImageCache` is sized in *images* and knows nothing about bytes),
and `cacheWidth` caps the decode itself — showing a 256px icon at 56px otherwise
costs twenty times the memory it needs to.

---

## What it is for

**A desktop assistant that runs on your machine and answers to you.** Not a
chat window. Something that can see your screen, hear you in your own language,
open and move your applications, and write code — without a subscription and
without your voice leaving the building.

Concretely, the things it is built to do:

| | |
|---|---|
| **Launch anything** | every installed app, indexed, searchable, keyboard-driven |
| **Manage windows** | enumerate, focus, snap, close — a real taskbar on Windows |
| **Watch the machine** | CPU, RAM, disk from kernel32, not a mock |
| **Hear you** | local Whisper, any language, offline |
| **Understand you** | intent extraction, so "chrome close cheyyu" is an instruction |
| **See** | the camera and the screen, through a vision model |
| **Write code** | a dedicated coder slot, with tools to run and debug it |
| **Look the part** | a skin engine and a HUD that does not look like a settings page |

And the thing it is built *not* to do: send your data anywhere.

---

## Honest limits

Four things, stated rather than hidden:

1. **Nothing here has been executed.** Every file parses — `node --check` on the
   JS, `flutter analyze` on the Dart. That is the whole of the verification. The
   Whisper path has never transcribed a word; the window manager has never
   enumerated a window; the intent extractor has never seen Telugu.

2. **The agent UI is reserved space, not a live agent.** The Flutter workspace
   has a panel for the chat but does not yet speak the bridge's protocol.
   Wiring those together is the next real piece.

3. **STT needs whisper.cpp installed.** It is not bundled. Without the binary
   and a model file, `POST /stt` says so specifically rather than failing
   silently.

4. **The window manager is Windows-only.** macOS and Linux get a favourites
   strip, which is what the dock was before it existed.
