import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/app_entry.dart';
import '../platform/app_enumerator.dart';
import '../platform/launcher.dart';
import '../services/app_index.dart';
import '../skins/skins.dart';
import '../skins/skin.dart';
import '../services/window.dart';
import '../theme/jarvis_painter.dart';
import '../theme/jarvis_theme.dart';
import 'app_grid.dart';
import 'clock_readout.dart';
import 'dock.dart';
import 'reactor.dart';
import 'search_field.dart';
import 'skin_host.dart';

/// The workspace.
///
/// The whole screen is the JARVIS interface: reactor at the centre, app grid
/// filling the space, dock along the bottom, clock and status in the top rail.
/// This is not a panel over the desktop — it *is* the surface.
///
/// Two things it deliberately is not, both because Flutter cannot do them:
///
///   - It is not a window manager. It cannot see, move or composite other
///     applications' windows. The dock is a favourites strip, not a taskbar,
///     and there is no window list.
///   - It is not the actual wallpaper. A Flutter window cannot sit behind the
///     desktop icons. This is a full-screen workspace you switch to, which is
///     the honest version of "the OS wrapped in this UI" that Flutter allows.
///
/// Both limits are stated in the README rather than left to be discovered.
class Workspace extends StatefulWidget {
  const Workspace({super.key});

  @override
  State<Workspace> createState() => _WorkspaceState();
}

class _WorkspaceState extends State<Workspace> {
  final _index = AppIndex();
  final _focus = FocusNode();
  final _search = TextEditingController();

  List<ScoredApp> _results = const [];
  List<AppEntry> _all = const [];

  /// Which result the keyboard points at. -1 means "nothing yet", which is the
  /// honest default: highlighting the first app before the user has touched
  /// anything is a guess dressed up as a feature.
  int _selected = -1;
  final _gridScroll = ScrollController();
  int _appCount = 0;
  bool _loading = true;
  bool _searching = false;
  String? _error;

  /// The active skin. Changeable at runtime, because a skin you cannot switch
  /// without a restart is a setting, not a skin.
  Skin _skin = BuiltInSkins.arcReactor;

  @override
  void initState() {
    super.initState();
    _search.addListener(_onQuery);
    _load();
  }

  Future<void> _load() async {
    try {
      final apps = await _index.load();
      if (!mounted) return;
      setState(() {
        _all = apps;
        _appCount = apps.length;
        _results = _index.search('');
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  void _onQuery() {
    setState(() {
      _results = _index.search(_search.text);
      // A new result list invalidates the old index. Keeping it would point at
      // whatever now occupies that slot, which is how you launch the wrong app.
      _selected = -1;
    });
  }

  void _launch(AppEntry entry) async {
    try {
      await Launcher.launch(entry);
    } on LaunchException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    }
  }

  /// The dock: a handful of the most recognisable apps, or the first few found.
  ///
  /// There is no persistence yet — favourites would live in shared_preferences
  /// and be reordered by drag. Until then this is a sensible default rather
  /// than an empty strip.
  List<AppEntry> get _dock {
    if (_all.isEmpty) return const [];
    final wanted = [
      'terminal', 'console', 'files', 'finder', 'explorer', 'nautilus',
      'settings', 'system settings', 'preferences', 'control panel',
      'browser', 'chrome', 'firefox', 'edge', 'safari',
      'code', 'visual studio', 'editor',
    ];
    final picked = <AppEntry>[];
    for (final w in wanted) {
      final match = _all.where((a) => a.name.toLowerCase().contains(w)).firstOrNull;
      if (match != null && !picked.contains(match)) picked.add(match);
      if (picked.length >= 6) break;
    }
    if (picked.isEmpty) return _all.take(6).toList();
    return picked;
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    final key = event.logicalKey;

    // `/` opens search from anywhere, the way a lot of tools do it. Escape
    // closes it and hands focus back to the grid.
    if (key == LogicalKeyboardKey.slash && !_searching) {
      setState(() => _searching = true);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.escape) {
      if (_searching) {
        setState(() {
          _searching = false;
          _search.clear();
        });
        return KeyEventResult.handled;
      }
      // Nothing to dismiss at the top level, so this leaves full-screen —
      // the closest thing to "get my real desktop back" that exists here.
      JarvisWindow.setWindowed();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.f11) {
      JarvisWindow.setFullScreen();
      return KeyEventResult.handled;
    }

    // Arrow keys move the selection, Enter launches it. This is what turns the
    // grid from a picture into something you can drive without the mouse, which
    // is the difference between a launcher and a desktop wallpaper.
    if (_results.isEmpty) return KeyEventResult.ignored;
    final columns = _columnsFor(context);

    final delta = switch (key) {
      LogicalKeyboardKey.arrowLeft => -1,
      LogicalKeyboardKey.arrowRight => 1,
      LogicalKeyboardKey.arrowUp => -columns,
      LogicalKeyboardKey.arrowDown => columns,
      _ => 0,
    };
    if (delta != 0) {
      final next = (_selected + delta).clamp(0, _results.length - 1);
      // Wrapping is deliberately absent. Left from the first item landing on
      // the last one is disorienting in a 6-wide grid; clamping is predictable.
      if (next != _selected) {
        setState(() => _selected = next);
        _scrollSelectionIntoView();
      }
      return KeyEventResult.handled;
    }

    if ((key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter) &&
        _selected >= 0 &&
        _selected < _results.length) {
      _launch(_results[_selected].entry);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  /// Keeps the selected tile visible. Without this a keyboard walk down a long
  /// list silently moves the highlight off-screen.
  void _scrollSelectionIntoView() {
    if (_selected < 0 || !_gridScroll.hasClients) return;
    const rowHeight = 104.0 + 12.0; // mainAxisExtent + mainAxisSpacing
    final row = _selected ~/ _columnsFor(context);
    final target = row * rowHeight;
    final viewport = _gridScroll.position.viewportDimension;
    final offset = _gridScroll.offset;
    if (target < offset || target + rowHeight > offset + viewport) {
      _gridScroll.animateTo(
        (target - viewport / 2).clamp(0.0, _gridScroll.position.maxScrollExtent),
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    }
  }

  /// Columns, derived from width so the arrow keys match what is on screen.
  int _columnsFor(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    if (w < 700) return 3;
    if (w < 1100) return 5;
    return 7;
  }

  @override
  void dispose() {
    _search.removeListener(_onQuery);
    _search.dispose();
    _focus.dispose();
    _gridScroll.dispose();
    _index.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      focusNode: _focus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: Scaffold(
        backgroundColor: JarvisPalette.background,
        body: ScanlineOverlay(
          opacity: 0.6,
          child: SkinHost(
            skin: _skin,
            appCount: _appCount,
            child: Column(
              children: [
                _TopRail(
                count: _appCount,
                platform: AppEnumerator.platform,
                searching: _searching,
                searchController: _search,
                focusNode: _focus,
                skins: BuiltInSkins.all,
                currentSkin: _skin,
                onSkin: (skin) => setState(() => _skin = skin),
              ),
              Expanded(
                child: Stack(
                  children: [
                    // The reactor sits behind the grid, centred. It is the
                    // thing you look at while the index builds.
                    Center(
                      child: Opacity(
                        opacity: _loading ? 0.35 : 0.18,
                        child: Reactor(
                          size: 300,
                          intensity: _loading ? 1.0 : 0.6,
                          color: JarvisPalette.interface_,
                        ),
                      ),
                    ),
                    if (_loading)
                      // Not const: JarvisType.label is a static method call,
                      // and a method call is not a constant expression.
                      Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const BreathingArc(size: 22),
                            const SizedBox(height: 18),
                            Text(
                              'INDEXING APPLICATIONS',
                              style: JarvisType.label(
                                JarvisPalette.listening,
                                size: 10,
                              ),
                            ),
                          ],
                        ),
                      )
                    else
                      AppGrid(
                        apps: _results,
                        selected: _selected,
                        scrollController: _gridScroll,
                        columns: 7,
                        onLaunch: _launch,
                      ),
                  ],
                ),
              ),
              if (_error != null) _ErrorBar(message: _error!),
              Dock(items: _dock, onLaunch: _launch, onSettings: () {
                setState(() => _searching = true);
              }),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The top rail: identity on the left, clock and status on the right.
class _TopRail extends StatelessWidget {
  const _TopRail({
    required this.count,
    required this.platform,
    required this.searching,
    required this.searchController,
    required this.focusNode,
    required this.skins,
    required this.currentSkin,
    required this.onSkin,
  });

  final int count;
  final AppPlatform platform;
  final bool searching;
  final TextEditingController searchController;

  /// The workspace's own node, so the field and the key handler share it.
  final FocusNode focusNode;
  final List<Skin> skins;
  final Skin currentSkin;
  final void Function(Skin skin) onSkin;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(40, 26, 40, 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'J.A.R.V.I.S.',
                style: JarvisType.title(JarvisPalette.interface_).copyWith(
                  shadows: JarvisGlow.text(JarvisPalette.interface_),
                ),
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  const StatusLamp(color: JarvisPalette.listening),
                  const SizedBox(width: 8),
                  Text(
                    '$count APPLICATIONS',
                    style: JarvisType.label(JarvisPalette.inkDim, size: 9),
                  ),
                  const SizedBox(width: 16),
                  Text(
                    platform.label,
                    style: JarvisType.readout(
                      JarvisPalette.interface_.withValues(alpha: 0.7),
                      size: 9,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const Spacer(),
          if (searching)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(left: 40, right: 40, top: 4),
                child: SearchField(
                  controller: searchController,
                  focusNode: focusNode,
                ),
              ),
            )
          else
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkinPicker(
                  skins: skins,
                  current: currentSkin,
                  onSelect: onSkin,
                ),
                const SizedBox(width: 24),
                const ClockReadout(),
              ],
            ),
        ],
      ),
    );
  }
}

class _ErrorBar extends StatelessWidget {
  const _ErrorBar({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: JarvisPalette.alert.withValues(alpha: 0.14),
      padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 9),
      child: Text(
        message,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: JarvisType.readout(JarvisPalette.alert, size: 10),
      ),
    );
  }
}
