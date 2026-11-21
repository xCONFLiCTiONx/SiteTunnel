# SiteTunnel - Cloudflare Zero Trust & WARP Router

A Chrome Manifest V3 extension designed to route selected website traffic through the **Cloudflare Zero Trust / Cloudflare One WARP desktop client** running in **Local Proxy Mode** on Windows.

Instead of tunneling your entire computer's network traffic through WARP, SiteTunnel gives you fine-grained, per-domain routing directly in your browser. All other computer applications (games, Slack, system services) and unlisted websites continue using your direct internet connection.

---

## Why Local Proxy Mode?

Connecting your browser to random public proxies is dangerous: public proxy operators can log metadata, intercept unencrypted traffic, or perform man-in-the-middle attacks.

Cloudflare officially supports **Local Proxy Mode** in desktop WARP clients. When enabled:
- Cloudflare WARP exposes a local listener on your PC (default: `127.0.0.1:40000`, SOCKS5 / HTTP).
- Only applications configured to communicate with this local port route through Cloudflare Zero Trust.
- Your computer does not use a system-wide VPN virtual network interface.
- SiteTunnel compiles your domain rules into a native Chromium PAC script, dynamically routing target sites through your local WARP listener.

---

## Features

- **Local WARP Integration:** Connects directly to `127.0.0.1:40000` (or any custom port) via SOCKS5 or HTTP.
- **Whole-Tab Tunneling (All Tab Traffic Included):** When a target site is open in a tab, ALL traffic in that tab (including external APIs, third-party CDNs, fonts, auth providers, and embedded subresources) is routed through Cloudflare WARP so nothing in the tab bypasses the proxy.
- **Per-Domain Routing (Exclude & Include Modes):**
  - **Exclude mode (default):** All web traffic routes through Cloudflare Zero Trust *except* specified bypass domains.
  - **Include mode:** Only target domains and their subdomains route through Cloudflare Zero Trust; all other sites connect directly.
- **1-Click Current Site Toggle:** Toggle any open tab into or out of WARP routing directly from the extension popup.
- **Fail-Closed Killswitch Protection:** When configured for *Fail-Closed*, if the local WARP proxy drops offline, SiteTunnel drops traffic to protected sites rather than leaking cleartext data to the open internet.
- **Fail-Safe Health Monitoring & Ambient Badges:** Monitors proxy health in real-time. If WARP is down or unreachable, traffic to routed sites remains safely blocked by the fail-safe. Non-intrusive ambient toolbar badges (`!`, `ERR`, `LEAK`) keep you informed at a glance without interrupting your workflow with intrusive notifications.
- **Real-Time Cloudflare Diagnostic Verification:** Tests live end-to-end connectivity against `https://www.cloudflare.com/cdn-cgi/trace` through the local proxy, reporting exit IP, Cloudflare colocation data center (`colo`), and WARP status (`warp=on` / `gateway=on`).
- **WebRTC IP Leak Protection:** Automatically configures Chromium's `disable_non_proxied_udp` policy while connected to prevent WebRTC STUN/TURN queries from leaking your real direct IP.
- **Dark/Light Mode Dynamic Icons:** Toolbar icon reflects both dark/light mode and tab connection state in real time.

---

## Setup Guide for Windows

### Step 1: Enable Local Proxy Mode in Cloudflare WARP

#### Option A: Via the Cloudflare WARP Windows UI
1. Open Cloudflare WARP from your Windows taskbar system tray.
2. Click the **Gear icon (⚙️)** → select **Preferences**.
3. Go to the **Advanced** tab and click **Configure Proxy**.
4. Enable the local proxy and set the listening port to `40000`.
5. Select **Local Proxy** mode in WARP's client mode settings.
6. Ensure the main WARP toggle switch is **Connected (ON)**.

#### Option B: Via Windows PowerShell / Command Prompt
Run the following commands in PowerShell:
```powershell
warp-cli mode proxy
warp-cli proxy port 40000
warp-cli connect
```
*(On older versions of the client, use `warp-cli set-mode proxy` and `warp-cli set-proxy-port 40000`)*.

---

### Step 2: Install SiteTunnel in Chrome

1. Clone or extract this repository to your computer.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in top right).
4. Click **Load unpacked** and select the `SiteTunnel` folder.
5. Click the SiteTunnel extension icon in your Chrome toolbar.
6. Click **Test WARP** to confirm live communication with `127.0.0.1:40000`.
7. Add your target domains and click **Connect**.

---

## How It Works (PAC Script Architecture)

SiteTunnel manages proxy routing using Chromium's native Proxy Auto-Config (PAC) engine:

```javascript
function FindProxyForURL(url, host) {
  if (!host) return "DIRECT";
  host = String(host).toLowerCase();

  var sites = ["example.com", "my-target-site.net"];
  var matched = false;
  for (var i = 0; i < sites.length; i++) {
    var s = sites[i];
    if (host === s || host === 'www.' + s || host.indexOf('.' + s, host.length - s.length - 1) !== -1) {
      matched = true;
      break;
    }
  }

  // SOCKS5 to local WARP listener, failing closed to port 9 if WARP drops
  return matched ? "SOCKS5 127.0.0.1:40000; SOCKS 127.0.0.1:40000; PROXY 127.0.0.1:9" : "DIRECT";
}
```

---

## Three Important Considerations

1. **Protocol Compatibility:** Cloudflare WARP's local proxy listener operates on SOCKS5 and HTTP. SiteTunnel defaults to `SOCKS5 127.0.0.1:40000; SOCKS 127.0.0.1:40000`, with configurable HTTP and Auto fallback modes.
2. **Fail-Closed vs Direct Fallback:** By default, SiteTunnel enables **Fail-Closed (Killswitch)**. If WARP is closed or drops, routed sites fail closed (`ERR_PROXY_CONNECTION_FAILED`) to prevent accidental IP leaks. You can switch this to *Permit Direct Fallback* in Settings if you prefer continuous connectivity.
3. **Whole-Tab Traffic & Subresource Routing:** SiteTunnel features **Whole-Tab Tunneling**: when a tab matches your routing rules, all network requests originating from that tab (external APIs, scripts, stylesheets, CDNs, WebSockets, and auth redirects) route through Cloudflare WARP. Dynamically discovered subresource domains are preserved so background requests continue to route through the proxy even when switching tabs.

---

## Sources & Documentation

- [Cloudflare WARP Client Modes](https://developers.cloudflare.com/warp-client/warp-modes/)
- [Cloudflare One Client Modes](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/modes/)
- [Chromium Proxy API Reference](https://developer.chrome.com/docs/extensions/reference/api/proxy)

---

## License

GNU GPL version 3. See [LICENSE](LICENSE). The prior MIT contributor notice is retained in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
