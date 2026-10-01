import 'package:flutter/material.dart';

/// The JARVIS colour identity, lifted from the web build rather than invented.
///
/// These are the same values the Three.js scene and the 2D HUD resolve against
/// in `src/store.ts` — `phaseColor` — so the launcher is recognisably the same
/// machine. `interface` is the base cyan; the rest are the per-phase accents.
///
///   offline  #0d4a4a   dormant   #12908f   boot   #17b3b3
///   waking   #5cf2ef   listening #19d8d2   thinking #f0a93c
///   tooling  #a97bff   speaking  #3ef2a8
///
/// The background is `#01060c`, which is not black — it is a very dark blue,
/// and that distinction is most of why the cyan reads as a light source rather
/// than as a colour on top of a void.
class JarvisPalette {
  JarvisPalette._();

  /// The base interface cyan. Everything that is not a phase accent is this.
  static const Color interface_ = Color(0xFF00E5FF);

  static const Color background = Color(0xFF01060C);
  static const Color surface = Color(0xFF061018);
  static const Color surfaceHigh = Color(0xFF0A1A24);

  /// Near-white with a cyan cast, for primary text.
  static const Color ink = Color(0xFFE8F8FF);
  static const Color inkDim = Color(0xFF7FA9B4);

  static const Color offline = Color(0xFF0D4A4A);
  static const Color boot = Color(0xFF17B3B3);
  static const Color dormant = Color(0xFF12908F);
  static const Color waking = Color(0xFF5CF2EF);
  static const Color listening = Color(0xFF19D8D2);
  static const Color thinking = Color(0xFFF0A93C);
  static const Color tooling = Color(0xFFA97BFF);
  static const Color speaking = Color(0xFF3EF2A8);

  /// Alert, for destructive confirmations only. Never decorative.
  static const Color alert = Color(0xFFFF5A3C);

  /// Every accent, in the order the phases run. Handy for tests and for the
  /// diagnostic strip.
  static const List<Color> phases = [
    offline,
    boot,
    dormant,
    waking,
    listening,
    thinking,
    tooling,
    speaking,
  ];
}

/// How a surface is lit.
///
/// The web build gets its glow from CSS `box-shadow` layered under every rail
/// and from a bloom pass in the shader. Flutter has no bloom, so the glow is
/// built from `BoxShadow` with a wide, low-opacity blur — the same trick, done
/// by hand. The spread is what sells it: a tight shadow reads as a drop shadow,
/// a wide faint one reads as emitted light.
class JarvisGlow {
  JarvisGlow._();

  /// A soft halo around an element. [strength] 0..1.
  static List<BoxShadow> halo(Color color, {double strength = 1.0}) => [
        BoxShadow(
          color: color.withValues(alpha: 0.55 * strength),
          blurRadius: 24,
          spreadRadius: 2,
        ),
        BoxShadow(
          color: color.withValues(alpha: 0.22 * strength),
          blurRadius: 64,
          spreadRadius: 8,
        ),
      ];

  /// A tight edge light, for borders and thin rules.
  static List<BoxShadow> edge(Color color, {double strength = 1.0}) => [
        BoxShadow(
          color: color.withValues(alpha: 0.45 * strength),
          blurRadius: 8,
          spreadRadius: 0,
        ),
      ];

  /// Text glow. Two layers, because one is either invisible or a smudge.
  static List<Shadow> text(Color color, {double strength = 1.0}) => [
        Shadow(color: color.withValues(alpha: 0.75 * strength), blurRadius: 12),
        Shadow(color: color.withValues(alpha: 0.35 * strength), blurRadius: 28),
      ];
}

/// Typography.
///
/// The web build uses Chakra Petch for everything and JetBrains Mono for the
/// readouts. Neither ships with Flutter, and a missing font on one of four
/// platforms is a silent fallback to Roboto — which is the difference between
/// this looking like a machine and looking like a Material demo.
///
/// So the type scale is defined against the platform monospace and a geometric
/// sans, with wide tracking, which is what actually carries the character.
/// Drop `ChakraPetch-Regular.ttf` into `assets/fonts/` and uncomment the asset
/// block in `pubspec.yaml` to get the real face.
class JarvisType {
  JarvisType._();

  /// Wide tracking is the single most important thing here. UI labels in the
  /// web build are letterspaced hard, and it is most of why they read as
  /// instrument labelling rather than as body text.
  static const double tracking = 0.18;
  static const double trackingWide = 0.32;

  static const String mono = 'monospace';
  static const String sans = 'sans-serif';

  static TextStyle label(
    Color color, {
    double size = 11,
    double? tracking,
    FontWeight weight = FontWeight.w500,
  }) =>
      TextStyle(
        fontFamily: sans,
        color: color,
        fontSize: size,
        letterSpacing: tracking ?? JarvisType.tracking,
        fontWeight: weight,
        height: 1.2,
      );

  static TextStyle readout(
    Color color, {
    double size = 13,
  }) =>
      TextStyle(
        fontFamily: mono,
        color: color,
        fontSize: size,
        letterSpacing: tracking,
        height: 1.3,
      );

  static TextStyle title(Color color) => TextStyle(
        fontFamily: sans,
        color: color,
        fontSize: 26,
        letterSpacing: trackingWide,
        fontWeight: FontWeight.w300,
        height: 1.1,
      );
}

/// The theme data, applied once at the root.
ThemeData jarvisTheme() {
  const bg = JarvisPalette.background;
  const accent = JarvisPalette.interface_;

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: bg,
    canvasColor: bg,
    primaryColor: accent,
    // The whole app is a dark surface with cyan edges. Overriding the default
    // Material ink/splash colours matters: an accidental white ripple on a
    // JARVIS HUD is instantly cheap-looking.
    splashFactory: InkSparkle.splashFactory,
    colorScheme: const ColorScheme.dark(
      primary: accent,
      secondary: JarvisPalette.tooling,
      surface: bg,
      error: JarvisPalette.alert,
      onPrimary: JarvisPalette.background,
      onSurface: JarvisPalette.ink,
    ),
    textTheme: const TextTheme(
      bodyMedium: TextStyle(color: JarvisPalette.ink, fontFamily: 'sans-serif'),
      bodySmall: TextStyle(color: JarvisPalette.inkDim, fontFamily: 'sans-serif'),
    ),
    // No Card theme is set because no Card is used anywhere in this app. The
    // web build uses 2px radii and hard chamfers, and a 12px Material card
    // would read as a different product entirely — so there is nothing to theme.
    dividerTheme: const DividerThemeData(
      color: JarvisPalette.surfaceHigh,
      thickness: 1,
      space: 1,
    ),
  );
}
