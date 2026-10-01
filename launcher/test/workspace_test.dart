// Tests for the pure-Dart logic — the parts with no platform channel and no
// Flutter binding, so they run anywhere `flutter test` runs.
//
// `flutter create` generates a test/widget_test.dart that pumps MyApp, which
// this project does not have. The CI job deletes it; this file is the real one.
import 'package:flutter_test/flutter_test.dart';

import 'package:jarvis_launcher/platform/system_stats.dart';
import 'package:jarvis_launcher/services/fuzzy.dart';

void main() {
  group('formatBytes', () {
    test('null reads as unknown, not zero', () {
      // A null byte count means "we could not ask". Showing 0 B would claim
      // the disk is empty, which is a different and wrong statement.
      expect(formatBytes(null), '--');
    });

    test('scales through the units', () {
      expect(formatBytes(0), '0 B');
      expect(formatBytes(512), '512 B');
      expect(formatBytes(2048), '2.0 K');
      expect(formatBytes(5 * 1024 * 1024), '5.0 M');
      expect(formatBytes(3 * 1024 * 1024 * 1024), '3.0 G');
    });

    test('rounds to one decimal, not more', () {
      // 1.5 GiB exactly. Anything longer than one decimal is noise on a bar
      // that is 300 pixels wide.
      expect(formatBytes(1024 * 1024 * 1024 + 512 * 1024 * 1024), '1.5 G');
    });
  });

  group('fuzzyMatch', () {
    test('empty query matches everything with score zero', () {
      final hit = fuzzyMatch('', 'Visual Studio Code');
      expect(hit, isNotNull);
      expect(hit!.score, 0);
    });

    test('empty text never matches', () {
      expect(fuzzyMatch('vs', ''), isNull);
    });

    test('is case-insensitive', () {
      expect(fuzzyMatch('VSCODE', 'vscode'), isNotNull);
      expect(fuzzyMatch('vscode', 'VSCODE'), isNotNull);
    });

    test('matches a subsequence', () {
      expect(fuzzyMatch('vsc', 'Visual Studio Code'), isNotNull);
    });

    test('rejects a non-subsequence', () {
      expect(fuzzyMatch('zzz', 'Visual Studio Code'), isNull);
    });

    test('scores a consecutive run above a scattered one', () {
      // The whole point of the matcher: "vs" should rank Visual Studio above
      // something that merely contains v and s far apart.
      final consecutive = fuzzyMatch('studio', 'Visual Studio Code');
      final scattered = fuzzyMatch('vsc', 'Visual Studio Code');
      expect(consecutive, isNotNull);
      expect(scattered, isNotNull);
      expect(consecutive!.score, greaterThan(scattered!.score));
    });

    test('reports which characters were matched', () {
      final hit = fuzzyMatch('vs', 'Visual Studio');
      expect(hit, isNotNull);
      expect(hit!.ranges, isNotEmpty);
      // Ranges are into the *name*, and must be ordered and non-overlapping.
      var last = -1;
      for (final r in hit.ranges) {
        expect(r.start, greaterThan(last));
        expect(r.end, greaterThanOrEqualTo(r.start));
        last = r.end;
      }
    });
  });
}
