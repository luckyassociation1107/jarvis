
import 'package:flutter/material.dart';

import '../models/app_entry.dart';
import 'app_icon.dart';
import '../services/app_index.dart';
import '../services/fuzzy.dart';
import '../theme/jarvis_theme.dart';

/// The app grid: the desktop's app surface.
///
/// A grid rather than a list, because that is what a desktop is — icons at a
/// size you can recognise at a glance, in a stable arrangement, so muscle
/// memory works. A launcher list optimises for typing; a grid optimises for
/// looking.
///
/// Icons are large here, which is why the icon decoders in `platform/icons.dart`
/// matter: at 56px a monogram grid is visibly a fallback, whereas at 16px in a
/// list row it reads as a deliberate style.
class AppGrid extends StatelessWidget {
  const AppGrid({
    super.key,
    required this.apps,
    required this.onLaunch,
    this.columns = 6,
  });

  final List<ScoredApp> apps;
  final void Function(AppEntry entry) onLaunch;
  final int columns;

  @override
  Widget build(BuildContext context) {
    if (apps.isEmpty) return const _EmptyGrid();

    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(40, 8, 40, 32),
      // Never scrollable horizontally: a desktop that scrolls sideways is a
      // phone, and the phone already has one.
      scrollDirection: Axis.vertical,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: columns,
        // Tall cells. The label needs two lines and the icon needs air, and a
        // square cell clips both.
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        mainAxisExtent: 104,
      ),
      itemCount: apps.length,
      itemBuilder: (_, i) => _AppTile(
        entry: apps[i].entry,
        ranges: apps[i].ranges,
        onLaunch: onLaunch,
      ),
    );
  }
}

class _AppTile extends StatefulWidget {
  const _AppTile({
    required this.entry,
    required this.ranges,
    required this.onLaunch,
  });

  final AppEntry entry;
  final List<MatchRange> ranges;
  final void Function(AppEntry entry) onLaunch;

  @override
  State<_AppTile> createState() => _AppTileState();
}

class _AppTileState extends State<_AppTile> with SingleTickerProviderStateMixin {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        onTap: () => widget.onLaunch(widget.entry),
        // Double-click as well as single. A desktop is a desktop: people
        // double-click icons out of thirty years of habit, and making that do
        // nothing is a small, constant irritation.
        onDoubleTap: () => widget.onLaunch(widget.entry),
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: _hover
                ? JarvisPalette.interface_.withValues(alpha: 0.08)
                : Colors.transparent,
            border: Border.all(
              color: _hover
                  ? JarvisPalette.interface_.withValues(alpha: 0.45)
                  : Colors.transparent,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _TileIcon(entry: widget.entry, hovered: _hover),
              const SizedBox(height: 10),
              _TileLabel(name: widget.entry.name, ranges: widget.ranges),
            ],
          ),
        ),
      ),
    );
  }
}

/// The icon, wrapped so it belongs to this interface.
///
/// Delegates to [AppIcon], which clips, backs, tints and frames the raw icon.
/// The tile itself no longer knows anything about how icons are presented.
class _TileIcon extends StatelessWidget {
  const _TileIcon({
    required this.entry,
    required this.hovered,
    this.selected = false,
  });

  final AppEntry entry;
  final bool hovered;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return AppIcon(
      entry: entry,
      size: 56,
      // Selection lifts the wash and the frame; hover is a lighter version of
      // the same thing, so the grid has one visual language for "this one".
      intensity: selected ? 1.6 : (hovered ? 1.25 : 1.0),
      accent: selected
          ? JarvisPalette.listening
          : (hovered
              ? JarvisPalette.interface_.withValues(alpha: 1)
              : null),
    );
  }
}

/// The label, two lines, centred, with the match lit.
class _TileLabel extends StatelessWidget {
  const _TileLabel({required this.name, required this.ranges});

  final String name;
  final List<MatchRange> ranges;

  @override
  Widget build(BuildContext context) {
    final style = JarvisType.label(
      JarvisPalette.ink,
      size: 10,
      tracking: 0.04,
    );
    if (ranges.isEmpty) {
      return Text(
        name,
        textAlign: TextAlign.center,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: style,
      );
    }

    final matched = <int>{};
    for (final r in ranges) {
      for (var i = r.start; i < r.end && i < name.length; i++) {
        matched.add(i);
      }
    }

    return Text.rich(
      TextSpan(
        children: [
          for (var i = 0; i < name.length; i++)
            TextSpan(
              text: name[i],
              style: matched.contains(i)
                  ? style.copyWith(
                      color: JarvisPalette.interface_,
                      fontWeight: FontWeight.w700,
                      shadows: JarvisGlow.text(JarvisPalette.interface_),
                    )
                  : style,
            ),
        ],
      ),
      textAlign: TextAlign.center,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    );
  }
}

class _EmptyGrid extends StatelessWidget {
  const _EmptyGrid();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            'NO MATCH',
            style: JarvisType.label(JarvisPalette.inkDim, size: 13),
          ),
          const SizedBox(height: 10),
          Text(
            'press ESC to clear the filter',
            style: JarvisType.label(
              JarvisPalette.inkDim.withValues(alpha: 0.5),
              size: 9,
            ),
          ),
        ],
      ),
    );
  }
}
