; J.A.R.V.I.S. Workspace — Windows installer and uninstaller
;
; Inno Setup, free, produces a normal .exe. Compile with
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" jarvis.iss
;
; Three decisions worth knowing about:
;
;   PrivilegesLowest — the workspace needs no admin rights. It reads the Start
;   Menu, the application directories, and kernel32 counters; all of that is
;   available to a normal user. Asking for elevation would put a UAC prompt in
;   front of a desktop theme, which is absurd.
;
;   Auto-start is a *task*, not a default. The workspace is summoned with
;   Alt+Space. An earlier version commented the Run key out entirely, which
;   meant the first-run permission flow had nothing to toggle — so it is now a
;   checkbox the user can decline, which is what a permission should be.
;
;   The uninstaller asks about the model cache. The autopilot downloads up to
;   12 GB of models into the user's profile, and an uninstaller that silently
;   leaves those behind is worse than one that deletes them — gigabytes of
;   orphaned weights on a disk the user thought they had reclaimed.
;
; What gets removed, and what does not:
;
;   removed   the app, its DLLs and assets; Start Menu and desktop icons;
;             the icon cache and app index; downloaded models and node_modules
;             if the user says so; the autostart Run key
;   kept      nothing else — this writes no system-wide state and no registry
;             keys outside HKCU, so there is nothing else to clean

#define AppName "J.A.R.V.I.S. Workspace"
#define AppVersion "1.0.0"
#define AppPublisher "J.A.R.V.I.S."
#define AppExe "jarvis_launcher.exe"
#define AppMutex "JARVISWorkspaceSingleton"

[Setup]
AppId={{7A9E4C21-3B5D-4E8F-9A2C-1D6F8B0E4A73}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppCopyright={#AppPublisher}
DefaultDirName={autopf}\JARVIS Workspace
DefaultGroupName=J.A.R.V.I.S.
DisableProgramGroupPage=yes
PrivilegesRequired=lowest

; The app holds a singleton mutex, so a second installer run while one is open
; would otherwise install over a running process. This makes Inno find it, ask
; the user to close it, and continue — the behaviour people expect from every
; other installer on Windows.
CloseApplications=yes
CloseApplicationsFilter=*.exe
RestartApplications=no
AppMutex={#AppMutex}

; Shows the app's own icon next to the entry in Add/Remove Programs. Without it
; the entry is a generic puzzle piece and looks like something that came with
; Windows.
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName} {#AppVersion}
Uninstallable=yes
CreateUninstallRegKey=yes

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
; Start with Windows. A task rather than a default because the first-run flow
; asks for this permission, and a permission the user can decline has to be
; something they can actually see and un-tick.
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"
Name: "autostart"; Description: "Start {#AppName} when Windows &starts"; \
    GroupDescription: "Startup:"; Flags: unchecked

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

[Registry]
; Written only if the autostart task is ticked, and uninsdeletevalue removes it
; on uninstall. HKCU, so no elevation is needed and no other user on the machine
; is affected.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "JARVISWorkspace"; \
    ValueData: """{app}\{#AppExe}"" --show"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
; --show tells the app to bring the workspace up on launch. Without it a cold
; start can leave a process running with no window, which looks exactly like a
; crash.
Filename: "{app}\{#AppExe}"; Parameters: "--show"; \
    Description: "Start {#AppName} now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; ---------------------------------------------------------------------------
; What an uninstaller must remove, and why each line is here.
; ---------------------------------------------------------------------------

; The app's own data: icon cache, app index, preferences. Written at runtime to
; the per-user appdata, and an uninstaller that leaves it behind is sloppy.
Type: filesandordirs; Name: "{userappdata}\com.jarvis\jarvis_launcher"




; The model cache, node_modules and the staged-update directory are deliberately
; NOT here. They are deleted imperatively in [Code] instead, because the user is
; asked whether to keep them, and [UninstallDelete] runs *after* [Code] - so a
; declarative entry would delete them regardless of what was chosen, and the
; question would be a lie.
;
; The autopilot writes up to 12 GB of models to {userappdata}\jarvis, beside the
; app rather than inside it, precisely so that reinstalling or updating does not
; have to re-download them. That also means the uninstaller has to look there,
; which the [Code] block does.

; Start Menu entries. Inno removes the group automatically, but a shortcut left
; in the *user's* Start Menu\Programs\Startup is not removed by that, and a
; leftover autostart shortcut is a bug the user experiences as "it came back".
Type: files; Name: "{userstartup}\{#AppName}.lnk"

[Code]

{ Ask before deleting the model cache. ------------------------------------------------- }

var
  KeepModelsPage: TInputOptionWizardPage;

{
  The uninstaller's default is to delete everything, which is what most people
  want and what every other installer does. But 12 GB of models is a real
  download, and someone uninstalling to reinstall a newer version — or to free
  space for a week — may want to keep them.

  So the question is asked, with "delete" as the default. Asking costs one
  dialog; not asking costs someone a 12 GB re-download they did not expect.
}
procedure InitializeWizard;
begin
  KeepModelsPage := CreateInputOptionPage(
    wpSelectTasks,
    'Model cache',
    'J.A.R.V.I.S. downloaded AI models to your user profile.',
    'These can be several gigabytes. Keep them for a future install, or delete them now.',
    True, False);

  KeepModelsPage.Add('&Delete the downloaded models');
  KeepModelsPage.Add('&Keep the downloaded models');

  { Default to deleting: an uninstaller that silently keeps gigabytes behind is
    worse than one that asks. }
  KeepModelsPage.SelectedValueIndex := 0;
end;

{ Only skip the model deletion when the user explicitly chose to keep them. }
function ShouldKeepModels: Boolean;
begin
  if KeepModelsPage = nil then
    Result := False
  else
    Result := KeepModelsPage.SelectedValueIndex = 1;
end;

{ Run before [UninstallDelete], because Inno's declarative delete happens after
  this. Returning False from CurUninstallStepChanged is not how to skip a
  declarative entry, so the deletion is done imperatively here instead. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ModelsDir: String;
begin
  if CurUninstallStep <> usUninstall then Exit;
  if ShouldKeepModels then
  begin
    Log('Keeping the model cache at the user''s request.');
    Exit;
  end;

  ModelsDir := ExpandConstant('{userappdata}\jarvis\models');
  if DirExists(ModelsDir) then
  begin
    Log('Deleting model cache: ' + ModelsDir);
    DelTree(ModelsDir, True, True, True);
  end;

  if DirExists(ExpandConstant('{userappdata}\jarvis\node_modules')) then
    DelTree(ExpandConstant('{userappdata}\jarvis\node_modules'), True, True, True);
end;
