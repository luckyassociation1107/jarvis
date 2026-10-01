import 'dart:io';

import 'package:flutter/material.dart';

import '../models/app_entry.dart';
import '../theme/jarvis_painter.dart';
import '../theme/jarvis_theme.dart';

/// The dock: a fixed strip of the apps you actually use.
///
/// Not a taskbar. There is no window list here, because Flutter cannot see
/// other applications' windows — a taskbar showing a list it cannot populate
/// would be a lie. What this is instead is a *favourites* strip, which is
/// honest: it launches things, and it does not pretend to track anything.
///
/// The README is explicit about this limitation rather than leaving a reader to
/// discover an empty bar.
class Dock extends StatelessWidget {
  const Dock({
    super.key,
    required this.items,
    required this.onLaunch,
    this.onSettings,
  });

  final List<AppEntry> items;
  final void Function(AppEntry entry) onLaunch;
  final VoidCallback? onSettings;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(40, 0, 40, 20),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: JarvisPalette.surface.withValues(alpha: 0.75),
        border: Border.all(color: JarvisPalette.interface_.withValues(alpha: 0.35)),
        boxShadow: JarvisGlow.edge(JarvisPalette.interface_, strength: 0.3),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final entry in items) ...[
            _DockIcon(entry: entry, onLaunch: () => onLaunch(entry)),
            const SizedBox(width: 6),
          ],
          const JarvisRule(length: 12, thickness: 1, glow: false),
          const SizedBox(width: 10),
          _DockButton(
            label: 'SEARCH',
            icon: Icons.search,
            onTap: onSettings ?? () {},
          ),
        ],
      ),
    );
  }
}

class _DockIcon extends StatefulWidget {
  const _DockIcon({required this.entry, required this.onLaunch});

  final AppEntry entry;
  final VoidCallback onLaunch;

  @override
  State<_DockIcon> createState() => _DockIconState();
}

class _DockIconState extends State<_DockIcon> with SingleTickerProviderStateMixin {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        onTap: widget.onLaunch,
        child: Tooltip(
          message: widget.entry.name,
          // No tooltip decoration — a Material tooltip over a HUD is a grey
          // rounded rectangle, and it is the single most jarring thing that can
          // appear on this screen.
          decoration: const BoxDecoration(color: Colors.transparent),
          textStyle: JarvisType.label(JarvisPalette.ink, size: 10),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 120),
            width: 40,
            height: 40,
            transform: _hover
                ? (Matrix4.translationValues(0, -4, 0))
                : Matrix4.identity(),
            decoration: BoxDecoration(
              border: Border.all(
                color: JarvisPalette.interface_.withValues(alpha: _hover ? 0.9 : 0.3),
              ),
              boxShadow: _hover
                  ? JarvisGlow.edge(JarvisPalette.interface_, strength: 0.8)
                  : null,
            ),
            child: Center(child: _icon()),
          ),
        ),
      ),
    );
  }

  Widget _icon() {
    final path = widget.entry.iconPath;
    final loadable = path != null &&
        path.isNotEmpty &&
        (path.toLowerCase().endsWith('.png') ||
            path.toLowerCase().endsWith('.jpg') ||
            path.toLowerCase().endsWith('.jpeg') ||
            path.toLowerCase().endsWith('.webp'));
    if (loadable) {
      return Image.file(
        File(path),
        width: 26,
        height: 26,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => _monogram(),
      );
    }
    return _monogram();
  }

  Widget _monogram() {
    final t = widget.entry.name.trim();
    return Text(
      t.isEmpty ? '?' : t.substring(0, 1).toUpperCase(),
      style: JarvisType.readout(JarvisPalette.interface_, size: 15).copyWith(
        shadows: JarvisGlow.text(JarvisPalette.interface_),
      ),
    );
  }
}

class _DockButton extends StatefulWidget {
  const _DockButton({required this.label, required this.icon, required this.onTap});

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  State<_DockButton> createState() => _DockButtonState();
}

class _DockButtonState extends State<_DockButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: _hover
                ? JarvisPalette.interface_.withValues(alpha: 0.12)
                : Colors.transparent,
            border: Border.all(
              color: JarvisPalette.interface_.withValues(alpha: _hover ? 0.7 : 0.3),
            ),
          ),
          child: Row(
            children: [
              Icon(widget.icon, size: 13, color: JarvisPalette.interface_),
              const SizedBox(width: 8),
              Text(widget.label, style: JarvisType.label(JarvisPalette.interface_, size: 9)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Re-exported so the workspace can draw a divider without importing the
/// painter module directly for one symbol.
typedef DockRule = JarvisRule;
