import 'dart:io';

import 'package:flutter/services.dart';

/// A top-level window belonging to another application.
///
/// This is the piece the launcher's README said was impossible, and it is worth
/// being precise about why that was wrong: *Dart* cannot see other windows. A
/// native Win32 module can, and `windows/runner/window_manager.cpp` is that
/// module. The distinction matters because it is the difference between "Flutter
/// can't do this" and "Flutter alone can't do this."
class ManagedWindow {
  const ManagedWindow({
    required this.id,
    required this.title,
    required this.process,
    required this.pid,
    this.minimized = false,
    this.maximized = false,
    this.focused = false,
  });

  /// The native window handle, as an integer.
  ///
  /// Not a wrapper object, because it crosses a channel as a number and comes
  /// back as one. Anything else would need a Dart-side map from ids to live
  /// handles that goes stale the moment a window closes.
  final int id;
  final String title;
  final String process;
  final int pid;
  final bool minimized;
  final bool maximized;
  final bool focused;

  static ManagedWindow fromJson(Map<dynamic, dynamic> json) => ManagedWindow(
        id: (json['id'] as num).toInt(),
        title: json['title'] as String? ?? '',
        process: json['process'] as String? ?? '',
        pid: (json['pid'] as num?)?.toInt() ?? 0,
        minimized: json['minimized'] as bool? ?? false,
        maximized: json['maximized'] as bool? ?? false,
        focused: json['focused'] as bool? ?? false,
      );
}

/// Where a window can be snapped.
enum Snap {
  leftHalf,
  rightHalf,
  topHalf,
  bottomHalf,
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  maximize,
  center;

  String get wire => switch (this) {
        Snap.leftHalf => 'leftHalf',
        Snap.rightHalf => 'rightHalf',
        Snap.topHalf => 'topHalf',
        Snap.bottomHalf => 'bottomHalf',
        Snap.topLeft => 'topLeft',
        Snap.topRight => 'topRight',
        Snap.bottomLeft => 'bottomLeft',
        Snap.bottomRight => 'bottomRight',
        Snap.maximize => 'maximize',
        Snap.center => 'center',
      };
}

/// Native window management, over a platform channel.
///
/// Windows only. Every other platform reports [supported] as false and every
/// method returns false or an empty list rather than throwing, because a dock
/// that crashes on macOS is worse than a dock that is empty there.
class WindowManager {
  const WindowManager._();

  static const _channel = MethodChannel('com.jarvis.launcher/windows');

  /// Cached because Platform.isWindows does not change while the process lives,
  /// and this is read on every dock build.
  static bool? _supported;

  static bool get supported => _supported ??= Platform.isWindows;

  /// Every visible, titled, non-tool window, sorted by title.
  static Future<List<ManagedWindow>> list() async {
    if (!supported) return const [];
    try {
      final raw = await _channel.invokeListMethod<dynamic>('list');
      return (raw ?? const [])
          .cast<Map<dynamic, dynamic>>()
          .map(ManagedWindow.fromJson)
          .toList();
    } on MissingPluginException {
      return const [];
    }
  }

  static Future<bool> focus(int id) => _call('focus', {'id': id});
  static Future<bool> minimize(int id) => _call('minimize', {'id': id});
  static Future<bool> maximize(int id) => _call('maximize', {'id': id});
  static Future<bool> restore(int id) => _call('restore', {'id': id});
  static Future<bool> close(int id) => _call('close', {'id': id});
  static Future<bool> snap(int id, Snap position) =>
      _call('snap', {'id': id, 'position': position.wire});

  /// True when the call succeeded.
  ///
  /// False is a normal outcome, not an error: the window can vanish between the
  /// moment it is listed and the moment you act on it. The caller decides
  /// whether that is worth telling the user about.
  static Future<bool> _call(String method, Map<String, dynamic> args) async {
    if (!supported) return false;
    try {
      return await _channel.invokeMethod<bool>(method, args) ?? false;
    } on MissingPluginException {
      return false;
    }
  }
}
