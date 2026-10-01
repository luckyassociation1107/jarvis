// Native window management for the JARVIS workspace.
//
// The launcher's own README says plainly that Flutter cannot see, move or
// composite other applications' windows. That is true of Dart, and it is why
// this file exists: everything below is plain Win32, with no Flutter dependency,
// so it can be dropped into the generated runner the same way hotkey.cpp is.
//
// The split matters. window_manager.cpp knows about HWNDs and nothing else; the
// runner owns the MethodChannel and translates between Win32 and Dart values.
// Keeping them apart means this file can be tested with a plain C++ harness and
// the channel plumbing can change without touching any of the logic.
//
// Every function returns a bool. A window can vanish between the moment it is
// listed and the moment you act on it — the user closed it, or it is a
// shell window mid-teardown — and that is a normal outcome, not an error. The
// Dart side decides whether a false is worth telling the user about.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace jarvis {

// One top-level window, as much of it as is worth knowing.
struct WindowInfo {
  // The HWND as an integer. Not a handle wrapper: it crosses a platform channel
  // as a number and comes back as one, and anything else would need a map from
  // Dart ids to live handles that goes stale the moment a window closes.
  std::int64_t id = 0;
  std::wstring title;
  std::wstring process;      // e.g. "chrome.exe"
  std::int32_t pid = 0;
  bool minimized = false;
  bool maximized = false;
  bool focused = false;
};

// Where a window should be snapped to, in eighths of the work area.
enum class SnapPosition {
  kLeftHalf,
  kRightHalf,
  kTopHalf,
  kBottomHalf,
  kTopLeft,
  kTopRight,
  kBottomLeft,
  kBottomRight,
  kMaximize,
  kCenter,
};

// Every visible, titled, non-tool top-level window.
//
// Filtering is the whole job here. A raw EnumWindows walk returns dozens of
// invisible and tool windows per application, and a taskbar full of them is
// worse than no taskbar.
std::vector<WindowInfo> EnumerateWindows();

// Bring a window to the front. The usual caveats about SetForegroundWindow and
// foreground lock apply; see the comment in the .cpp.
bool FocusWindow(std::int64_t id);

bool MinimizeWindow(std::int64_t id);
bool MaximizeWindow(std::int64_t id);
bool RestoreWindow(std::int64_t id);
bool CloseWindow(std::int64_t id);

// Move and resize, in physical pixels, relative to the primary work area.
bool MoveWindowTo(std::int64_t id, int x, int y, int width, int height);

// Snap to a region of the work area.
bool SnapWindow(std::int64_t id, SnapPosition position);

// The work area of the monitor a window is on, in physical pixels.
// Returns false if the window is gone.
bool GetWorkAreaFor(std::int64_t id, int* x, int* y, int* width, int* height);

}  // namespace jarvis
