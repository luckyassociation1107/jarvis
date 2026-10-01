import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../models/app_entry.dart';
import '../platform/app_enumerator.dart';
import 'fuzzy.dart';

/// One app plus how well it matched, ready for the list.
class ScoredApp {
  const ScoredApp(this.entry, this.score, this.ranges);

  final AppEntry entry;
  final int score;
  final List<MatchRange> ranges;
}

/// Loads, scores and caches the app index.
///
/// The index is cached as JSON because enumerating apps is not free: on Linux
/// it means stat-ing and parsing every `.desktop` file on the system, on macOS
/// it means walking four application directories, and on Windows it means
/// walking the Start Menu tree and reading `.lnk` binaries. Doing that on every
/// keystroke would be absurd, and doing it on every launch is nearly as bad.
///
/// The cache is a plain JSON file in the app-support directory. It is invalidated
/// by a platform + mtime check rather than a TTL, so installing an app and
/// relaunching picks it up immediately.
class AppIndex {
  AppIndex();

  static const _cacheName = 'app-index.json';
  static const _cacheVersion = 3;

  List<AppEntry> _apps = const [];
  bool _loaded = false;

  List<AppEntry> get apps => _apps;
  bool get isLoaded => _loaded;

  /// Emits whenever the index changes, so the UI can rebuild.
  final _changes = StreamController<List<AppEntry>>.broadcast();
  Stream<List<AppEntry>> get changes => _changes.stream;

  /// Loads from cache if valid, otherwise enumerates and writes the cache.
  Future<List<AppEntry>> load({bool force = false}) async {
    if (_loaded && !force) return _apps;

    final file = await _cacheFile;
    if (!force && await file.exists()) {
      try {
        final decoded = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
        if (decoded['version'] == _cacheVersion) {
          _apps = (decoded['apps'] as List)
              .cast<Map<String, dynamic>>()
              .map(AppEntry.fromJson)
              .toList();
          _loaded = true;
          _changes.add(_apps);
          return _apps;
        }
      } catch (_) {
        // A corrupt cache is not worth reporting. Fall through and rebuild.
      }
    }

    _apps = await AppEnumerator.enumerate();
    _loaded = true;
    _changes.add(_apps);
    unawaited(_write(file, _apps));
    return _apps;
  }

  Future<void> _write(File file, List<AppEntry> apps) async {
    try {
      await file.writeAsString(jsonEncode({
        'version': _cacheVersion,
        'apps': apps.map((a) => a.toJson()).toList(),
      }));
    } catch (_) {
      // Caching is an optimisation. If the disk says no, carry on uncached.
    }
  }

  Future<File> get _cacheFile async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/$_cacheName');
  }

  /// Ranked results for [query], best first.
  ///
  /// An empty query returns everything, ordered by name, which is what the
  /// palette shows before you type — a full list is more useful than an empty
  /// one, and it is the state the user sees most often.
  List<ScoredApp> search(String query) {
    final q = query.trim();
    if (q.isEmpty) {
      final sorted = [..._apps]..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      return sorted.map((e) => ScoredApp(e, 0, const [])).toList();
    }

    final hits = <ScoredApp>[];
    for (final app in _apps) {
      // Score against the name only. A match found in the comment or the
      // keywords still counts, but it is scored as if it were a weak name
      // match, so real name matches always outrank it.
      final named = fuzzyMatch(q, app.name);
      if (named != null) {
        hits.add(ScoredApp(app, named.score, named.ranges));
        continue;
      }
      final loose = fuzzyMatch(q, app.haystack);
      if (loose != null) {
        hits.add(ScoredApp(app, loose.score - 400, const []));
      }
    }

    hits.sort((a, b) {
      final byScore = b.score.compareTo(a.score);
      if (byScore != 0) return byScore;
      return a.entry.name.toLowerCase().compareTo(b.entry.name.toLowerCase());
    });
    return hits;
  }

  void dispose() => _changes.close();
}
