import 'package:flutter/material.dart';

import '../theme/jarvis_theme.dart';

/// The filter field in the top rail.
///
/// It filters the grid rather than summoning a separate view, which is the
/// difference between this and the quick launcher this used to be: the workspace
/// is always there, and typing narrows what is on it.
///
/// It shares the workspace's FocusNode rather than owning one. That is
/// load-bearing: with two separate nodes the text field wins focus, Escape and
/// the arrow keys are consumed by it as text-editing input, and the workspace
/// never sees them. One node, one place in the focus tree, and the workspace's
/// handler runs first — returning `handled` for the keys it wants.
class SearchField extends StatelessWidget {
  const SearchField({
    super.key,
    required this.controller,
    required this.focusNode,
  });

  final TextEditingController controller;
  final FocusNode focusNode;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: JarvisPalette.surface.withValues(alpha: 0.9),
        border: Border.all(color: JarvisPalette.interface_.withValues(alpha: 0.6)),
        boxShadow: JarvisGlow.edge(JarvisPalette.interface_, strength: 0.6),
      ),
      child: Row(
        children: [
          Text(
            '/',
            style: JarvisType.readout(JarvisPalette.interface_, size: 16).copyWith(
              shadows: JarvisGlow.text(JarvisPalette.interface_),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: EditableText(
              controller: controller,
              focusNode: focusNode,
              style: JarvisType.readout(JarvisPalette.ink, size: 14),
              cursorColor: JarvisPalette.interface_,
              backgroundCursorColor: JarvisPalette.interface_,
              cursorWidth: 2,
              // A solid block, not a blinking bar. A blinking bar is a text
              // editor; a block is a terminal.
              cursorOpacityAnimator: (visible) =>
                  AlwaysStoppedAnimation(visible ? 1.0 : 0.0),
              maxLines: 1,
            ),
          ),
          const SizedBox(width: 12),
          Text(
            'ESC',
            style: JarvisType.label(
              JarvisPalette.inkDim.withValues(alpha: 0.6),
              size: 8,
            ),
          ),
        ],
      ),
    );
  }
}
