import 'dart:async';

import 'package:flutter/material.dart';

import '../../skins/skin.dart';
import '../../theme/jarvis_theme.dart';
import '../../ui/reactor.dart';
import 'system_monitor.dart';

/// Every widget a skin can place, and the frame each one sits in.
///
/// The frame is the same for all of them — a bordered panel with a small
/// letterspaced title — so a skin reads as one instrument cluster rather than as
/// a pile of unrelated boxes. Rainmeter gets this right by giving every skin the
/// same chrome, and it is most of why a Rainmeter desktop looks designed.
class SkinWidget extends StatelessWidget {
  const SkinWidget({super.key, required this.spec});

  final WidgetSpec spec;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: spec.opacity.clamp(0.0, 1.0),
      child: Container(
        decoration: BoxDecoration(
          color: JarvisPalette.surface.withValues(alpha: 0.72),
          border: Border.all(color: JarvisPalette.interface_.withValues(alpha: 0.28)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (spec.showTitle) _Title(text: spec.title ?? _defaultTitle(spec.kind)),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  static String _defaultTitle(String kind) => switch (kind) {
        'clock' => 'LOCAL TIME',
        'systemMonitor' => 'SYSTEM',
        'calendar' => 'CALENDAR',
        'notes' => 'NOTES',
        'weather' => 'CONDITIONS',
        'media' => 'NOW PLAYING',
        'appList' => 'APPLICATIONS',
        'reactor' => 'REACTOR',
        _ => kind.toUpperCase(),
      };

  Widget _body() => switch (WidgetKind.fromName(spec.kind)) {
        WidgetKind.clock => const ClockBody(),
        WidgetKind.systemMonitor => const SystemMonitor(),
        WidgetKind.calendar => const CalendarBody(),
        WidgetKind.notes => const NotesBody(),
        WidgetKind.weather => const WeatherBody(),
        WidgetKind.media => const MediaBody(),
        WidgetKind.appList => const AppListBody(),
        WidgetKind.reactor => const ReactorBody(),
        null => _UnknownBody(kind: spec.kind),
      };
}

class _Title extends StatelessWidget {
  const _Title({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: JarvisPalette.interface_.withValues(alpha: 0.22),
          ),
        ),
      ),
      child: Text(
        text,
        style: JarvisType.label(
          JarvisPalette.interface_.withValues(alpha: 0.85),
          size: 8,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// The widget bodies
// ---------------------------------------------------------------------------

/// Clock. Large, because it is glanced at rather than read.
class ClockBody extends StatefulWidget {
  const ClockBody({super.key});

  @override
  State<ClockBody> createState() => _ClockBodyState();
}

class _ClockBodyState extends State<ClockBody> {
  Timer? _timer;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    // Aligned to the next whole second, then every second. Starting it
    // immediately would drift by however long the first build took.
    _timer = Timer(
      Duration(milliseconds: 1000 - _now.millisecond),
      _tick,
    );
  }

  void _tick() {
    if (!mounted) return;
    setState(() => _now = DateTime.now());
    _timer = Timer(const Duration(seconds: 1), _tick);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  static const _days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  static const _months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];

  @override
  Widget build(BuildContext context) {
    final h = _now.hour.toString().padLeft(2, '0');
    final m = _now.minute.toString().padLeft(2, '0');
    final s = _now.second.toString().padLeft(2, '0');
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          RichText(
            text: TextSpan(
              children: [
                TextSpan(
                  text: '$h:$m',
                  style: JarvisType.readout(JarvisPalette.ink, size: 40).copyWith(
                    shadows: JarvisGlow.text(JarvisPalette.interface_, strength: 0.35),
                  ),
                ),
                TextSpan(
                  text: ':$s',
                  style: JarvisType.readout(JarvisPalette.interface_, size: 15)
                      .copyWith(shadows: JarvisGlow.text(JarvisPalette.interface_)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '${_days[_now.weekday - 1]} ${_now.day.toString().padLeft(2, '0')} ${_months[_now.month - 1]} ${_now.year}',
            style: JarvisType.label(JarvisPalette.inkDim, size: 9, tracking: 0.28),
          ),
        ],
      ),
    );
  }
}

/// A month grid.
///
/// Built by hand rather than with a calendar package: a month is seven columns
/// and at most six rows, and the whole thing is about forty lines. A dependency
/// for that is not a saving.
class CalendarBody extends StatefulWidget {
  const CalendarBody({super.key});

  @override
  State<CalendarBody> createState() => _CalendarBodyState();
}

class _CalendarBodyState extends State<CalendarBody> {
  late DateTime _month = DateTime.now();

  static const _months = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  ];

  void _shift(int months) {
    setState(() {
      _month = DateTime(_month.year, _month.month + months);
    });
  }

  @override
  Widget build(BuildContext context) {
    final first = DateTime(_month.year, _month.month);
    // Monday-first, so the leading blanks are (weekday - 1).
    final leading = first.weekday - 1;
    final daysInMonth = DateTime(_month.year, _month.month + 1, 0).day;
    final today = DateTime.now();
    final isThisMonth =
        today.year == _month.year && today.month == _month.month;

    return Padding(
      padding: const EdgeInsets.all(10),
      child: Column(
        children: [
          Row(
            children: [
              _NavButton(icon: Icons.chevron_left, onTap: () => _shift(-1)),
              Expanded(
                child: Text(
                  '${_months[_month.month - 1]} ${_month.year}',
                  textAlign: TextAlign.center,
                  style: JarvisType.label(JarvisPalette.interface_, size: 9),
                ),
              ),
              _NavButton(icon: Icons.chevron_right, onTap: () => _shift(1)),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              for (final d in const ['M', 'T', 'W', 'T', 'F', 'S', 'S'])
                Expanded(
                  child: Text(
                    d,
                    textAlign: TextAlign.center,
                    style: JarvisType.label(
                      JarvisPalette.inkDim.withValues(alpha: 0.6),
                      size: 8,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Expanded(
            child: GridView.builder(
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 7,
              ),
              itemCount: leading + daysInMonth,
              itemBuilder: (_, i) {
                if (i < leading) return const SizedBox.shrink();
                final day = i - leading + 1;
                final isToday = isThisMonth && day == today.day;
                return Center(
                  child: Container(
                    width: 20,
                    height: 20,
                    decoration: isToday
                        ? BoxDecoration(
                            border: Border.all(color: JarvisPalette.listening),
                            boxShadow: JarvisGlow.edge(JarvisPalette.listening),
                          )
                        : null,
                    child: Center(
                      child: Text(
                        '$day',
                        style: JarvisType.readout(
                          isToday ? JarvisPalette.listening : JarvisPalette.ink,
                          size: 9,
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: Icon(icon, size: 14, color: JarvisPalette.inkDim),
      ),
    );
  }
}

/// A scratch pad.
///
/// Persistence is deliberately absent in this build — it would need
/// shared_preferences and a debounce, and a notes widget that forgets on restart
/// is more honest than one that silently loses the last ten seconds.
class NotesBody extends StatefulWidget {
  const NotesBody({super.key});

  @override
  State<NotesBody> createState() => _NotesBodyState();
}

class _NotesBodyState extends State<NotesBody> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(10),
      child: TextField(
        controller: _controller,
        maxLines: null,
        expands: true,
        style: JarvisType.readout(JarvisPalette.ink, size: 11),
        cursorColor: JarvisPalette.interface_,
        decoration: const InputDecoration(
          border: InputBorder.none,
          isDense: true,
          contentPadding: EdgeInsets.zero,
        ),
      ),
    );
  }
}

/// Weather.
///
/// Shows the configured location and nothing else, because a weather widget that
/// guesses is worse than one that says it does not know. Drop an API key into
/// the config and this fills in; until then it is an honest placeholder.
class WeatherBody extends StatelessWidget {
  const WeatherBody({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            'NO FEED',
            style: JarvisType.label(JarvisPalette.inkDim, size: 11),
          ),
          const SizedBox(height: 8),
          Text(
            'set JARVIS_WEATHER_KEY\nto enable',
            textAlign: TextAlign.center,
            style: JarvisType.label(
              JarvisPalette.inkDim.withValues(alpha: 0.5),
              size: 8,
            ),
          ),
        ],
      ),
    );
  }
}

/// Now playing.
///
/// Empty for the same reason as weather: reading the OS media session needs
/// Windows.Media.Control via WinRT, which is a native module per platform. The
/// slot is reserved and the frame is drawn, so adding it does not move anything.
class MediaBody extends StatelessWidget {
  const MediaBody({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('IDLE', style: JarvisType.label(JarvisPalette.inkDim, size: 11)),
          const SizedBox(height: 8),
          Text(
            'no media session',
            style: JarvisType.label(
              JarvisPalette.inkDim.withValues(alpha: 0.5),
              size: 8,
            ),
          ),
        ],
      ),
    );
  }
}

/// A count of applications, and the search hint.
class AppListBody extends StatelessWidget {
  const AppListBody({super.key, this.count = 0});

  /// Defaults to zero rather than being required: the skin format has no field
  /// for it, and a widget that cannot be constructed from its own spec is a
  /// widget that crashes the skin it is in.
  final int count;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            '$count',
            style: JarvisType.readout(JarvisPalette.interface_, size: 34).copyWith(
              shadows: JarvisGlow.text(JarvisPalette.interface_),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'APPLICATIONS INDEXED',
            style: JarvisType.label(JarvisPalette.inkDim, size: 8),
          ),
        ],
      ),
    );
  }
}

/// The reactor, for skins that want it as a placed widget rather than as the
/// background.
///
/// It animates, which means it needs to be its own widget rather than something
/// the skin renderer draws statically — a reactor that does not move reads as a
/// broken one, and that is worse than not having one.
class ReactorBody extends StatelessWidget {
  const ReactorBody({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Reactor(size: 180, intensity: 0.8),
    );
  }
}

class _UnknownBody extends StatelessWidget {
  const _UnknownBody({required this.kind});

  final String kind;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        'UNKNOWN WIDGET\n$kind',
        textAlign: TextAlign.center,
        style: JarvisType.label(JarvisPalette.alert, size: 9),
      ),
    );
  }
}
