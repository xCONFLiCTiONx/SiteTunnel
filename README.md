# SiteTunnel

A free, open-source Chrome Manifest V3 extension that routes requests for `pornhub.com` and `xvideos.com` (including subdomains) through a selected public proxy. Other hostnames are sent directly.

## Features

- Loads a public Netherlands proxy list from [maximilianfeix/free-proxy-list](https://github.com/maximilianfeix/free-proxy-list).
- Supports HTTP, HTTPS, SOCKS4, and SOCKS5 proxy entries where Chrome's PAC resolver supports them.
- Connect, disconnect, refresh the list, and check the proxy's observed exit IP.
- Saves the previous Chrome proxy configuration and attempts to restore it on disconnect.
- No account, analytics, or tracking SDK.

## Install locally

1. Download this repository (Code → Download ZIP) and extract it.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted `SiteTunnel` folder.
5. Click the extension icon, refresh the proxy list, select an endpoint, then click **Connect**.

## Privacy and limitations

This is a browser proxy switcher, **not a VPN**. Public proxy operators are strangers and may log metadata, intercept unencrypted traffic, or be malicious. Use HTTPS destinations only; do not enter passwords or sensitive information while using a public proxy. The extension cannot guarantee that any listed proxy works, is actually located in the Netherlands, or is accepted by either target website.

The PAC rules route only the two named domains and their subdomains through the selected proxy. Other hostnames, including third-party media/CDN domains, go direct unless explicitly added to the target list. Therefore, this does not guarantee that every request associated with those sites is proxied. It does not clear browser history or cookies. This initial version has not been independently security-audited or verified against live sessions.

## Sources

- [Public proxy list](https://github.com/maximilianfeix/free-proxy-list)
- [Chrome proxy API](https://developer.chrome.com/docs/extensions/reference/api/proxy)
- [Chromium network stack](https://chromium.org/developers/design-documents/network-stack/)

## License

MIT. See [LICENSE](LICENSE).