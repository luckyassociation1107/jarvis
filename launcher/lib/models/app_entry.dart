/// One launchable thing.
///
/// Deliberately not a class hierarchy per platform. A `.desktop` file, a `.app`
/// bundle and an Android package are the same idea — a name, an icon, and
/// something you can hand to the OS to start — so they collapse into one type
/// and the platform differences live entirely in how one is produced and how
/// one is launched. That keeps the UI and the search completely platform-blind.
class AppEntry {
  const AppEntry({
    required this.id,
    required this.name,
    required this.exec,
    required this.platform,
    this.iconPath,
    this.comment,
    this.keywords = const [],
    this.categories = const [],
  });

  /// Stable across runs. On Android this is the package name; on desktop it is
  /// the absolute path to the bundle or `.desktop` file. Used as the map key,
  /// so it has to be unique per platform.
  final String id;

  final String name;

  /// What to hand to the OS to start it.
  ///
  /// A path on every desktop platform, a package name on Android. The
  /// [Launcher] knows which it is holding because [platform] tells it.
  final String exec;

  final AppPlatform platform;

  /// Absolute path to an icon, when one can be found. Nullable on purpose —
  /// a missing icon is normal (a `.desktop` file with no `Icon=` key, a bare
  /// `.exe` with no embedded resource) and must degrade to a glyph rather than
  /// crash the index.
  final String? iconPath;

  final String? comment;

  /// Extra search terms. From the `.desktop` `Keywords=` key and, on Android,
  /// from nothing — Android gives no keywords, so those stay empty.
  final List<String> keywords;

  /// From the `.desktop` `Categories=` key, used for grouping.
  final List<String> categories;

  /// Everything a query is matched against.
  String get haystack =>
      [name, comment ?? '', ...keywords, ...categories].join(' ').toLowerCase();

  // --- cache serialisation -------------------------------------------------
  // Hand-written rather than generated. The cache is a private format read by
  // exactly one version of exactly one program, so a code generator and its
  // build step would be more machinery than the format deserves.

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'exec': exec,
        'platform': platform.name,
        if (iconPath != null) 'iconPath': iconPath,
        if (comment != null) 'comment': comment,
        if (keywords.isNotEmpty) 'keywords': keywords,
        if (categories.isNotEmpty) 'categories': categories,
      };

  static AppEntry fromJson(Map<String, dynamic> json) => AppEntry(
        id: json['id'] as String,
        name: json['name'] as String,
        exec: json['exec'] as String,
        // An unknown platform name would throw, and a cache written by a newer
        // build must not brick the launcher — so fall back rather than crash.
        platform: AppPlatform.values.firstWhere(
          (p) => p.name == json['platform'],
          orElse: () => AppPlatform.linux,
        ),
        iconPath: json['iconPath'] as String?,
        comment: json['comment'] as String?,
        keywords: (json['keywords'] as List?)?.cast<String>() ?? const [],
        categories: (json['categories'] as List?)?.cast<String>() ?? const [],
      );

  @override
  bool operator ==(Object other) =>
      other is AppEntry && other.id == id && other.platform == platform;

  @override
  int get hashCode => Object.hash(id, platform);
}

enum AppPlatform { android, windows, macos, linux }

extension AppPlatformLabel on AppPlatform {
  String get label => switch (this) {
        AppPlatform.android => 'ANDROID',
        AppPlatform.windows => 'WINDOWS',
        AppPlatform.macos => 'MACOS',
        AppPlatform.linux => 'LINUX',
      };
}
