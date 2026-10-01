import 'dart:ui' as ui;


/// How much this machine can afford.
///
/// The brief was "works from 500 MB of RAM to 32 GB", which is a thirty-two-fold
/// range and cannot be served by one set of defaults. A frosted-glass panel and
/// a 60 fps reactor are free on a 32 GB desktop and ruin a 500 MB box.
///
/// So the app asks the OS how much memory exists and picks a tier. Nothing here
/// is a guess about the CPU or the GPU — those are unreadable without a native
/// module — but total RAM is the single best proxy available and it is one
/// kernel32 call, which we already make for the system monitor.
enum MemoryTier {
  /// Under ~2 GB. No blur, no animation, tiny caches, monogram-only icons.
  minimal,

  /// 2–4 GB. Blur off, reactor throttled, small icon cache.
  low,

  /// 4–8 GB. The full look, moderate caches.
  standard,

  /// Over 8 GB. Full look, generous caches, nothing degraded.
  high,
}

/// The numbers a tier actually changes.
class Budget {
  const Budget({
    required this.tier,
    required this.iconCacheBytes,
    required this.blur,
    required this.reactorFps,
    required this.iconPixels,
  });

  final MemoryTier tier;

  /// Hard ceiling on decoded icon memory, in bytes.
  ///
  /// This is the number that matters. A 256px RGBA icon is 256 KB decoded; a
  /// thousand of them is 256 MB, which on a 500 MB machine is the whole budget
  /// spent on pictures. The cache evicts rather than grows.
  final int iconCacheBytes;

  /// Whether panels get a BackdropFilter. Each one costs a render surface, and
  /// they are the most expensive thing in the UI.
  final bool blur;

  /// Reactor frames per second. 0 means draw it once and stop.
  final int reactorFps;

  /// Longest edge an icon is decoded to, in pixels.
  ///
  /// Decoding a 256px icon to show it at 56px wastes 20x the memory. Flutter
  /// decodes to the target size when asked, which is why this is a budget knob
  /// and not just a display size.
  final int iconPixels;

  static const minimal = Budget(
    tier: MemoryTier.minimal,
    iconCacheBytes: 8 * 1024 * 1024,
    blur: false,
    reactorFps: 0,
    iconPixels: 48,
  );

  static const low = Budget(
    tier: MemoryTier.low,
    iconCacheBytes: 24 * 1024 * 1024,
    blur: false,
    reactorFps: 12,
    iconPixels: 64,
  );

  static const standard = Budget(
    tier: MemoryTier.standard,
    iconCacheBytes: 64 * 1024 * 1024,
    blur: true,
    reactorFps: 30,
    iconPixels: 96,
  );

  static const high = Budget(
    tier: MemoryTier.high,
    iconCacheBytes: 160 * 1024 * 1024,
    blur: true,
    reactorFps: 60,
    iconPixels: 128,
  );
}

/// Reads the machine and hands out a [Budget].
///
/// Total RAM is one kernel32 call, but the FFI path here is async, and this runs
/// before the first frame. So the sequence is: start at `standard` — the tier the
/// UI was designed against, and the one where being wrong costs smoothness
/// rather than correctness — then refine the moment the first real sample lands.
///
/// A machine does not gain RAM, so this converges on the first sample and never
/// changes again.
class MemoryBudget {
  const MemoryBudget._();

  static Budget _current = Budget.standard;

  static Budget get current => _current;

  /// Called from the system monitor's first sample.
  static void refresh(int? totalBytes) {
    if (totalBytes == null || totalBytes <= 0) return;
    final gb = totalBytes / (1024 * 1024 * 1024);
    final next = switch (gb) {
      < 2 => Budget.minimal,
      < 4 => Budget.low,
      < 8 => Budget.standard,
      _ => Budget.high,
    };
    if (next.tier != _current.tier) _current = next;
  }

  /// Test seam. Production never calls this.
  static void overrideWith(Budget b) => _current = b;
}

/// A byte-bounded, LRU cache of decoded icons.
///
/// `ImageCache` is the obvious thing to reach for and it is the wrong one here:
/// it is sized in *images* (default 1000) and knows nothing about bytes, so a
/// thousand 256px icons is 256 MB regardless of how much the machine has. This
/// is sized in bytes and evicts.
///
/// Eviction is LRU on read, which is what a grid scroll actually produces: the
/// icons you just saw are the ones you are about to see again.
class IconStore {
  IconStore({int? maxBytes})
      : maxBytes = maxBytes ?? MemoryBudget.current.iconCacheBytes;

  final int maxBytes;

  final _entries = <String, _Entry>{};
  int _bytes = 0;

  /// Reads that hit. A miss returns null and the caller decodes.
  int get hits => _hits;
  int get misses => _misses;
  int _hits = 0;
  int _misses = 0;

  int get bytes => _bytes;
  int get count => _entries.length;

  ui.Image? get(String path) {
    final e = _entries.remove(path);
    if (e == null) {
      _misses++;
      return null;
    }
    _hits++;
    // Re-inserting moves it to the end of the iteration order, which is what
    // makes this LRU rather than FIFO.
    _entries[path] = e;
    return e.image;
  }

  void put(String path, ui.Image image) {
    final cost = _costOf(image);
    // An image larger than the whole budget is not cacheable. Decoding it still
    // worked, so return it once and let the GC have it.
    if (cost > maxBytes) return;

    _entries.remove(path);
    _entries[path] = _Entry(image, cost);
    _bytes += cost;
    _evict();
  }

  void _evict() {
    // Iteration order is insertion order, so the front is the least recently
    // used. Evicting from the front is the whole algorithm.
    while (_bytes > maxBytes && _entries.isNotEmpty) {
      final victim = _entries.keys.first;
      final e = _entries.remove(victim);
      if (e != null) _bytes -= e.cost;
    }
  }

  static int _costOf(ui.Image image) =>
      image.width * image.height * 4; // RGBA8

  void clear() {
    _entries.clear();
    _bytes = 0;
  }

  /// Diagnostics for the system-monitor widget.
  String get summary =>
      '${(bytes / 1048576).toStringAsFixed(1)}/${(maxBytes / 1048576).toStringAsFixed(0)}MB '
      '${count} icons ${_hits}h/${_misses}m';
}

class _Entry {
  const _Entry(this.image, this.cost);

  final ui.Image image;
  final int cost;
}
