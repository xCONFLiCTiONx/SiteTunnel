$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Run this script in PowerShell 7 or later.' }
$Root = Split-Path -Parent $PSScriptRoot
$Windows = Join-Path $Root 'windows'
$Out = Join-Path $Windows 'dist'
$TorVersion = '15.0.26'
$TorUrl = "https://dist.torproject.org/torbrowser/$TorVersion/tor-expert-bundle-windows-x86_64-$TorVersion.tar.gz"
$Bundle = Join-Path $env:TEMP "sitetunnel-tor-$TorVersion.tar.gz"
$TorOut = Join-Path $Out 'Tor'
$ExtensionOut = Join-Path $Out 'extension'
$KeyPath = Join-Path $Windows '.extension-key.xml'

New-Item -ItemType Directory -Force -Path $Out | Out-Null
if (-not (Test-Path $Bundle)) {
  Write-Host "Downloading official Tor Expert Bundle $TorVersion..."
  Invoke-WebRequest -Uri $TorUrl -OutFile $Bundle
}
if (Test-Path $TorOut) { Remove-Item $TorOut -Recurse -Force }
New-Item -ItemType Directory -Force -Path $TorOut | Out-Null
tar.exe -xzf $Bundle -C $TorOut
if ($LASTEXITCODE -ne 0) { throw 'Could not extract the official Tor Expert Bundle.' }
$TorExe = Get-ChildItem $TorOut -Filter tor.exe -Recurse | Select-Object -First 1
if (-not $TorExe) { throw 'tor.exe was not found in the official bundle archive.' }
if ($TorExe.DirectoryName -ne $TorOut) {
  Get-ChildItem $TorExe.DirectoryName -Force | Copy-Item -Destination $TorOut -Recurse -Force
}

$Project = Join-Path $Windows 'SiteTunnel.NativeHost\SiteTunnel.NativeHost.csproj'
$HostOut = Join-Path $Out 'host'
dotnet publish $Project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $HostOut
if ($LASTEXITCODE -ne 0) { throw 'Native host build failed.' }
Copy-Item (Join-Path $HostOut 'SiteTunnel.NativeHost.exe') (Join-Path $Out 'SiteTunnel.NativeHost.exe') -Force

$rsa = [System.Security.Cryptography.RSA]::Create(2048)
if (Test-Path $KeyPath) { $rsa.FromXmlString((Get-Content $KeyPath -Raw)) }
else { Set-Content -Path $KeyPath -Value $rsa.ToXmlString($true) -NoNewline }
$publicDer = $rsa.ExportSubjectPublicKeyInfo()
$key = [Convert]::ToBase64String($publicDer)
$hash = [System.Security.Cryptography.SHA256]::HashData($publicDer)
$hex = ([Convert]::ToHexString($hash)).Substring(0,32).ToLowerInvariant()
$extensionId = -join ($hex.ToCharArray() | ForEach-Object { [char]([int][char]'a' + [Convert]::ToInt32($_.ToString(),16)) })
$rsa.Dispose()

if (Test-Path $ExtensionOut) { Remove-Item $ExtensionOut -Recurse -Force }
New-Item -ItemType Directory -Force -Path $ExtensionOut | Out-Null
Get-ChildItem $Root -File | Where-Object { $_.Name -in @('manifest.json','background.js','popup.html','popup.js','popup.css','README.md') } | Copy-Item -Destination $ExtensionOut -Force
$manifestPath = Join-Path $ExtensionOut 'manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$manifest.key = $key
if ($manifest.permissions -notcontains 'nativeMessaging') { $manifest.permissions += 'nativeMessaging' }
$manifest | ConvertTo-Json -Depth 20 | Set-Content -Path $manifestPath -Encoding utf8
Set-Content -Path (Join-Path $Out 'extension-id.txt') -Value $extensionId -NoNewline
Write-Host "Extension ID: $extensionId"
Write-Host 'Build output: windows\dist'
Write-Host 'Load windows\dist\extension in Chrome after installing the Windows helper.'
Write-Host 'Compile windows\installer\SiteTunnel.iss with Inno Setup to create the installer.'
