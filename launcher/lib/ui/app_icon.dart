import 'dart:io';

import 'package:flutter/material.dart';

import '../models/app_entry.dart';
import '../services/memory_budget.dart';
import '../theme/jarvis_theme.dart';

/// How an app icon is clipped into the JARVIS frame.
///
/// Four shapes, because a skin is a look and the icon frame is most of the look.
/// `chamfer` is the default: cut corners read as both a Metro tile and a HUD
/// panel, which is why two of the four reference skins land on it independently.
enum IconShape {
  /// Plain rectangle. The WP7/Metro tile.
  square,

  /// Rectangle with the corners cut at 45°. The default.
  chamfer,

  /// Flat-top hexagon. Reads as a shield or a reactor segment.
  hexagon,

  /// Rounded top tapering to a point. The Iron Man / arc-reactor cue.
  shield,
}

/// Wraps an application icon so it belongs to this interface.
///
/// The problem this solves: Windows hands you a 48px PNG drawn for a light
/// background with its own visual language, and dropping it onto a dark HUD
/// looks exactly like what it is — a foreign object pasted on. Every icon here
/// is instead:
///
///   1. clipped into one of four angular shapes
///   2. backed by the theme surface so transparent pixels read correctly
///   3. tinted very slightly toward the accent, which harmonises a pile of
///      unrelated icons without repainting them
///   4. framed by a border that follows the same path, plus corner brackets
///   5. given a glow that tracks hover and selection
///
/// Step 3 is the one that does the real work. A 6% accent wash over icons from
/// a dozen different vendors is what makes a grid read as one instrument panel
/// rather than as a folder of pictures.
class AppIcon extends StatelessWidget {
  const AppIcon({
    super.key,
    required this.entry,
    this.size = 56,
    this.shape = IconShape.chamfer,
    this.accent,
    this.intensity = 1.0,
  });

  final AppEntry entry;
  final double size;

  /// Null means the theme's interface cyan. Null shape means "whatever the
  /// active skin asked for", falling back to chamfer.
  final IconShape? shape;
  final Color? accent;
  final double intensity;

  /// How far the corners are cut, as a fraction of the size. 0.22 is enough to
  /// read as a deliberate shape at 56px without eating the icon.
  static const _cut = 0.22;

  Path _path(Size s, IconShape shape) {
    final w = s.width, h = s.height;
    final c = w * _cut;
    switch (shape) {
      case IconShape.square:
        return Path()
          ..addRect(Rect.fromLTWH(0, 0, w, h));
      case IconShape.chamfer:
        return Path()
          ..moveTo(c, 0)
          ..lineTo(w - c, 0)
          ..lineTo(w, c)
          ..lineTo(w, h - c)
          ..lineTo(w - c, h)
          ..lineTo(c, h)
          ..lineTo(0, h - c)
          ..lineTo(0, c)
          ..close();
      case IconShape.hexagon:
        // Flat top and bottom, points left and right.
        return Path()
          ..moveTo(w * 0.28, 0)
          ..lineTo(w * 0.72, 0)
          ..lineTo(w, h * 0.5)
          ..lineTo(w * 0.72, h)
          ..lineTo(w * 0.28, h)
          ..lineTo(0, h * 0.5)
          ..close();
      case IconShape.shield:
        // Rounded shoulders, pointed foot.
        return Path()
          ..moveTo(w * 0.5, h)
          ..lineTo(0, h * 0.62)
          ..lineTo(0, h * 0.24)
          ..quadraticBezierTo(0, 0, w * 0.24, 0)
          ..lineTo(w * 0.76, 0)
          ..quadraticBezierTo(w, 0, w, h * 0.24)
          ..lineTo(w, h * 0.62)
          ..close();
    }
  }

  @override
  Widget build(BuildContext context) {
    final scope = IconStyleScope.maybeOf(context);
    final color = accent ?? scope?.accent ?? JarvisPalette.interface_;
    final path = _path(Size(size, size), shape ?? scope?.shape ?? IconShape.chamfer);
    final inner = size - 6;

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // 1. The backing. A foreign icon on a dark theme is usually drawn for
          //    a light one, so it needs somewhere solid to sit.
          CustomPaint(
            size: Size(size, size),
            painter: _ShapePainter(
              path: path,
              fill: JarvisPalette.surfaceHigh,
              stroke: color.withValues(alpha: 0.35 * intensity),
              strokeWidth: 1,
            ),
          ),

          // 2. The icon itself, clipped to the shape.
          ClipPath(
            clipper: _PathClipper(path),
            child: _IconImage(entry: entry, size: inner),
          ),

          // 3. The accent wash. Deliberately faint — enough to harmonise, not
          //    enough to repaint. This is what makes a mixed grid cohere.
          ClipPath(
            clipper: _PathClipper(path),
            child: IgnorePointer(
              child: ColoredBox(
                color: color.withValues(alpha: 0.07 * intensity),
              ),
            ),
          ),

          // 4. Border + corner brackets, drawn over everything.
          IgnorePointer(
            child: CustomPaint(
              size: Size(size, size),
              painter: _ShapePainter(
                path: path,
                stroke: color.withValues(alpha: 0.75 * intensity),
                strokeWidth: 1,
                glow: JarvisGlow.edge(color, strength: 0.5 * intensity),
                brackets: true,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The raw icon, or the monogram when it cannot be loaded.
class _IconImage extends StatelessWidget {
  const _IconImage({required this.entry, required this.size});

  final AppEntry entry;
  final double size;

  static bool _isImage(String p) {
    final lower = p.toLowerCase();
    return lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.webp') ||
        lower.endsWith('.bmp') ||
        lower.endsWith('.gif');
  }

  @override
  Widget build(BuildContext context) {
    final path = entry.iconPath;
    if (path == null || path.isEmpty || !_isImage(path)) {
      return _Monogram(entry: entry, size: size);
    }
    // Decode to the budget's pixel ceiling, not the file's native size. A 256px
    // icon shown at 56px costs 20x the memory it needs to, and with a few
    // hundred apps installed that difference is the whole budget.
    // cacheWidth is what actually caps the decode. Without it Flutter decodes
    // the file at native resolution and scales at paint time, which is the
    // single biggest memory cost in a launcher with a few hundred apps.
    final cap = MemoryBudget.current.iconPixels;
    return Image.file(
      File(path),
      width: size,
      height: size,
      fit: BoxFit.contain,
      cacheWidth: cap,
      // An icon that fails to decode must not take the tile down with it.
      errorBuilder: (_, __, ___) => _Monogram(entry: entry, size: size),
    );
  }
}

/// The fallback: the app's initial, in the theme type, inside the same frame.
class _Monogram extends StatelessWidget {
  const _Monogram({required this.entry, required this.size});

  final AppEntry entry;
  final double size;

  @override
  Widget build(BuildContext context) {
    final trimmed = entry.name.trim();
    final initial = trimmed.isEmpty ? '?' : trimmed.substring(0, 1).toUpperCase();
    return Container(
      width: size,
      height: size,
      color: JarvisPalette.surfaceHigh,
      alignment: Alignment.center,
      child: Text(
        initial,
        style: JarvisType.readout(
          JarvisPalette.interface_,
          size: size * 0.42,
        ).copyWith(shadows: JarvisGlow.text(JarvisPalette.interface_)),
      ),
    );
  }
}

/// Clips a child to a precomputed path.
class _PathClipper extends CustomClipper<Path> {
  const _PathClipper(this.path);

  final Path path;

  @override
  Path getClip(Size size) => path;

  // The path is built for a fixed size, so it never needs rebuilding as long
  // as the size is unchanged — which it always is here.
  @override
  bool shouldReclip(_PathClipper old) => false;
}

/// Fills, strokes, and brackets a path.
class _ShapePainter extends CustomPainter {
  const _ShapePainter({
    required this.path,
    this.fill,
    this.stroke,
    this.strokeWidth = 1,
    this.glow,
    this.brackets = false,
  });

  final Path path;
  final Color? fill;
  final Color? stroke;
  final double strokeWidth;
  final List<BoxShadow>? glow;
  final bool brackets;

  @override
  void paint(Canvas canvas, Size size) {
    if (fill != null) {
      canvas.drawPath(path, Paint()..color = fill!);
    }
    if (stroke != null) {
      final paint = Paint()
        ..color = stroke!
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth;
      if (glow != null) {
        paint.maskFilter = const MaskFilter.blur(BlurStyle.normal, 3);
      }
      canvas.drawPath(path, paint);
    }

    if (!brackets) return;

    // Corner brackets, inset so they sit inside the border rather than on it.
    // Four short Ls at the corners are what make a panel read as a HUD element
    // rather than as a bordered box.
    final bounds = path.getBounds();
    final inset = strokeWidth + 2.5;
    final arm = size.shortestSide * 0.17;
    final p = Paint()
      ..color = stroke ?? JarvisPalette.interface_
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4
      ..strokeCap = StrokeCap.square;
    if (glow != null) {
      p.maskFilter = const MaskFilter.blur(BlurStyle.normal, 2);
    }

    void bracket(double x, double y, double dx, double dy) {
      canvas.drawPath(
        Path()
          ..moveTo(x + dx * arm, y)
          ..lineTo(x, y)
          ..lineTo(x, y + dy * arm),
        p,
      );
    }

    bracket(bounds.left + inset, bounds.top + inset, 1, 1);
    bracket(bounds.right - inset, bounds.top + inset, -1, 1);
    bracket(bounds.left + inset, bounds.bottom - inset, 1, -1);
    bracket(bounds.right - inset, bounds.bottom - inset, -1, -1);
  }

  @override
  bool shouldRepaint(_ShapePainter old) =>
      old.path != path ||
      old.fill != fill ||
      old.stroke != stroke ||
      old.brackets != brackets;
}

/// Lets a skin decide how every app icon is framed, without the grid needing to
/// know a skin exists.
///
/// This is the connection between the two halves of the product: the skin picks
/// a shape and an accent, and every application icon in the grid is clipped and
/// glowed to match. Without it, changing skins would leave the grid looking
/// exactly the same, which is the one thing a skin must not do.
class IconStyleScope extends InheritedWidget {
  const IconStyleScope({
    super.key,
    required this.shape,
    required this.accent,
    required super.child,
  });

  final IconShape shape;
  final Color? accent;

  static IconStyleScope? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<IconStyleScope>();

  @override
  bool updateShouldNotify(IconStyleScope old) =>
      old.shape != shape || old.accent != accent;
}
