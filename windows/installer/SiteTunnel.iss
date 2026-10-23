#define AppName "SiteTunnel"
#define AppVersion "0.4.0"
#define AppPublisher "xCONFLiCTiONx"
#define SourceRoot "..\dist"

[Setup]
AppId={{9B02A3B6-2A9D-4B1D-9D2E-27A4A66DDA40}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\SiteTunnel
DefaultGroupName=SiteTunnel
OutputDir=..\dist
OutputBaseFilename=SiteTunnel-Setup
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
PrivilegesRequired=admin
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\SiteTunnel.NativeHost.exe

[Files]
Source: "{#SourceRoot}\SiteTunnel.NativeHost.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\Tor\*"; DestDir: "{app}\Tor"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\extension-id.txt"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\com.xconflictionx.sitetunnel"; ValueType: string; ValueName: ""; ValueData: "{app}\com.xconflictionx.sitetunnel.json"; Flags: uninsdeletekey

[Code]
function InitializeSetup(): Boolean;
begin
  if not FileExists(ExpandConstant('{#SourceRoot}\SiteTunnel.NativeHost.exe')) then begin
    MsgBox('Build SiteTunnel first by running windows\build-windows.ps1.', mbError, MB_OK);
    Result := False;
  end else
    Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExtensionId: String;
  ManifestText: String;
begin
  if CurStep = ssPostInstall then begin
    if LoadStringFromFile(ExpandConstant('{app}\extension-id.txt'), ExtensionId) then begin
      ExtensionId := Trim(ExtensionId);
      ManifestText := '{"name":"com.xconflictionx.sitetunnel","description":"SiteTunnel Tor native host","path":"' +
        StringChangeEx(ExpandConstant('{app}\SiteTunnel.NativeHost.exe'), '\', '\\', True) +
        '","type":"stdio","allowed_origins":["chrome-extension://' + ExtensionId + '/"]}';
      SaveStringToFile(ExpandConstant('{app}\com.xconflictionx.sitetunnel.json'), ManifestText, False);
    end;
  end;
end;
