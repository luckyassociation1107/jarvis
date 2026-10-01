import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// What the first run has to accomplish.
///
/// The brief: double-tap the installer, answer the permission prompts, and then
/// never think about this again. Everything below exists to make that one
/// sentence true.
///
/// The order is deliberate. Permissions first, because asking for auto-start
/// *after* the engine is running looks like a second install rather than a
/// finishing touch. Theme last, because it needs the engine's palette and there
/// is no point extracting one before anything is running.
enum SetupStep { permissions, engine, theme, done }

/// One thing the user was asked, and what they said.
@immutable
class PermissionResult {
  const PermissionResult(this.step, this.granted, {this.note});
  final SetupStep step;
  final bool granted;
  final String? note;
}

/// First-run orchestration.
///
/// Deliberately not a widget. This is the thing a widget calls, and keeping it
/// out of the tree means it can be driven from `main()` before the first frame
/// rather than from an `initState` that has already painted.
class Setup {
  const Setup._();

  static const _channel = MethodChannel('com.jarvis.launcher/setup');

  /// Run every step, asking as we go.
  ///
  /// Returns what was granted so the caller can explain the gaps. A step that
  /// fails is not fatal — an assistant that cannot auto-start is still an
  /// assistant — but it must be *reported*, because silently degraded is the
  /// same as broken from the outside.
  static Future<SetupReport> run({
    void Function(SetupStep step, String message)? onStep,
  }) async {
    final granted = <SetupStep>[];
    final notes = <String>[];

    for (final step in SetupStep.values) {
      if (step == SetupStep.done) break;
      onStep?.call(step, _labels[step]!);
      final ok = await _run(step);
      if (ok) {
        granted.add(step);
      } else {
        notes.add(_labels[step]!);
      }
    }
    return SetupReport(granted: granted, declined: notes);
  }

  static Future<bool> _run(SetupStep step) async {
    try {
      final ok = await _channel.invokeMethod<bool>(step.name);
      return ok ?? false;
    } on MissingPluginException {
      // Every platform but Windows falls back to the platform-appropriate
      // default, which is "no". Degrading rather than throwing is the whole
      // point of this being a channel rather than a direct call.
      return false;
    } on PlatformException catch (e) {
      debugPrint('setup ${step.name} failed: ${e.message}');
      return false;
    }
  }

  static const _labels = {
    SetupStep.permissions: 'Ask to start with the machine',
    SetupStep.engine: 'Start the engine and download its models',
    SetupStep.theme: 'Match the theme to your wallpaper',
  };
}

/// What happened, so the UI can be honest about it.
@immutable
class SetupReport {
  const SetupReport({required this.granted, required this.declined});
  final List<SetupStep> granted;
  final List<String> declined;

  bool get complete => granted.contains(SetupStep.theme);
}

/// The theme, matched to the wallpaper.
///
/// Automatic theming is the piece that makes an install feel like *yours*
/// without any configuration, and it is a colour problem, not a ML one: pull the
/// dominant colours out of the wallpaper and pick the accent that has the most
/// contrast against the near-black the surface already uses.
///
/// Contrast rather than "the most common colour" because the most common colour
/// in a photograph is usually a mid-tone grey that reads as mud against black.
/// The accent is the colour that *pops*, which is the one furthest from the
/// background in luminance.
class AutoTheme {
  const AutoTheme._();

  /// Extract an accent from an image's bytes.
  ///
  /// Decodes at 64px on purpose. A wallpaper is 3840px wide and we need the
  /// palette, not the detail — decoding at full size to read a handful of corner
  /// pixels is the same mistake as decoding a 256px icon at native resolution,
  /// and on a 1 GB machine it is the difference between a first run that
  /// finishes and one that gets killed.
  static Future<String> accentFromWallpaper(Uint8List bytes) async {
    final pixels = await _decode(bytes);
    if (pixels == null || pixels.isEmpty) return _fallback;
    return _pickAccent(pixels);
  }

  static const _fallback = '#00E5FF';

  /// Decode and sample. Returns raw RGBA pixels, or null if anything goes wrong.
  ///
  /// Null on failure rather than a throw, because a wallpaper we cannot read is
  /// a cosmetic problem and a first run that crashes on it is not.
  static Future<List<int>?> _decode(Uint8List bytes) async {
    try {
      final codec = await ui.instantiateImageCodec(bytes, targetWidth: 64, targetHeight: 64);
      final frame = await codec.getNextFrame();
      final data = await frame.image.toByteData(format: ui.ImageByteFormat.rawRgba);
      frame.image.dispose();
      if (data == null) return null;
      return data.buffer.asUint8List();
    } catch (e) {
      debugPrint('wallpaper decode failed: $e');
      return null;
    }
  }

  /// The colour with the most contrast against near-black.
  static String _pickAccent(List<int> rgba) {
    var best = _fallback;
    var bestScore = -1.0;

    // Stride over the buffer in whole pixels rather than one byte at a time.
    // rawRgba is 4 bytes per pixel, so reading it as a list of ints means
    // skipping 3 of every 4 entries.
    for (var i = 0; i + 3 < rgba.length; i += 4 * 8) {
      final r = rgba[i];
      final g = rgba[i + 1];
      final b = rgba[i + 2];

      // Relative luminance, the WCAG formula. Cheap, and the right answer for
      // "which of these is visible on black".
      final lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      // Skip near-black and near-white. Both are useless as an accent: black is
      // invisible on the background and white is just grey with better
      // self-esteem.
      if (lum < 0.08 || lum > 0.95) continue;

      // Prefer saturated colours. A desaturated mid-tone has fine contrast but
      // reads as mud; weighting by saturation breaks ties toward the colour that
      // actually looks like an accent.
      final max = [r, g, b].reduce((a, b) => a > b ? a : b);
      final min = [r, g, b].reduce((a, b) => a < b ? a : b);
      final sat = max == 0 ? 0.0 : (max - min) / max;
      final score = lum * 0.6 + sat * 0.4;

      if (score > bestScore) {
        bestScore = score;
        final hex = ((r << 16) | (g << 8) | b).toRadixString(16).padLeft(6, '0');
        best = '#${hex.toUpperCase()}';
      }
    }
    return best;
  }
}
