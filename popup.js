try {
  const isDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
  chrome.runtime.sendMessage({ action: "updateIcon", type: "UPDATE_THEME_ICON", isDarkMode });
} catch (e) {}

const $ = id => document.getElementById(id);

let currentTabHost = "";
let savedSites = [];
let currentState = null;

const send = async (type, extra = {}) => {
  try {
    return await chrome.runtime.sendMessage(Object.assign({ type: type }, extra));
  } catch (err) {
    console.warn(`SiteTunnel: Message '${type}' failed:`, err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
};

// SVG Icons (viewBox="0 0 16 16")
const ICON_PATH_DEFAULT = "M5.5 13h4c.83 0 1.5-.67 1.5-1.5v-9A1.5 1.5 0 0 0 9.5 1h-4A1.5 1.5 0 0 0 4 2.5v9c0 .83.67 1.5 1.5 1.5m.65-8.85A.5.5 0 0 1 6.5 4h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.5-.5.5.5 0 0 1 .15-.35m0 4A.5.5 0 0 1 6.5 8h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.5-.5.5.5 0 0 1 .15-.35m0 2A.5.5 0 0 1 6.5 10h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.35-.85m7.82 4.17-1.5-4A.5.5 0 0 0 12 10v1.5A2.5 2.5 0 0 1 9.5 14h-4A2.5 2.5 0 0 1 3 11.5V10a.5.5 0 0 0-.47.32l-1.5 4q-.05.12-.03.24a.5.5 0 0 0 .5.44h12a.5.5 0 0 0 .41-.22.5.5 0 0 0 .06-.46";
const ICON_PATH_CONNECTED = "M10 8h.5a.5.5 0 1 0 0-1H10V5.5A2.5 2.5 0 0 0 9.5 4h1a.5.5 0 1 0 0-1h-1a.5.5 0 0 0-.5.5v.01A2.5 2.5 0 0 0 7.5 3H7v-.5A1.5 1.5 0 0 1 8.5 1h3A1.5 1.5 0 0 1 13 2.5v6c0 .83-.67 1.5-1.5 1.5H10zm4 .41.97 2.93a.5.5 0 0 1-.07.45.5.5 0 0 1-.4.21h-3.25l-.33-.97V11h.58A2.5 2.5 0 0 0 14 8.5zm-4 3 .98 2.93a.5.5 0 0 1-.07.45.5.5 0 0 1-.4.21h-9a.5.5 0 0 1-.5-.42 1 1 0 0 1 .02-.24L2 11.42v.08A2.5 2.5 0 0 0 4.5 14h3a2.5 2.5 0 0 0 2.5-2.5zM7.5 13h-3A1.5 1.5 0 0 1 3 11.5v-6A1.5 1.5 0 0 1 4.5 4h3A1.5 1.5 0 0 1 9 5.5v6c0 .83-.67 1.5-1.5 1.5m-2-7a.5.5 0 1 0 0 1h1a.5.5 0 1 0 0-1zm0 4a.5.5 0 1 0 0 1h1a.5.5 0 1 0 0-1z";

function getSvgMarkup(isConnected, color) {
  const path = isConnected ? ICON_PATH_CONNECTED : ICON_PATH_DEFAULT;
  const fillColor = color || "currentColor";
  return '<svg width="100%" height="100%" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="' + fillColor + '" d="' + path + '"/></svg>';
}

let lastTabIsConnected = false;
function updateBrandIcon(isConnected) {
  if (typeof isConnected === 'boolean') lastTabIsConnected = isConnected;
  const brandEl = $("brandIcon");
  if (brandEl) {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const color = lastTabIsConnected ? '#f6821f' : (isDark ? '#FFFFFF' : '#000000');
    brandEl.innerHTML = getSvgMarkup(lastTabIsConnected, color);
  }
}

function openSettings() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    chrome.tabs.create({ url: "options.html" });
  }
}

$("openSettingsBtn").addEventListener("click", openSettings);
$("footerSettingsBtn").addEventListener("click", openSettings);
$("quickEditBtn").addEventListener("click", openSettings);
$("manageRulesLink").addEventListener("click", (e) => {
  e.preventDefault();
  openSettings();
});

let messageTimer = null;
function setMessage(text, type = "normal") {
  const messageEl = $("message");
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.className = "message " + (type === "error" ? "error" : type === "success" ? "success" : "");
  if (messageTimer) clearTimeout(messageTimer);
  if (type === "success" || type === "error") {
    messageTimer = setTimeout(() => {
      messageEl.textContent = "";
      messageEl.className = "message";
    }, 4000);
  }
}

function normalizeHost(value) {
  let host = String(value || "").trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^\*?\./, "").replace(/\.$/, "").replace(/^www\./, "");
  return host;
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

// Connect Button
$("connectBtn").addEventListener("click", async () => {
  $("connectBtn").disabled = true;
  setMessage("Connecting to Cloudflare WARP…", "normal");
  try {
    const result = await send("CONNECT");
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : "Connection failed.");
    setMessage("Connected to Cloudflare WARP local proxy!", "success");
    await updateState();
  } catch (err) {
    setMessage(err.message || "Could not connect.", "error");
  } finally {
    $("connectBtn").disabled = false;
  }
});

// Disconnect Button
$("disconnectBtn").addEventListener("click", async () => {
  $("disconnectBtn").disabled = true;
  try {
    const result = await send("DISCONNECT");
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : "Could not disconnect.");
    setMessage("Disconnected. All traffic is direct.", "normal");
    await updateState();
  } catch (err) {
    setMessage(err.message || "Could not disconnect.", "error");
  } finally {
    $("disconnectBtn").disabled = false;
  }
});

// Test WARP Route Diagnostic
$("testWarpBtn").addEventListener("click", async () => {
  const button = $("testWarpBtn");
  button.disabled = true;
  const row = $("diagResultRow");
  const resultEl = $("diagResult");
  row.style.display = "block";
  row.className = "diagResultRow";
  resultEl.textContent = "Checking Cloudflare WARP local proxy at " + ($("endpointText").textContent || "127.0.0.1:40000") + "…";

  try {
    const result = await send("CHECK_WARP_STATUS");
    if (!result || !result.ok) {
      row.className = "diagResultRow error";
      resultEl.innerHTML = "<strong>✕ Connection Failed:</strong> " + (result && result.error ? result.error : "Cannot reach local proxy.");
      setMessage("WARP local proxy test failed.", "error");
      return;
    }

    if (result.warpActive) {
      row.className = "diagResultRow success";
      resultEl.innerHTML = "<strong>✓ WARP Active!</strong> Exit IP: <code>" + result.ip + "</code> · Colo: <code>" + result.colo + "</code> · Gateway: " + result.gatewayStatus;
      setMessage("Cloudflare Zero Trust connection verified!", "success");
    } else {
      row.className = "diagResultRow error";
      resultEl.innerHTML = "<strong>⚠️ Reached Cloudflare, but WARP is OFF:</strong> The WARP client on Windows is paused or disconnected. Turn WARP ON in the desktop app.";
      setMessage("WARP reported 'warp=off'.", "error");
    }
  } catch (err) {
    row.className = "diagResultRow error";
    resultEl.textContent = "✕ Diagnostic error: " + err.message;
    setMessage("Diagnostic test failed.", "error");
  } finally {
    button.disabled = false;
    await updateState();
  }
});

// Current Site Toggle
$("currentSiteBtn").addEventListener("click", async () => {
  if (!currentTabHost) return;
  const isIncluded = savedSites.includes(currentTabHost);
  if (isIncluded) {
    savedSites = savedSites.filter(s => s !== currentTabHost);
  } else {
    savedSites.push(currentTabHost);
  }
  const modeVal = $("modeExclude").checked ? "exclude" : "include";
  await send("SAVE_RULES", { sites: savedSites, mode: modeVal });
  updateCurrentSiteUI();
  setMessage((isIncluded ? "Removed " : "Added ") + currentTabHost + " to site rules.", "success");
  await updateState();
});

// Mode Radios
$("modeInclude").addEventListener("change", async () => {
  await send("SAVE_RULES", { sites: savedSites, mode: "include" });
  updateCurrentSiteUI();
  await updateState();
});
$("modeExclude").addEventListener("change", async () => {
  await send("SAVE_RULES", { sites: savedSites, mode: "exclude" });
  updateCurrentSiteUI();
  await updateState();
});

if ($("tabRoutingQuickToggle")) {
  $("tabRoutingQuickToggle").addEventListener("change", async () => {
    const enabled = $("tabRoutingQuickToggle").checked;
    await send("SAVE_TAB_ROUTING", { tabRouting: enabled });
    setMessage(enabled ? "Whole-tab tunneling active (all subresources included)." : "Whole-tab tunneling disabled (domain only).", "success");
    await updateState();
  });
}

function updateCurrentSiteUI() {
  $("rulesCountSpan").textContent = savedSites.length;
  if (!currentTabHost) {
    $("currentSiteDomain").textContent = "Browser page";
    $("currentSiteBtn").disabled = true;
    $("currentSiteBtn").textContent = "Route via WARP";
    return;
  }
  $("currentSiteDomain").textContent = currentTabHost;
  $("currentSiteBtn").disabled = false;
  const isPresent = savedSites.includes(currentTabHost);
  const isExclude = $("modeExclude").checked;

  if (isPresent) {
    $("currentSiteBtn").textContent = isExclude ? "Route via WARP (Remove bypass)" : "Bypass WARP (Remove rule)";
    $("currentSiteBtn").className = "secondary siteToggleBtn";
  } else {
    $("currentSiteBtn").textContent = isExclude ? "Bypass this site" : "Route via WARP";
    $("currentSiteBtn").className = "primary siteToggleBtn";
  }
}

async function detectCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs && tabs[0] ? tabs[0].url : "";
    let parsed = null;
    try { parsed = new URL(url || ""); } catch (_) {}
    if (parsed && ["http:", "https:"].includes(parsed.protocol) && parsed.hostname && parsed.hostname.includes(".")) {
      currentTabHost = normalizeHost(parsed.hostname);
    } else {
      currentTabHost = "";
    }
  } catch (_) {
    currentTabHost = "";
  }
  updateCurrentSiteUI();
}

async function updateState() {
  try {
    const state = await send("GET_STATE");
    if (!state || state.ok === false) return;
    currentState = state;

    savedSites = Array.isArray(state.sites) ? state.sites : [];
    const active = Boolean(state.active);
    const banner = $("connectionBanner");
    const statusPill = $("statusPill");

    $("endpointText").textContent = (state.warpHost || "127.0.0.1") + ":" + (state.warpPort || 40000);
    $("proxyProtocolBadge").textContent = (state.warpProtocol || "socks5").toUpperCase();

    if (state.fallbackPolicy === "fail-closed") {
      $("fallbackPolicyText").textContent = "Fail-Closed: Blocks routed sites if WARP drops (Killswitch)";
    } else {
      $("fallbackPolicyText").textContent = "Direct Fallback: Permits clear internet if WARP drops";
    }

    if (active) {
      if (state.currentBadgeStatus === "leak") {
        banner.className = "connectionBanner disconnected";
        banner.querySelector(".connectionIcon").textContent = "🚨";
        $("connectionTitle").textContent = "Warning: Traffic Leaking Direct!";
        $("connectionDetail").textContent = "Fallback is set to Direct or proxy settings were hijacked.";
      } else if (state.currentBadgeStatus === "down" || state.proxyIsCurrentlyDown) {
        banner.className = "connectionBanner disconnected";
        banner.querySelector(".connectionIcon").textContent = "✕";
        $("connectionTitle").textContent = "WARP Unreachable (Blocked Safely)";
        $("connectionDetail").textContent = "Traffic safely blocked from leaking. Check local WARP client.";
      } else if (state.currentBadgeStatus === "connecting") {
        banner.className = "connectionBanner connected";
        banner.querySelector(".connectionIcon").textContent = "⏳";
        $("connectionTitle").textContent = "Reconnecting to WARP…";
        $("connectionDetail").textContent = "Traffic safely blocked while WARP client reconnects.";
      } else {
        banner.className = "connectionBanner connected";
        banner.querySelector(".connectionIcon").textContent = "✓";
        $("connectionTitle").textContent = "Connected to Cloudflare WARP";
        $("connectionDetail").textContent = "Local Proxy active at " + (state.warpHost || "127.0.0.1") + ":" + (state.warpPort || 40000);
      }
      statusPill.textContent = "CONNECTED";
      statusPill.className = "pill on";
      $("disconnectBtn").disabled = false;
      $("connectBtn").disabled = true;
    } else {
      banner.className = "connectionBanner disconnected";
      banner.querySelector(".connectionIcon").textContent = "⚡";
      $("connectionTitle").textContent = "Disconnected";
      $("connectionDetail").textContent = "All traffic connects directly without WARP";
      statusPill.textContent = "DISCONNECTED";
      statusPill.className = "pill";
      $("disconnectBtn").disabled = true;
      $("connectBtn").disabled = false;
    }

    if (state.mode === "include") $("modeInclude").checked = true;
    else $("modeExclude").checked = true;

    if ($("tabRoutingQuickToggle")) {
      $("tabRoutingQuickToggle").checked = state.tabRouting !== false;
    }

    // Detect Tab route
    if (currentTabHost) {
      const matched = savedSites.some(d => hostMatches(currentTabHost, d));
      const mode = state.mode === "include" ? "include" : "exclude";
      const usesProxy = mode === "include" ? matched : !matched;
      const isProxied = active && usesProxy;

      if (isProxied) {
        const tabTunnelActive = state.tabRouting !== false;
        $("tabRouteDetail").textContent = tabTunnelActive
          ? "Current tab (" + currentTabHost + "): Whole tab routed via WARP (all subresources included)"
          : "Current tab (" + currentTabHost + "): Domain routed via WARP";
        $("tabRouteBadge").textContent = tabTunnelActive ? "Whole-Tab Tunnel" : "WARP Routed";
      } else {
        $("tabRouteDetail").textContent = "Current tab (" + currentTabHost + "): " + (active ? "Direct (Bypassed)" : "Direct");
        $("tabRouteBadge").textContent = "Direct";
      }
      updateBrandIcon(isProxied);
    } else {
      $("tabRouteDetail").textContent = active ? "WARP Local Proxy Ready" : "Direct connection";
      $("tabRouteBadge").textContent = active ? "Active" : "Direct";
      updateBrandIcon(active);
    }

    updateCurrentSiteUI();
  } catch (err) {
    console.warn("SiteTunnel: updateState failed:", err);
  }
}

(async function init() {
  updateBrandIcon(false);
  await detectCurrentTab();
  await updateState();
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.sites && Array.isArray(changes.sites.newValue)) {
      savedSites = changes.sites.newValue;
      updateCurrentSiteUI();
    }
    if (changes.mode && typeof changes.mode.newValue === "string") {
      if (changes.mode.newValue === "include") $("modeInclude").checked = true;
      else $("modeExclude").checked = true;
      updateCurrentSiteUI();
    }
    if (changes.active || changes.warpPort || changes.warpHost || changes.warpProtocol || changes.fallbackPolicy) {
      updateState();
    }
  }
});
