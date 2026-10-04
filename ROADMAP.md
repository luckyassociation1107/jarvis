# Upgrades — what is in, and what is next

This is the honest ledger. Everything under **Done** is in the code with tests
behind it. Everything under **Next** is specified well enough to build, with the
reason it is not built yet stated plainly rather than dressed up.

## Done

### 1. One download, one click, from a downloaded folder

`START.cmd` — double-click it in the extracted folder and the whole thing
happens: Node is found or bootstrapped, `npm ci` installs from the lockfile, the
UI is built, the bridge and the HUD start, and the setup page opens. One button
on that page downloads the model runtime and the stack this machine fits.
Windows is the only target: the macOS and Linux launchers were removed with the
rest of the non-Windows code, and Linux remains only as the host the test suites
run on.

`START.cmd auto` (or `build.ps1 -Auto`) goes further: the fitting stack is
chosen by the same rule the page preselects, installed in the open, printed step
by step, and the assistant is usable when it finishes. That is the actual
one-click path.

### 2. The runtime downloads with resume and a checksum

`bridge/portable-runtime.mjs` resolves the Windows zip from the release's own
asset list (so a rename upstream cannot 404 an install), downloads it to a
`.part` file, resumes with a `Range` request when the connection drops, verifies
the SHA-256 the release publishes (or says `verified: false` when it publishes
none), and unpacks it in Node itself with a CRC check per entry — Windows has no
`unzip`. Covered by `npm run test:runtime` against a local mock release with a
Range server, a deliberately dropped connection, a corrupt checksum, a bad CRC
and a hostile entry.

### 3. AMD vs NVIDIA is a real choice, not a guess

The default build carries the NVIDIA CUDA libraries; AMD cards need the `-rocm`
archive. The page offers both with their real sizes, preselects ROCm only when
ROCm is actually present (`/opt/rocm`, `rocm-smi`), and the bridge accepts
`runtimeVariant: 'default' | 'rocm' | 'auto'`. `GET /autopilot/runtime` returns
the resolved list, cached for ten minutes because GitHub's API rate-limits.

### 4. The CLI is a first-class client

`npm run cli`: your messages, streamed replies, one line per execution, `/status`,
`/help`, Ctrl-C to interrupt then leave, and `--once` for scripts. It answers the
camera request a terminal cannot serve with the truth instead of hanging.

## Next

### 5. Per-model tool-call benchmark (highest value)

Small models call tools correctly maybe half the time, and the README says so.
`npm run bench` should run a fixed set of ten prompts (one per tool family)
against every installed rung, score tool selection + argument validity, and have
the planner prefer the rung with the best *measured* score inside the RAM
ceiling — not just the largest one that fits. Not built because it needs a live
model to be meaningful; a stub-model version would only prove the harness.

### 6. Constrained tool calling

Ollama supports a JSON schema on the request. Sending the tool schema as a
grammar would make malformed calls nearly impossible on the small rungs, which is
where they hurt. Needs a measurement first (5) to know how much of the failure it
removes, and a fallback path for endpoints that ignore `format`.

### 7. Local memory (RAG)

A small embedding model plus the existing RAM planner: index a folder the user
names, retrieve per turn, cite the file. The planner already serialises model
residency, so an embedding rung would have to be accounted for in the same
budget — that is the work, not the vector store.

### 8. Approval prompt and audit log for effectful actions

Write mode is one switch today: on or off. It should be "ask", with the ask
surfaced in the browser *and* the terminal, and every effectful call appended to
a log (time, tool, arguments, decision, result). The bridge already has the frame
protocol for the question; the HUD needs the dialog, and the CLI needs a y/n
prompt. Until then, write mode should stay off unless the user turned it on
deliberately.

### 9. Scheduled tasks

"Every morning at eight, summarise my notifications" needs a queue, a task
store and a rule for what happens when the machine is asleep. Worth doing after
(8), so a scheduled action has an approval story.

### 10. Phone / LAN access

The HUD is a static page plus a WebSocket; serving it to a phone on the same
network is a token, a TLS story and a narrower origin allowlist — not a rewrite.
It is left out of this round because it is the one change that widens exposure,
and it should land with (8) rather than before it.

### 11. Packaged desktop app

Tauri/Electron around the same bridge and HUD. The launchers above already make
the download-and-run path one click, so packaging is about polish (a dock icon,
an update channel), not about capability.
