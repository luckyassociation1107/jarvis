import 'dart:io';

// material, not just foundation: Size and Color come from painting, and
// reaching for dart:ui for them is a needless import.
import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

/// Owns the desktop window.
///
/// This is a **workspace**, not a launcher palette, so the window is shaped completely
/// differently: full-screen, no chrome, and it does not float. The whole point
/// is that it becomes the surface you work on rather than a panel over it.
///
/// On Android this class is inert — there is no window to own, and calling any
/// of it would throw. Every method is a no-op there, which is why the platform
/// checks live inside the class rather than at every call site.
abstract final class JarvisWindow {
  static bool _ready = false;

  /// The workspace size. Overridable so a smaller window is usable for testing
  /// the layout without filling a 4K display.
  static double get width => double.tryParse(
        Platform.environment['JARVIS_WORKSPACE_WIDTH'] ?? '',
      ) ??
      1440;

  static double get height => double.tryParse(
        Platform.environment['JARVIS_WORKSPACE_HEIGHT'] ?? '',
      ) ??
      900;

  /// Must be awaited before any other call, and only on desktop.
  static Future<void> init() async {
    if (Platform.isAndroid || Platform.isIOS) return;

    await windowManager.ensureInitialized();
    _ready = true;

    await windowManager.setSize(Size(width, height));
    await windowManager.center();

    // NOT always-on-top. A workspace that floats above everything is a
    // launcher palette, and that is what this is not.
    await windowManager.setAlwaysOnTop(false);
    await windowManager.setResizable(true);
    await windowManager.setMinimizable(true);
    await windowManager.setMaximizable(true);
    // No title bar and no border: the HUD draws its own frame, and a native
    // title bar over a holographic UI is the fastest way to make it look like
    // a web page in a window.
    await windowManager.setTitleBarStyle(TitleBarStyle.hidden);
    // Full-screen by default, because a workspace in a window is a browser tab.
    await windowManager.setFullScreen(true);
    await windowManager.setBackgroundColor(const Color(0xFF01060C));
  }

  /// Shows and focuses the workspace.
  static Future<void> show() async {
    if (!_ready) return;
    await windowManager.show();
    await windowManager.focus();
  }

  static Future<void> hide() async {
    if (!_ready) return;
    await windowManager.hide();
  }

  /// Leaves full-screen, for when you want your real desktop back.
  static Future<void> setWindowed() async {
    if (!_ready) return;
    await windowManager.setFullScreen(false);
    await windowManager.setSize(Size(width, height));
    await windowManager.center();
  }

  static Future<void> setFullScreen() async {
    if (!_ready) return;
    await windowManager.setFullScreen(true);
  }

  static Future<void> close() async {
    if (!_ready) return;
    await windowManager.close();
  }
}
