
const ALARM_NAME = "sitetunnel-reapply";

// SVG Icon Paths (viewBox="0 0 16 16")
const ICON_PATH_DEFAULT = "M5.5 13h4c.83 0 1.5-.67 1.5-1.5v-9A1.5 1.5 0 0 0 9.5 1h-4A1.5 1.5 0 0 0 4 2.5v9c0 .83.67 1.5 1.5 1.5m.65-8.85A.5.5 0 0 1 6.5 4h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.5-.5.5.5 0 0 1 .15-.35m0 4A.5.5 0 0 1 6.5 8h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.5-.5.5.5 0 0 1 .15-.35m0 2A.5.5 0 0 1 6.5 10h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.35-.85m7.82 4.17-1.5-4A.5.5 0 0 0 12 10v1.5A2.5 2.5 0 0 1 9.5 14h-4A2.5 2.5 0 0 1 3 11.5V10a.5.5 0 0 0-.47.32l-1.5 4q-.05.12-.03.24a.5.5 0 0 0 .5.44h12a.5.5 0 0 0 .41-.22.5.5 0 0 0 .06-.46";
const ICON_PATH_CONNECTED = "M10 8h.5a.5.5 0 1 0 0-1H10V5.5A2.5 2.5 0 0 0 9.5 4h1a.5.5 0 1 0 0-1h-1a.5.5 0 0 0-.5.5v.01A2.5 2.5 0 0 0 7.5 3H7v-.5A1.5 1.5 0 0 1 8.5 1h3A1.5 1.5 0 0 1 13 2.5v6c0 .83-.67 1.5-1.5 1.5H10zm4 .41.97 2.93a.5.5 0 0 1-.07.45.5.5 0 0 1-.4.21h-3.25l-.33-.97V11h.58A2.5 2.5 0 0 0 14 8.5zm-4 3 .98 2.93a.5.5 0 0 1-.07.45.5.5 0 0 1-.4.21h-9a.5.5 0 0 1-.5-.42 1 1 0 0 1 .02-.24L2 11.42v.08A2.5 2.5 0 0 0 4.5 14h3a2.5 2.5 0 0 0 2.5-2.5zM7.5 13h-3A1.5 1.5 0 0 1 3 11.5v-6A1.5 1.5 0 0 1 4.5 4h3A1.5 1.5 0 0 1 9 5.5v6c0 .83-.67 1.5-1.5 1.5m-2-7a.5.5 0 1 0 0 1h1a.5.5 0 1 0 0-1zm0 4a.5.5 0 1 0 0 1h1a.5.5 0 1 0 0-1z";

let currentSystemIsDark = null;
let lastRenderedThemeDark = null;
const imageBitmapCache = {}; // key: `${isConnected ? 'conn' : 'def'}_${isDark ? 'dark' : 'light'}` -> { [size]: ImageData }

function getRenderedImageData(isConnected, isDark) {
  const cacheKey = (isConnected ? "conn" : "def") + "_" + (isDark ? "dark" : "light");
  if (imageBitmapCache[cacheKey]) {
    return imageBitmapCache[cacheKey];
  }
  const pathString = isConnected ? ICON_PATH_CONNECTED : ICON_PATH_DEFAULT;
  const iconColor = isDark ? "#FFFFFF" : "#000000";
  const result = {};

  for (const size of [16, 32, 48]) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = iconColor;
    ctx.save();
    // Path coordinates are designed on a 16x16 grid
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

function getTabProxyRoute(tabUrl, settings) {
  if (!settings || !settings.active || !settings.selectedProxy) {
    return { isConnected: false, proxy: null, title: "Disconnected" };
  }
  if (!tabUrl) {
    return { isConnected: false, proxy: null, title: "Disconnected" };
  }
  let parsed;
  try { parsed = new URL(tabUrl); } catch (_) {
    return { isConnected: false, proxy: null, title: "Disconnected" };
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || !parsed.hostname.includes(".")) {
    return { isConnected: false, proxy: null, title: "Disconnected" };
  }
  const host = normalizeHost(parsed.hostname);
  if (!host) {
    return { isConnected: false, proxy: null, title: "Disconnected" };
  }

  // Check per-domain proxy override mappings
  const map = settings.siteProxyMap && typeof settings.siteProxyMap === "object" ? settings.siteProxyMap : {};
  let mappedHost = "";
  let mappedProxy = "";
  for (const [rawDomain, preferredProxy] of Object.entries(map)) {
    const domain = normalizeHost(rawDomain);
    if (domain && typeof preferredProxy === "string" && preferredProxy && hostMatches(host, domain) && domain.length > mappedHost.length) {
      mappedHost = domain;
      mappedProxy = preferredProxy;
    }
  }

  if (mappedProxy) {
    return { isConnected: true, proxy: mappedProxy, title: "Connected: " + mappedProxy };
  }

  const sites = Array.isArray(settings.sites) ? settings.sites.map(normalizeHost).filter(Boolean) : [];
  const matched = sites.some(domain => hostMatches(host, domain));
  const usesProxy = settings.mode === "exclude" ? !matched : matched;
  if (usesProxy) {
    return { isConnected: true, proxy: settings.selectedProxy, title: "Connected: " + settings.selectedProxy };
  }
  return { isConnected: false, proxy: null, title: "Disconnected" };
}

function isTabUsingProxy(tabUrl, settings) {
  return getTabProxyRoute(tabUrl, settings).isConnected;
}

async function updateTabActionIcon(tabId, tabUrl, settings, isDark) {
  if (!chrome.action) return;
  const route = getTabProxyRoute(tabUrl, settings);
  const imageDataMap = getRenderedImageData(route.isConnected, isDark);
  try {
    if (chrome.action.setIcon) {
      if (tabId != null) {
        await chrome.action.setIcon({ tabId: tabId, imageData: imageDataMap });
      } else {
        await chrome.action.setIcon({ imageData: imageDataMap });
      }
    }
  } catch (_) {}
  try {
    if (chrome.action.setTitle) {
      if (tabId != null) {
        await chrome.action.setTitle({ tabId: tabId, title: route.title });
      } else {
        await chrome.action.setTitle({ title: route.title });
      }
    }
  } catch (_) {}
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
          isDark = true; // Fallback default
        }
      }
    }
    currentSystemIsDark = isDark;
    lastRenderedThemeDark = isDark;

    // Apply default global icon & tooltip
    if (chrome.action) {
      if (chrome.action.setIcon) {
        const defaultGlobalData = getRenderedImageData(false, isDark);
        await chrome.action.setIcon({ imageData: defaultGlobalData }).catch(() => {});
      }
      if (chrome.action.setTitle) {
        await chrome.action.setTitle({ title: "Disconnected" }).catch(() => {});
      }
    }

    // Update per-tab icons for all active tabs across windows
    if (chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab && tab.id) {
          await updateTabActionIcon(tab.id, tab.url, stored, isDark);
        }
      }
    }
  } catch (err) {
    console.warn("SiteTunnel: Error updating tab icons:", err);
  }
}

function normalizeSites(sites) {
  const input = Array.isArray(sites) ? sites : [];
  const out = [];
  for (const raw of input) {
    let host = String(raw || "").trim().toLowerCase();
    host = host.replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^\*?\./, "").replace(/\.$/, "").replace(/^www\./, "");
    if (!host || host.length > 253 || !host.includes(".")) continue;
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) continue;
    if (!out.includes(host)) out.push(host);
  }
  return out;
}

function proxyToPac(proxy) {
  const match = /^(http|https|socks4|socks5):\/\/([^:/\s]+):(\d{1,5})$/i.exec(String(proxy || ""));
  if (!match) throw new Error("Unsupported proxy entry.");
  const scheme = match[1].toLowerCase(), host = match[2], port = Number(match[3]);
  if (port < 1 || port > 65535) throw new Error("Invalid proxy port.");
  const map = {http:"PROXY", https:"HTTPS", socks4:"SOCKS", socks5:"SOCKS5"};
  return map[scheme] + " " + host + ":" + port;
}

function pacScript(proxy, sites, mode, includeIpCheck, siteProxyMap) {
  const directive = proxyToPac(proxy);
  const normalized = normalizeSites(sites);
  const selectedMode = mode === "exclude" ? "exclude" : "include";
  const overrides = {};
  const sourceMap = siteProxyMap && typeof siteProxyMap === "object" ? siteProxyMap : {};
  // Normalize mapping keys independently from the site list so host spelling
  // differences (scheme, path, trailing dot, wildcard prefix) cannot silently
  // disable an otherwise saved per-domain override.
  for (const [rawHost, preferredProxy] of Object.entries(sourceMap)) {
    const hosts = normalizeSites([rawHost]);
    if (!hosts.length || typeof preferredProxy !== "string" || !preferredProxy) continue;
    try { overrides[hosts[0]] = proxyToPac(preferredProxy); } catch (_) {}
  }
  return "function FindProxyForURL(url, host) {\n" +
    "host = String(host || '').toLowerCase();\n" +
    (includeIpCheck ? "if (host === 'api.ipify.org') return " + JSON.stringify(directive) + ";\n" : "") +
    "var sites = " + JSON.stringify(normalized) + ";\n" +
    "var overrides = " + JSON.stringify(overrides) + ";\n" +
    "for (var key in overrides) { if (Object.prototype.hasOwnProperty.call(overrides, key) && (host === key || host === 'www.' + key || host.indexOf('.' + key, host.length - key.length - 1) !== -1)) return overrides[key]; }\n" +
    "var matched = false;\n" +
    "for (var i = 0; i < sites.length; i++) { if (host === sites[i] || host === 'www.' + sites[i] || host.indexOf('.' + sites[i], host.length - sites[i].length - 1) !== -1) { matched = true; break; } }\n" +
    "if (" + JSON.stringify(selectedMode) + " === 'include') return matched ? " + JSON.stringify(directive) + " : 'DIRECT';\n" +
    "return matched ? 'DIRECT' : " + JSON.stringify(directive) + ";\n}";
}
async function getSettings() {
  return await chrome.storage.local.get(["active", "selectedProxy", "sites", "mode", "previousProxyConfig", "hasPreviousProxyConfig", "healthyProxies", "autoRandomize", "siteProxyMap"]);
}
async function chooseHealthyProxy() {
  const stored = await getSettings();
  const pool = Array.isArray(stored.healthyProxies) ? stored.healthyProxies.filter(p => typeof p === "string") : [];
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
async function applyProxy(proxy, sites, mode, includeIpCheck, siteProxyMap) {
  const setting = await chrome.proxy.settings.get({incognito:false});
  if (setting.levelOfControl === "controlled_by_other_extensions" || setting.levelOfControl === "not_controllable") {
    throw new Error("Another extension or browser policy controls Chrome proxy settings.");
  }
  const data = pacScript(proxy, sites, mode, includeIpCheck, siteProxyMap);
  await chrome.proxy.settings.set({value:{mode:"pac_script", pacScript:{data:data}}, scope:"regular"});
}
async function connect(proxy, sites, mode) {
  const stored = await getSettings();
  const setting = await chrome.proxy.settings.get({incognito:false});
  if (setting.levelOfControl === "controlled_by_other_extensions" || setting.levelOfControl === "not_controllable") {
    throw new Error("Another extension or browser policy controls Chrome proxy settings.");
  }
  if (!stored.hasPreviousProxyConfig) {
    await chrome.storage.local.set({previousProxyConfig: setting.value || null, hasPreviousProxyConfig:true});
  }
  const cleanSites = normalizeSites(sites);
  const cleanMode = mode === "exclude" ? "exclude" : "include";
  await applyProxy(proxy, cleanSites, cleanMode, false, stored.siteProxyMap || {});
  await chrome.storage.local.set({active:true, selectedProxy:proxy, sites:cleanSites, mode:cleanMode, connectedAt:Date.now()});
  chrome.alarms.create(ALARM_NAME, {periodInMinutes:1});
  await updateAllTabIcons();
  return {ok:true, sites:cleanSites, mode:cleanMode};
}
async function disconnect() {
  const stored = await getSettings();
  if (stored.hasPreviousProxyConfig && stored.previousProxyConfig) {
    await chrome.proxy.settings.set({value:stored.previousProxyConfig, scope:"regular"});
  } else {
    await chrome.proxy.settings.clear({scope:"regular"});
  }
  await chrome.storage.local.set({active:false, previousProxyConfig:null, hasPreviousProxyConfig:false});
  await chrome.alarms.clear(ALARM_NAME);
  await updateAllTabIcons();
  return {ok:true};
}

// Offscreen Document Detection for Theme/Color-Scheme
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

// Tab navigation & activation listeners to maintain per-tab icon accuracy
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    const stored = await getSettings();
    await updateTabActionIcon(tabId, tab.url, stored, currentSystemIsDark ?? true);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab) {
      const stored = await getSettings();
      await updateTabActionIcon(tab.id, tab.url, stored, currentSystemIsDark ?? true);
    }
  } catch (_) {}
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message && (message.type === "THEME_CHANGED" || message.type === "UPDATE_THEME_ICON")) {
        if (typeof message.isDarkMode === "boolean") {
          currentSystemIsDark = message.isDarkMode;
          try { chrome.storage.local.set({ last_known_is_dark: message.isDarkMode }); } catch (_) {}
          await updateAllTabIcons(message.isDarkMode);
        }
        sendResponse({ success: true });
        return;
      }
      if (message && message.type === "CONNECT") {
        const res = await connect(message.proxy, message.sites, message.mode);
        sendResponse(res);
      }
      else if (message && message.type === "DISCONNECT") {
        const result = await disconnect();
        sendResponse(result);
      }
      else if (message && message.type === "SAVE_RULES") {
        const sites = normalizeSites(message.sites);
        const mode = message.mode === "exclude" ? "exclude" : "include";
        const stored = await getSettings();
        const siteProxyMap = {};
        for (const [rawHost, preferred] of Object.entries(stored.siteProxyMap || {})) {
          const normalizedHosts = normalizeSites([rawHost]);
          if (!normalizedHosts.length || typeof preferred !== "string" || !preferred) continue;
          const host = normalizedHosts[0];
          if (sites.includes(host)) siteProxyMap[host] = preferred;
        }
        await chrome.storage.local.set({sites:sites, mode:mode, siteProxyMap:siteProxyMap});
        if (stored.active && stored.selectedProxy) await applyProxy(stored.selectedProxy, sites, mode, false, siteProxyMap);
        await updateAllTabIcons();
        sendResponse({ok:true, sites:sites, mode:mode, active:Boolean(stored.active)});
      } else if (message && message.type === "SAVE_SITE_PROXY_MAP") {
        const stored = await getSettings();
        const allowed = new Set(normalizeSites(stored.sites || []));
        const map = {};
        if (message.map && typeof message.map === "object") {
          for (const [rawHost, preferred] of Object.entries(message.map)) {
            const normalizedHosts = normalizeSites([rawHost]);
            if (!normalizedHosts.length || typeof preferred !== "string" || !preferred) continue;
            const host = normalizedHosts[0];
            if (!allowed.has(host)) continue;
            try { proxyToPac(preferred); map[host] = preferred; } catch (_) {}
          }
        }
        await chrome.storage.local.set({siteProxyMap:map});
        if (stored.active && stored.selectedProxy) await applyProxy(stored.selectedProxy, stored.sites || [], stored.mode || "include", false, map);
        await updateAllTabIcons();
        sendResponse({ok:true, map:map});
      } else if (message && message.type === "SAVE_HEALTHY_POOL") {
        const pool = Array.isArray(message.proxies) ? [...new Set(message.proxies.filter(p => typeof p === "string"))].slice(0, 30) : [];
        await chrome.storage.local.set({healthyProxies:pool, autoRandomize:Boolean(message.autoRandomize)});
        sendResponse({ok:true, count:pool.length});
      } else if (message && message.type === "GET_STATE") {
        const stored = await getSettings();
        const setting = await chrome.proxy.settings.get({incognito:false});
        sendResponse({active:Boolean(stored.active), selectedProxy:stored.selectedProxy || "", sites:stored.sites || [], mode:stored.mode || "include", connectedAt:stored.connectedAt || null, levelOfControl:setting.levelOfControl, healthyProxies:stored.healthyProxies || [], autoRandomize:Boolean(stored.autoRandomize), siteProxyMap:stored.siteProxyMap || {}});
      } else if (message && message.type === "SET_TEMP_TEST") {
        const stored = await getSettings();
        const proxy = message.proxy;
        if (!proxy) throw new Error("Select a proxy first.");
        const current = await chrome.proxy.settings.get({incognito:false});
        await chrome.storage.local.set({testPreviousProxyConfig:current.value || null, testHadProxyConfig:Boolean(current.value)});
        await applyProxy(proxy, stored.sites || [], stored.mode || "include", true);
        sendResponse({ok:true});
      } else if (message && message.type === "RESTORE_TARGETS") {
        const stored = await getSettings();
        const testState = await chrome.storage.local.get(["testPreviousProxyConfig", "testHadProxyConfig"]);
        if (testState.testHadProxyConfig && testState.testPreviousProxyConfig) await chrome.proxy.settings.set({value:testState.testPreviousProxyConfig, scope:"regular"});
        else await chrome.proxy.settings.clear({scope:"regular"});
        await chrome.storage.local.remove(["testPreviousProxyConfig", "testHadProxyConfig"]);
        if (stored.active && stored.selectedProxy) await applyProxy(stored.selectedProxy, stored.sites || [], stored.mode || "include", false, stored.siteProxyMap || {});
        sendResponse({ok:true});
      }
    } catch (error) {
      sendResponse({ok:false, error:error && error.message ? error.message : String(error)});
    }
  })();
  return true;
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAME) return;
  const stored = await getSettings();
  if (stored.active && stored.selectedProxy) {
    try {
      await applyProxy(stored.selectedProxy, stored.sites || [], stored.mode || "include", false, stored.siteProxyMap || {});
    } catch (_) {}
  }
});

// Initialization
try {
  chrome.storage.local.get(["last_known_is_dark"], (res) => {
    if (res && typeof res.last_known_is_dark === "boolean") {
      currentSystemIsDark = res.last_known_is_dark;
      updateAllTabIcons(res.last_known_is_dark);
    } else {
      updateAllTabIcons(true);
    }
    setupOffscreenDocument();
  });
} catch (_) {
  setupOffscreenDocument();
}

chrome.runtime.onInstalled.addListener(() => {
  setupOffscreenDocument();
  updateAllTabIcons();
});

chrome.runtime.onStartup.addListener(async () => {
  setupOffscreenDocument();
  updateAllTabIcons();
  const stored = await getSettings();
  if (!stored.active || !stored.selectedProxy) return;
  const randomProxy = stored.autoRandomize ? await chooseHealthyProxy() : null;
  const proxy = randomProxy || stored.selectedProxy;
  try {
    await applyProxy(proxy, stored.sites || [], stored.mode || "include", false, stored.siteProxyMap || {});
    if (proxy !== stored.selectedProxy) await chrome.storage.local.set({selectedProxy:proxy, connectedAt:Date.now()});
  } catch (_) {}
});
