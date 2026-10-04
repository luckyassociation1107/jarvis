#!/usr/bin/env bash
# ============================================================================
#  J.A.R.V.I.S. — the one-click launcher for Linux and macOS.
#
#  Most Linux file managers run a .sh when you double-click it and choose
#  "Run"; on any system this is one command. Either way it is the same single
#  action: this script does the whole setup and leaves you with a browser page
#  where one button finishes the job.
#
#    * finds Node.js 20+ (and bootstraps a user-local copy if it is missing),
#    * installs the project's npm packages from the lockfile,
#    * builds the browser interface,
#    * starts the local bridge and the HUD,
#    * opens the setup page — the model runtime and the models are one press
#      away there, chosen for what this machine can actually run.
#
#  Nothing is installed system-wide and no sudo is ever used.
#  Pass `auto` to skip even that last click:  ./START.sh auto
# ============================================================================
set -u

cd "$(dirname "$0")" || exit 1
chmod +x ./build.sh 2>/dev/null || true

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
exit "$code"
