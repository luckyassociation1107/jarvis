; JARVIS Inno Setup Installer Script
; ===================================
; Compiles the distribution folder (prepared by the CI workflow)
; into a proper Windows installer: JARVIS-Setup.exe
;
; Usage (from CI):
;   iscc installer\jarvis.iss
;
; The CI workflow builds installer-build\JARVIS\ (at the repo root) with:
;   - bridge\          (Node.js bridge server)
;   - dist\            (Vite-built frontend)
;   - scripts\         (launcher, start, stop)
;   - node-portable\   (embedded Node.js runtime)
;   - package.json, models.json, etc.
;
; NOTE: All paths here are relative to this .iss file (installer/),
; so we use ..\ to reach the repo root.

#define MyAppName "JARVIS"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "JARVIS Project"
#define MyAppURL "https://github.com/luckyassociation1107/jarvis"
#define MyAppExeName "JARVIS.exe"
#define RepoRoot "..\"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppName}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}

; Source and output paths (relative to this .iss file)
SourceDir={#RepoRoot}
OutputDir={#RepoRoot}installer-build
OutputBaseFilename=JARVIS-Setup

; Installer appearance
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes

; Permissions — no admin required for per-user install
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; Allow users to choose install directory
DisableDirPage=no
DisableProgramGroupPage=no

; Uninstaller
UninstallDisplayIcon={app}\JARVIS.exe

; Size estimates (will be updated by actual build)
; Typical install is ~300-500MB (Node + deps + frontend)

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checked
Name: "autostart"; Description: "Start JARVIS automatically with Windows"; GroupDescription: "Startup options:"; Flags: unchecked

[Files]
; Copy the entire distribution folder prepared by CI (paths relative to SourceDir = repo root)
Source: "installer-build\JARVIS\bridge\*"; DestDir: "{app}\bridge"; Flags: recursesubdirs createallsubdirs
Source: "installer-build\JARVIS\dist\*"; DestDir: "{app}\dist"; Flags: recursesubdirs createallsubdirs
Source: "installer-build\JARVIS\scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs createallsubdirs
Source: "installer-build\JARVIS\node-portable\*"; DestDir: "{app}\node-portable"; Flags: recursesubdirs createallsubdirs
Source: "installer-build\JARVIS\public\*"; DestDir: "{app}\public"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "installer-build\JARVIS\package.json"; DestDir: "{app}"
Source: "installer-build\JARVIS\package-lock.json"; DestDir: "{app}"
Source: "installer-build\JARVIS\models.json"; DestDir: "{app}"
Source: "installer-build\JARVIS\.env.example"; DestDir: "{app}"; Flags: skipifsourcedoesntexist
Source: "installer-build\JARVIS\index.html"; DestDir: "{app}"; Flags: skipifsourcedoesntexist
; node_modules if they exist (installed by CI)
Source: "installer-build\JARVIS\node_modules\*"; DestDir: "{app}\node_modules"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\scripts\jarvis-launcher.bat"; IconFilename: "{app}\node-portable\node.exe"; WorkingDir: "{app}"
Name: "{group}\Stop JARVIS"; Filename: "{app}\scripts\stop.bat"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\scripts\jarvis-launcher.bat"; IconFilename: "{app}\node-portable\node.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; Option to start JARVIS immediately after installation
Filename: "{app}\scripts\jarvis-launcher.bat"; Description: "Launch JARVIS now"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Stop JARVIS before uninstalling
Filename: "{cmd}"; Parameters: "/c taskkill /F /FI ""WINDOWTITLE eq JARVIS Bridge*"""; Flags: runhidden

[UninstallDelete]
; Clean up user data directories on uninstall
Type: filesandordirs; Name: "{localappdata}\JARVIS\data"
Type: filesandordirs; Name: "{localappdata}\JARVIS\logs"

[Code]
// Pascal Script for additional installer logic

procedure RegisterAutoStart;
var
  RegKey: String;
  LauncherPath: String;
begin
  RegKey := 'Software\Microsoft\Windows\CurrentVersion\Run';
  LauncherPath := ExpandConstant('{app}\scripts\jarvis-launcher.bat');
  RegWriteStringValue(HKEY_CURRENT_USER, RegKey, 'JARVIS', LauncherPath);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // Create data directory in user's local app data
    CreateDir(ExpandConstant('{localappdata}\JARVIS'));
    CreateDir(ExpandConstant('{localappdata}\JARVIS\data'));
    CreateDir(ExpandConstant('{localappdata}\JARVIS\data\voices'));
    CreateDir(ExpandConstant('{localappdata}\JARVIS\data\logs'));
    CreateDir(ExpandConstant('{localappdata}\JARVIS\data\tts'));
    CreateDir(ExpandConstant('{localappdata}\JARVIS\data\screenshots'));

    // Register auto-start if the user selected that task
    if IsTaskSelected('autostart') then
    begin
      RegisterAutoStart;
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  RegKey: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // Remove auto-start entry if it exists
    RegKey := 'Software\Microsoft\Windows\CurrentVersion\Run';
    RegDeleteValue(HKEY_CURRENT_USER, RegKey, 'JARVIS');
  end;
end;
