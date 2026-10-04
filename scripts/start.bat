@echo off
:: ═══════════════════════════════════════════════════════════
::  JARVIS STARTER — With auto-restart
::  Runs in background, auto-restarts on crash
:: ═══════════════════════════════════════════════════════════

cd /d "%~dp0.."

:: Kill existing JARVIS if running
taskkill /F /FI "WINDOWTITLE eq JARVIS*" >nul 2>&1

:: Create PID file
echo %PID% > "%USERPROFILE%\JARVIS\jarvis.pid"

:RESTART
echo [%date% %time%] Starting JARVIS...

:: Start JARVIS with auto-restart
node bridge/server.mjs --auto-restart

echo [%date% %time%] JARVIS stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul

goto RESTART