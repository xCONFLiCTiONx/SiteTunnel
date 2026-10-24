# SiteTunnel

A free, open-source Chrome Manifest V3 extension that lets you define your own domain list and choose how those domains are routed through a selected public proxy.

## Features

- **Include mode (default):** only requests whose destination hostname matches a listed domain or its subdomains use the selected proxy; every other hostname connects directly.
- **Exclude mode:** all destination hostnames use the selected proxy except domains in your list and their subdomains, which connect directly.
- **Important routing limitation:** Chrome PAC rules match the request's destination hostname, not the tab/site that initiated it. Include mode does not automatically proxy third-party APIs, IP-check services, CDNs, or embedded resources loaded by an included page. To proxy all ordinary browser destinations, use Exclude mode with an empty exclusion list.
- Add domains one per line; protocol prefixes and URL paths are normalized, and duplicate or invalid entries are ignored.
- Loads public proxy lists by country from [maximilianfeix/free-proxy-list](https://github.com/maximilianfeix/free-proxy-list).
- Supports HTTP, HTTPS, SOCKS4, and SOCKS5 proxy entries where Chrome's PAC resolver supports them.
- Prominent connection status, selected proxy and active mode, save/apply rules, disconnect, refresh the list, and check the proxy's observed exit IP.
- Saves site rules and attempts to restore the previous Chrome proxy configuration on disconnect.
- No preset destination domains, account, analytics, or tracking SDK.

## Install locally

1. Download this repository (Code → Download ZIP) and extract it.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted `SiteTunnel` folder.
5. Click the extension icon, refresh the proxy list, enter your domains, choose Include or Exclude, and click **Save & apply rules**.
6. Select a proxy and click **Connect proxy**.

## Privacy and limitations

This is a browser proxy switcher, **not a VPN**. Public proxy operators are strangers and may log metadata, intercept unencrypted traffic, or be malicious. Use HTTPS destinations only; do not enter passwords or sensitive information while using a public proxy. The extension cannot guarantee that any listed proxy works or is actually located in the specified country.

Rules match the destination hostname and its subdomains, not the origin page that initiated the request. They do not automatically include third-party media, CDN, API, IP-check, or other related domains. In Include mode, those destinations can connect directly even when the top-level page is proxied. To avoid that destination-based split, use Exclude mode with an empty exclusion list. Proxy behavior and protocol support depend on Chrome and the selected endpoint. This does not clear browser history or cookies. It has not been independently security-audited or verified against live sessions.

## Sources

- [Public proxy list](https://github.com/maximilianfeix/free-proxy-list)
- [Chrome proxy API](https://developer.chrome.com/docs/extensions/reference/api/proxy)
- [Chromium network stack](https://chromium.org/developers/design-documents/network-stack/)

## License

MIT. See [LICENSE](LICENSE).
