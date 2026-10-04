' ═══════════════════════════════════════════════════════════
'  JARVIS STARTER — Runs hidden (no console window)
'  Double-click this or the Desktop icon to start JARVIS
' ═══════════════════════════════════════════════════════════

Set objShell = CreateObject("WScript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
objShell.CurrentDirectory = strPath

' Run JARVIS hidden (no console window)
objShell.Run "cmd /c start.bat", 0, False