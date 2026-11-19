const ALARM_NAME = "sitetunnel-reapply";

// SVG Icon Paths (viewBox="0 0 16 16")
const ICON_PATH_DEFAULT = "M5.5 13h4c.83 0 1.5-.67 1.5-1.5v-9A1.5 1.5 0 0 0 9.5 1h-4A1.5 1.5 0 0 0 4 2.5v9c0 .83.67 1.5 1.5 1.5m.65-8.85A.5.5 0 0 1 6.5 4h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.5-.5.5.5 0 0 1 .15-.35m0 4A.5.5 0 0 1 6.5 8h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.5-.5.5.5 0 0 1 .15-.35m0 2A.5.5 0 0 1 6.5 10h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.35-.85m7.82 4.17-1.5-4A.5.5 0 0 0 12 10v1.5A2.5 2.5 0 0 1 9.5 14h-4A2.5 2.5 0 0 1 3 11.5V10a.5.5 0 0 0-.47.32l-1.5 4q-.05.12-.03.24a.5.5 0 0 0 .5.44h12a.5.5 0 0 0 .41-.22.5.5 0 0 0 .06-.46";
const ICON_PATH_CONNECTED = "M10 8h.5a.5.5 0 1 0 0-1H10V5.5A2.5 2.5 0 0 0 9.5 4h1a.5.5 0 1 0 0-1h-1a.5.5 0 0 0-.5.5v.01A2.5 2.5 0 0 0 7.5 3H7v-.5A1.5 1.5 0 0 1 8.5 1h3A1.5 1.5 0 0 1 13 2.5v6c0 .83-.67 1.5-1.5 1.5H10zm4 .41.97 2.93a.5.5 0 0 1-.07.45.5.5 0 0 1-.4.21h-3.25l-.33-.97V11h.58A2.5 2.5 0 0 0 14 8.5zm-4 3 .98 2.93a.5.5 0 0 1-.07.45.5.5 0 0 1-.4.21h-9a.5.5 0 0 1-.5-.42 1 1 0 0 1 .02-.24L2 11.42v.08A2.5 2.5 0 0 0 4.5 14h3a2.5 2.5 0 0 0 2.5-2.5zM7.5 13h-3A1.5 1.5 0 0 1 3 11.5v-6A1.5 1.5 0 0 1 4.5 4h3A1.5 1.5 0 0 1 9 5.5v6c0 .83-.67 1.5-1.5 1.5m-2-7a.5.5 0 1 0 0 1h1a.5.5 0 1 0 0-1zm0 4a.5.5 0 1 0 0 1h1a.5.5 0 1 0 0-1z";

let currentSystemIsDark = null;
const imageBitmapCache = {};

try {
  chrome.storage.local.get(["last_known_is_dark"], (res) => {
    if (res && typeof res.last_known_is_dark === "boolean") {
      currentSystemIsDark = res.last_known_is_dark;
    }
  });
} catch (_) {}

function getRenderedImageData(isConnected, isDark) {
  const cacheKey = (isConnected ? "conn" : "def") + "_" + (isDark ? "dark" : "light");
  if (imageBitmapCache[cacheKey]) {
    return imageBitmapCache[cacheKey];
  }
  const pathString = isConnected ? ICON_PATH_CONNECTED : ICON_PATH_DEFAULT;
  const iconColor = isConnected ? (isDark ? "#f6821f" : "#d96509") : (isDark ? "#FFFFFF" : "#000000");
  const result = {};

  for (const size of [16, 32, 48, 128]) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = iconColor;
    ctx.save();
    ctx.scale(size / 16, size / 16);
    const p = new Path2D(pathString);
    ctx.fill(p);
    ctx.restore();
    result[size] = ctx.getImageData(0, 0, size, size);
  }

  imageBitmapCache[cacheKey] = result;
  return result;
}

function normalizeHost(value) {
  let host = String(value || "").trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^\*?\./, "").replace(/\.$/, "").replace(/^www\./, "");
  return host;
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

function isHostRouted(host, sites, mode) {
  if (!host) return false;
  host = normalizeHost(host);
  if (!host) return false;
  const sitesList = Array.isArray(sites) ? sites : [];
  const matched = sitesList.some(domain => hostMatches(host, domain));
  return mode === "include" ? matched : !matched;
}

function isUrlRouted(url, sites, mode) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || !parsed.hostname.includes(".")) {
      return false;
    }
    return isHostRouted(parsed.hostname, sites, mode);
  } catch (_) {
    return false;
  }
}

// Whole-Tab Tunneling tracking structures
const routedTabUrls = new Map(); // tabId -> normalized URL / hostname
const tabDiscoveredDomains = new Map(); // tabId -> Set of discovered third-party hostnames
let currentActiveTabId = null;
let currentActiveTabIsRouted = false;
let cachedSettings = null;
let pacUpdateTimer = null;

function getAllDiscoveredDomains() {
  const all = new Set();
  for (const domainSet of tabDiscoveredDomains.values()) {
    if (domainSet && domainSet.size) {
      for (const d of domainSet) {
        all.add(d);
      }
    }
  }
  return Array.from(all);
}

async function checkActiveTabRouting(settings) {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const activeTab = tabs && tabs[0] ? tabs[0] : null;
    if (!activeTab || !activeTab.id || !activeTab.url) {
      currentActiveTabId = null;
      currentActiveTabIsRouted = false;
      return { isRouted: false, isExcluded: false };
    }
    currentActiveTabId = activeTab.id;

    let parsed = null;
    try { parsed = new URL(activeTab.url); } catch (_) {}
    const isHttp = parsed && ["http:", "https:"].includes(parsed.protocol) && parsed.hostname && parsed.hostname.includes(".");
    if (!isHttp) {
      currentActiveTabIsRouted = false;
      routedTabUrls.delete(activeTab.id);
      return { isRouted: false, isExcluded: false };
    }

    const host = normalizeHost(parsed.hostname);
    const sites = Array.isArray(settings.sites) ? settings.sites : [];
    const matched = sites.some(domain => hostMatches(host, domain));
    const mode = settings.mode === "include" ? "include" : "exclude";

    const isRouted = mode === "include" ? matched : !matched;
    const isExcluded = mode === "exclude" ? matched : false;

    currentActiveTabIsRouted = isRouted;
    if (isRouted) {
      routedTabUrls.set(activeTab.id, activeTab.url);
    } else {
      routedTabUrls.delete(activeTab.id);
    }
    return { isRouted, isExcluded };
  } catch (_) {
    currentActiveTabIsRouted = false;
    return { isRouted: false, isExcluded: false };
  }
}

async function initTabTracking(settings) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab && tab.id && tab.url) {
        if (isUrlRouted(tab.url, settings.sites, settings.mode)) {
          routedTabUrls.set(tab.id, tab.url);
        }
      }
    }
    await checkActiveTabRouting(settings);
  } catch (_) {}
}

function schedulePacUpdate(delay = 250) {
  if (pacUpdateTimer) clearTimeout(pacUpdateTimer);
  pacUpdateTimer = setTimeout(async () => {
    pacUpdateTimer = null;
    try {
      const stored = await getSettings();
      if (stored.active) {
        await applyProxySettings(stored);
      }
    } catch (err) {
      console.warn("SiteTunnel: Failed to apply updated PAC for discovered domains:", err);
    }
  }, delay);
}

function normalizeSites(sites) {
  const input = Array.isArray(sites) ? sites : [];
  const out = [];
  for (const raw of input) {
    let host = normalizeHost(raw);
    if (!host || host.length > 253 || !host.includes(".")) continue;
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) continue;
    if (!out.includes(host)) out.push(host);
  }
  return out;
}

async function getSettings() {
  const stored = await chrome.storage.local.get([
    "active",
    "warpHost",
    "warpPort",
    "warpProtocol",
    "fallbackPolicy",
    "sites",
    "mode",
    "webrtcProtection",
    "tabRouting",
    "connectedAt",
    "lastTestResult",
    "previousProxyConfig",
    "hasPreviousProxyConfig"
  ]);

  return {
    active: Boolean(stored.active),
    warpHost: (typeof stored.warpHost === "string" && stored.warpHost.trim()) ? stored.warpHost.trim() : "127.0.0.1",
    warpPort: Number.isInteger(Number(stored.warpPort)) && Number(stored.warpPort) >= 1 && Number(stored.warpPort) <= 65535 ? Number(stored.warpPort) : 40000,
    warpProtocol: ["socks5", "http", "auto"].includes(stored.warpProtocol) ? stored.warpProtocol : "socks5",
    fallbackPolicy: ["fail-closed", "direct"].includes(stored.fallbackPolicy) ? stored.fallbackPolicy : "fail-closed",
    sites: Array.isArray(stored.sites) ? normalizeSites(stored.sites) : [],
    mode: stored.mode === "include" ? "include" : "exclude",
    webrtcProtection: typeof stored.webrtcProtection === "boolean" ? stored.webrtcProtection : true,
    tabRouting: typeof stored.tabRouting === "boolean" ? stored.tabRouting : true,
    connectedAt: stored.connectedAt || null,
    lastTestResult: stored.lastTestResult || null,
    previousProxyConfig: stored.previousProxyConfig || null,
    hasPreviousProxyConfig: Boolean(stored.hasPreviousProxyConfig)
  };
}

async function refreshCachedSettings() {
  try {
    cachedSettings = await getSettings();
  } catch (_) {}
  return cachedSettings;
}

// Builds the PAC script targeting Cloudflare Zero Trust / WARP Local Proxy
function buildPacScript(config, options = {}) {
  let activeTabIsRouted = false;
  let activeTabIsExcluded = false;
  let dynamicDomains = [];
  let includeTestTrace = false;

  if (typeof options === "boolean") {
    includeTestTrace = options;
  } else if (options && typeof options === "object") {
    activeTabIsRouted = Boolean(options.activeTabIsRouted);
    activeTabIsExcluded = Boolean(options.activeTabIsExcluded);
    dynamicDomains = Array.isArray(options.dynamicDomains) ? options.dynamicDomains : [];
    includeTestTrace = Boolean(options.includeTestTrace);
  }

  const host = config.warpHost || "127.0.0.1";
  const port = config.warpPort || 40000;
  const protocol = config.warpProtocol || "socks5";
  const fallbackPolicy = config.fallbackPolicy || "fail-closed";
  const mode = config.mode === "include" ? "include" : "exclude";
  const tabRouting = config.tabRouting !== false; // default true

  const baseSites = normalizeSites(config.sites || []);
  const extraSites = mode === "include" ? normalizeSites(dynamicDomains || []) : [];
  const allSites = Array.from(new Set([...baseSites, ...extraSites]));

  let proxyDirective = "";
  if (protocol === "http") {
    proxyDirective = "PROXY " + host + ":" + port;
  } else if (protocol === "auto") {
    proxyDirective = "SOCKS5 " + host + ":" + port + "; SOCKS " + host + ":" + port + "; PROXY " + host + ":" + port;
  } else {
    // SOCKS5 default
    proxyDirective = "SOCKS5 " + host + ":" + port + "; SOCKS " + host + ":" + port;
  }

  // Routing return string with user-configured fallback policy:
  // - "fail-closed": If local WARP proxy drops, traffic fails closed (port 9 discard) instead of leaking direct
  // - "direct": Falls back to DIRECT if local WARP proxy drops
  const routedReturn = fallbackPolicy === "fail-closed"
    ? proxyDirective + "; PROXY 127.0.0.1:9"
    : proxyDirective + "; DIRECT";

  const unroutedReturn = "DIRECT";

  let script = "function FindProxyForURL(url, host) {\n";
  script += "  if (!host) return 'DIRECT';\n";
  script += "  host = String(host).toLowerCase();\n";
  script += "  if (host.length > 0 && host.charAt(host.length - 1) === '.') host = host.substring(0, host.length - 1);\n\n";

  // Prevent proxying localhost / loopback addresses
  script += "  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || (host.length > 6 && host.indexOf('.local', host.length - 6) !== -1)) return 'DIRECT';\n\n";

  // When running diagnostic test, route Cloudflare trace endpoint through proxy
  if (includeTestTrace) {
    script += "  if (host === 'www.cloudflare.com' || host === 'cloudflare.com') return " + JSON.stringify(proxyDirective + "; DIRECT") + ";\n\n";
  }

  // Whole-Tab Tunneling / Whole-Tab Bypass for focused tab
  if (tabRouting) {
    if (activeTabIsRouted) {
      script += "  // Whole-Tab Tunnel Active: Current focused tab is routed via Cloudflare Zero Trust\n";
      script += "  return " + JSON.stringify(routedReturn) + ";\n";
      script += "}";
      return script;
    }
    if (activeTabIsExcluded) {
      script += "  // Whole-Tab Bypass Active: Current focused tab is configured to bypass proxy\n";
      script += "  return " + JSON.stringify(unroutedReturn) + ";\n";
      script += "}";
      return script;
    }
  }

  script += "  var sites = " + JSON.stringify(allSites) + ";\n";
  script += "  var matched = false;\n";
  script += "  for (var i = 0; i < sites.length; i++) {\n";
  script += "    var s = sites[i];\n";
  script += "    if (host === s || host === 'www.' + s || (host.length > s.length && host.indexOf('.' + s, host.length - s.length - 1) !== -1)) {\n";
  script += "      matched = true;\n";
  script += "      break;\n";
  script += "    }\n";
  script += "  }\n\n";

  if (mode === "include") {
    script += "  return matched ? " + JSON.stringify(routedReturn) + " : " + JSON.stringify(unroutedReturn) + ";\n";
  } else {
    script += "  return matched ? " + JSON.stringify(unroutedReturn) + " : " + JSON.stringify(routedReturn) + ";\n";
  }
  script += "}";

  return script;
}

function getTabProxyRoute(tabUrl, settings) {
  if (!settings || !settings.active) {
    return { isConnected: false, title: "SiteTunnel: Disconnected" };
  }
  if (!tabUrl) {
    return { isConnected: false, title: "SiteTunnel: Direct" };
  }
  let parsed;
  try { parsed = new URL(tabUrl); } catch (_) {
    return { isConnected: false, title: "SiteTunnel: Direct" };
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || !parsed.hostname.includes(".")) {
    return { isConnected: false, title: "SiteTunnel: Direct" };
  }
  const host = normalizeHost(parsed.hostname);
  if (!host) {
    return { isConnected: false, title: "SiteTunnel: Direct" };
  }

  const sites = Array.isArray(settings.sites) ? settings.sites : [];
  const matched = sites.some(domain => hostMatches(host, domain));
  const mode = settings.mode === "include" ? "include" : "exclude";
  const usesProxy = mode === "include" ? matched : !matched;

  if (usesProxy) {
    const ep = (settings.warpHost || "127.0.0.1") + ":" + (settings.warpPort || 40000);
    const modeDesc = settings.tabRouting !== false ? "Whole-Tab Tunnel Active" : "Domain Routed";
    return {
      isConnected: true,
      title: "SiteTunnel: " + modeDesc + " via WARP (" + ep + ")"
    };
  }
  return {
    isConnected: false,
    title: "SiteTunnel: Direct (" + host + " bypassed)"
  };
}

function safeActionSetIcon(details) {
  return new Promise((resolve) => {
    try {
      if (!chrome.action || !chrome.action.setIcon) return resolve(false);
      chrome.action.setIcon(details, () => {
        // Explicitly inspect chrome.runtime.lastError to mark it as handled by the extension
        const err = chrome.runtime.lastError;
        resolve(!err);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function safeActionSetTitle(details) {
  return new Promise((resolve) => {
    try {
      if (!chrome.action || !chrome.action.setTitle) return resolve(false);
      chrome.action.setTitle(details, () => {
        const err = chrome.runtime.lastError;
        resolve(!err);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function safeGetTab(tabId) {
  return new Promise((resolve) => {
    try {
      if (!chrome.tabs || !chrome.tabs.get) return resolve(null);
      chrome.tabs.get(tabId, (tab) => {
        const err = chrome.runtime.lastError;
        if (err || !tab) {
          resolve(null);
        } else {
          resolve(tab);
        }
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function safeGetActiveTab() {
  return new Promise((resolve) => {
    try {
      if (!chrome.tabs || !chrome.tabs.query) return resolve(null);
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const err = chrome.runtime.lastError;
        if (err || !tabs || !tabs.length) {
          resolve(null);
        } else {
          resolve(tabs[0]);
        }
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function checkTabSupposedToBeRouted(tabId, url, settings) {
  if (!settings || !settings.active) return false;

  // 1. If Whole-Tab Tunneling has registered this tab
  if (settings.tabRouting !== false && tabId != null && tabId >= 0 && routedTabUrls.has(tabId)) {
    return true;
  }

  // 2. If Whole-Tab Tunneling has the active tab routed
  if (settings.tabRouting !== false && tabId != null && tabId === currentActiveTabId && currentActiveTabIsRouted) {
    return true;
  }

  // 3. If URL is directly routed by include/exclude rules
  if (url && isUrlRouted(url, settings.sites, settings.mode)) {
    return true;
  }

  // 4. If URL was not provided, inspect tab
  if (tabId != null && tabId >= 0 && !url) {
    const tab = await safeGetTab(tabId);
    if (tab && tab.url && isUrlRouted(tab.url, settings.sites, settings.mode)) {
      return true;
    }
  }

  return false;
}

function isNetworkFailureError(err) {
  if (!err) return false;
  const e = String(err).toUpperCase();
  return (
    e.includes("ERR_PROXY_CONNECTION_FAILED") ||
    e.includes("ERR_SOCKS_CONNECTION_FAILED") ||
    e.includes("ERR_SOCKS_CONNECTION_HOST_UNREACHABLE") ||
    e.includes("ERR_PROXY_CONNECTION_RESET") ||
    e.includes("ERR_TUNNEL_CONNECTION_FAILED") ||
    e.includes("ERR_CONNECTION_REFUSED") ||
    e.includes("ERR_CONNECTION_RESET") ||
    e.includes("ERR_CONNECTION_TIMED_OUT") ||
    e.includes("ERR_TIMED_OUT") ||
    e.includes("ERR_CONNECTION_CLOSED") ||
    e.includes("ERR_NAME_NOT_RESOLVED") ||
    e.includes("ERR_MANDATORY_PROXY_CONFIGURATION_FAILED") ||
    e.includes("ERR_ADDRESS_UNREACHABLE") ||
    e.includes("ERR_INTERNET_DISCONNECTED")
  );
}

function friendlyError(err) {
  if (!err) return "Connection dropped";
  const e = String(err);
  if (e.includes("ERR_PROXY_CONNECTION_FAILED") || e.includes("ERR_CONNECTION_REFUSED")) {
    return "WARP proxy listener unreachable";
  }
  if (e.includes("ERR_SOCKS_CONNECTION_FAILED")) {
    return "SOCKS5 proxy handshake failed";
  }
  if (e.includes("ERR_CONNECTION_TIMED_OUT") || e.includes("ERR_TIMED_OUT")) {
    return "Proxy connection timed out";
  }
  if (e.includes("ERR_NAME_NOT_RESOLVED")) {
    return "DNS resolution over proxy failed";
  }
  return e.replace(/^net::/, "");
}

let currentBadgeStatus = "normal"; // "normal" | "connecting" | "down" | "leak"
let proxyFailureStartTime = null;
let proxyFailureTimer = null;
let proxyIsCurrentlyDown = false;
let lastLeakAlertTime = 0;

async function setExtensionBadge(status) {
  if (!chrome.action) return;
  currentBadgeStatus = status;
  try {
    if (status === "leak") {
      await chrome.action.setBadgeText({ text: "LEAK" });
      await chrome.action.setBadgeBackgroundColor({ color: "#DC2626" });
      await safeActionSetTitle({ title: "SiteTunnel WARNING: Traffic is leaking direct or proxy hijacked!" });
    } else if (status === "down") {
      await chrome.action.setBadgeText({ text: "ERR" });
      await chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
      await safeActionSetTitle({ title: "SiteTunnel ALERT: WARP proxy unreachable for 30s+ (Traffic blocked by fail-safe)" });
    } else if (status === "connecting") {
      await chrome.action.setBadgeText({ text: "!" });
      await chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" });
      await safeActionSetTitle({ title: "SiteTunnel: Connecting to WARP (Traffic safely blocked by fail-safe)" });
    } else {
      await chrome.action.setBadgeText({ text: "" });
    }
  } catch (_) {}
}

async function handleProxyRecovered() {
  if (proxyFailureStartTime !== null || proxyIsCurrentlyDown || currentBadgeStatus !== "normal") {
    proxyFailureStartTime = null;
    proxyIsCurrentlyDown = false;
    if (proxyFailureTimer) {
      clearTimeout(proxyFailureTimer);
      proxyFailureTimer = null;
    }
    await setExtensionBadge("normal");
    const stored = cachedSettings || await getSettings();
    await updateAllTabIcons();
  }
}

async function handleTrafficLeak({ title, message, domain, tabId, reason }) {
  const settings = cachedSettings || await getSettings();
  if (!settings.active) return;

  await setExtensionBadge("leak");

  const now = Date.now();
  if (now - lastLeakAlertTime < 10000) return;
  lastLeakAlertTime = now;
}

async function handleConnectionFailure({ domain, tabId, error, type = "request" }) {
  const settings = cachedSettings || await getSettings();
  if (!settings.active) return;

  const ep = (settings.warpHost || "127.0.0.1") + ":" + (settings.warpPort || 40000);

  // 1. LEAK CHECK: If fallback policy is "direct", traffic fails open — this is an ACTIVE LEAK!
  if (settings.fallbackPolicy === "direct") {
    await handleTrafficLeak({
      title: "SiteTunnel Security Warning: Traffic Leaking Direct",
      message: `WARP proxy (${ep}) is unreachable and Fallback Policy is set to Direct. Traffic on "${domain || "tab"}" is connecting directly to the internet unproxied!`,
      domain,
      tabId,
      reason: "direct_fallback_leak"
    });
    return;
  }

  // 2. FAIL-CLOSED: Traffic is safely blocked by 127.0.0.1:9 discard port.
  // Set ambient badge indicator immediately so user is aware
  await setExtensionBadge(proxyIsCurrentlyDown ? "down" : "connecting");

  // 3. Mark down if continuous for 30s
  if (proxyFailureStartTime === null) {
    proxyFailureStartTime = Date.now();
  }

  if (proxyFailureTimer) return;

  proxyFailureTimer = setTimeout(async () => {
    proxyFailureTimer = null;
    const currentSettings = cachedSettings || await getSettings();
    if (!currentSettings.active) return;

    const elapsed = Date.now() - (proxyFailureStartTime || 0);
    if (elapsed >= 29000) {
      const diag = await checkWarpStatus();
      if (!diag || !diag.ok || !diag.warpActive) {
        proxyIsCurrentlyDown = true;
        await setExtensionBadge("down");
      } else {
        handleProxyRecovered();
      }
    }
  }, 30000);
}

async function updateTabActionIcon(tabId, tabUrl, settings, isDark) {
  if (!chrome.action) return;
  const route = getTabProxyRoute(tabUrl, settings);
  const imageDataMap = getRenderedImageData(route.isConnected, isDark);

  if (tabId != null) {
    await safeActionSetIcon({ tabId: tabId, imageData: imageDataMap });
    await safeActionSetTitle({ tabId: tabId, title: route.title });
  } else {
    await safeActionSetIcon({ imageData: imageDataMap });
    await safeActionSetTitle({ title: route.title });
  }
}

async function updateAllTabIcons(forceDark) {
  try {
    const stored = await getSettings();
    let isDark = forceDark;
    if (typeof isDark !== "boolean") {
      if (currentSystemIsDark !== null) {
        isDark = currentSystemIsDark;
      } else {
        const storedTheme = await chrome.storage.local.get(["last_known_is_dark"]);
        if (storedTheme && typeof storedTheme.last_known_is_dark === "boolean") {
          isDark = storedTheme.last_known_is_dark;
        } else {
          isDark = false;
        }
      }
    }
    currentSystemIsDark = isDark;

    if (chrome.action) {
      const defaultGlobalData = getRenderedImageData(Boolean(stored.active), isDark);
      await safeActionSetIcon({ imageData: defaultGlobalData });
      const globalTitle = stored.active ? "SiteTunnel: Active (Cloudflare WARP)" : "SiteTunnel: Disconnected";
      await safeActionSetTitle({ title: globalTitle });
    }

    if (chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab && typeof tab.id === "number" && tab.id >= 0) {
          await updateTabActionIcon(tab.id, tab.url, stored, isDark);
        }
      }
    }

    if (currentBadgeStatus !== "normal") {
      await setExtensionBadge(currentBadgeStatus);
    }
  } catch (err) {
    console.warn("SiteTunnel: Error updating tab icons:", err);
  }
}

async function enableWebRtcLeakProtection() {
  try {
    if (chrome.privacy && chrome.privacy.network && chrome.privacy.network.webRTCIPHandlingPolicy) {
      await chrome.privacy.network.webRTCIPHandlingPolicy.set({
        value: "disable_non_proxied_udp"
      });
    }
  } catch (_) {}
}

async function disableWebRtcLeakProtection() {
  try {
    if (chrome.privacy && chrome.privacy.network && chrome.privacy.network.webRTCIPHandlingPolicy) {
      await chrome.privacy.network.webRTCIPHandlingPolicy.clear({});
    }
  } catch (_) {}
}

async function applyProxySettings(config, options = {}) {
  const setting = await chrome.proxy.settings.get({ incognito: false });
  if (setting.levelOfControl === "controlled_by_other_extensions" || setting.levelOfControl === "not_controllable") {
    throw new Error("Another extension or browser enterprise policy controls Chrome proxy settings.");
  }

  let opts = {};
  if (typeof options === "boolean") {
    opts = { includeTestTrace: options };
  } else if (options && typeof options === "object") {
    opts = Object.assign({}, options);
  }

  if (typeof opts.activeTabIsRouted !== "boolean") {
    const tabRouteInfo = await checkActiveTabRouting(config);
    opts.activeTabIsRouted = tabRouteInfo.isRouted;
    opts.activeTabIsExcluded = tabRouteInfo.isExcluded;
  }
  if (!Array.isArray(opts.dynamicDomains)) {
    opts.dynamicDomains = getAllDiscoveredDomains();
  }

  const pacData = buildPacScript(config, opts);
  await chrome.proxy.settings.set({
    value: { mode: "pac_script", pacScript: { data: pacData } },
    scope: "regular"
  });
}

async function connect(customConfig = null) {
  const stored = await getSettings();
  const config = Object.assign({}, stored, customConfig || {});

  const setting = await chrome.proxy.settings.get({ incognito: false });
  if (setting.levelOfControl === "controlled_by_other_extensions" || setting.levelOfControl === "not_controllable") {
    throw new Error("Another extension or browser enterprise policy controls Chrome proxy settings.");
  }

  if (!stored.hasPreviousProxyConfig) {
    await chrome.storage.local.set({
      previousProxyConfig: setting.value || null,
      hasPreviousProxyConfig: true
    });
  }

  await initTabTracking(config);
  await applyProxySettings(config, false);

  if (config.webrtcProtection) {
    await enableWebRtcLeakProtection();
  }

  await chrome.storage.local.set({
    active: true,
    warpHost: config.warpHost,
    warpPort: config.warpPort,
    warpProtocol: config.warpProtocol,
    fallbackPolicy: config.fallbackPolicy,
    sites: config.sites,
    mode: config.mode,
    webrtcProtection: config.webrtcProtection,
    tabRouting: config.tabRouting !== false,
    connectedAt: Date.now()
  });

  proxyFailureStartTime = null;
  if (proxyFailureTimer) { clearTimeout(proxyFailureTimer); proxyFailureTimer = null; }
  proxyIsCurrentlyDown = false;
  await setExtensionBadge("normal");

  await refreshCachedSettings();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  await updateAllTabIcons();
  return { ok: true, config };
}

async function disconnect() {
  const stored = await getSettings();
  if (stored.hasPreviousProxyConfig && stored.previousProxyConfig) {
    try {
      await chrome.proxy.settings.set({ value: stored.previousProxyConfig, scope: "regular" });
    } catch (_) {
      await chrome.proxy.settings.clear({ scope: "regular" });
    }
  } else {
    await chrome.proxy.settings.clear({ scope: "regular" });
  }

  routedTabUrls.clear();
  tabDiscoveredDomains.clear();
  currentActiveTabId = null;
  currentActiveTabIsRouted = false;
  proxyFailureStartTime = null;
  if (proxyFailureTimer) { clearTimeout(proxyFailureTimer); proxyFailureTimer = null; }
  proxyIsCurrentlyDown = false;
  await setExtensionBadge("normal");

  await disableWebRtcLeakProtection();
  await chrome.storage.local.set({
    active: false,
    previousProxyConfig: null,
    hasPreviousProxyConfig: false
  });

  await refreshCachedSettings();
  await chrome.alarms.clear(ALARM_NAME);
  await updateAllTabIcons();
  return { ok: true };
}

// Live end-to-end check of Cloudflare Zero Trust / WARP local proxy via cdn-cgi/trace
async function checkWarpStatus() {
  const stored = await getSettings();
  const before = await chrome.proxy.settings.get({ incognito: false });
  let result = null;

  try {
    // Configure temporary PAC routing www.cloudflare.com through local proxy
    await applyProxySettings(stored, true);
    await new Promise(r => setTimeout(r, 150));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const resp = await fetch("https://www.cloudflare.com/cdn-cgi/trace?sitetunnel_diag=" + Date.now(), {
        cache: "no-store",
        signal: controller.signal
      });

      if (!resp.ok) {
        throw new Error("Cloudflare returned HTTP " + resp.status);
      }

      const text = await resp.text();
      const lines = text.split("\n");
      const trace = {};
      for (const line of lines) {
        const idx = line.indexOf("=");
        if (idx > -1) {
          trace[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }

      const isWarpOn = trace.warp === "on" || trace.warp === "plus";
      const isGatewayOn = trace.gateway === "on";

      result = {
        ok: true,
        warpActive: isWarpOn || isGatewayOn,
        warpStatus: trace.warp || "off",
        gatewayStatus: trace.gateway || "off",
        ip: trace.ip || "unknown",
        colo: trace.colo || "unknown",
        loc: trace.loc || "unknown",
        ts: Date.now()
      };

      await chrome.storage.local.set({ lastTestResult: result });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const errorMsg = String(err && err.message ? err.message : err);
    result = {
      ok: false,
      error: errorMsg.includes("abort") || errorMsg.includes("timeout")
        ? "Connection timed out connecting to local proxy at " + stored.warpHost + ":" + stored.warpPort + ". Check that Cloudflare WARP is running."
        : "Failed to connect to local WARP proxy at " + stored.warpHost + ":" + stored.warpPort + ". (" + errorMsg + ")"
    };
  } finally {
    // Restore proxy state
    try {
      if (stored.active) {
        await applyProxySettings(stored, false);
      } else {
        if (before && before.value) {
          await chrome.proxy.settings.set({ value: before.value, scope: "regular" });
        } else {
          await chrome.proxy.settings.clear({ scope: "regular" });
        }
      }
    } catch (restoreErr) {
      console.warn("SiteTunnel: Error restoring proxy settings after test:", restoreErr);
    }
  }

  return result;
}

// Offscreen Document Setup for OS dark/light detection
let creatingOffscreenPromise = null;
async function setupOffscreenDocument() {
  try {
    if (!chrome.offscreen) return;
    if (chrome.offscreen.hasDocument) {
      if (await chrome.offscreen.hasDocument()) return;
    } else if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen.html')]
      });
      if (contexts && contexts.length > 0) return;
    }

    if (creatingOffscreenPromise) {
      await creatingOffscreenPromise;
      return;
    }

    creatingOffscreenPromise = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['MATCH_MEDIA'],
      justification: 'Detect system dark or light mode to update toolbar icon'
    });
    await creatingOffscreenPromise;
  } catch (err) {
    if (!String(err).includes('already exists')) {
      console.warn('SiteTunnel: Offscreen document error:', err);
    }
  } finally {
    creatingOffscreenPromise = null;
  }
}

// Tab navigation listeners
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const currentUrl = (tab && tab.url) || changeInfo.url;
  if (changeInfo.status === "loading" && currentUrl) {
    const stored = cachedSettings || await getSettings();
    if (stored.active && stored.tabRouting !== false) {
      const isRouted = isUrlRouted(currentUrl, stored.sites, stored.mode);
      if (isRouted) {
        routedTabUrls.set(tabId, currentUrl);
      } else {
        routedTabUrls.delete(tabId);
        tabDiscoveredDomains.delete(tabId);
      }
      if (tabId === currentActiveTabId && currentActiveTabIsRouted !== isRouted) {
        currentActiveTabIsRouted = isRouted;
        await applyProxySettings(stored);
      }
    }
  }

  if (changeInfo.status === "complete" || changeInfo.url) {
    const stored = cachedSettings || await getSettings();
    await updateTabActionIcon(tabId, currentUrl, stored, currentSystemIsDark ?? false);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    currentActiveTabId = activeInfo.tabId;
    const stored = cachedSettings || await getSettings();
    if (stored.active && stored.tabRouting !== false) {
      await applyProxySettings(stored);
    }
    const tab = await safeGetTab(activeInfo.tabId);
    if (tab && tab.id != null) {
      await updateTabActionIcon(tab.id, tab.url, stored, currentSystemIsDark ?? false);
    }
  } catch (_) {}
});

if (chrome.windows && chrome.windows.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    try {
      const stored = cachedSettings || await getSettings();
      if (stored.active && stored.tabRouting !== false) {
        await applyProxySettings(stored);
      }
    } catch (_) {}
  });
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  routedTabUrls.delete(tabId);
  tabDiscoveredDomains.delete(tabId);
  if (tabId === currentActiveTabId) {
    currentActiveTabId = null;
    currentActiveTabIsRouted = false;
    const stored = cachedSettings || await getSettings();
    if (stored.active && stored.tabRouting !== false) {
      schedulePacUpdate(100);
    }
  }
});

if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
  chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return; // Only main document
    try {
      const stored = cachedSettings || await getSettings();
      if (!stored.active || stored.tabRouting === false) return;

      const isRouted = isUrlRouted(details.url, stored.sites, stored.mode);
      if (isRouted) {
        routedTabUrls.set(details.tabId, details.url);
      } else {
        routedTabUrls.delete(details.tabId);
        tabDiscoveredDomains.delete(details.tabId);
      }

      if (details.tabId === currentActiveTabId) {
        if (currentActiveTabIsRouted !== isRouted) {
          currentActiveTabIsRouted = isRouted;
          await applyProxySettings(stored);
        }
      }
    } catch (_) {}
  });
}

if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0) return;
      try {
        const settings = cachedSettings;
        if (!settings || !settings.active || settings.tabRouting === false) return;
        if (settings.mode !== "include") return;

        let isFromRoutedTab = routedTabUrls.has(details.tabId);
        let initiatorIsRouted = false;

        if (!isFromRoutedTab && details.initiator) {
          try {
            const initHost = new URL(details.initiator).hostname;
            initiatorIsRouted = isHostRouted(initHost, settings.sites, settings.mode);
          } catch (_) {}
        }

        if (isFromRoutedTab || initiatorIsRouted) {
          try {
            const reqUrl = new URL(details.url);
            if (["http:", "https:", "ws:", "wss:"].includes(reqUrl.protocol) && reqUrl.hostname && reqUrl.hostname.includes(".")) {
              const host = normalizeHost(reqUrl.hostname);
              if (host) {
                let domainSet = tabDiscoveredDomains.get(details.tabId);
                if (!domainSet) {
                  domainSet = new Set();
                  tabDiscoveredDomains.set(details.tabId, domainSet);
                }
                if (!domainSet.has(host)) {
                  domainSet.add(host);
                  // If current active tab is not currently routed, update PAC so background tab subresources route properly
                  if (!currentActiveTabIsRouted) {
                    schedulePacUpdate(300);
                  }
                }
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    },
    { urls: ["<all_urls>"] }
  );
}

// Web Navigation Error Handler: Fires when main page navigation fails on a VPN-routed tab
if (chrome.webNavigation && chrome.webNavigation.onErrorOccurred) {
  chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
    if (details.frameId !== 0) return; // Main frame document only
    try {
      const settings = cachedSettings || await getSettings();
      if (!settings.active) return;

      const isRouted = await checkTabSupposedToBeRouted(details.tabId, details.url, settings);
      if (!isRouted) return;

      const err = String(details.error || "");
      if (isNetworkFailureError(err)) {
        let domain = "";
        try { domain = new URL(details.url).hostname; } catch (_) {}
        await handleConnectionFailure({
          domain: domain,
          tabId: details.tabId,
          error: err,
          type: "navigation"
        });
      }
    } catch (_) {}
  });
}

// Web Request Success Handler: Confirms active proxy recovery when traffic flows through routed tab
if (chrome.webRequest && chrome.webRequest.onCompleted) {
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (details.tabId < 0) return;
      try {
        const settings = cachedSettings;
        if (!settings || !settings.active) return;

        let isRoutedTab = false;
        if (settings.tabRouting !== false && (routedTabUrls.has(details.tabId) || (details.tabId === currentActiveTabId && currentActiveTabIsRouted))) {
          isRoutedTab = true;
        } else if (details.url && isUrlRouted(details.url, settings.sites, settings.mode)) {
          isRoutedTab = true;
        }

        if (isRoutedTab) {
          handleProxyRecovered();
        }
      } catch (_) {}
    },
    { urls: ["<all_urls>"] }
  );
}

// Web Request Error Handler: Catches subresource and API failures in VPN-routed tabs
if (chrome.webRequest && chrome.webRequest.onErrorOccurred) {
  chrome.webRequest.onErrorOccurred.addListener(
    async (details) => {
      if (details.tabId < 0) return;
      try {
        const settings = cachedSettings || await getSettings();
        if (!settings.active) return;

        const isRouted = await checkTabSupposedToBeRouted(details.tabId, details.url, settings);
        if (!isRouted) return;

        const err = String(details.error || "");
        if (isNetworkFailureError(err)) {
          let domain = "";
          try { domain = new URL(details.url).hostname; } catch (_) {}

          const isProxyErr = err.includes("ERR_PROXY") || err.includes("ERR_SOCKS") || err.includes("ERR_TUNNEL") || err.includes("ERR_CONNECTION_REFUSED");
          if (details.type === "main_frame" || isProxyErr) {
            await handleConnectionFailure({
              domain: domain,
              tabId: details.tabId,
              error: err,
              type: details.type || "subresource"
            });
          }
        }
      } catch (_) {}
    },
    { urls: ["<all_urls>"] }
  );
}

// Proxy Subsystem Error Handler: Catches low-level Chromium proxy setup or connection drops
if (chrome.proxy && chrome.proxy.onProxyError) {
  chrome.proxy.onProxyError.addListener(async (details) => {
    try {
      const settings = cachedSettings || await getSettings();
      if (!settings.active) return;

      const activeTab = await safeGetActiveTab();
      const isRouted = activeTab && (await checkTabSupposedToBeRouted(activeTab.id, activeTab.url, settings));

      if (isRouted || routedTabUrls.size > 0) {
        let domain = "";
        if (activeTab && activeTab.url) {
          try { domain = new URL(activeTab.url).hostname; } catch (_) {}
        }
        await handleConnectionFailure({
          domain: domain,
          tabId: activeTab ? activeTab.id : null,
          error: details.error || "proxy_error",
          type: "proxy"
        });
      }
    } catch (_) {}
  });
}

// Proxy Settings Change Handler: Detects if another extension or system policy hijacks proxy settings
if (chrome.proxy && chrome.proxy.settings && chrome.proxy.settings.onChange) {
  chrome.proxy.settings.onChange.addListener(async (details) => {
    try {
      const settings = cachedSettings || await getSettings();
      if (!settings.active) return;
      if (details.levelOfControl !== "controlled_by_this_extension") {
        await handleTrafficLeak({
          title: "SiteTunnel Security Warning: Proxy Control Lost",
          message: "Another extension or system policy changed Chrome proxy settings. Traffic on protected tabs is no longer proxied!",
          reason: "proxy_control_lost"
        });
      }
    } catch (_) {}
  });
}

// Runtime message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const msgType = message?.type || message?.action;
      if (!message || !msgType) {
        sendResponse({ ok: false, error: "Missing message type." });
        return;
      }

      if (msgType === "updateIcon" || msgType === "THEME_CHANGED" || msgType === "UPDATE_THEME_ICON") {
        if (typeof message.isDarkMode === "boolean") {
          currentSystemIsDark = message.isDarkMode;
          try { await chrome.storage.local.set({ last_known_is_dark: message.isDarkMode }); } catch (_) {}
          await updateAllTabIcons(message.isDarkMode);
        }
        sendResponse({ success: true });
        return;
      }

      if (message.type === "GET_STATE") {
        const stored = await getSettings();
        const setting = await chrome.proxy.settings.get({ incognito: false });
        const discoveredCount = getAllDiscoveredDomains().length;
        sendResponse({
          ok: true,
          active: stored.active,
          warpHost: stored.warpHost,
          warpPort: stored.warpPort,
          warpProtocol: stored.warpProtocol,
          fallbackPolicy: stored.fallbackPolicy,
          sites: stored.sites,
          mode: stored.mode,
          webrtcProtection: stored.webrtcProtection,
          tabRouting: stored.tabRouting,
          discoveredCount: discoveredCount,
          activeTabIsRouted: currentActiveTabIsRouted,
          connectedAt: stored.connectedAt,
          lastTestResult: stored.lastTestResult,
          levelOfControl: setting.levelOfControl,
          proxyIsCurrentlyDown: proxyIsCurrentlyDown,
          currentBadgeStatus: currentBadgeStatus
        });
        return;
      }

      if (message.type === "CONNECT") {
        const res = await connect(message.config);
        sendResponse(res);
        return;
      }

      if (message.type === "DISCONNECT") {
        const res = await disconnect();
        sendResponse(res);
        return;
      }

      if (message.type === "CHECK_WARP_STATUS") {
        const res = await checkWarpStatus();
        sendResponse(res);
        return;
      }

      if (message.type === "SAVE_WARP_CONFIG") {
        const host = (typeof message.warpHost === "string" && message.warpHost.trim()) ? message.warpHost.trim() : "127.0.0.1";
        const port = Number(message.warpPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error("Port must be a valid number between 1 and 65535.");
        }
        const protocol = ["socks5", "http", "auto"].includes(message.warpProtocol) ? message.warpProtocol : "socks5";
        const fallback = ["fail-closed", "direct"].includes(message.fallbackPolicy) ? message.fallbackPolicy : "fail-closed";
        const webrtc = typeof message.webrtcProtection === "boolean" ? message.webrtcProtection : true;
        const tabRouting = typeof message.tabRouting === "boolean" ? message.tabRouting : true;

        const saveObj = {
          warpHost: host,
          warpPort: port,
          warpProtocol: protocol,
          fallbackPolicy: fallback,
          webrtcProtection: webrtc,
          tabRouting: tabRouting
        };

        await chrome.storage.local.set(saveObj);

        await refreshCachedSettings();
        const stored = await getSettings();
        if (stored.active) {
          await applyProxySettings(stored, false);
          if (webrtc) await enableWebRtcLeakProtection();
          else await disableWebRtcLeakProtection();
        }

        await updateAllTabIcons();
        sendResponse({ ok: true, stored });
        return;
      }

      if (message.type === "SAVE_RULES") {
        const sites = normalizeSites(message.sites);
        const mode = message.mode === "include" ? "include" : "exclude";
        const saveObj = { sites, mode };
        if (typeof message.tabRouting === "boolean") {
          saveObj.tabRouting = message.tabRouting;
        }
        await chrome.storage.local.set(saveObj);

        await refreshCachedSettings();
        const stored = await getSettings();
        await initTabTracking(stored);
        if (stored.active) {
          await applyProxySettings(stored, false);
        }

        await updateAllTabIcons();
        sendResponse({ ok: true, sites, mode, tabRouting: stored.tabRouting, active: stored.active });
        return;
      }

      if (message.type === "SAVE_TAB_ROUTING") {
        const tabRouting = Boolean(message.tabRouting);
        await chrome.storage.local.set({ tabRouting });
        await refreshCachedSettings();
        const stored = await getSettings();
        if (stored.active) {
          await applyProxySettings(stored, false);
        }
        await updateAllTabIcons();
        sendResponse({ ok: true, tabRouting });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type: " + message.type });
    } catch (err) {
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  })();

  return true;
});

// Periodic alarm handler: re-asserts PAC if active to handle any browser drops
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    const stored = await getSettings();
    if (stored.active) {
      try {
        await applyProxySettings(stored, false);
      } catch (_) {}

      // Verify proxy settings haven't been hijacked by another extension or policy
      try {
        const currentSetting = await chrome.proxy.settings.get({ incognito: false });
        if (currentSetting.levelOfControl !== "controlled_by_this_extension") {
          await handleTrafficLeak({
            title: "SiteTunnel Security Warning: Proxy Control Lost",
            message: "Another extension or policy took over Chrome proxy settings. Protected tabs are not proxied!",
            reason: "proxy_hijacked_alarm"
          });
        }
      } catch (_) {}

      // Fail-safe periodic health check when routed tabs are active
      if (routedTabUrls.size > 0 || currentActiveTabIsRouted) {
        try {
          const res = await checkWarpStatus();
          if (res && (!res.ok || !res.warpActive)) {
            const activeTab = await safeGetActiveTab();
            let domain = "";
            if (activeTab && activeTab.url) {
              try { domain = new URL(activeTab.url).hostname; } catch (_) {}
            }
            await handleConnectionFailure({
              domain: domain,
              tabId: activeTab ? activeTab.id : null,
              error: res.error || "Cloudflare WARP client is disconnected or paused on Windows.",
              type: "alarm_health_check"
            });
          } else if (res && res.ok && res.warpActive) {
            handleProxyRecovered();
          }
        } catch (_) {}
      }
    }
  }
});

// Initialization
(async () => {
  try {
    const stored = await refreshCachedSettings();
    await initTabTracking(stored);
    chrome.storage.local.get(["last_known_is_dark"], (res) => {
      if (res && typeof res.last_known_is_dark === "boolean") {
        currentSystemIsDark = res.last_known_is_dark;
        updateAllTabIcons(res.last_known_is_dark);
      } else {
        updateAllTabIcons(false);
      }
      setupOffscreenDocument();
    });
  } catch (_) {
    setupOffscreenDocument();
  }
})();

chrome.runtime.onInstalled.addListener(async () => {
  setupOffscreenDocument();
  try {
    const existing = await chrome.storage.local.get(["mode"]);
    if (!existing.mode) {
      await chrome.storage.local.set({ mode: "exclude" });
    }
  } catch (_) {}
  const stored = await refreshCachedSettings();
  await initTabTracking(stored);
  updateAllTabIcons();
});

chrome.runtime.onStartup.addListener(async () => {
  setupOffscreenDocument();
  const stored = await refreshCachedSettings();
  await initTabTracking(stored);
  updateAllTabIcons();
  if (stored.active) {
    try {
      await applyProxySettings(stored, false);
      if (stored.webrtcProtection) await enableWebRtcLeakProtection();
    } catch (_) {}
  }
});
