// A global hotkey for the JARVIS launcher on Windows.
//
// Deliberately a small, self-contained module with no Flutter dependency: it
// takes a raw HWND and nothing else, so it can be dropped into the generated
// runner and wired up in three lines. See README.
#pragma once

// Registers Alt+Space as a system-wide hotkey owned by `window_handle`.
// Returns false if the chord is already taken — which is common, because
// several other launchers want the same key.
bool RegisterJarvisHotkey(void* window_handle);

// Releases it. Call before the window is destroyed; a hotkey left registered
// against a dead HWND leaks the chord until the process exits.
void UnregisterJarvisHotkey();
