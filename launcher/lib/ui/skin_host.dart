import 'package:flutter/material.dart';

import '../skins/skin.dart';
import '../theme/jarvis_theme.dart';
import 'widgets/widgets.dart';

/// Renders a skin: its widgets, placed at the coordinates the skin specifies.
///
/// A [Stack] with [Positioned] children, because a skin is an absolute layout.
/// That is the whole point of the format — the author decided the clock goes in
/// the top-right and the memory readout along the left edge, and a flow layout
/// would rearrange it the moment the window changed size.
///
/// The app grid is not part of the skin. It is the workspace's own surface and
/// every skin keeps it, because a desktop with no way to launch anything is a
/// screenshot. What a skin controls is everything *around* it.
class SkinHost extends StatelessWidget {
  const SkinHost({
    super.key,
    required this.skin,
    required this.appCount,
    required this.child,
  });

  final Skin skin;

  /// Passed through to the app-count widget.
  final int appCount;

  /// The workspace surface the widgets float over.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        child,
        for (final spec in skin.widgets)
          if (spec.kind == 'reactor')
            // The reactor fills the space rather than sitting in its box — it is
            // a background element that happens to be placeable.
            const Positioned.fill(
              child: IgnorePointer(
                child: Center(
                  child: ReactorBody(),
                ),
              ),
            )
          else
            Positioned(
              left: spec.x,
              top: spec.y,
              width: spec.width,
              height: spec.height,
              child: IgnorePointer(
                // Widgets are readouts. They must never swallow a click meant
                // for the app grid underneath them.
                child: _PassThrough(spec: spec, appCount: appCount),
              ),
            ),
      ],
    );
  }
}

/// Wraps a widget so its *interactive* parts still work while the frame does
/// not block the grid.
///
/// `IgnorePointer` on the whole panel would make the calendar arrows and the
/// notes field dead. This keeps the panel from blocking and lets the children
/// decide for themselves, which is the behaviour a skin author expects.
class _PassThrough extends StatelessWidget {
  const _PassThrough({required this.spec, required this.appCount});

  final WidgetSpec spec;
  final int appCount;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      hitTestBehavior: HitTestBehavior.translucent,
      child: Stack(
        children: [
          Positioned.fill(
            child: IgnorePointer(
              child: SkinWidget(spec: spec),
            ),
          ),
          if (spec.kind == 'appList')
            Positioned.fill(
              child: AppListBody(count: appCount),
            ),
        ],
      ),
    );
  }
}

/// The skin picker, shown in the top rail.
class SkinPicker extends StatelessWidget {
  const SkinPicker({
    super.key,
    required this.skins,
    required this.current,
    required this.onSelect,
  });

  final List<Skin> skins;
  final Skin current;
  final void Function(Skin skin) onSelect;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<Skin>(
      tooltip: '',
      color: JarvisPalette.surface,
      onSelected: onSelect,
      itemBuilder: (_) => [
        for (final skin in skins)
          PopupMenuItem<Skin>(
            value: skin,
            child: _SkinMenuItem(skin: skin, active: skin.id == current.id),
          ),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          border: Border.all(
            color: JarvisPalette.interface_.withValues(alpha: 0.45),
          ),
        ),
        child: Row(
          children: [
            Text(
              'SKIN',
              style: JarvisType.label(JarvisPalette.interface_, size: 8),
            ),
            const SizedBox(width: 8),
            Text(
              current.name.toUpperCase(),
              style: JarvisType.readout(JarvisPalette.ink, size: 10),
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.expand_more,
              size: 12,
              color: JarvisPalette.inkDim,
            ),
          ],
        ),
      ),
    );
  }
}

class _SkinMenuItem extends StatelessWidget {
  const _SkinMenuItem({required this.skin, required this.active});

  final Skin skin;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 240,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            skin.name,
            style: JarvisType.label(
              active ? JarvisPalette.listening : JarvisPalette.ink,
              size: 11,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            '${skin.widgets.length} widgets · ${skin.author}',
            style: JarvisType.readout(
              JarvisPalette.inkDim.withValues(alpha: 0.7),
              size: 8,
            ),
          ),
        ],
      ),
    );
  }
}
