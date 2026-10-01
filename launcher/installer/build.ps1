# Build jarvis.exe and the installer.
#
# Run from the project root:   powershell -ExecutionPolicy Bypass -File installer\build.ps1
#
# What this does, in order:
#   1. flutter build windows --release  -> build\windows\x64\runner\Release\jarvis_launcher.exe
#   2. ISCC jarvis.iss                  -> dist\jarvis-setup.exe
#
# Step 1 needs the Flutter SDK. Step 2 needs Inno Setup. Both are checked first
# so a missing tool gives a clear message rather than a stack trace.

$ErrorActionPreference = 'Stop'

function Fail($msg) {
    Write-Host ""
    Write-Host "  $msg" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  J.A.R.V.I.S. Workspace - build" -ForegroundColor Cyan
Write-Host ""

# --- flutter ---------------------------------------------------------------
$flutter = Get-Command flutter -ErrorAction SilentlyContinue
if (-not $flutter) {
    Fail "flutter not found on PATH. Install the Flutter SDK and re-run."
}

Write-Host "  [1/3] flutter pub get" -ForegroundColor DarkGray
& flutter pub get
if ($LASTEXITCODE -ne 0) { Fail "flutter pub get failed." }

Write-Host "  [2/3] flutter build windows --release" -ForegroundColor DarkGray
& flutter build windows --release
if ($LASTEXITCODE -ne 0) { Fail "flutter build failed. See the output above." }

$exe = "build\windows\x64\runner\Release\jarvis_launcher.exe"
if (-not (Test-Path $exe)) {
    Fail "Build reported success but $exe is missing."
}
Write-Host "        built: $exe" -ForegroundColor Green

# --- inno setup ------------------------------------------------------------
$iscc = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) {
    Write-Host ""
    Write-Host "  Built the exe, but Inno Setup is not installed, so no installer." -ForegroundColor Yellow
    Write-Host "  The exe alone is runnable:  $exe" -ForegroundColor Yellow
    Write-Host "  Install Inno Setup from https://jrsoftware.org/isdl.php and re-run to get the .exe installer." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

Write-Host "  [3/3] compiling installer" -ForegroundColor DarkGray
& $iscc "installer\jarvis.iss"
if ($LASTEXITCODE -ne 0) { Fail "Inno Setup failed. See the output above." }

$setup = "dist\jarvis-setup.exe"
Write-Host ""
Write-Host "  Done." -ForegroundColor Green
Write-Host "    installer : $setup" -ForegroundColor Green
Write-Host "    portable  : $exe" -ForegroundColor Green
Write-Host ""
