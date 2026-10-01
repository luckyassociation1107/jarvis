import 'package:flutter/services.dart';

import 'window.dart';

/// The global hotkey.
///
/// This is the one part of the launcher that genuinely needs native code on
/// every platform, and it is the part most likely to need adjusting on your
/// machine:
///
///   Windows  RegisterHotKey in the Win32 message loop  — implemented, see
///             windows/runner/main.cpp
///   macOS    an NSEvent global monitor                  — needs a Swift/ObjC
///             event tap, and an Accessibility permission prompt
///   Linux    XGrabKey on the root window                — needs an X11
///             connection; Wayland has no global hotkeys at all, by design
///
/// The Dart side is the same everywhere: one method channel, one method. So
/// wiring up a new platform is a native patch and nothing else.
///
/// Until then the launcher is fully usable without it — `--show` on the command
/// line, or bound to a key in your desktop environment's own settings, does
/// exactly the same job.
abstract final class HotkeyService {
  static const _channel = MethodChannel('com.jarvis.launcher/hotkey');

  /// Registers the default chord, Alt+Space.
  ///
  /// Chosen because it is unused on every major platform by default and it is
  /// where the left hand already rests.
  static Future<bool> register() async {
    try {
      final ok = await _channel.invokeMethod<bool>('register', {
        'key': 'space',
        'modifiers': const ['alt'],
      });
      return ok ?? false;
    } on MissingPluginException {
      // No native implementation for this platform. Not an error — the launcher
      // works, it just has no global key.
      return false;
    } on PlatformException {
      return false;
    }
  }

  /// Called from native when the chord fires.
  ///
  /// Registered once, from main, because the platform side sends the event on
  /// the main thread and there is no other sensible place to put the handler.
  static void bindToggle() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'pressed') {
        await JarvisWindow.show();
      }
      return null;
    });
  }
}
