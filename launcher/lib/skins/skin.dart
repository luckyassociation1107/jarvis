import 'dart:convert';
import 'dart:io';

/// A skin: a named arrangement of widgets on the JARVIS surface.
///
/// Rainmeter's model, which is the right one and worth copying exactly: a skin
/// is *data*, not code. It is a JSON file that says which widgets exist, where
/// they sit, how big they are, and which accent they use. The renderer knows how
/// to draw a clock and a system monitor; the skin only says where they go.
///
/// That split is what makes skins shareable and writable by hand. A skin that
/// needed a recompile to change a corner radius would not be a skin, it would be
/// a theme option.
class Skin {
  const Skin({
    required this.id,
    required this.name,
    required this.author,
    required this.description,
    required this.widgets,
    this.accent,
  });

  final String id;
  final String name;
  final String author;
  final String description;
  final List<WidgetSpec> widgets;

  /// Overrides the interface cyan for this skin. Null means the default.
  final String? accent;

  static Skin fromJson(Map<String, dynamic> json) => Skin(
        id: json['id'] as String,
        name: json['name'] as String,
        author: json['author'] as String? ?? 'unknown',
        description: json['description'] as String? ?? '',
        accent: json['accent'] as String?,
        widgets: (json['widgets'] as List? ?? [])
            .cast<Map<String, dynamic>>()
            .map(WidgetSpec.fromJson)
            .toList(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'author': author,
        'description': description,
        if (accent != null) 'accent': accent,
        'widgets': widgets.map((w) => w.toJson()).toList(),
      };

  /// Reads a skin from disk. Throws [SkinException] with something readable.
  static Skin load(String path) {
    final file = File(path);
    if (!file.existsSync()) {
      throw SkinException('No skin at $path');
    }
    try {
      final decoded = jsonDecode(file.readAsStringSync());
      if (decoded is! Map<String, dynamic>) {
        throw const FormatException('a skin must be a JSON object');
      }
      return Skin.fromJson(decoded);
    } on FormatException catch (e) {
      throw SkinException('$path is not valid JSON: ${e.message}');
    }
  }
}

/// One placed widget.
class WidgetSpec {
  const WidgetSpec({
    required this.kind,
    this.x = 24,
    this.y = 24,
    this.width = 240,
    this.height = 120,
    this.title,
    this.showTitle = true,
    this.opacity = 1.0,
  });

  /// Which widget to draw. See [WidgetKind].
  final String kind;

  /// Position and size in logical pixels, absolute rather than flowed.
  ///
  /// Absolute because that is what a skin is: the author decided this clock
  /// goes in the top-right and this monitor along the left edge, and a flow
  /// layout would rearrange it the moment the window changed size.
  final double x;
  final double y;
  final double width;
  final double height;

  final String? title;
  final bool showTitle;
  final double opacity;

  static WidgetSpec fromJson(Map<String, dynamic> json) => WidgetSpec(
        kind: json['kind'] as String,
        x: (json['x'] as num?)?.toDouble() ?? 24,
        y: (json['y'] as num?)?.toDouble() ?? 24,
        width: (json['width'] as num?)?.toDouble() ?? 240,
        height: (json['height'] as num?)?.toDouble() ?? 120,
        title: json['title'] as String?,
        showTitle: json['showTitle'] as bool? ?? true,
        opacity: (json['opacity'] as num?)?.toDouble() ?? 1.0,
      );

  Map<String, dynamic> toJson() => {
        'kind': kind,
        'x': x,
        'y': y,
        'width': width,
        'height': height,
        if (title != null) 'title': title,
        'showTitle': showTitle,
        'opacity': opacity,
      };
}

/// The widgets a skin can place.
///
/// A closed set rather than a plugin system, deliberately. A skin format that
/// can load arbitrary widget code is a security hole and a stability problem,
/// and every widget anyone actually wants is one of these eight.
enum WidgetKind {
  clock,
  systemMonitor,
  calendar,
  notes,
  weather,
  media,
  appList,
  reactor;

  static WidgetKind? fromName(String name) {
    for (final k in WidgetKind.values) {
      if (k.name == name) return k;
    }
    return null;
  }
}

class SkinException implements Exception {
  const SkinException(this.message);

  final String message;

  @override
  String toString() => message;
}
