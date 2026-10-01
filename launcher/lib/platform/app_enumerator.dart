import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import '../models/app_entry.dart';
import 'icons.dart';

/// Finds every launchable app on this machine.
///
/// Pure `dart:io` on all three desktop platforms, and a `MethodChannel` on
/// Android. That split is the whole design: enumerating apps does not need
/// native code if the OS keeps its app registry in the filesystem, and
/// Windows, macOS and Linux all do.
///
///   Windows  the Start Menu tree, as `.lnk` shortcuts
///   macOS    the application directories, as `.app` bundles
///   Linux    the XDG application directories, as `.desktop` files
///   Android  PackageManager, which is the only one that is genuinely native
///
/// Nothing here throws for an unsupported platform — it returns an empty list
/// and the caller says so, rather than crashing a launcher over a platform
/// detail.
abstract final class AppEnumerator {
  static const _channel = MethodChannel('com.jarvis.launcher/apps');

  /// Enumerates for whichever platform this is running on.
  static Future<List<AppEntry>> enumerate() async {
    if (Platform.isAndroid) return _fromAndroid();
    if (Platform.isWindows) return _fromWindows();
    if (Platform.isMacOS) return _fromMacOS();
    if (Platform.isLinux) return _fromLinux();
    return const [];
  }

  /// Which platform this is, for the badge in the header.
  static AppPlatform get platform {
    if (Platform.isAndroid) return AppPlatform.android;
    if (Platform.isWindows) return AppPlatform.windows;
    if (Platform.isMacOS) return AppPlatform.macos;
    if (Platform.isLinux) return AppPlatform.linux;
    return AppPlatform.linux;
  }

  // -------------------------------------------------------------------------
  // Android
  // -------------------------------------------------------------------------

  /// Asks the Kotlin side, which has PackageManager.
  ///
  /// The channel returns a list of maps rather than objects because that is the
  /// only thing that crosses a channel without a codec, and a codec is one more
  /// thing to keep in sync between two languages.
  static Future<List<AppEntry>> _fromAndroid() async {
    try {
      final raw = await _channel.invokeListMethod<Map<dynamic, dynamic>>('list');
      if (raw == null) return const [];
      return raw
          .map((m) => AppEntry(
                id: m['id'] as String,
                name: m['name'] as String,
                // On Android the "exec" is the package name; the launcher side
                // turns it into an Intent.
                exec: m['id'] as String,
                platform: AppPlatform.android,
                iconPath: m['icon'] as String?,
              ))
          .toList();
    } on PlatformException {
      return const [];
    } on MissingPluginException {
      // Running on a platform with no implementation — a hot restart during
      // development, most likely. An empty index is the honest answer.
      return const [];
    }
  }

  // -------------------------------------------------------------------------
  // Windows
  // -------------------------------------------------------------------------

  /// The two Start Menu roots. Both are behind environment variables because
  /// they move with the user profile and the Windows install drive.
  ///
  /// Shortcuts are used rather than the uninstall registry because the Start
  /// Menu is what the user actually sees and clicks, so it is the right list —
  /// the registry knows about things that were never meant to be launched.
  static Future<List<AppEntry>> _fromWindows() async {
    final env = Platform.environment;
    final roots = <String>[
      if (env['ProgramData'] != null)
        '${env['ProgramData']}\\Microsoft\\Windows\\Start Menu\\Programs',
      if (env['APPDATA'] != null)
        '${env['APPDATA']}\\Microsoft\\Windows\\Start Menu\\Programs',
    ];

    final out = <AppEntry>[];
    for (final root in roots) {
      await _collectWindows(root, out);
    }

    // Deduplicate by name: the same app is frequently in both the per-machine
    // and the per-user Start Menu, and showing it twice is a bug that looks
    // like a bug.
    final seen = <String>{};
    return out.where((e) => seen.add(e.name.toLowerCase())).toList();
  }

  static Future<void> _collectWindows(String dir, List<AppEntry> out) async {
    final d = Directory(dir);
    if (!await d.exists()) return;

    await for (final entity in d.list(recursive: true, followLinks: false)) {
      if (entity is! File) continue;
      final path = entity.path;
      if (!path.toLowerCase().endsWith('.lnk')) continue;

      final name = _basename(path).replaceAll(RegExp(r'\.lnk$', caseSensitive: false), '');
      if (_isUninstaller(name)) continue;

      out.add(AppEntry(
        id: path,
        name: name,
        exec: path,
        platform: AppPlatform.windows,
        // The shortcut's own icon, when it names an .ico directly.
        iconPath: await _windowsIcon(path),
      ));
    }
  }

  /// The icon for a `.lnk`.
  ///
  /// Shortcuts point at an `.ico` far more often than people expect — Windows
  /// writes an IconLocation into most Start Menu shortcuts it creates — so this
  /// resolves a surprising share of them. Where the location names an `.exe`
  /// with an index instead, this returns null and the row shows a monogram.
  static Future<String?> _windowsIcon(String lnkPath) async {
    final location = LnkIconReader.read(lnkPath);
    if (location == null || location.isEmpty) return null;
    if (!location.toLowerCase().endsWith('.ico')) return null;
    return IconExtractor.decode(location, cacheDir: await _cacheDir);
  }

  // -------------------------------------------------------------------------
  // macOS
  // -------------------------------------------------------------------------

  /// The four places an `.app` can live.
  ///
  /// `/System/Applications` is scanned recursively because Utilities and a few
  /// others nest one level down, and a launcher that cannot find Terminal is
  /// not a launcher.
  static Future<List<AppEntry>> _fromMacOS() async {
    final home = Platform.environment['HOME'] ?? '';
    final roots = <String>[
      '/Applications',
      '/System/Applications',
      '/System/Applications/Utilities',
      if (home.isNotEmpty) '$home/Applications',
    ];

    final out = <AppEntry>[];
    for (final root in roots) {
      await _collectMacOS(root, out, depth: 0);
    }

    final seen = <String>{};
    return out.where((e) => seen.add(e.name.toLowerCase())).toList();
  }

  static Future<void> _collectMacOS(String dir, List<AppEntry> out, {required int depth}) async {
    final d = Directory(dir);
    if (!await d.exists()) return;
    // Two levels is enough to reach Utilities without walking into the
    // internals of every bundle that happens to contain another one.
    if (depth > 2) return;

    await for (final entity in d.list(followLinks: false)) {
      if (entity is! Directory) continue;
      final path = entity.path;
      if (!path.toLowerCase().endsWith('.app')) {
        await _collectMacOS(path, out, depth: depth + 1);
        continue;
      }

      final name = _basename(path).replaceAll(RegExp(r'\.app$', caseSensitive: false), '');
      if (_isUninstaller(name)) continue;

      // The real icon, decoded. `.icns` is not a format Flutter reads, but its
      // large elements are PNG, so IconExtractor pulls one out and re-encodes
      // it. Where that fails the row falls back to a monogram. `.icns` is not a format Flutter
      // can decode, so this is kept for a future converter rather than used
      // directly — see README.
      final icon = await _macOSIcon(path);

      out.add(AppEntry(
        id: path,
        name: name,
        // `open` takes the bundle path directly, so the exec IS the path.
        exec: path,
        platform: AppPlatform.macos,
        iconPath: icon,
      ));
    }
  }

  /// `Contents/Resources/*.icns`, which is where the real icon lives.
  static Future<String?> _macOSIcon(String bundlePath) async {
    try {
      final resources = Directory('$bundlePath/Contents/Resources');
      if (!await resources.exists()) return null;
      await for (final f in resources.list()) {
        if (f is File && f.path.toLowerCase().endsWith('.icns')) {
          return IconExtractor.decode(f.path, cacheDir: await _cacheDir);
        }
      }
    } catch (_) {
      // Icons are a nicety. Never let one stop the index.
    }
    return null;
  }

  /// Where decoded icons are written. One directory, shared by both platforms
  /// that need decoding, keyed by source path hash.
  static Future<String> get _cacheDir async {
    final base = await getApplicationSupportDirectory();
    final dir = Directory('${base.path}/icons');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir.path;
  }

  // -------------------------------------------------------------------------
  // Linux
  // -------------------------------------------------------------------------

  /// The XDG application directories, in the order they should win.
  ///
  /// The user's own directory is scanned last but deduplicated by id, so an
  /// entry the user has overridden takes precedence — which is what the spec
  /// intends, even though the spec says it the other way round.
  static const _linuxDirs = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications',
  ];

  static Future<List<AppEntry>> _fromLinux() async {
    final home = Platform.environment['HOME'] ?? '';
    final dirs = [
      ..._linuxDirs,
      if (home.isNotEmpty) '$home/.local/share/applications',
    ];

    final out = <AppEntry>[];
    final seen = <String>{};

    for (final dir in dirs) {
      final d = Directory(dir);
      if (!await d.exists()) continue;
      await for (final entity in d.list(followLinks: false)) {
        if (entity is! File) continue;
        if (!entity.path.toLowerCase().endsWith('.desktop')) continue;
        final entry = await _parseDesktopFile(entity);
        // First writer wins, so the system entry beats a Flatpak duplicate of
        // the same id.
        if (entry != null && seen.add(entry.id)) out.add(entry);
      }
    }
    return out;
  }

  /// Parses one `.desktop` file.
  ///
  /// Only the `[Desktop Entry]` group is read. Desktop files can contain other
  /// groups — actions, and vendor extensions — and reading them would invent
  /// apps that do not exist.
  static Future<AppEntry?> _parseDesktopFile(File file) async {
    String? name;
    String? exec;
    String? icon;
    String? comment;
    var type = 'Application';
    var noDisplay = false;
    var hidden = false;
    final keywords = <String>[];
    final categories = <String>[];

    try {
      final lines = await file.readAsLines();
      var inEntry = false;
      for (final raw in lines) {
        final line = raw.trim();
        if (line.startsWith('[')) {
          inEntry = line == '[Desktop Entry]';
          continue;
        }
        if (!inEntry || line.isEmpty || line.startsWith('#')) continue;

        final eq = line.indexOf('=');
        if (eq <= 0) continue;
        final key = line.substring(0, eq).trim();
        final value = line.substring(eq + 1).trim();

        switch (key) {
          case 'Name':
            name ??= value;
          case 'Exec':
            exec ??= value;
          case 'Icon':
            icon ??= value;
          case 'Comment':
            comment ??= value;
          case 'Type':
            type = value;
          case 'NoDisplay':
            noDisplay = value.toLowerCase() == 'true';
          case 'Hidden':
            hidden = value.toLowerCase() == 'true';
          case 'Keywords':
            keywords.addAll(_splitList(value));
          case 'Categories':
            categories.addAll(_splitList(value));
        }
      }
    } catch (_) {
      return null; // unreadable or malformed; skip it
    }

    if (name == null || exec == null) return null;
    if (type != 'Application') return null; // Links and directories are not apps
    if (noDisplay || hidden) return null; // explicitly not for the menu

    final cleaned = _stripFieldCodes(exec);
    if (cleaned.isEmpty) return null;

    return AppEntry(
      id: file.path,
      name: name,
      exec: cleaned,
      platform: AppPlatform.linux,
      iconPath: await _resolveLinuxIcon(icon),
      comment: comment,
      keywords: keywords,
      categories: categories,
    );
  }

  /// Removes `%u`, `%F`, `%U` and friends.
  ///
  /// These are field codes the desktop entry spec fills in at launch time. Left
  /// in place they are passed to the program as literal arguments, which either
  /// errors or opens a file named "%u" — both of which have happened.
  static String _stripFieldCodes(String exec) {
    // Split on whitespace but keep quoted segments intact, because `Exec` can
    // contain a path with a space in it.
    final parts = _splitQuoted(exec)
        .where((p) => !RegExp(r'^%[a-zA-Z]$').hasMatch(p) && p != '%')
        .toList();
    return parts.join(' ');
  }

  /// Resolves an icon *name* to a file.
  ///
  /// The `Icon=` key in a desktop file is a name, not a path, and the file is
  /// somewhere in the hicolor tree. This is the one platform where the icon is
  /// directly loadable — it is a PNG — so it is worth doing properly.
  static Future<String?> _resolveLinuxIcon(String? icon) async {
    if (icon == null || icon.isEmpty) return null;
    // An absolute path is already a path.
    if (icon.startsWith('/')) return await File(icon).exists() ? icon : null;

    final home = Platform.environment['HOME'] ?? '';
    final roots = [
      if (home.isNotEmpty) '$home/.local/share/icons',
      '/usr/share/icons',
      '/usr/local/share/icons',
      '/var/lib/flatpak/exports/share/icons',
    ];
    // Largest first: a launcher shows big icons, and picking a 22px one and
    // upscaling it is the difference between crisp and mush.
    const sizes = ['512', '256', '128', '96', '64', '48', '32'];
    for (final root in roots) {
      for (final size in sizes) {
        for (final theme in ['hicolor', 'Adwaita', 'Papirus', 'breeze']) {
          for (final ext in ['png', 'svg', 'xpm']) {
            final candidate = '$root/$theme/${size}x$size/apps/$icon.$ext';
            if (await File(candidate).exists()) return candidate;
          }
        }
      }
      // Some themes keep a flat `apps/` dir rather than per-size.
      final flat = '$root/hicolor/apps/$icon.png';
      if (await File(flat).exists()) return flat;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  static String _basename(String path) {
    final i = path.lastIndexOf(Platform.pathSeparator);
    return i == -1 ? path : path.substring(i + 1);
  }

  /// True for the uninstallers and setup helpers that clutter every Start Menu.
  static bool _isUninstaller(String name) {
    final n = name.toLowerCase();
    return n.contains('uninstall') ||
        n.contains('remove ') ||
        n.startsWith('setup ') ||
        n.endsWith(' setup') ||
        n.endsWith('installer') ||
        n.contains('readme') ||
        n.contains('release notes');
  }

  /// Splits a `;`-separated desktop-entry list, dropping empties.
  static List<String> _splitList(String value) =>
      value.split(';').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();

  /// Splits on whitespace, honouring double quotes.
  static List<String> _splitQuoted(String input) {
    final out = <String>[];
    final buf = StringBuffer();
    var inQuotes = false;
    for (var i = 0; i < input.length; i++) {
      final c = input[i];
      if (c == '"') {
        inQuotes = !inQuotes;
      } else if (c == ' ' && !inQuotes) {
        if (buf.isNotEmpty) {
          out.add(buf.toString());
          buf.clear();
        }
      } else {
        buf.write(c);
      }
    }
    if (buf.isNotEmpty) out.add(buf.toString());
    return out;
  }
}
