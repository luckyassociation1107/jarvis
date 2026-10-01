#include "hotkey.h"

#include <windows.h>

namespace {

// Any non-zero id. It only has to be unique among this window's hotkeys, of
// which there is one.
constexpr int kHotkeyId = 1;

// MOD_NOREPEAT matters: without it, holding Alt+Space fires the message over
// and over while the key is down, and the window flickers.
constexpr UINT kModifiers = MOD_ALT | MOD_NOREPEAT;
constexpr UINT kVirtualKey = VK_SPACE;

HWND g_window = nullptr;
bool g_registered = false;

}  // namespace

bool RegisterJarvisHotkey(void* window_handle) {
  if (window_handle == nullptr) return false;

  g_window = static_cast<HWND>(window_handle);
  if (g_registered) return true;

  // RegisterHotKey is a thread-level registration tied to the window's message
  // queue, so it must be called from the thread that created the window.
  if (!RegisterHotKey(g_window, kHotkeyId, kModifiers, kVirtualKey)) {
    return false;
  }

  g_registered = true;
  return true;
}

void UnregisterJarvisHotkey() {
  if (g_registered && g_window != nullptr) {
    UnregisterHotKey(g_window, kHotkeyId);
  }
  g_registered = false;
  g_window = nullptr;
}
