# JARVIS Windows Installer - Build Guide

This document explains how the GitHub Actions workflow builds the JARVIS Windows installer (EXE).

## Overview

The workflow automatically builds a professional Windows installer (`JARVIS-Setup.exe`) that:

- Bundles the complete JARVIS application with a portable Node.js runtime
- Creates a self-contained installation (no need to install Node.js separately)
- Provides desktop shortcuts, Start Menu entries, and optional auto-start
- Installs per-user (no administrator privileges required)
- Includes a clean uninstaller

## What Gets Built

### Distribution Package

The workflow creates a complete distribution folder (`installer-build/JARVIS/`) containing:

```
JARVIS/
├── bridge/              # Node.js bridge server (the "brain")
├── dist/                # Vite-built frontend (the "face")
├── scripts/             # Launcher scripts
│   ├── jarvis-launcher.bat  # Main launcher (uses bundled Node)
│   ├── start.bat
│   ├── stop.bat
│   └── ...
├── node-portable/       # Embedded Node.js 22 runtime
├── node_modules/        # Production dependencies
├── package.json
├── models.json
└── public/              # Static assets
```

### Installer Features

The Inno Setup installer (`JARVIS-Setup.exe`) provides:

✅ **Modern UI** - Clean, professional installation wizard  
✅ **Desktop Shortcut** - Quick launch from desktop  
✅ **Start Menu** - Access from Start Menu programs  
✅ **Auto-Start Option** - Optionally start JARVIS with Windows  
✅ **Per-User Install** - No admin rights needed  
✅ **Custom Install Path** - Users can choose where to install  
✅ **Clean Uninstall** - Removes all files and registry entries  
✅ **Launch After Install** - Option to start JARVIS immediately  

## How to Use

### For Users

1. **Download the installer** from GitHub Releases (look for `JARVIS-Setup.exe`)
2. **Run the installer** - double-click `JARVIS-Setup.exe`
3. **Follow the wizard** - choose install location, options, etc.
4. **Launch JARVIS** - either from the desktop icon or let the installer start it
5. **Configure models** - the setup page will guide you through downloading AI models

### For Developers

#### Manual Build (Local)

To build the installer locally on Windows:

```powershell
# 1. Install dependencies
npm ci

# 2. Build the frontend
npm run build

# 3. Create the distribution folder structure
# (You'll need to manually replicate what the CI does, or see below)

# 4. Compile the Inno Setup installer
# Download and install Inno Setup 6 from https://jrsoftware.org/isinfo.htm
# Then run:
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\jarvis.iss
```

The installer will be created at `installer-build/JARVIS-Setup.exe`.

#### Automatic Build (GitHub Actions)

The workflow runs automatically on:

- **Tag pushes** (`v*.*.*`) - Creates a GitHub Release with the EXE attached
- **Pushes to main** - Builds for testing
- **Pull requests** - Validates the build works
- **Manual dispatch** - Trigger from Actions tab → "Run workflow"

#### Creating a Release

To create a new release with the installer:

```bash
# 1. Update version in package.json (optional)
npm version 1.0.1

# 2. Create and push a tag
git tag v1.0.1
git push origin v1.0.1

# 3. GitHub Actions will automatically:
#    - Build the installer
#    - Create a GitHub Release
#    - Attach JARVIS-Setup.exe to the release
```

## Workflow Details

### Steps

1. **Checkout** - Clone the repository
2. **Setup Node.js** - Install Node.js 22 (for building)
3. **Install Dependencies** - `npm ci`
4. **Build Frontend** - `npm run build` (Vite)
5. **Download Portable Node** - Downloads Node.js 22 portable (Windows x64)
6. **Prepare Distribution** - Copies all files into `installer-build/JARVIS/`
7. **Install Production Deps** - Installs npm dependencies using bundled Node
8. **Compile Installer** - Runs Inno Setup to create `JARVIS-Setup.exe`
9. **Upload Artifact** - Makes the EXE available as a workflow artifact
10. **Create Release** - (on tags only) Attaches EXE to GitHub Release

### Artifacts

- **Workflow Run** - Download from Actions tab → Artifacts section
- **GitHub Release** - Download from Releases page (tagged versions only)

### Retention

- Workflow artifacts are kept for 30 days
- GitHub Releases are permanent

## Troubleshooting

### Installer Won't Run

- **SmartScreen warning** - Click "More info" → "Run anyway" (unsigned installer)
- **Antivirus** - Some AVs flag portable Node.js; add an exception if needed

### JARVIS Won't Start After Install

- Check the logs in `%LOCALAPPDATA%\JARVIS\data\logs\`
- Try running `scripts\jarvis-launcher.bat` directly from the install folder
- Ensure no firewall is blocking port 8787

### Build Fails

- Check the Actions tab for the full error log
- Common issues:
  - Node.js download failed (network issue)
  - npm install failed (dependency issue)
  - Vite build failed (code error)
  - Inno Setup not found on runner (rare)

## File Structure

```
.github/workflows/
└── build-exe.yml          # The GitHub Actions workflow

installer/
├── jarvis.iss             # Inno Setup script
└── README.md              # This file

installer-build/           # Build output (gitignored)
├── JARVIS/                # Distribution folder
│   ├── bridge/
│   ├── dist/
│   ├── scripts/
│   ├── node-portable/
│   └── ...
└── JARVIS-Setup.exe       # The final installer
```

## Customization

### Change App Version

Edit `installer/jarvis.iss`:
```iss
#define MyAppVersion "2.0.0"
```

### Change Install Location

Edit `installer/jarvis.iss`:
```iss
DefaultDirName={autopf}\MyCustomName
```

### Add Files to Installer

Edit `installer/jarvis.iss` and add to `[Files]` section:
```iss
Source: "installer-build\JARVIS\myfolder\*"; DestDir: "{app}\myfolder"; Flags: recursesubdirs
```

### Modify Installer UI

See [Inno Setup documentation](https://jrsoftware.org/ishelp/) for customization options.

## Technical Details

### Portable Node.js

The installer bundles Node.js 22.14.0 (Windows x64) so users don't need to install Node separately. This is downloaded from nodejs.org during the build.

### Launcher Script

The main launcher (`jarvis-launcher.bat`) uses the bundled Node.js to run the bridge server and opens the browser to the frontend.

### Installation Paths

- **App files**: `{app}\` (user-chosen, default: `%LOCALAPPDATA%\Programs\JARVIS\`)
- **User data**: `%LOCALAPPDATA%\JARVIS\data\`
- **Auto-start registry**: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

### Uninstallation

The uninstaller:
1. Stops any running JARVIS processes
2. Removes all installed files
3. Removes desktop/start menu shortcuts
4. Removes auto-start registry entry
5. Optionally removes user data

## Support

For issues with:
- **The installer itself** - Check this README or open an issue
- **JARVIS functionality** - See the main [README.md](../README.md)
- **Build workflow failures** - Check the Actions tab for logs

## Credits

- **Inno Setup** - Installer creation tool by Jordan Russell
- **Node.js** - JavaScript runtime by OpenJS Foundation
- **GitHub Actions** - CI/CD platform by GitHub
