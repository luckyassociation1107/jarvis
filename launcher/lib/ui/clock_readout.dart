import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/jarvis_theme.dart';

/// The clock.
///
/// A launcher's clock is glanced at, not read, so it is large and the seconds
/// are small. The date sits under it in the same wide-tracked label style the
/// rest of the HUD uses.
///
/// It ticks with a real [Timer] rather than an animation, because the value is
/// data and rendering it from a controller would mean deriving the time from
/// an elapsed duration — which drifts, and which is wrong the moment the
/// machine sleeps.
class ClockReadout extends StatefulWidget {
  const ClockReadout({super.key});

  @override
  State<ClockReadout> createState() => _ClockReadoutState();
}

class _ClockReadoutState extends State<ClockReadout> {
  Timer? _timer;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    // Aligned to the next whole second, then every second. Starting it
    // immediately would drift by however long the build took.
    final delay = Duration(milliseconds: 1000 - _now.millisecond);
    _timer = Timer(delay, _tick);
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

  String get _hhmm {
    final h = _now.hour.toString().padLeft(2, '0');
    final m = _now.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  String get _ss => _now.second.toString().padLeft(2, '0');

  static const _months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];

  static const _days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  String get _date =>
      '${_days[_now.weekday - 1]} ${_now.day.toString().padLeft(2, '0')} ${_months[_now.month - 1]}';

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        RichText(
          text: TextSpan(
            children: [
              TextSpan(
                text: _hhmm,
                style: JarvisType.readout(JarvisPalette.ink, size: 44).copyWith(
                  shadows: JarvisGlow.text(JarvisPalette.interface_, strength: 0.4),
                ),
              ),
              TextSpan(
                text: ' $_ss',
                style: JarvisType.readout(
                  JarvisPalette.interface_,
                  size: 16,
                ).copyWith(shadows: JarvisGlow.text(JarvisPalette.interface_)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 2),
        Text(
          _date,
          style: JarvisType.label(JarvisPalette.inkDim, size: 10, tracking: 0.3),
        ),
      ],
    );
  }
}
