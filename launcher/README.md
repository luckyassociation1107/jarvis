# J.A.R.V.I.S. Workspace

A full-screen desktop workspace for Windows, built in Flutter, that ships as a
single installable `jarvis.exe`.

It combines three things that are normally three separate products:

| | |
|---|---|
| **A launcher** | every installed application, indexed and searchable |
| **A skin engine** | Rainmeter-style widgets placed by a JSON skin file |
| **A character surface** | the panel slots a local agent/character chat will live in |

The third row is the honest part. Read [What this is not](#what-this-is-not)
before you install it, because it is short and it will save you an hour.

---

## Build it

```powershell
# 1. host scaffolding — you generate this, it is not in the repo
flutter create --project-name jarvis_launcher --platforms=android,windows,macos,linux --org com.jarvis .

# 2. restore the platform files the repo ships, which step 1 just overwrote
git checkout -- android/app/src/main/AndroidManifest.xml
git checkout -- android/app/src/main/kotlin/com/jarvis/jarvis_launcher/MainActivity.kt

# 3. build the .exe and the installer
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

`--org com.jarvis --project-name jarvis_launcher` puts the Kotlin package at
`com.jarvis.jarvis_launcher`, which is why `MainActivity.kt` lives there and not
under `com/jarvis/launcher/`. The method channel `com.jarvis.launcher/apps` is a
plain string and is unaffected by any of this.

`installer\build.ps1` runs `flutter pub get`, then
`flutter build windows --release`, then compiles `installer\jarvis.iss` with
Inno Setup. Output:

```
dist\jarvis-setup.exe          <- the installer
build\windows\x64\runner\Release\jarvis_launcher.exe   <- the portable exe
```

`--org com.jarvis` **must** match the channel name and the Kotlin package, or
the channel silently never connects and the app list comes back empty.

`--project-name jarvis_launcher` matters for a less obvious reason: without it
`flutter create` names the project after the directory, which is `launcher`, and
the exe comes out as `launcher.exe` while the installer script and the CI
artifact both expect `jarvis_launcher.exe`. The flag is what keeps those three
names in agreement.

### Tests

`test/workspace_test.dart` covers the pure-Dart logic — byte formatting and the
fuzzy matcher. No platform channel, no Flutter binding, so it runs anywhere.

`flutter create` also writes a `test/widget_test.dart` that pumps `MyApp`, which
this project does not have. Delete it, or the analyzer will fail forever:

```powershell
Remove-Item test\widget_test.dart
flutter test
```

The generated `AndroidManifest.xml` has no `QUERY_ALL_PACKAGES`. Without it,
Android 11+ returns an empty application list. That is why the file is copied
over rather than left as generated.

### Requirements

- Flutter SDK, targeting Windows
- [Inno Setup 6](https://jrsoftware.org/isdl.php) — only for the installer. The
  `.exe` runs without it.

---

## The palette

Lifted from the real JARVIS theme, not invented:

| token | value |
|---|---|
| interface | `#00E5FF` |
| background | `#01060C` |
| listening | `#19D8D2` |
| thinking | `#f0a93c` |
| tooling | `#a97bff` |
| speaking | `#3ef2a8` |
| alert | `#ff5a3c` |

Chakra Petish and JetBrains Mono are the web fonts the original uses. They are
**not bundled** — the type scale uses wide tracking on the platform sans/mono
instead, which reads close enough without shipping a font licence.

---

## Skins

A skin is a JSON file. It says which widgets exist, where they sit, and how big
they are. It cannot contain code.

```json
{
  "id": "my-skin",
  "name": "My Skin",
  "author": "you",
  "description": "Clock top-right, memory bottom-left.",
  "accent": "#00e5ff",
  "widgets": [
    { "kind": "clock", "x": 1080, "y": 24, "width": 280, "height": 120 },
    { "kind": "systemMonitor", "x": 24, "y": 640, "width": 300, "height": 220 },
    { "kind": "notes", "x": 348, "y": 640, "width": 320, "height": 220,
      "title": "SCRATCH" }
  ]
}
```

Positions are absolute logical pixels. That is the point — the author decided
the clock goes top-right, and a flow layout would rearrange it the moment the
window changed size.

Eight widgets ship: `clock`, `systemMonitor`, `calendar`, `notes`, `weather`,
`media`, `appList`, `reactor`. Seven skins ship. Switch between them from the
`SKIN` control in the top rail.

### Ported skins

Four of the seven are ported from real Rainmeter skins, with the palettes read
out of their `Variables.inc` and `Color/*.inc` rather than eyeballed:

| Skin | Source | What was taken |
|---|---|---|
| **Iron Man** | `iron-man-mark-7.rmskin` | `204,204,204` on black, shield-clipped icons |
| **Glass Shards** | `glass-shards.rmskin` | `0,255,255` cyan + `228,129,255` violet |
| **Neon Space** | `neon-space.rmskin` | `Cloudcolor=0,50,255` deep electric blue |
| **Shield OS** | `jarvis-shield-os.rmskin` | WP7 Metro, `ColorSkin=27,161,226`, square tiles |

The frost in Glass Shards is the one thing that did not port — a blur layer per
pane is a different rendering model, and faking it with a translucent fill looks
worse than not trying. The palette and the chamfer survived.

### Icons are wrapped, not pasted

Every application icon is clipped into the skin's shape, backed by the theme
surface, washed very slightly toward the accent, and framed with a border that
follows the same path plus corner brackets. Four shapes: `square`, `chamfer`,
`hexagon`, `shield`.

That 7% accent wash is what does the work. Windows hands you icons drawn for a
light background in a dozen different visual languages; a faint accent wash over
all of them is what makes the grid read as one instrument panel instead of a
folder of pictures.

A skin sets it with two fields:

```json
{
  "iconShape": "hexagon",
  "iconAccent": "#4d7cff"
}
```

### Writing your own

Drop a `.json` skin anywhere and load it with `Skin.load(path)`. Unknown widget
kinds render as `UNKNOWN WIDGET <kind>` in alert red rather than crashing the
skin — a skin that breaks on one bad entry is a skin that stops being edited.

### System stats are real

The `systemMonitor` widget reads actual kernel32 counters via `dart:ffi`:
`GlobalMemoryStatusEx`, `GetDiskFreeSpaceExW`, `GetSystemTimes`. CPU load is the
delta between two samples two seconds apart, which is why it shows `SAMPLING`
for the first two seconds rather than a fake `0%`.

It is **Windows-only**. On macOS and Linux the widget renders `SYSTEM STATS
WINDOWS ONLY` instead of zeros.

---

## The application index

- **Windows** — Start Menu `.lnk` files, launched via `cmd /c start`
- **macOS** — `.app` bundles, launched via `open`
- **Linux** — XDG `.desktop` files, `%u %F` stripped, icons resolved through the
  hicolor tree largest-first
- **Android** — PackageManager over a platform channel

Icons are extracted in pure Dart — `.ico` and `.icns` PNG element parsing, no
native code. `.lnk` `IconLocation` is read directly out of the shell link.

The index caches to `app-index.json` under the app support directory, versioned
so a format change invalidates it rather than crashing on load.

Search is a subsequence match scoring matches, consecutive runs and word
boundaries, so `vs` finds *Visual Studio* before *Svr*.

---

## Controls

| | |
|---|---|
| `Alt+Space` | summon / dismiss the workspace |
| `↑` `↓` | move through the grid |
| `Enter` | launch |
| `/` or type | filter |
| `Esc` | clear the filter |

`JARVIS_WORKSPACE_WIDTH` / `JARVIS_WORKSPACE_HEIGHT` override the window size.

---

## What this is not

Four things, stated plainly because the alternative is a support question.

1. **It is not a window manager.** Flutter cannot see, move or composite other
   applications' windows. The dock is a *favourites* strip, not a taskbar, and
   there is no window list. This is the single biggest gap between what this
   looks like and what it is.

2. **It is not the wallpaper.** A Flutter window cannot sit behind the desktop
   icons. This is a full-screen workspace you switch to, not a themed desktop
   you keep working on top of.

3. **No hosted agent marketplace.** A marketplace with billing needs a backend
   server, and a backend cannot ship inside an `.exe`. What exists is a local
   skin registry. The agent *engine* — memory, tools, multi-agent workflows —
   is buildable locally and is not built yet.

4. **No 3000-character library, no image or video generation.** Those need
   trained models and, realistically, someone's GPU bill. The character-chat
   panel is reserved and the app grid is what fills it for now.

Also missing, and deliberate: weather and media widgets are honest placeholders.
Reading the OS media session needs `Windows.Media.Control` over WinRT, which is
a native module per platform, and a weather widget that guesses is worse than
one that says it has no feed.

---

## Known rough edges

- No global hotkeys on Wayland. `Alt+Space` is registered through the platform
  and X11 only; on GNOME/Wayland it will not fire.
- Windows shows a console flash on launch from `cmd /c start`.
- First-run enumeration on Linux is slow with many Flatpaks installed.
- `.ico` files holding only BMP data, and old `.icns` with only raw ARGB
  elements, fall back to the monogram.
- `QUERY_ALL_PACKAGES` needs a Play declaration form before an Android release
  build will be accepted.

---

## Layout

```
lib/
  main.dart                  entry point
  models/app_entry.dart      AppEntry, AppPlatform
  platform/
    app_enumerator.dart      the four platform backends
    icons.dart               .ico / .icns / .lnk parsing, pure Dart
    launcher.dart            launch
    system_stats.dart        kernel32 via dart:ffi
  services/
    app_index.dart           cache + fuzzy search
    fuzzy.dart               the matcher
    hotkey.dart              global hotkey
    window.dart              full-screen frameless
  skins/
    skin.dart                the skin + widget spec model
    skins.dart               the three built-in skins
  theme/
    jarvis_theme.dart        palette, glow, type scale
    jarvis_painter.dart      scanlines, corner brackets, frame
  ui/
    workspace.dart           the screen
    skin_host.dart           renders a skin
    app_grid.dart  clock_readout.dart  dock.dart
    reactor.dart  search_field.dart
    widgets/
      widgets.dart           all eight widget bodies
      system_monitor.dart    the live bars
installer/
  jarvis.iss                 Inno Setup script
  build.ps1                  flutter build + ISCC
```

## No compiler here

The Flutter SDK is not installed in the environment this was written in, so
**none of this Dart has been compiled.** It has been checked for balanced
delimiters, unresolved symbols across files, dead imports, and the specific API
mistakes that have bitten this project before (`Focus.of` in `initState`,
`List.equals`, `dart:ui` vs `services.dart` imports). That is not the same as
building it. Expect to fix something on the first `flutter pub get`.
