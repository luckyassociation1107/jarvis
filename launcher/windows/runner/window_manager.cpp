// Native window management for the JARVIS workspace. See window_manager.h.
//
// Plain Win32, no Flutter. Everything here is a thin, honest wrapper over the
// API: there is no cleverness to hide and no state to keep, which is why each
// function is short.

#include "window_manager.h"

#include <windows.h>

#include <algorithm>
#include <string>

namespace jarvis {
namespace {

// The callback EnumWindows needs, which cannot be a lambda with captures. The
// context pointer carries the output vector.
BOOL CALLBACK EnumProc(HWND hwnd, LPARAM param) {
  auto* out = reinterpret_cast<std::vector<WindowInfo>*>(param);

  // Invisible windows: splash screens mid-construction, cloaked UWP hosts,
  // message-only windows. None of them belong in a taskbar.
  if (!IsWindowVisible(hwnd)) return TRUE;

  // Tool windows are the floating palettes and IME candidates that an
  // application owns but does not want in the alt-tab list. The shell hides
  // them for exactly the same reason.
  const LONG_PTR ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if (ex & WS_EX_TOOLWINDOW) return TRUE;

  const int len = GetWindowTextLengthW(hwnd);
  if (len <= 0) return TRUE;  // Untitled: a background helper, not a window.

  // Owned windows are dialogs. Their owner is the real window, and listing both
  // puts a duplicate in the dock.
  if (GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;

  WindowInfo info;
  info.id = reinterpret_cast<std::int64_t>(hwnd);

  wchar_t title[512] = {};
  GetWindowTextW(hwnd, title, 512);
  info.title = title;

  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  info.pid = static_cast<std::int32_t>(pid);

  // PROCESS_QUERY_LIMITED_INFORMATION rather than PROCESS_QUERY_INFORMATION:
  // the full flag fails on elevated and protected processes, which is precisely
  // the set most likely to be running on a desktop.
  if (HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)) {
    wchar_t path[MAX_PATH] = {};
    DWORD size = MAX_PATH;
    if (QueryFullProcessImageNameW(proc, 0, path, &size)) {
      std::wstring full(path, size);
      const size_t slash = full.find_last_of(L"\\/");
      info.process = slash == std::wstring::npos ? full : full.substr(slash + 1);
    }
    CloseHandle(proc);
  }
  if (info.process.empty()) info.process = L"unknown";

  info.minimized = IsIconic(hwnd) != 0;
  info.maximized = IsZoomed(hwnd) != 0;
  info.focused = GetForegroundWindow() == hwnd;

  out->push_back(std::move(info));
  return TRUE;
}

HWND AsHwnd(std::int64_t id) {
  return reinterpret_cast<HWND>(id);
}

// IsWindow is the guard that makes every function safe to call with a stale id.
// A window that closed has a recycled handle, and acting on it would hit
// whatever now owns that address.
bool Alive(std::int64_t id) {
  return id != 0 && IsWindow(AsHwnd(id));
}

bool RectForWorkArea(HWND hwnd, RECT* out) {
  // The work area, not the screen: the taskbar is not somewhere you can put a
  // window, and snapping a window under it looks like a bug.
  HMONITOR mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  MONITORINFO mi = {};
  mi.cbSize = sizeof(mi);
  if (!GetMonitorInfoW(mon, &mi)) return false;
  *out = mi.rcWork;
  return true;
}

}  // namespace

std::vector<WindowInfo> EnumerateWindows() {
  std::vector<WindowInfo> out;
  EnumWindows(EnumProc, reinterpret_cast<LPARAM>(&out));
  // EnumWindows order is z-order, which is meaningful but unstable across
  // calls. Sorting by title makes the dock stop shuffling every refresh.
  std::sort(out.begin(), out.end(), [](const WindowInfo& a, const WindowInfo& b) {
    return a.title < b.title;
  });
  return out;
}

bool FocusWindow(std::int64_t id) {
  if (!Alive(id)) return false;
  HWND hwnd = AsHwnd(id);

  // A minimized window restored while still in the background flashes in the
  // taskbar instead of appearing. Restoring first is what makes it show up.
  if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);

  // SetForegroundWindow refuses when the calling process does not own the
  // foreground. The AttachThreadInput trick borrows the foreground thread's
  // input queue, which is the documented way round it. It is also the reason
  // this cannot be done from Dart: the thread has to be the one that calls.
  DWORD foreground_thread = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
  DWORD this_thread = GetCurrentThreadId();
  if (foreground_thread != this_thread) {
    AttachThreadInput(foreground_thread, this_thread, TRUE);
    SetForegroundWindow(hwnd);
    SetActiveWindow(hwnd);
    AttachThreadInput(foreground_thread, this_thread, FALSE);
  } else {
    SetForegroundWindow(hwnd);
  }
  return true;
}

bool MinimizeWindow(std::int64_t id) {
  if (!Alive(id)) return false;
  return ShowWindow(AsHwnd(id), SW_MINIMIZE) != 0;
}

bool MaximizeWindow(std::int64_t id) {
  if (!Alive(id)) return false;
  return ShowWindow(AsHwnd(id), SW_MAXIMIZE) != 0;
}

bool RestoreWindow(std::int64_t id) {
  if (!Alive(id)) return false;
  return ShowWindow(AsHwnd(id), SW_RESTORE) != 0;
}

bool CloseWindow(std::int64_t id) {
  if (!Alive(id)) return false;
  // WM_CLOSE rather than WM_DESTROY: it asks the application to close, which
  // lets it prompt to save. Terminating the process would be faster and would
  // lose work.
  PostMessageW(AsHwnd(id), WM_CLOSE, 0, 0);
  return true;
}

bool MoveWindowTo(std::int64_t id, int x, int y, int width, int height) {
  if (!Alive(id)) return false;
  return SetWindowPos(AsHwnd(id), nullptr, x, y, width, height,
                      SWP_NOZORDER | SWP_NOACTIVATE) != 0;
}

bool GetWorkAreaFor(std::int64_t id, int* x, int* y, int* width, int* height) {
  if (!Alive(id)) return false;
  RECT r = {};
  if (!RectForWorkArea(AsHwnd(id), &r)) return false;
  if (x) *x = r.left;
  if (y) *y = r.top;
  if (width) *width = r.right - r.left;
  if (height) *height = r.bottom - r.top;
  return true;
}

bool SnapWindow(std::int64_t id, SnapPosition position) {
  if (!Alive(id)) return false;
  HWND hwnd = AsHwnd(id);

  RECT r = {};
  if (!RectForWorkArea(hwnd, &r)) return false;

  const int w = r.right - r.left;
  const int h = r.bottom - r.top;
  const int hw = w / 2;
  const int hh = h / 2;
  const int qw = w / 4;
  const int qh = h / 4;

  int x = r.left, y = r.top, width = w, height = h;

  switch (position) {
    case SnapPosition::kLeftHalf:    width = hw; height = h; break;
    case SnapPosition::kRightHalf:   x = r.left + hw; width = hw; height = h; break;
    case SnapPosition::kTopHalf:     height = hh; break;
    case SnapPosition::kBottomHalf:  y = r.top + hh; height = hh; break;
    case SnapPosition::kTopLeft:     width = hw; height = hh; break;
    case SnapPosition::kTopRight:    x = r.left + hw; width = hw; height = hh; break;
    case SnapPosition::kBottomLeft:  y = r.top + hh; width = hw; height = hh; break;
    case SnapPosition::kBottomRight:
      x = r.left + hw; y = r.top + hh; width = hw; height = hh; break;
    case SnapPosition::kMaximize:
      // Restore first: ShowWindow(SW_MAXIMIZE) on an already-maximized window
      // is a no-op, and on a minimized one it restores without maximizing.
      ShowWindow(hwnd, SW_RESTORE);
      ShowWindow(hwnd, SW_MAXIMIZE);
      return true;
    case SnapPosition::kCenter: {
      // Two thirds of the work area, centred. Not a half — a centred window
      // that fills the screen is just maximized with extra steps.
      width = (w * 2) / 3;
      height = (h * 2) / 3;
      x = r.left + (w - width) / 2;
      y = r.top + (h - height) / 2;
      break;
    }
  }

  // A restored window cannot be positioned while it is still zoomed.
  if (IsZoomed(hwnd)) ShowWindow(hwnd, SW_RESTORE);
  return SetWindowPos(hwnd, nullptr, x, y, width, height,
                      SWP_NOZORDER | SWP_NOACTIVATE) != 0;
}

}  // namespace jarvis
