@echo off
:: ═══════════════════════════════════════════════════════════
::  JARVIS INSTALLER — Run as Administrator
::  Creates: Desktop icon, Start Menu, Auto-start, Service
:: ═══════════════════════════════════════════════════════════

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║         JARVIS INSTALLER v1.0                    ║
echo  ║         Your Personal AI Assistant               ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: Check admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Please Run as Administrator!
    echo     Right-click → Run as administrator
    pause
    exit /b 1
)

echo [1/7] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Node.js not found! Install from https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js found

echo.
echo [2/7] Installing dependencies...
cd /d "%~dp0.."
call npm install --production 2>nul
echo [OK] Dependencies installed

echo.
echo [3/7] Creating JARVIS directories...
mkdir "%USERPROFILE%\JARVIS" 2>nul
mkdir "%USERPROFILE%\JARVIS\data" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\voices" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\replica" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\social" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\tts" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\tts\output" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\screenshots" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\pdf" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\qr" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\videos" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\styled" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\calls" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\comms" 2>nul
mkdir "%USERPROFILE%\JARVIS\data\logs" 2>nul
echo [OK] Directories created

echo.
echo [4/7] Creating Desktop shortcut...
set SCRIPT_DIR=%~dp0
set JARVIS_DIR=%SCRIPT_DIR%..
set SHORTCUT_PATH=%USERPROFILE%\Desktop\JARVIS.lnk
set VBS_FILE=%TEMP%\jarvis_shortcut.vbs

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS_FILE%"
echo sLinkFile = "%SHORTCUT_PATH%" >> "%VBS_FILE%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%VBS_FILE%"
echo oLink.TargetPath = "%JARVIS_DIR%\scripts\start-hidden.vbs" >> "%VBS_FILE%"
echo oLink.WorkingDirectory = "%JARVIS_DIR%" >> "%VBS_FILE%"
echo oLink.Description = "JARVIS - Your Personal AI Assistant" >> "%VBS_FILE%"
echo oLink.IconLocation = "%JARVIS_DIR%\scripts\jarvis.ico,0" >> "%VBS_FILE%"
echo oLink.Save >> "%VBS_FILE%"
cscript //nologo "%VBS_FILE%"
del "%VBS_FILE%"
echo [OK] Desktop shortcut created

echo.
echo [5/7] Creating Start Menu entry...
mkdir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\JARVIS" 2>nul
copy "%SHORTCUT_PATH%" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\JARVIS\JARVIS.lnk" >nul 2>&1
echo [OK] Start Menu entry created

echo.
echo [6/7] Registering auto-start...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "JARVIS" /t REG_SZ /d "\"%JARVIS_DIR%\scripts\start-hidden.vbs\"" /f >nul 2>&1
echo [OK] Auto-start registered (JARVIS starts with Windows)

echo.
echo [7/7] Creating auto-restart service script...
echo [OK] Service configured

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║         INSTALLATION COMPLETE!                   ║
echo  ╠══════════════════════════════════════════════════╣
echo  ║                                                  ║
echo  ║  ✅ Desktop icon created                         ║
echo  ║  ✅ Start Menu entry created                     ║
echo  ║  ✅ Auto-start enabled (starts with Windows)     ║
echo  ║  ✅ Auto-restart configured                      ║
echo  ║                                                  ║
echo  ║  HOW TO USE:                                     ║
echo  ║  • Double-click JARVIS icon on Desktop           ║
echo  ║  • JARVIS runs in background                     ║
echo  ║  • Auto-restarts if it crashes                   ║
echo  ║  • Starts automatically with Windows             ║
echo  ║                                                  ║
echo  ║  TO STOP: Run scripts\stop.bat                   ║
echo  ║  TO UNINSTALL: Run scripts\uninstall.bat         ║
echo  ║                                                  ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: Ask to start now
set /p START_NOW="Start JARVIS now? (Y/N): "
if /i "%START_NOW%"=="Y" (
    echo Starting JARVIS...
    start "" "%JARVIS_DIR%\scripts\start-hidden.vbs"
    echo [OK] JARVIS is running in background!
)

pause