import 'skin.dart';

/// The skins that ship with the workspace.
///
/// Three, because that is enough to show the format does what it claims and not
/// so many that none of them is finished. A skin that is half-designed is worse
/// than no skin, and a skin gallery full of near-identical variants is noise.
abstract final class BuiltInSkins {
  /// The default: grid of apps, widgets around the edges, reactor behind.
  static const arcReactor = Skin(
    id: 'arc-reactor',
    name: 'Arc Reactor',
    author: 'J.A.R.V.I.S.',
    description: 'The default. Reactor at the centre, monitors around the edges.',
    widgets: [
      WidgetSpec(
        kind: 'clock',
        x: 24,
        y: 24,
        width: 260,
        height: 110,
        title: 'LOCAL TIME',
      ),
      WidgetSpec(
        kind: 'systemMonitor',
        x: 24,
        y: 150,
        width: 260,
        height: 200,
        title: 'SYSTEM',
      ),
      WidgetSpec(
        kind: 'calendar',
        x: 24,
        y: 366,
        width: 260,
        height: 230,
        title: 'DATE',
      ),
    ],
  );

  /// Instrument-panel dense: everything on screen at once, small type.
  static const workshop = Skin(
    id: 'workshop',
    name: 'Workshop',
    author: 'J.A.R.V.I.S.',
    description: 'Dense. Four readouts, no decoration, small type.',
    widgets: [
      WidgetSpec(
        kind: 'systemMonitor',
        x: 24,
        y: 24,
        width: 300,
        height: 250,
        title: 'SYSTEM',
      ),
      WidgetSpec(
        kind: 'clock',
        x: 24,
        y: 290,
        width: 300,
        height: 100,
        title: 'TIME',
      ),
      WidgetSpec(
        kind: 'calendar',
        x: 348,
        y: 24,
        width: 300,
        height: 366,
        title: 'CALENDAR',
      ),
    ],
  );

  /// Quiet: reactor and clock only. For when the desktop is the point.
  static const quiet = Skin(
    id: 'quiet',
    name: 'Quiet',
    author: 'J.A.R.V.I.S.',
    description: 'Reactor and clock. Nothing else.',
    widgets: [
      WidgetSpec(
        kind: 'clock',
        x: 24,
        y: 24,
        width: 280,
        height: 120,
        title: 'TIME',
      ),
      WidgetSpec(
        kind: 'reactor',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        showTitle: false,
      ),
    ],
  );

  // -------------------------------------------------------------------------
  // Ported from real Rainmeter skins, palettes read out of their Variables.inc
  // and Color/*.inc rather than eyeballed from a screenshot.
  // -------------------------------------------------------------------------

  /// From Iron Man Mark 7. That skin runs 204,204,204 on near-black with Arial
  /// Black, and every graphic is a chamfered plate. Shield-clipped icons carry
  /// the arc-reactor cue; the accent stays the theme cyan so it still reads as
  /// JARVIS rather than as a third Iron Man clone.
  static const ironMan = Skin(
    id: 'iron-man',
    name: 'Iron Man',
    author: 'ported from Iron_Man_Mark_7.rmskin',
    description: 'Shield-clipped icons, steel grey on black.',
    accent: '#c6ccd4',
    iconShape: 'shield',
    iconAccent: '#c6ccd4',
    widgets: [
      WidgetSpec(kind: 'clock', x: 24, y: 24, width: 260, height: 110),
      WidgetSpec(
        kind: 'systemMonitor',
        x: 24,
        y: 150,
        width: 260,
        height: 200,
      ),
    ],
  );

  /// From Glass Shards. Color1=198,229,255, Color2=0,255,255 and
  /// color4=228,129,255 — a cold cyan with a violet counterpoint. The original
  /// is a frosted glass pile, which Flutter cannot do without a blur layer per
  /// pane; the palette and the chamfer survive, the frost does not.
  static const glassShards = Skin(
    id: 'glass-shards',
    name: 'Glass Shards',
    author: 'ported from glass-shards.rmskin',
    description: 'Cyan and violet on frosted panes.',
    accent: '#00ffff',
    iconShape: 'chamfer',
    iconAccent: '#e481ff',
    widgets: [
      WidgetSpec(
        kind: 'systemMonitor',
        x: 24,
        y: 24,
        width: 280,
        height: 210,
      ),
      WidgetSpec(kind: 'clock', x: 24, y: 250, width: 280, height: 110),
      WidgetSpec(
        kind: 'notes',
        x: 24,
        y: 376,
        width: 280,
        height: 220,
      ),
    ],
  );

  /// From Neon Space. Its only colour variable is Cloudcolor=0,50,255 — a deep
  /// electric blue, which is a much colder read than the theme's cyan and is the
  /// whole point of porting it. Hexagon icons, because a hex grid is what that
  /// skin's launcher actually looks like.
  static const neonSpace = Skin(
    id: 'neon-space',
    name: 'Neon Space',
    author: 'ported from neon-space.rmskin',
    description: 'Deep electric blue, hexagonal icons.',
    accent: '#0032ff',
    iconShape: 'hexagon',
    iconAccent: '#4d7cff',
    widgets: [
      WidgetSpec(kind: 'clock', x: 24, y: 24, width: 280, height: 120),
      WidgetSpec(
        kind: 'systemMonitor',
        x: 24,
        y: 160,
        width: 280,
        height: 220,
      ),
      WidgetSpec(
        kind: 'calendar',
        x: 24,
        y: 396,
        width: 280,
        height: 230,
      ),
    ],
  );

  /// From JARVIS Shield OS, which is a Windows Phone 7 Metro skin — its colour
  /// variable is literally ColorSkin=27,161,226 and its panel paths are named
  /// WP7. Square tiles are the correct port: Metro is the one place where a
  /// hard square is the intended shape rather than a default.
  static const shieldOs = Skin(
    id: 'shield-os',
    name: 'Shield OS',
    author: 'ported from jarvis-shield-os.rmskin',
    description: 'WP7 Metro tiles in the original shield blue.',
    accent: '#1ba1e2',
    iconShape: 'square',
    iconAccent: '#1ba1e2',
    widgets: [
      WidgetSpec(
        kind: 'systemMonitor',
        x: 24,
        y: 24,
        width: 280,
        height: 210,
      ),
      WidgetSpec(kind: 'clock', x: 24, y: 250, width: 280, height: 110),
      WidgetSpec(kind: 'appList', x: 24, y: 376, width: 280, height: 200),
    ],
  );

  static const all = [
    arcReactor,
    ironMan,
    glassShards,
    neonSpace,
    shieldOs,
    workshop,
    quiet,
  ];

  static Skin byId(String id) =>
      all.firstWhere((s) => s.id == id, orElse: () => arcReactor);
}

/// A worked example, written out as the JSON a user would actually hand-edit.
///
/// Ships as a real file rather than a doc comment because a skin format you
/// cannot see is a skin format nobody will write for.
const String exampleSkinJson = '''
{
  "id": "my-skin",
  "name": "My Skin",
  "author": "you",
  "description": "Clock top-right, memory bottom-left.",
  "accent": "#00e5ff",
  "widgets": [
    { "kind": "clock", "x": 1080, "y": 24, "width": 280, "height": 120 },
    { "kind": "systemMonitor", "x": 24, "y": 640, "width": 300, "height": 220 },
    { "kind": "notes", "x": 348, "y": 640, "width": 320, "height": 220,
      "title": "SCRATCH" }
  ]
}
''';
