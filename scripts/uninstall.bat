@echo off
:: ═══════════════════════════════════════════════════════════
::  JARVIS UNINSTALLER — Complete removal
::  Removes: Desktop icon, Start Menu, Auto-start, ALL DATA
:: ═══════════════════════════════════════════════════════════

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║         JARVIS UNINSTALLER                       ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: Check admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Please Run as Administrator!
    pause
    exit /b 1
)

echo This will COMPLETELY remove JARVIS:
echo   - Stop all running processes
echo   - Remove Desktop icon
echo   - Remove Start Menu entry
echo   - Remove auto-start
echo   - Delete ALL data (voices, chats, settings)
echo.
set /p CONFIRM="Are you sure? (YES to confirm): "
if /i not "%CONFIRM%"=="YES" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo [1/5] Stopping JARVIS...
call "%~dp0stop.bat" 2>nul
echo [OK] Stopped

echo.
echo [2/5] Removing Desktop shortcut...
del "%USERPROFILE%\Desktop\JARVIS.lnk" >nul 2>&1
echo [OK] Desktop icon removed

echo.
echo [3/5] Removing Start Menu entry...
rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\JARVIS" >nul 2>&1
echo [OK] Start Menu entry removed

echo.
echo [4/5] Removing auto-start...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "JARVIS" /f >nul 2>&1
echo [OK] Auto-start removed

echo.
echo [5/5] Deleting ALL data...
rmdir /s /q "%USERPROFILE%\JARVIS" >nul 2>&1
rmdir /s /q "%~dp0..\data" >nul 2>&1
rmdir /s /q "%~dp0..\node_modules" >nul 2>&1
echo [OK] All data deleted

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║         UNINSTALL COMPLETE!                      ║
echo  ╠══════════════════════════════════════════════════╣
echo  ║                                                  ║
echo  ║  ✅ JARVIS stopped                               ║
echo  ║  ✅ Desktop icon removed                         ║
echo  ║  ✅ Start Menu entry removed                     ║
echo  ║  ✅ Auto-start removed                           ║
echo  ║  ✅ All data deleted                             ║
echo  ║                                                  ║
echo  ║  JARVIS has been completely removed.             ║
echo  ║  To reinstall, run scripts\install.bat           ║
echo  ║                                                  ║
echo  ╚══════════════════════════════════════════════════╝
echo.
pause