@echo off
rem ===========================================================================
rem  J.A.R.V.I.S. — double-click this file.
rem
rem  One click from a downloaded folder to a running assistant:
rem
rem    * finds Node.js 20+ (and offers WinGet if it is missing),
rem    * installs the project's npm packages from the lockfile,
rem    * builds the browser interface,
rem    * starts the local bridge and the HUD,
rem    * opens the setup page, where one button downloads the model runtime
rem      and the model stack this machine can actually run.
rem
rem  Nothing is installed system-wide and no administrator prompt is raised.
rem  Pass `auto` to skip even that last click:  START.cmd auto
rem
rem  The window stays open at the end, because a launcher that closes on an
rem  error is a launcher you cannot debug.
rem ===========================================================================
setlocal
title J.A.R.V.I.S.
cd /d "%~dp0"

echo.
echo   J.A.R.V.I.S. starting...
echo   =======================
echo.

set "ARGS="
if /I "%~1"=="auto" set "ARGS=-Auto"
if /I "%~1"=="--auto" set "ARGS=-Auto"
if /I "%~1"=="-auto" set "ARGS=-Auto"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %ARGS%
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" (
  echo.
  echo   The launcher stopped with code %CODE%.
  echo   Read the messages above: most failures are a missing Node.js, no
  echo   internet connection, or a corporate proxy blocking the downloads.
  echo.
  pause
  exit /b %CODE%
)

endlocal
