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

  static const all = [arcReactor, workshop, quiet];

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
