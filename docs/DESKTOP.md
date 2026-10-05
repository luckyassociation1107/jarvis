# J.A.R.V.I.S. as a Windows application (.exe)

The normal way to run JARVIS is `npm start` in a source checkout: Node, a
terminal, and Chrome for the wake word. That is a fine way to run it if you
write software. This document is about the other way — a downloaded installer,
an icon, and no terminal at all.

Nothing about the intelligence changes. The installer ships the same
`bridge/server.mjs`, the same `dist/` interface, and the same one-click model
installer. What it adds is a shell for people who do not have Node and should
not have to get it: a window, a tray icon, microphone permission, and a way to
quit.

---

## Getting the installer

The installer is built by GitHub Actions — [`.github/workflows/installer.yml`](../.github/workflows/installer.yml)
— not committed to the repository, because it is a hundred-megabyte file of
somebody else's Electron runtime and there is no version of that which belongs
in git.

**Download it:**

1. Open the repository's **Actions** tab.
2. Run **Build Windows installer** (it also runs on pushes to any branch and
   on pull requests that touch the app).
3. Open the newest green run and download the artifact
   **`JARVIS-Windows-Installer`**. Inside is `JARVIS-Setup-1.0.0-x64.exe`.

**Or, on a version tag** (`git tag v1.0.0 && git push --tags`), the workflow
attaches the same file to the GitHub release, so users can download it without
an account:

```
https://github.com/luckyassociation1107/jarvis/releases/latest
```

**Or build it yourself** on a Windows machine with Node 20+:

```powershell
npm ci
npm run dist          # builds the interface, then the installer
# → release\JARVIS-Setup-1.0.0-x64.exe

npm run dist:dir      # unpacked folder instead, for a quick look
# → release\win-unpacked\JARVIS.exe
```

---

## What the installer does

An assisted NSIS installer, which means it shows its work:

- **Per-user by default** — installs to `%LOCALAPPDATA%\Programs\JARVIS`, no
  administrator prompt, no system-wide changes. It can be switched to a
  machine-wide install on the installer's first page.
- Creates a **desktop shortcut** and a **Start Menu entry** (`J.A.R.V.I.S.`).
- Registers an **uninstaller** in *Apps & features* / *Add or Remove Programs*
  under "J.A.R.V.I.S. (local AI assistant)".
- Offers to **run the app when you finish**. The app also registers itself to
  start with Windows on first launch, hidden in the tray, so "Hey Jarvis" works
  without launching anything. The tray menu has a checkbox to turn that off.

The app itself will **not** ask for administrator rights. It writes nothing
outside its own install and data folders.

### Windows will warn you the first time

The build is not code-signed: there is no certificate in this repository, and a
certificate costs money every year. So SmartScreen shows *"Windows protected
your PC"* on first run. **More info → Run anyway** is the expected path. If you
have an EV/OV certificate, add it to `package.json` under `build.win`
(`certificateFile` + `certificatePassword`) or set `CSC_LINK`/`CSC_KEY_PASSWORD`
in the workflow, and the warning goes away for your users too.

---

## The first launch

1. The window opens on the HUD. There is no model yet, so JARVIS can see you
   and hear you but cannot think.
2. Because the stack is incomplete, the **model setup** window opens once. It
   is the same page `npm start` and `npm run setup` open — press the button and
   it downloads the model runtime (Ollama's standalone build, no installer, no
   admin) plus the largest model stack this machine's RAM can hold, into the
   app's own data folder.
3. When the download finishes, the runtime is started and the interface starts
   answering. No restart needed; the HUD reconnects on its own.

The setup window is always reachable afterwards from the tray
(**Model setup…**) and from the interface's **MODEL STACK** panel.

---

## Where everything lives

| What | Where |
| --- | --- |
| The app | `%LOCALAPPDATA%\Programs\JARVIS` (per-user install) |
| Models, runtime, memory, screenshots | `%LOCALAPPDATA%\JARVIS\models` |
| Settings | `%LOCALAPPDATA%\JARVIS\desktop-settings.json` |
| Logs (everything the brain printed) | `%LOCALAPPDATA%\JARVIS\logs\desktop.log` |

The install folder and the data folder are separate, on purpose. An upgrade can
replace or move the install folder, and a machine-wide install under
`Program Files` is not writable by a normal account at all — neither is a
reason to make someone download eight gigabytes again. The install folder
(`<install folder>\data`) is only the fallback, for the improbable case where
local app data cannot be written.

In a source checkout, `npm run desktop` uses the repository itself as the data
folder, so it shares `models/` with `npm start` instead of downloading
everything twice.

Everything the app creates is under the one data folder. Uninstalling removes
the application and leaves that folder alone — the uninstaller deliberately
does not delete your models and your memory, because "uninstall" should not
silently mean "download 8 GB again". Delete `%LOCALAPPDATA%\JARVIS` by hand to
reclaim the space.

---

## The tray menu

| Item | What it does |
| --- | --- |
| Open J.A.R.V.I.S. | Shows the window (also a single click on the tray icon) |
| Model setup… | The one-click model installer window |
| Let JARVIS take actions (writes) | Turns on shell/file/device tools, the desktop equivalent of `npm start -- --writes`. Off by default; the bridge restarts itself when you flip it |
| Start with Windows | Login item, with `--hidden` so it lands in the tray |
| Close window quits | Default off — closing the window keeps him listening |
| Open logs / Open data folder | Opens the two folders above |
| Developer tools / Restart / Quit | The obvious things |

Closing the window does not quit; **Quit J.A.R.V.I.S.** in the tray does. Quitting
stops the bridge *and* the model server it started, so nothing is left holding
several gigabytes of RAM after you are done.

---

## Voice, and the one honest limitation

The installer's window is Chromium. Chromium does not include Google's speech
service, so `SpeechRecognition` — the API the browser path uses for the wake
word — is present in the page and never answers. This is not a bug in this
repository and cannot be fixed in this repository: it is the same reason no
Electron app has working `webkitSpeechRecognition` without a Google API key.

What this app does about it:

- With `VITE_STT_ENGINE=auto` (the default), the HUD asks the bridge whether the
  **local** speech stack is ready before choosing an engine. If the
  multilingual Whisper runtime and model are installed, speech input runs on
  your machine — no Google, nothing leaving the computer, and it works offline.
  The setup page installs that stack when RAM allows.
- If it is not installed, the interface falls back to the browser recogniser,
  which in this window will not work, and the HUD says so instead of pretending
  the microphone is alive.

So: **install the local speech stack** (it is part of the one-click setup, and
listed in the MODEL STACK panel), and voice works inside the app. If you would
rather keep voice on the browser's own recogniser, `npm start` plus Chrome or
Edge remains the fully-featured path — the desktop app is the same product with
a smaller blast radius and no terminal.

Everything else in the app — the interface, tools, panels, models, memory — is
identical between the two paths.

---

## What is and is not supervised

The shell keeps the assistant alive rather than relaying failures:

- **The bridge is restarted** if it dies unexpectedly (four times in two
  minutes, then it stops trying and explains itself).
- **The window is reloaded** if the renderer crashes; the bridge and the models
  never went anywhere.
- **A second launch** focuses the running window instead of starting a second
  copy, a second bridge and a second model server.
- **A bridge already running on port 8787** (your own `npm start` session, say)
  is used rather than fought over. The HUD's port range is inside the range that
  bridge already trusts.

There is no auto-update. Each release is a new installer; install it over the
old one and your models stay where they are.

---

## Why this pipeline, and not the other two that were tried

This branch's history contains two earlier attempts at the same goal, both of
which were removed once this one worked. Recording why, so nobody has to
re-derive it from a diff:

| Attempt | Why it is not the one |
| --- | --- |
| `.github/workflows/build-exe.yml` + `installer/jarvis.iss` — download a portable Node.js, copy `dist`, `bridge` and `scripts` by hand, `npm install --production` inside the copy, compile with Inno Setup | Ships a second Node runtime inside the app (~300 MB, ~10 minutes per build), a `.bat` launcher rather than an application, and a shortcut that opens a browser tab. It is the right starting point for a *fully offline, everything-included* distribution — this is deliberately not that |
| `.github/workflows/windows-installer.yml` + `desktop/main.cjs` — an earlier, shorter Electron shell with its own workflow | The right idea, missing most of what makes it an application rather than a window: no tray, no supervision, no self-test, no permission policy beyond `media`, no code-signing path, and two workflows claiming to build the same artifact |
| Squirrel / electron-updater | Needs an update server and a signed feed to be honest about updates. This app has no auto-update: each release is a new installer |
| A single self-contained `.exe` (pkg/nexe-style) | The interface is a WebGL page and the brain is a long-lived process that starts a model server. A single-file binary would have to explode itself into a temp folder at every launch, and gains nothing over an installer that writes to a real folder once |

The pipeline that survives earns its place the same way the rest of this
repository does: it does the honest thing and shows its work. `installer.yml`
verifies the build on Linux, then on Windows packages it, then **runs the
packaged application** and fails the run if it cannot serve the interface, start
the bridge, or accept its own window's WebSocket origin. Nothing is published
until that passes.

---

## The icon

`desktop/icon.png` (512×512, transparent corners) is the master;
`desktop/icon.ico` is generated from it and committed, because electron-builder
needs the multi-resolution `.ico` at build time and cannot make one. To redo it
after changing the artwork, on any machine with ImageMagick:

```bash
convert desktop/icon.png -define icon:auto-resize=256,128,64,48,32,24,16 desktop/icon.ico
```

`npm run test:desktop` checks that the committed `.ico` still has all seven
sizes and still contains a 256px image — the failure it prevents arrives three
minutes into a build on a Windows runner otherwise.

---

## Troubleshooting

**The window is open but JARVIS never answers.**
No model is reachable. Tray → *Model setup…* → install, then watch the log
(tray → *Open logs*): the bridge prints one line per slot it cannot reach.

**The window is blank.**
The interface files are missing from the install. Reinstall; the packaged
self-test in CI exists precisely to catch this before you do.

**What exit codes does `JARVIS.exe --self-test` use?**
`0` all checks passed, `1` a check failed (the last line of
`%LOCALAPPDATA%\JARVIS\logs\desktop.log` names it), `2` the run exceeded its
watchdog (`JARVIS_SELF_TEST_TIMEOUT_MS`, 240 s by default) and `3` an exception
escaped — the app logs and exits instead of showing a dialog, because a dialog
in CI sits there until the job times out. The workflow gives the whole run six
minutes, prints the log as it grows, and kills what is left over.

**Nothing happens when I say "Hey Jarvis".**
See *Voice* above: the local speech stack has to be installed for speech input
inside the app window.

**How do you know the AI can actually do something, not just talk?**
Two layers. The packaged self-test (`JARVIS.exe --self-test`) proves the window,
the interface server and the bridge handshake work without a model at all. The
live self-test (`npm run test:live`, run by the *Live model self-test* CI job)
proves the model half: it installs the runtime, pulls the weights the RAM
planner picked, prompts them, and then starts the **real bridge** with the
acting tools on, connects to it over its own socket and has the AI work in a
session — it greets, it is told a codeword and asked it back, and it is asked
to run `echo BANANA>live-proof.txt` through `mcp__jarvis_shell__run_command`.
The check reads the file off the disk; whether the model says it did the job
counts for nothing.

Which checks decide the verdict is a deliberate split: the ones about the
application — the servers joining, the bridge answering over its socket —
gate it, and the ones about model behaviour (recalling the word, choosing the
tool) are reported next to them. A 2B rung can pass every wiring check and
still word-find badly; that is worth reading in the transcript, not worth
calling a broken install. The work turn is tried twice, once with thinking
off and once under the app's own configuration, because the two fail
differently, and the report names the one that acted. The transcript is written to `models/live-test-report.txt`
and published as a check annotation on the run, so the answer is readable
without downloading anything.

**Something is wrong and I want to know what.**
`%LOCALAPPDATA%\JARVIS\logs\desktop.log` has the whole startup, every model
the bridge tried to reach, and every reason it gave. The tray opens it
directly.

**I want to run it from source, like a developer.**

```powershell
npm ci
npm run desktop           # Electron, reading the repo as its data folder
npm run desktop:writes    # …with the acting tools enabled
```
