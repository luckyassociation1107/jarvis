import 'package:flutter/material.dart';

import 'services/hotkey.dart';
import 'services/window.dart';
import 'theme/jarvis_theme.dart';
import 'ui/workspace.dart';

/// Entry point.
///
/// The order here matters and is the thing most likely to be got wrong:
/// `ensureInitialized` for the binding, then the window, then `runApp`. The
/// window must be configured before the first frame is pumped, or it appears at
/// its default size for a visible moment — which on a full-screen frameless HUD
/// is very visible indeed.
///
/// `window_manager` is reached through `services/window.dart`, never directly,
/// so this file needs no import of it.
Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();

  // Desktop only. On Android `windowManager.ensureInitialized()` throws, which
  // is why the guard is inside JarvisWindow rather than here.
  await JarvisWindow.init();

  // A global hotkey is how a workspace is summoned. It is optional and
  // platform-dependent, so a failure here is silent rather than fatal.
  HotkeyService.bindToggle();
  await HotkeyService.register();

  runApp(const JarvisWorkspaceApp());

  // Show immediately on a cold start. Without this, launching the binary gives
  // a process with no window, which looks exactly like a crash.
  await JarvisWindow.show();
}

class JarvisWorkspaceApp extends StatelessWidget {
  const JarvisWorkspaceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'J.A.R.V.I.S. Workspace',
      debugShowCheckedModeBanner: false,
      theme: jarvisTheme(),
      // One screen. No routes.
      home: const Workspace(),
      builder: (context, child) => MediaQuery(
        // The workspace is a fixed-size surface, not a responsive layout.
        // Locking the text scale stops a user's large-font setting from
        // clipping the top rail, which is the one place there is no slack.
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.noScaling),
        child: child!,
      ),
    );
  }
}
