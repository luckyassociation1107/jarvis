import 'dart:io';

import 'package:flutter/services.dart';

import '../models/app_entry.dart';

/// Starts an app.
///
/// Three of the four platforms need no native code at all:
///
///   macOS   `open <bundle>`          — the OS does the rest
///   Linux   the `.desktop` Exec line — already parsed and cleaned
///   Windows `start <shortcut>`       — resolves the target itself
///
/// Which is why the `.lnk` is never parsed on Windows: `start` already knows
/// how to read a shell link, so parsing it here would be reimplementing the
/// shell to save a process spawn.
///
/// Android is the exception and needs the Kotlin side, because launching is an
/// Intent and an Intent is not a command line.
abstract final class Launcher {
  static const _channel = MethodChannel('com.jarvis.launcher/apps');

  /// Starts [entry]. Throws [LaunchException] with something a human can read.
  static Future<void> launch(AppEntry entry) async {
    try {
      switch (entry.platform) {
        case AppPlatform.android:
          await _channel.invokeMethod<void>('launch', {'id': entry.exec});
        case AppPlatform.macos:
          // `open` is the only correct way. Running the binary inside the
          // bundle directly bypasses the app's own environment and often
          // fails in confusing ways.
          await _spawn('open', [entry.exec]);
        case AppPlatform.linux:
          // The Exec line, already stripped of field codes.
          await _spawnShell(entry.exec);
        case AppPlatform.windows:
          await _spawnShell('start "" "${entry.exec}"');
      }
    } on ProcessException catch (e) {
      throw LaunchException('Could not start ${entry.name}: ${e.message}');
    } on PlatformException catch (e) {
      throw LaunchException('Could not start ${entry.name}: ${e.message}');
    }
  }

  /// Runs a command without waiting and without keeping a handle.
  ///
  /// `detached` matters: a launcher that stays alive holding the child's stdout
  /// open will keep the child's pipe alive too, and some apps hang on exit
  /// waiting for a reader that never comes.
  static Future<void> _spawn(String command, List<String> args) async {
    await Process.start(
      command,
      args,
      mode: ProcessStartMode.detached,
      runInShell: false,
    );
  }

  /// Runs a command line through the shell.
  ///
  /// Needed for Windows `start`, and for Linux `Exec` lines that contain shell
  /// syntax the desktop spec permits — env prefixes, quoted arguments, and
  /// occasionally a real pipe.
  static Future<void> _spawnShell(String commandLine) async {
    if (Platform.isWindows) {
      await Process.start(
        'cmd',
        ['/c', commandLine],
        mode: ProcessStartMode.detached,
      );
    } else {
      await Process.start(
        '/bin/sh',
        ['-c', commandLine],
        mode: ProcessStartMode.detached,
      );
    }
  }
}

class LaunchException implements Exception {
  const LaunchException(this.message);

  final String message;

  @override
  String toString() => message;
}
