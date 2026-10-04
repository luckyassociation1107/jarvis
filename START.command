#!/usr/bin/env bash
# ============================================================================
#  J.A.R.V.I.S. — double-click this file (macOS) or run it from a terminal.
#
#  One click from a downloaded folder to a running assistant:
#
#    * finds Node.js 20+ (and bootstraps a user-local copy if it is missing),
#    * installs the project's npm packages from the lockfile,
#    * builds the browser interface,
#    * starts the local bridge and the HUD,
#    * opens the setup page, where one button downloads the model runtime
#      and the model stack this machine can actually run.
#
#  Nothing is installed system-wide and no sudo is ever used.
#  Pass `auto` to skip even that last click:  ./START.command auto
#
#  Double-clicking a .command file opens Terminal; the window stays open at
#  the end so a failure can be read instead of vanishing.
# ============================================================================
set -u

cd "$(dirname "$0")" || exit 1

echo
echo "  J.A.R.V.I.S. starting..."
echo "  ======================="
echo

args=()
if [[ "${1:-}" == "auto" || "${1:-}" == "--auto" || "${1:-}" == "-auto" ]]; then
  args+=(--auto)
fi

bash ./build.sh "${args[@]}"
code=$?

if [[ $code -ne 0 ]]; then
  echo
  echo "  The launcher stopped with code $code."
  echo "  Read the messages above: most failures are a missing Node.js, no"
  echo "  internet connection, or a proxy blocking the downloads."
  echo
fi

# Keep the window alive when the file was double-clicked in Finder.
if [[ -t 0 && "$(ps -o comm= -p "${PPID:-0}" 2>/dev/null)" == *Terminal* ]]; then
  read -r -p "  Press Return to close this window..." _
fi
exit "$code"
