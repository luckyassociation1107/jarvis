import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../services/memory_budget.dart';
import '../theme/jarvis_theme.dart';

/// The reactor: the thing at the centre of the display.
///
/// The web build's reactor is a Three.js mesh driven by a shader and animated
/// per phase. This is the 2D equivalent — a ring, a counter-rotating ring, and
/// a set of radial ticks — drawn with a CustomPainter so it costs one canvas
/// rather than a widget subtree.
///
/// It breathes. That is the point: it is the element the user watches while
/// they wait, and its motion is read as the system's state whether or not
/// anything is actually happening. A static reactor reads as a broken one.
class Reactor extends StatefulWidget {
  const Reactor({
    super.key,
    this.size = 260,
    this.color = JarvisPalette.interface_,
    this.intensity = 1.0,
  });

  final double size;
  final Color color;

  /// 0..1. Drives brightness and ring count. Left at 1 for idle.
  final double intensity;

  @override
  State<Reactor> createState() => _ReactorState();
}

class _ReactorState extends State<Reactor> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    // Slow on purpose. A fast spin reads as a loading spinner; this is meant
    // to read as something idling.
    duration: const Duration(seconds: 24),
  );

  @override
  void initState() {
    super.initState();
    // A continuous animation is a continuous repaint, and on a machine with no
    // memory to spare it is also a continuous reason to keep the process
    // resident. The budget decides: full frame rate, a slow tick, or draw once
    // and stop entirely.
    final fps = MemoryBudget.current.reactorFps;
    if (fps <= 0) {
      _c.value = 0.35; // A fixed, deliberate pose rather than a frozen 0.
    } else {
      // Flutter has no "repeat at N fps", so the period is stretched instead:
      // the controller still runs at display rate but the visual only needs to
      // change when it does, and the ticker is what costs.
      _c.repeat(period: Duration(milliseconds: (1000 / fps).round()));
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => CustomPaint(
          painter: _ReactorPainter(
            spin: _c.value * 2 * math.pi,
            color: widget.color,
            intensity: widget.intensity,
          ),
        ),
      ),
    );
  }
}

class _ReactorPainter extends CustomPainter {
  const _ReactorPainter({
    required this.spin,
    required this.color,
    required this.intensity,
  });

  final double spin;
  final Color color;
  final double intensity;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = Offset(size.width / 2, size.height / 2);
    final radius = math.min(size.width, size.height) / 2;

    // --- the halo -----------------------------------------------------------
    // Two wide, faint circles. Without these the rings look drawn rather than
    // lit, which is the whole difference between a diagram and a reactor.
    for (final (spread, alpha) in [(radius * 0.9, 0.06), (radius * 0.6, 0.10)]) {
      canvas.drawCircle(
        centre,
        spread,
        Paint()
          ..color = color.withValues(alpha: alpha * intensity)
          ..maskFilter = MaskFilter.blur(BlurStyle.normal, radius * 0.22),
      );
    }

    // --- the core -----------------------------------------------------------
    canvas.drawCircle(
      centre,
      radius * 0.14,
      Paint()
        ..color = color.withValues(alpha: 0.9 * intensity)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, radius * 0.1),
    );

    // --- radial ticks -------------------------------------------------------
    // 48 of them, every 7.5 degrees, alternating length. This is what makes it
    // read as an instrument rather than as a circle.
    const ticks = 48;
    for (var i = 0; i < ticks; i++) {
      final angle = (i / ticks) * 2 * math.pi + spin * 0.15;
      final long = i % 4 == 0;
      final inner = radius * (long ? 0.42 : 0.52);
      final outer = radius * (long ? 0.62 : 0.58);
      canvas.drawLine(
        centre + Offset(math.cos(angle) * inner, math.sin(angle) * inner),
        centre + Offset(math.cos(angle) * outer, math.sin(angle) * outer),
        Paint()
          ..color = color.withValues(alpha: (long ? 0.55 : 0.25) * intensity)
          ..strokeWidth = long ? 1.6 : 1,
      );
    }

    // --- three rings --------------------------------------------------------
    // Each a different radius, speed and direction. The counter-rotation is
    // what gives it depth; concentric rings all spinning the same way read as
    // a single flat object.
    _ring(canvas, centre, radius * 0.74, spin * 0.6, 0.5, 0.9);
    _ring(canvas, centre, radius * 0.86, -spin * 0.35, 0.35, 0.5);
    _ring(canvas, centre, radius * 0.34, -spin * 1.1, 0.7, 0.2);
  }

  /// An arc, drawn with a gap so it reads as a rotating segment.
  void _ring(
    Canvas canvas,
    Offset centre,
    double radius,
    double angle,
    double alpha,
    double sweepFraction,
  ) {
    final rect = Rect.fromCircle(center: centre, radius: radius);
    canvas.drawArc(
      rect,
      angle,
      math.pi * 2 * sweepFraction,
      false,
      Paint()
        ..color = color.withValues(alpha: alpha * intensity)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(_ReactorPainter old) =>
      old.spin != spin || old.intensity != intensity || old.color != color;
}

/// A small status lamp: a lit dot with a halo.
///
/// Used in the status bar to say which platform is live and whether the index
/// is built. Cheaper and clearer than an icon.
class StatusLamp extends StatelessWidget {
  const StatusLamp({super.key, required this.color, this.size = 6, this.lit = true});

  final Color color;
  final double size;
  final bool lit;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: lit ? color : color.withValues(alpha: 0.15),
        boxShadow: lit ? JarvisGlow.edge(color, strength: 0.8) : null,
      ),
    );
  }
}

/// A slow-breathing dot, shown while the index is still building.
///
/// The reactor at the centre of the web build is the thing the user watches
/// while they wait. This is the launcher's version of it: one small element
/// that says "working" without a spinner, because a spinner is a web idiom and
/// a breathing arc is a machine's.
class BreathingArc extends StatefulWidget {
  const BreathingArc({super.key, this.size = 18, this.color = JarvisPalette.listening});

  final double size;
  final Color color;

  @override
  State<BreathingArc> createState() => _BreathingArcState();
}

class _BreathingArcState extends State<BreathingArc> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => CustomPaint(
          painter: _ArcPainter(
            progress: _c.value,
            color: widget.color,
          ),
        ),
      ),
    );
  }
}

class _ArcPainter extends CustomPainter {
  const _ArcPainter({required this.progress, required this.color});

  final double progress;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = Offset(size.width / 2, size.height / 2);
    final radius = math.min(size.width, size.height) / 2 - 1.5;

    // A faint full ring, and one bright arc sweeping it. Two states on screen
    // at once — "there is a whole thing, and this much of it is alive".
    canvas.drawCircle(
      centre,
      radius,
      Paint()
        ..color = color.withValues(alpha: 0.18)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
    canvas.drawArc(
      Rect.fromCircle(center: centre, radius: radius),
      -math.pi / 2,
      math.pi * 2 * (0.25 + 0.75 * progress),
      false,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..strokeCap = StrokeCap.round
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3),
    );
  }

  @override
  bool shouldRepaint(_ArcPainter old) => old.progress != progress;
}
