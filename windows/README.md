# SiteTunnel for Windows

## Visual Studio

Open SiteTunnel.sln in Visual Studio 2022 with the .NET 8 SDK installed. The solution contains the native messaging host that launches the bundled Tor process.

## Build the Windows package

1. Install PowerShell 7, the .NET 8 SDK, and Inno Setup 6.
2. From the repository root, run: windows\build-windows.ps1
3. Open windows\installer\SiteTunnel.iss in Inno Setup and compile it.
4. Run windows\dist\SiteTunnel-Setup.exe.
5. In Chrome, open chrome://extensions, enable Developer mode, and choose Load unpacked. Select windows\dist\extension.

The build script downloads the official Tor Expert Bundle from Tor Project's distribution server and generates a stable extension identity. The extension key is stored locally in windows/.extension-key.xml; preserve that file if you need the same extension ID on later builds. It is intentionally not committed.

## Current implementation notes

- The native helper starts the bundled Tor process and configures a local SOCKS listener at 127.0.0.1:9150.
- A listening SOCKS port does not prove Tor has completed bootstrap or that a website is successfully routed through Tor. Verify the exit IP before relying on it.
- This routes matching Chrome traffic only; it is not a full-device VPN.
- The Windows package and native host have not yet been validated on a clean Windows machine. Test the installer and failure behavior before relying on this for sensitive browsing.
