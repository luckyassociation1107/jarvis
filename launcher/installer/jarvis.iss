; J.A.R.V.I.S. Workspace — Windows installer
;
; Inno Setup, which is free and produces a normal .exe installer. Compile with
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" jarvis.iss
;
; Two decisions worth knowing about:
;
;   PrivilegesLowest — the workspace needs no admin rights. It reads the Start
;   Menu, the application directories, and kernel32 counters; all of that is
;   available to a normal user. Asking for elevation would put a UAC prompt in
;   front of a desktop theme, which is absurd.
;
;   No registry Run key by default. The workspace is summoned with Alt+Space,
;   and adding it to startup is a choice the user makes, not one the installer
;   makes for them. The task is commented out below rather than included.

#define AppName "J.A.R.V.I.S. Workspace"
#define AppVersion "1.0.0"
#define AppPublisher "J.A.R.V.I.S."
#define AppExe "jarvis_launcher.exe"

[Setup]
AppId={{7A9E4C21-3B5D-4E8F-9A2C-1D6F8B0E4A73}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\JARVIS Workspace
DefaultGroupName=J.A.R.V.I.S.
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=jarvis-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"

[Files]
; Everything Flutter's release build produces. The Release directory is the
; whole application — the exe, its DLLs, and the data/ folder with the bundled
; assets and the Flutter engine.
Source: "..\build\windows\x64\runner\Release\*"; DestDir: "{app}"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; --show tells the app to bring the workspace up on launch. Without it a cold
; start can leave a process running with no window, which looks exactly like a
; crash.
Filename: "{app}\{#AppExe}"; Parameters: "--show"; \
    Description: "Start J.A.R.V.I.S. Workspace now"; Flags: nowait postinstall skipifsilent

; ---------------------------------------------------------------------------
; Optional: start with Windows.
;
; Left commented out deliberately. A desktop theme that puts itself in startup
; without asking is the kind of thing people uninstall over. Uncomment both
; lines if you want it, but the hotkey is the intended entry point.
;
; [Registry]
; Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
;     ValueType: string; ValueName: "JARVISWorkspace"; \
;     ValueData: """{app}\{#AppExe}"" --show"; Flags: uninsdeletevalue
; ---------------------------------------------------------------------------

[UninstallDelete]
; The icon cache and the app index are written here at runtime, and an
; uninstaller that leaves a few megabytes of cache behind is sloppy.
Type: filesandordirs; Name: "{userappdata}\com.jarvis\jarvis_launcher"
