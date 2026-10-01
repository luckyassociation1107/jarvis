import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'jarvis_theme.dart';

/// A scanline + vignette overlay, drawn once over the whole workspace.
///
/// The web build gets this from a CSS repeating-linear-gradient and a radial
/// vignette. It is subtle and it is doing a lot of work — without it the flat
/// dark background reads as "unstyled dark mode", and with it the same
/// background reads as a screen.
///
/// Implemented as a [CustomPainter] rather than a stack of gradients because it
/// has to repaint at a different rate from the content, and a decorative
/// overlay that rebuilds on every keystroke is a waste.
class ScanlineOverlay extends StatelessWidget {
  const ScanlineOverlay({
    super.key,
    this.opacity = 0.5,
    this.child,
  });

  final double opacity;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    // `foregroundPainter`, not `painter`. CustomPaint draws `painter` *first*
    // and the child on top of it, so using `painter` here would put the
    // scanlines underneath the content where they are invisible. The overlay
    // has to be the last thing drawn.
    //
    // It still does not hit-test: RenderCustomPaint forwards hit testing to
    // its children, so the rows underneath keep their taps.
    return CustomPaint(
      foregroundPainter: _ScanlinePainter(opacity: opacity),
      child: child,
    );
  }
}

class _ScanlinePainter extends CustomPainter {
  const _ScanlinePainter({required this.opacity});

  final double opacity;

  /// One line every 3 logical pixels. Denser and it moirés on a 1x display;
  /// sparser and it stops reading as a CRT.
  static const double _pitch = 3.0;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;

    // --- scanlines ---------------------------------------------------------
    final line = Paint()
      ..color = Colors.black.withValues(alpha: 0.22 * opacity)
      ..strokeWidth = 1;
    for (double y = 0; y < size.height; y += _pitch) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), line);
    }

    // --- vignette ----------------------------------------------------------
    // A radial gradient from transparent at the centre to the background
    // colour at the corners. This is what makes the panel feel recessed
    // rather than floating.
    final centre = Offset(size.width / 2, size.height / 2);
    final radius = math.sqrt(size.width * size.width + size.height * size.height) / 2;
    final vignette = Paint()
      ..shader = ui.Gradient.radial(
        centre,
        radius,
        [
          Colors.transparent,
          Colors.transparent,
          JarvisPalette.background.withValues(alpha: 0.55 * opacity),
          JarvisPalette.background.withValues(alpha: 0.9 * opacity),
        ],
        const [0.0, 0.45, 0.8, 1.0],
      );
    canvas.drawRect(Offset.zero & size, vignette);
  }

  @override
  bool shouldRepaint(_ScanlinePainter old) =>
      old.opacity != opacity; // static otherwise; no reason to repaint
}

/// A single thin horizontal rule that glows.
///
/// Used to separate the header from the results, the way the web build's
/// `.rail-item` borders do.
class JarvisRule extends StatelessWidget {
  const JarvisRule({
    super.key,
    this.color = JarvisPalette.interface_,
    this.glow = true,
    this.length,
    this.thickness = 1,
  });

  final Color color;
  final bool glow;

  /// Explicit width. Null lets it fill whatever the parent gives it, which is
  /// what a full-width rule under a heading wants.
  final double? length;

  /// Height. A rule is 1px by default because anything thicker reads as a
  /// block rather than a line.
  final double thickness;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: length,
      height: thickness,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.5),
          boxShadow: glow ? JarvisGlow.edge(color, strength: 0.6) : null,
        ),
      ),
    );
  }
}

/// The corner brackets that frame a widget panel.
///
/// Four L-shapes rather than a border, because a full border is a rectangle and
/// a rectangle is a dialog box; four detached corners are a targeting reticle.
/// This is the single cheapest way to make a panel look like instrumentation.
class JarvisFrame extends StatelessWidget {
  const JarvisFrame({
    super.key,
    required this.child,
    this.color = JarvisPalette.interface_,
    this.length = 18,
    this.thickness = 2,
  });

  final Widget child;
  final Color color;
  final double length;
  final double thickness;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _BracketPainter(
        color: color,
        length: length,
        thickness: thickness,
      ),
      child: child,
    );
  }
}

class _BracketPainter extends CustomPainter {
  const _BracketPainter({
    required this.color,
    required this.length,
    required this.thickness,
  });

  final Color color;
  final double length;
  final double thickness;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color.withValues(alpha: 0.85)
      ..strokeWidth = thickness
      ..style = PaintingStyle.stroke;
    final glow = Paint()
      ..color = color.withValues(alpha: 0.35)
      ..strokeWidth = thickness * 2.5
      ..style = PaintingStyle.stroke
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);

    for (final corner in const [(0, 0), (1, 0), (0, 1), (1, 1)]) {
      final x = corner.$1 == 0 ? 0.0 : size.width;
      final y = corner.$2 == 0 ? 0.0 : size.height;
      final dx = corner.$1 == 0 ? length : -length;
      final dy = corner.$2 == 0 ? length : -length;

      final path = Path()
        ..moveTo(x, y + dy)
        ..lineTo(x, y)
        ..lineTo(x + dx, y);

      canvas.drawPath(path, glow);
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_BracketPainter old) =>
      old.color != color || old.length != length || old.thickness != thickness;
}
