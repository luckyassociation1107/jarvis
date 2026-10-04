#!/usr/bin/env bash
# JARVIS web-only setup, production build, and local run.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

TEMP_NODE_STAGE=''
cleanup() {
  if [[ -n "$TEMP_NODE_STAGE" ]]; then rm -rf "$TEMP_NODE_STAGE"; fi
}
trap cleanup EXIT

fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

NO_LAUNCH=0
SKIP_AI_MODELS=0
AUTO_INSTALL=0
for argument in "$@"; do
  case "$argument" in
    --no-launch) NO_LAUNCH=1 ;;
    --skip-ai-models) SKIP_AI_MODELS=1 ;;
    # The launchers (START.sh / START.command) pass this: do not stop at the
    # setup page, install the stack this machine fits and then answer.
    --auto) AUTO_INSTALL=1 ;;
    *) fail "Unknown option: $argument (supported: --no-launch, --skip-ai-models, --auto)." ;;
  esac
done

node_major() {
  command -v node >/dev/null 2>&1 || { printf '0'; return; }
  local major
  major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)" || { printf '0'; return; }
  [[ "$major" =~ ^[0-9]+$ ]] && printf '%s' "$major" || printf '0'
}

download_file() {
  local url="$1" output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$output"
  else
    fail 'curl or wget is needed to bootstrap Node.js. Install one, or install Node.js 20+ manually from https://nodejs.org.'
  fi
}

install_portable_node() {
  local os arch platform version index_file sums_file archive archive_path expected actual install_root staging
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Linux) platform='linux' ;;
    Darwin) platform='darwin' ;;
    *) fail "Automatic Node.js setup is unsupported on $os. Install Node.js 20+ from https://nodejs.org, then rerun this script." ;;
  esac
  case "$arch" in
    x86_64|amd64) arch='x64' ;;
    aarch64|arm64) arch='arm64' ;;
    armv7l) arch='armv7l' ;;
    *) fail "Automatic Node.js setup is unsupported on $os/$arch. Install Node.js 20+ from https://nodejs.org." ;;
  esac
  command -v tar >/dev/null 2>&1 || fail 'tar is required to unpack Node.js. Install tar or install Node.js 20+ manually.'
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    fail 'A SHA-256 utility (sha256sum or shasum) is required to verify the Node.js download.'
  fi

  printf '  Downloading the latest Node.js 24 LTS binary and verifying its SHA-256…\n'
  staging="$(mktemp -d "${TMPDIR:-/tmp}/jarvis-node.XXXXXX")"
  TEMP_NODE_STAGE="$staging"
  index_file="$staging/index.tab"
  sums_file="$staging/SHASUMS256.txt"
  download_file 'https://nodejs.org/dist/index.tab' "$index_file" || fail 'Could not read the official Node.js release index.'
  version="$(awk -F '\t' 'NR > 1 && $1 ~ /^v24\./ { print $1; exit }' "$index_file")"
  [[ "$version" =~ ^v24\.[0-9]+\.[0-9]+$ ]] || fail 'No current Node.js 24 release was found in the official release index.'

  archive="node-${version}-${platform}-${arch}.tar.xz"
  archive_path="$staging/$archive"
  download_file "https://nodejs.org/dist/${version}/${archive}" "$archive_path" || fail "Could not download ${archive} from nodejs.org."
  download_file "https://nodejs.org/dist/${version}/SHASUMS256.txt" "$sums_file" || fail 'Could not download the official Node.js checksum list.'
  expected="$(awk -v file="$archive" '$2 == file { print $1; exit }' "$sums_file")"
  [[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || fail "No SHA-256 checksum was published for ${archive}."
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$archive_path" | awk '{ print $1 }')"
  else
    actual="$(shasum -a 256 "$archive_path" | awk '{ print $1 }')"
  fi
  [[ "$actual" == "$expected" ]] || fail 'Node.js download checksum did not match; refusing to install it.'

  install_root="${HOME}/.local/share/jarvis"
  mkdir -p "$install_root" "$staging/extracted"
  tar -xJf "$archive_path" -C "$staging/extracted" --strip-components=1 || fail 'Could not unpack the verified Node.js archive.'
  rm -rf "$install_root/node-v24"
  mv "$staging/extracted" "$install_root/node-v24"
  rm -rf "$staging"
  TEMP_NODE_STAGE=''
  export PATH="$install_root/node-v24/bin:$PATH"
  hash -r
}

ensure_node() {
  local major
  major="$(node_major)"
  if (( major >= 20 )) && command -v npm >/dev/null 2>&1; then return; fi

  printf '\nNode.js 20+ and npm are required. Attempting a user-local Node.js 24 LTS setup…\n'
  local nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [[ -s "$nvm_script" ]]; then
    # shellcheck disable=SC1090
    . "$nvm_script"
  fi
  if command -v nvm >/dev/null 2>&1; then
    nvm install 24 || fail 'nvm could not install Node.js 24 LTS.'
    nvm use 24 || fail 'nvm could not activate Node.js 24 LTS.'
  elif command -v brew >/dev/null 2>&1; then
    brew install node@24 || fail 'Homebrew could not install Node.js 24 LTS.'
    export PATH="$(brew --prefix node@24)/bin:$PATH"
    hash -r
  else
    install_portable_node
  fi

  major="$(node_major)"
  (( major >= 20 )) || fail 'Node.js 20+ was not available after setup. Install it manually from https://nodejs.org.'
  command -v npm >/dev/null 2>&1 || fail 'npm is still missing. Reinstall Node.js 24 LTS from https://nodejs.org.'
}

[[ -f package.json && -f package-lock.json ]] || fail 'Run this script from a complete JARVIS repository (package.json and package-lock.json are required).'
printf '\nJ.A.R.V.I.S. — web setup, build, and run\n'
printf '%s\n' '======================================='
printf '%s\n' 'This builds the browser UI only; no desktop app or EXE is created.'
ensure_node

printf 'Node.js %s; npm %s\n' "$(node --version)" "$(npm --version)"

# JARVIS runs its ONNX workloads in the browser and sends chat inference to
# Ollama. The optional Node CUDA provider is not required; skipping its separate
# GitHub asset download keeps CPU-only installs working. Set either supported
# variable explicitly to opt into ONNX Runtime's CUDA provider.
if [[ -z "${ONNXRUNTIME_NODE_INSTALL_CUDA:-}" && -z "${npm_config_onnxruntime_node_install_cuda:-}" ]]; then
  export ONNXRUNTIME_NODE_INSTALL_CUDA='skip'
fi

needs_install=0
if [[ ! -f node_modules/.package-lock.json || ! -f node_modules/vite/bin/vite.js ]]; then
  needs_install=1
elif [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
  needs_install=1
elif ! node scripts/check-dependencies.mjs >/dev/null 2>&1; then
  needs_install=1
fi

if (( needs_install )); then
  printf '\nInstalling missing or stale project dependencies from package-lock.json…\n'
  npm ci --no-audit --no-fund || fail 'npm ci failed. Check your network/proxy settings and rerun this script.'
else
  printf '\nProject dependencies are already installed and current.\n'
fi

printf '\nBuilding the browser UI…\n'
npm run build || fail 'The web build failed; see the compiler output above.'

printf '\nRunning the read-only advisory preflight…\n'
npm run doctor || fail 'The preflight command could not run.'

if (( SKIP_AI_MODELS )); then
  printf '\nSkipping the model setup page (--skip-ai-models).\n'
else
  printf '\nModels are chosen, never assumed. The setup page opens in your browser\n'
  printf 'so you can pick a stack and download it with one click:\n\n'
  printf '  npm run setup        (or open http://localhost:8787/install while the app runs)\n'
fi

if (( NO_LAUNCH )); then
  printf '\nSetup and build complete. --no-launch left the bridge and browser server stopped.\n'
  exit 0
fi

if (( AUTO_INSTALL )); then
  cat <<'EOF'

Starting the local bridge and browser HUD.
Open the Vite URL printed below in Chrome or Edge. Keep this window open;
Ctrl-C stops the bridge and browser server together.
--auto: the model runtime and the stack this machine fits are installed here,
before the first answer, and the progress is printed below.
EOF
  exec npm start -- --auto
fi

cat <<'EOF'

Starting the local bridge and browser HUD.
Open the Vite URL printed below in Chrome or Edge. Keep this window open;
Ctrl-C stops the bridge and browser server together. If no model stack is
downloaded yet, the setup page opens automatically — pick one there.
EOF
exec npm start
