# JARVIS web-only setup, production build, and local run.
# No desktop app, installer, or EXE bundle is produced.
[CmdletBinding()]
param(
  [switch]$NoLaunch,
  [switch]$SkipAiModels
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path

function Refresh-SessionPath {
  # Preserve paths supplied by the current shell (for example, a version
  # manager) while adding locations written by the just-completed installer.
  $paths = @(
    $env:Path
    [Environment]::GetEnvironmentVariable('Path', 'Machine')
    [Environment]::GetEnvironmentVariable('Path', 'User')
  )
  if ($env:LOCALAPPDATA) {
    $ollamaUserDir = Join-Path $env:LOCALAPPDATA 'Programs\Ollama'
    if (Test-Path (Join-Path $ollamaUserDir 'ollama.exe')) { $paths += $ollamaUserDir }
  }
  if ($env:ProgramFiles) {
    $programNode = Join-Path $env:ProgramFiles 'nodejs'
    if (Test-Path (Join-Path $programNode 'node.exe')) { $paths += $programNode }
  }
  $entries = $paths | ForEach-Object { if ($_){ $_ -split ';' } }
  $env:Path = ($entries | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique) -join ';'
}

function Get-NodeVersion {
  param([Parameter(Mandatory)][string]$Executable)
  try {
    $output = & $Executable -p 'process.versions.node' 2>$null
    if ($LASTEXITCODE -ne 0) { return '' }
    $version = ($output | Out-String).Trim()
    if ($version -match '^(\d+\.\d+\.\d+)') { return $Matches[1] }
  }
  catch { return '' }
  return ''
}

function Install-OllamaIfNeeded {
  param(
    [Parameter(Mandatory)][string]$NodeExe,
    [Parameter(Mandatory)][string]$RepoPath
  )

  try {
    $checker = Join-Path $RepoPath 'scripts/model-bootstrap.mjs'
    $decisionOutput = & $NodeExe $checker '--needs-local-ollama-install'
    if ($LASTEXITCODE -ne 0) { throw 'Could not calculate whether Ollama is needed.' }
    $decision = ($decisionOutput | Out-String).Trim()
    if ($decision -ne 'yes') { return $true }

    Write-Host ''
    Write-Host 'A fitting local chat/vision/coding model is selected, but Ollama is missing.' -ForegroundColor Yellow
    Write-Host 'Downloading the official Ollama installer; it may ask for Windows confirmation.'
    $installerScript = Join-Path $env:TEMP "jarvis-ollama-install-$PID.ps1"
    try {
      Invoke-WebRequest -Uri 'https://ollama.com/install.ps1' -OutFile $installerScript
      $hostName = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh.exe' } else { 'powershell.exe' }
      $hostExe = Join-Path $PSHOME $hostName
      if (-not (Test-Path $hostExe)) { throw "Could not locate the PowerShell host at $hostExe." }
      & $hostExe -NoProfile -ExecutionPolicy Bypass -File $installerScript
      if ($LASTEXITCODE -ne 0) { throw "Official Ollama installer exited with code $LASTEXITCODE." }
      Refresh-SessionPath
      if (-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)) {
        throw 'Ollama installer returned successfully, but ollama.exe is not on the refreshed PATH.'
      }
      Write-Host 'Ollama is installed; model setup will start its service if necessary.' -ForegroundColor Green
      return $true
    }
    finally {
      Remove-Item $installerScript -Force -ErrorAction SilentlyContinue
    }
  }
  catch {
    Write-Warning "Ollama setup could not complete: $($_.Exception.Message). JARVIS will still launch with available browser/OS or configured remote fallbacks."
    return $false
  }
}

Push-Location $repo

try {
  if (-not (Test-Path 'package.json') -or -not (Test-Path 'package-lock.json')) {
    throw 'Run this script from a complete JARVIS repository (package.json and package-lock.json are required).'
  }

  Write-Host ''
  Write-Host 'J.A.R.V.I.S. — web setup, build, and run' -ForegroundColor Cyan
  Write-Host '======================================='
  Write-Host 'This builds the browser UI only; no desktop app or EXE is created.'

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction SilentlyContinue }
  $nodeVersion = if ($nodeCommand) { Get-NodeVersion -Executable $nodeCommand.Source } else { '' }
  $nodeMajor = 0
  if ($nodeVersion -match '^(\d+)\.') { $nodeMajor = [int]$Matches[1] }

  if (-not $nodeCommand -or $nodeMajor -lt 20 -or -not $npmCommand) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) { $winget = Get-Command winget -ErrorAction SilentlyContinue }
    if (-not $winget) {
      throw 'Node.js 20+ and npm are required. Install Node.js LTS from https://nodejs.org (or install WinGet), then rerun this script.'
    }
    Write-Host 'Node.js 20+ and npm are missing/outdated. Installing or updating Node.js LTS with WinGet…' -ForegroundColor Yellow
    & $winget.Source install --id OpenJS.NodeJS.LTS --exact --source winget --force --silent --disable-interactivity --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { throw 'WinGet could not install Node.js LTS. Install it from https://nodejs.org, then rerun this script.' }

    # The MSI updates the registry, which this PowerShell process inherited
    # before the installer ran. Preserve shell paths while refreshing both.
    Refresh-SessionPath

    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction SilentlyContinue }
    if (-not $nodeCommand -or -not $npmCommand) { throw 'Node.js was installed, but this shell cannot find node/npm. Open a new PowerShell window and rerun build.ps1.' }
    $nodeVersion = Get-NodeVersion -Executable $nodeCommand.Source
    $nodeMajor = 0
    if ($nodeVersion -match '^(\d+)\.') { $nodeMajor = [int]$Matches[1] }
    if ($nodeMajor -lt 20) { throw "WinGet did not provide a working Node.js 20+ runtime (detected '$nodeVersion')." }
  }

  # npm.cmd avoids PowerShell execution-policy issues with npm.ps1 on Windows.
  $npmPath = $npmCommand.Source
  $npmVersion = (& $npmPath --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $npmVersion) { throw 'npm is present but could not run. Reinstall Node.js 20+ and rerun build.ps1.' }
  Write-Host "Node.js $nodeVersion; npm $npmVersion"

  $needsInstall = -not (Test-Path 'node_modules/.package-lock.json') -or -not (Test-Path 'node_modules/vite/bin/vite.js')
  if (-not $needsInstall) {
    $projectLock = Get-Item 'package-lock.json'
    $installedLock = Get-Item 'node_modules/.package-lock.json'
    if ($projectLock.LastWriteTimeUtc -gt $installedLock.LastWriteTimeUtc) { $needsInstall = $true }
  }
  if (-not $needsInstall) {
    $dependencyChecker = Join-Path $repo 'scripts/check-dependencies.mjs'
    $null = & $nodeCommand.Source $dependencyChecker
    if ($LASTEXITCODE -ne 0) { $needsInstall = $true }
  }

  if ($needsInstall) {
    Write-Host ''
    Write-Host 'Installing missing or stale project dependencies from package-lock.json…' -ForegroundColor Yellow
    & $npmPath ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Check your network/proxy settings and rerun this script.' }
  } else {
    Write-Host 'Project dependencies are already installed and current.'
  }

  Write-Host ''
  Write-Host 'Building the browser UI…' -ForegroundColor Cyan
  & $npmPath run build
  if ($LASTEXITCODE -ne 0) { throw 'The web build failed; see the compiler output above.' }

  Write-Host ''
  Write-Host 'Running the read-only advisory preflight…' -ForegroundColor Cyan
  & $npmPath run setup
  if ($LASTEXITCODE -ne 0) { throw 'The preflight command could not run.' }

  if (-not $SkipAiModels) {
    $null = Install-OllamaIfNeeded -NodeExe $nodeCommand.Source -RepoPath $repo
    Write-Host ''
    Write-Host 'Checking and installing only the selected, fitting local model assets…' -ForegroundColor Cyan
    & $npmPath run models:install
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'AI setup was partial. The web app will still launch with available browser/OS or configured remote fallbacks.'
    }
  } else {
    Write-Host ''
    Write-Host 'Skipping Ollama and model-weight setup (-SkipAiModels).' -ForegroundColor Yellow
  }

  if ($NoLaunch) {
    Write-Host ''
    Write-Host 'Setup and build complete. -NoLaunch left the bridge and browser server stopped.'
    return
  }

  Write-Host ''
  Write-Host 'Starting the local bridge and browser HUD.' -ForegroundColor Green
  Write-Host 'Open the Vite URL printed below in Chrome or Edge. Keep this window open;'
  Write-Host 'Ctrl-C stops the bridge and browser server together. The selected fitting model stack was prepared automatically unless -SkipAiModels was used.'
  & $npmPath start
  if ($LASTEXITCODE -ne 0) { throw "npm start exited with code $LASTEXITCODE." }
}
catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
finally {
  Pop-Location
}
