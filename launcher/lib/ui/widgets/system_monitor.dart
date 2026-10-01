import 'dart:async';

import 'package:flutter/material.dart';

import '../../platform/system_stats.dart';
import '../../services/memory_budget.dart';
import '../../theme/jarvis_theme.dart';

/// CPU, memory and disk, as three bars and three readouts.
///
/// The bars are the important part. A number alone is data; a number next to a
/// bar is an instrument, and the difference is why Rainmeter skins look like
/// equipment rather than like a settings page.
///
/// Samples every two seconds. Faster and the bars jitter without telling you
/// anything new; slower and a spike you caused is gone before it registers.
class SystemMonitor extends StatefulWidget {
  const SystemMonitor({super.key});

  @override
  State<SystemMonitor> createState() => _SystemMonitorState();
}

class _SystemMonitorState extends State<SystemMonitor> {
  Timer? _timer;
  SystemSnapshot _snap = const SystemSnapshot(supported: false);

  @override
  void initState() {
    super.initState();
    _sample();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => _sample());
  }

  Future<void> _sample() async {
    final next = await SystemStats.sample(previous: _snap);
    if (!mounted) return;
    setState(() => _snap = next);
    // The first real sample is when the app learns how much memory the machine
    // actually has. Everything before it runs on the `standard` default, which
    // is the tier the UI was designed against.
    MemoryBudget.refresh(next.memoryTotalBytes);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_snap.supported) {
      return const _Unsupported();
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Bar(
            label: 'CPU',
            fraction: _snap.cpuPercent == null ? null : _snap.cpuPercent! / 100,
            readout: _snap.cpuPercent == null ? 'SAMPLING' : '${_snap.cpuPercent}%',
            color: JarvisPalette.listening,
          ),
          const SizedBox(height: 12),
          _Bar(
            label: 'MEM',
            fraction: _snap.memoryFraction,
            readout: '${_snap.memoryLoad ?? 0}%',
            detail:
                '${formatBytes(_snap.memoryUsedBytes)} / ${formatBytes(_snap.memoryTotalBytes)}',
            color: JarvisPalette.thinking,
          ),
          const SizedBox(height: 12),
          _Bar(
            label: 'DSK',
            fraction: _snap.diskFraction,
            readout: '${((_snap.diskFraction ?? 0) * 100).round()}%',
            detail: '${formatBytes(_snap.diskFreeBytes)} free',
            color: JarvisPalette.tooling,
          ),
        ],
      ),
    );
  }
}

/// One labelled bar.
class _Bar extends StatelessWidget {
  const _Bar({
    required this.label,
    required this.fraction,
    required this.readout,
    required this.color,
    this.detail,
  });

  final String label;

  /// 0..1. Null means "not known yet", which draws the bar empty rather than
  /// at zero — those read very differently.
  final double? fraction;
  final String readout;
  final Color color;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(label, style: JarvisType.label(color, size: 9)),
            const Spacer(),
            Text(
              readout,
              style: JarvisType.readout(JarvisPalette.ink, size: 11).copyWith(
                shadows: JarvisGlow.text(color, strength: 0.5),
              ),
            ),
          ],
        ),
        const SizedBox(height: 5),
        // The track. A 1px border and no fill, so the empty part is visible
        // rather than implied.
        Container(
          height: 6,
          decoration: BoxDecoration(
            border: Border.all(color: color.withValues(alpha: 0.35)),
          ),
          child: FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: (fraction ?? 0).clamp(0.0, 1.0),
            child: Container(
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.85),
                boxShadow: JarvisGlow.edge(color, strength: 0.8),
              ),
            ),
          ),
        ),
        if (detail != null) ...[
          const SizedBox(height: 4),
          Text(detail!, style: JarvisType.readout(JarvisPalette.inkDim, size: 8)),
        ],
      ],
    );
  }
}

class _Unsupported extends StatelessWidget {
  const _Unsupported();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'SYSTEM STATS\nWINDOWS ONLY',
          textAlign: TextAlign.center,
          style: JarvisType.label(JarvisPalette.inkDim, size: 9),
        ),
      ),
    );
  }
}
