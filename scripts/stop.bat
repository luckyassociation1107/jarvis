@echo off
:: ═══════════════════════════════════════════════════════════
::  JARVIS STOPPER — Stops all JARVIS processes
:: ═══════════════════════════════════════════════════════════

echo.
echo Stopping JARVIS...

:: Kill by process name
taskkill /F /IM node.exe /FI "WINDOWTITLE eq JARVIS*" >nul 2>&1

:: Kill by PID file
if exist "%USERPROFILE%\JARVIS\jarvis.pid" (
    set /p PID=<"%USERPROFILE%\JARVIS\jarvis.pid"
    taskkill /F /PID %PID% >nul 2>&1
    del "%USERPROFILE%\JARVIS\jarvis.pid" >nul 2>&1
)

:: Kill all node processes running server.mjs
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq node.exe" /fo list ^| findstr PID') do (
    wmic process where "ProcessId=%%a AND CommandLine like '%%server.mjs%%'" delete >nul 2>&1
)

echo [OK] JARVIS stopped.
echo.
pause