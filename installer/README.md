# Windows desktop installer

JARVIS is packaged as a Windows x64 desktop app with Electron Builder (NSIS). The authoritative build is `.github/workflows/windows-installer.yml`; this folder contains no separate Inno Setup build.

## Download

1. Open **Actions → Windows installer** in the repository.
2. Choose a successful run and download the `JARVIS-Windows-Installer` artifact.
3. Extract the artifact ZIP and run `JARVIS-Setup-<version>-x64.exe` on Windows 10/11 x64.

Branch pushes and manual runs produce a 30-day Actions artifact. A `v*` tag matching the version in `package.json` also attaches the installer to a GitHub Release. The unsigned setup may trigger a Windows SmartScreen warning.

## Build locally on Windows

```powershell
$env:ONNXRUNTIME_NODE_INSTALL_CUDA = 'skip'
npm ci --no-audit --no-fund
npm run build
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx electron-builder --win nsis --x64
```

The generated EXE is written to `release/`. Electron supplies the Node runtime, so end users do not need a separate Node.js or npm install. Ollama and AI model weights are downloaded separately through JARVIS's in-app MODEL STACK panel; they are intentionally not bundled in the installer.

## Data and uninstall

The app stores its profile, settings, downloaded Ollama runtime, and model weights under `%LOCALAPPDATA%\JARVIS`. That user data is outside the install directory and survives application upgrades and uninstall, so uninstalling does not silently erase multi-gigabyte downloads or user data.
