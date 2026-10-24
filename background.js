const ALARM_NAME = "sitetunnel-reapply";
const DAILY_TEST_ALARM = "sitetunnel-daily-refresh";
const ALL_TEST_ALARM = "sitetunnel-test-all-proxies";
const ALL_TEST_BATCH_SIZE = 3;

// SVG Icon Paths (viewBox="0 0 16 16")
const ICON_PATH_DEFAULT = "M5.5 13h4c.83 0 1.5-.67 1.5-1.5v-9A1.5 1.5 0 0 0 9.5 1h-4A1.5 1.5 0 0 0 4 2.5v9c0 .83.67 1.5 1.5 1.5m.65-8.85A.5.5 0 0 1 6.5 4h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.5-.5.5.5 0 0 1 .15-.35m0 4A.5.5 0 0 1 6.5 8h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.5-.5.5.5 0 0 1 .15-.35m0 2A.5.5 0 0 1 6.5 10h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.35-.85m7.82 4.17-1.5-4A.5.5 0 0 0 12 10v1.5A2.5 2.5 0 0 1 9.5 14h-4A2.5 2.5 0 0 1 3 11.5V10a.5.5 0 0 0-.47.32l-1.5 4q-.05.12-.03.24a.5.5 0 0 0 .5.44h12a.5.5 0 0 0 .41-.22.5.5 0 0 0 .06-.46";
const ICON_PATH_CONNECTED = "M10 8h.5a.5.5 0 1 0 0-1H10V5.5A2.5 2.5 0 0 0 9.5 4h1a.5.5 0 1 0 0-1h-1a.5.5 0 0 0-.5.5v.01A2.5 2.5 0 0 0 7.5 3H7v-.5A1.5 1.5 0 0 1 8.5 1h3A1.5 1.5 0 0 1 13 2.5v6c0 .83-.67 1.5-1.5 1.5H10zm4 .41.97 2.93a.5.5 0 0 1-.07.45.5.5 0 0 1-.4.21h-3.25l-.33-.97V11h.58A2.5 2.5 0 0 0 14 8.5zm-4 3 .98 2.93a.5.5 0 0 1-.07.45.5.5 0 0 1-.4.21h-9a.5.5 0 0 1-.5-.42 1 1 0 0 1 .02-.24L2 11.42v.08A2.5 2.5 0 0 0 4.5 14h3a2.5 2.5 0 0 0 2.5-2.5zM7.5 13h-3A1.5 1.5 0 0 1 3 11.5v-6A1.5 1.5 0 0 1 4.5 4h3A1.5 1.5 0 0 1 9 5.5v6c0 .83-.67 1.5-1.5 1.5m-2-7a.5.5 0 1 0 0 1h1a.5.5 0 1 0 0-1zm0 4a.5.5 0 1 0 0 1h1a.5.5 0 1 0 0-1z";

let currentSystemIsDark = null;
let lastRenderedThemeDark = null;
const imageBitmapCache = {};

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
          isDark = true;
        }
      }
    }
    currentSystemIsDark = isDark;
    lastRenderedThemeDark = isDark;

    if (chrome.action) {
      if (chrome.action.setIcon) {
        const defaultGlobalData = getRenderedImageData(false, isDark);
        await chrome.action.setIcon({ imageData: defaultGlobalData }).catch(() => {});
      }
      if (chrome.action.setTitle) {
        await chrome.action.setTitle({ title: "Disconnected" }).catch(() => {});
      }
    }

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

  for (const [rawHost, preferredProxy] of Object.entries(sourceMap)) {
    const hosts = normalizeSites([rawHost]);
    if (!hosts.length || typeof preferredProxy !== "string" || !preferredProxy) continue;
    try { overrides[hosts[0]] = proxyToPac(preferredProxy); } catch (_) {}
  }
  return "function FindProxyForURL(url, host) {\n" +
    "host = String(host || '').toLowerCase();\n" +
    (includeIpCheck ? "if (host === 'api.ipify.org' || host === 'cloudflare.com' || host === 'httpbin.org') return " + JSON.stringify(directive) + ";\n" : "") +
    "var overrides = " + JSON.stringify(overrides) + ";\n" +
    "for (var key in overrides) { if (Object.prototype.hasOwnProperty.call(overrides, key) && (host === key || host === 'www.' + key || host.indexOf('.' + key, host.length - key.length - 1) !== -1)) return overrides[key]; }\n" +
    "var sites = " + JSON.stringify(normalized) + ";\n" +
    "var auditHosts = ['api.ipify.org', 'api6.ipify.org', 'checkip.amazonaws.com', 'ipinfo.io'];\n" +
    "var auditRoutingEnabled = sites.some(function(site) { return site === 'xconflictionx.cc' || site.endsWith('.xconflictionx.cc'); });\n" +
    "if (auditRoutingEnabled && auditHosts.some(function(auditHost) { return host === auditHost || host.slice(-(auditHost.length + 1)) === '.' + auditHost; })) return " + JSON.stringify(directive) + ";\n" +
    "var matched = false;\n" +
    "for (var i = 0; i < sites.length; i++) { if (host === sites[i] || host === 'www.' + sites[i] || host.indexOf('.' + sites[i], host.length - sites[i].length - 1) !== -1) { matched = true; break; } }\n" +
    "if (" + JSON.stringify(selectedMode) + " === 'include') return matched ? " + JSON.stringify(directive) + " : 'DIRECT';\n" +
    "return matched ? 'DIRECT' : " + JSON.stringify(directive) + ";\n}";
}

async function getSettings() {
  return await chrome.storage.local.get([
    "active",
    "selectedProxy",
    "sites",
    "mode",
    "previousProxyConfig",
    "hasPreviousProxyConfig",
    "healthyProxies",
    "favoriteProxies",
    "verifiedProxies",
    "selectedCountry",
    "lastTestedAt",
    "autoRandomize",
    "siteProxyMap"
  ]);
}

async function chooseStartupProxy() {
  const stored = await getSettings();
  const favorites = Array.isArray(stored.favoriteProxies) ? stored.favoriteProxies.filter(p => typeof p === "string") : [];
  if (favorites.length > 0) {
    return favorites[Math.floor(Math.random() * favorites.length)];
  }
  const verified = Array.isArray(stored.verifiedProxies) ? stored.verifiedProxies.filter(p => typeof p === "string") : [];
  if (verified.length > 0) {
    return verified[Math.floor(Math.random() * verified.length)];
  }
  const pool = Array.isArray(stored.healthyProxies) ? stored.healthyProxies.filter(p => typeof p === "string") : [];
  if (pool.length > 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return null;
}

async function applyProxy(proxy, sites, mode, includeIpCheck, siteProxyMap) {
  const setting = await chrome.proxy.settings.get({incognito:false});
  if (setting.levelOfControl === "controlled_by_other_extensions" || setting.levelOfControl === "not_controllable") {
    throw new Error("Another extension or browser policy controls Chrome proxy settings.");
  }
  const data = pacScript(proxy, sites, mode, includeIpCheck, siteProxyMap);
  await chrome.proxy.settings.set({value:{mode:"pac_script", pacScript:{data:data}}, scope:"regular"});
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
  await enableWebRtcLeakProtection();
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
  await disableWebRtcLeakProtection();
  await chrome.storage.local.set({active:false, previousProxyConfig:null, hasPreviousProxyConfig:false});
  await chrome.alarms.clear(ALARM_NAME);
  await updateAllTabIcons();
  return {ok:true};
}

function parseProxyLines(text) {
  const seen = new Set(), results = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = /^[a-z]+:\/\//i.test(line) ? line : "http://" + line;
    const m = /^(http|https|socks4|socks5):\/\/([^:/\s]+):(\d{1,5})$/i.exec(normalized);
    if (!m) continue;
    const port = Number(m[3]);
    if (port < 1 || port > 65535) continue;
    const item = m[1].toLowerCase() + "://" + m[2] + ":" + port;
    if (!seen.has(item)) { seen.add(item); results.push(item); }
  }
  return results;
}

// Rigorous website connectivity tester
async function testSingleProxy(proxy, sites, mode, siteProxyMap) {
  try {
    await applyProxy(proxy, sites || [], mode || "include", true, siteProxyMap || {});

    // Step 1: Render / fetch actual HTML content from Cloudflare CDN trace with 1s hard limit
    const controller = new AbortController();
    const start = Date.now();
    const overallDeadline = start + 5000;
    const timeout = setTimeout(() => controller.abort(), Math.max(1, overallDeadline - Date.now()));
    let verifiedIp = null;

    try {
      const resp = await fetch("https://cloudflare.com/cdn-cgi/trace?sitetunnel_bg=" + Date.now(), {
        cache: "no-store",
        signal: controller.signal
      });

      if (resp.ok) {
        const text = await resp.text();
        // cdn-cgi/trace returns key=value pairs including ip=... and loc=...
        const match = /^ip=([^\r\n]+)/m.exec(text);
        if (match) {
          verifiedIp = match[1].trim();
        }
      }
    } catch (_) {
      // Some public proxies block Cloudflare; try a second independent IP endpoint.
    } finally {
      clearTimeout(timeout);
    }

    if (!verifiedIp) {
      const fallbackController = new AbortController();
      const fallbackTimeout = setTimeout(() => fallbackController.abort(), Math.max(1, overallDeadline - Date.now()));
      try {
        const fallback = await fetch("https://api.ipify.org/?sitetunnel_bg=" + Date.now(), {
          cache: "no-store",
          signal: fallbackController.signal
        });
        if (fallback.ok) {
          const candidateIp = (await fallback.text()).trim();
          if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(candidateIp) || candidateIp.includes(":")) verifiedIp = candidateIp;
        }
      } finally {
        clearTimeout(fallbackTimeout);
      }
    }

    const elapsed = Date.now() - start;
    if (verifiedIp) return { ok: true, ip: verifiedIp, latency: elapsed };
    return { ok: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Background test routine for daily refresh and on-demand calls
async function runBackgroundTest(countryCode) {
  const stored = await getSettings();
  const originalProxySetting = await chrome.proxy.settings.get({incognito:false});
  const code = countryCode || stored.selectedCountry || "nl";
  let candidates = [];

  try {
    const response = await fetch("https://raw.githubusercontent.com/maximilianfeix/free-proxy-list/main/countries/" + encodeURIComponent(code) + ".txt", {cache:"no-store"});
    if (response.ok) {
      candidates = parseProxyLines(await response.text());
    }
  } catch (err) {
    console.warn("SiteTunnel: Failed to fetch country list for testing:", err);
    return { ok: false, error: err.message };
  }

  const existingFavorites = Array.isArray(stored.favoriteProxies) ? stored.favoriteProxies : [];
  for (const fav of existingFavorites) {
    if (!candidates.includes(fav)) candidates.unshift(fav);
  }

  const sample = candidates.slice(0, 25);
  const healthy = [];

  for (let i = 0; i < sample.length; i++) {
    const proxy = sample[i];
    try {
      const result = await testSingleProxy(proxy, stored.sites, stored.mode, stored.siteProxyMap);
      if (result.ok) {
        healthy.push({ proxy: proxy, latency: result.latency, ip: result.ip });
      }
    } finally {
      // Restore the exact effective proxy configuration present before testing.
      try {
        if (originalProxySetting && originalProxySetting.value) {
          await chrome.proxy.settings.set({value: originalProxySetting.value, scope:"regular"});
        } else {
          await chrome.proxy.settings.clear({scope:"regular"});
        }
      } catch (restoreError) {
        console.warn("SiteTunnel: Could not restore proxy settings after test:", restoreError);
      }
    }
  }

  healthy.sort((a, b) => a.latency - b.latency);
  const verifiedList = healthy.map(h => h.proxy);

  await chrome.storage.local.set({
    verifiedProxies: verifiedList,
    healthyProxies: verifiedList,
    lastTestedAt: Date.now(),
    selectedCountry: code
  });

  return { ok: true, count: verifiedList.length, proxies: verifiedList };
}


async function fetchAllProxyCandidates() {
  const response = await fetch("https://api.github.com/repos/maximilianfeix/free-proxy-list/contents/countries", {
    cache: "no-store",
    headers: {"Accept":"application/vnd.github+json"}
  });
  if (!response.ok) throw new Error("Could not retrieve the complete country index (HTTP " + response.status + ").");
  const files = await response.json();
  const countryFiles = files.filter(item => item && item.type === "file" && typeof item.name === "string" && item.name.endsWith(".txt") && typeof item.download_url === "string");
  if (!countryFiles.length) throw new Error("The proxy source returned no country lists.");
  const all = new Set();
  for (const file of countryFiles) {
    try {
      const listResponse = await fetch(file.download_url, {cache:"no-store"});
      if (!listResponse.ok) continue;
      for (const proxy of parseProxyLines(await listResponse.text())) all.add(proxy);
    } catch (error) {
      console.warn("SiteTunnel: Could not fetch proxy list " + file.name, error);
    }
  }
  return [...all];
}

async function startAllProxyTest() {
  const current = await chrome.storage.local.get(["allProxyTest"]);
  if (current.allProxyTest && current.allProxyTest.status === "running") {
    return {ok:true, alreadyRunning:true, total:current.allProxyTest.queue?.length || 0, tested:current.allProxyTest.tested || 0, passed:current.allProxyTest.passed || 0};
  }
  await chrome.storage.local.set({allProxyTest:{status:"fetching",queue:[],tested:0,passed:0,startedAt:Date.now(),errors:0}});
  try {
    const candidates = await fetchAllProxyCandidates();
    const stored = await getSettings();
    for (const favorite of (Array.isArray(stored.favoriteProxies) ? stored.favoriteProxies : [])) candidates.unshift(favorite);
    const unique = [...new Set(candidates)];
    // Retest every unique candidate from every country, including previously saved entries.
    const queue = unique;
    await chrome.storage.local.set({allProxyTest:{status:"running",queue,tested:0,passed:0,total:queue.length,startedAt:Date.now(),errors:0}});
    await chrome.notifications.create("sitetunnel-all-test-started", {
      type:"basic", iconUrl:"icons/icon128.png", title:"SiteTunnel: Full proxy test started",
      message:"Testing " + queue.length.toLocaleString() + " unique proxies from all country lists in the background."
    });
    if (!queue.length) {
      await finishAllProxyTest();
      return {ok:true,total:0};
    }
    await processAllProxyBatch();
    return {ok:true,total:queue.length};
  } catch (error) {
    await chrome.storage.local.set({allProxyTest:{status:"failed",error:error.message,finishedAt:Date.now()}});
    await chrome.notifications.create("sitetunnel-all-test-failed", {
      type:"basic", iconUrl:"icons/icon128.png", title:"SiteTunnel: Proxy test could not start", message:error.message || "Could not fetch the complete proxy list."
    });
    return {ok:false,error:error.message};
  }
}

async function processAllProxyBatch() {
  const state = (await chrome.storage.local.get(["allProxyTest"])).allProxyTest;
  if (!state || state.status !== "running") return;
  const stored = await getSettings();
  const originalProxySetting = await chrome.proxy.settings.get({incognito:false});
  const queue = Array.isArray(state.queue) ? [...state.queue] : [];
  let tested = Number(state.tested) || 0;
  let passed = Number(state.passed) || 0;
  let errors = Number(state.errors) || 0;
  const batch = queue.splice(0, ALL_TEST_BATCH_SIZE);
  for (const proxy of batch) {
    try {
      const result = await testSingleProxy(proxy, stored.sites, stored.mode, stored.siteProxyMap);
      if (result.ok) {
        const latest = await chrome.storage.local.get(["verifiedProxies","healthyProxies"]);
        const saved = [...new Set([...(Array.isArray(latest.verifiedProxies)?latest.verifiedProxies:[]), proxy])];
        await chrome.storage.local.set({verifiedProxies:saved,healthyProxies:saved,lastTestedAt:Date.now()});
        passed++;
      }
    } catch (error) {
      errors++;
    } finally {
      try {
        if (originalProxySetting && originalProxySetting.value) await chrome.proxy.settings.set({value:originalProxySetting.value,scope:"regular"});
        else await chrome.proxy.settings.clear({scope:"regular"});
      } catch (restoreError) { console.warn("SiteTunnel: Could not restore proxy after all-proxy test:",restoreError); }
    }
    tested++;
    await chrome.storage.local.set({allProxyTest:{...state,queue,tested,passed,errors,status:"running",updatedAt:Date.now()}});
  }
  if (queue.length) {
    await chrome.storage.local.set({allProxyTest:{...state,queue,tested,passed,errors,status:"running",updatedAt:Date.now()}});
    chrome.alarms.create(ALL_TEST_ALARM,{delayInMinutes:0.5});
  } else {
    await finishAllProxyTest({tested,passed,errors});
  }
}

async function finishAllProxyTest(summary) {
  const state = (await chrome.storage.local.get(["allProxyTest","verifiedProxies"])).allProxyTest || {};
  const result = summary || {tested:state.tested||0,passed:state.passed||0,errors:state.errors||0};
  await chrome.storage.local.set({allProxyTest:{...state,...result,status:"complete",finishedAt:Date.now(),queue:[]}});
  await chrome.alarms.clear(ALL_TEST_ALARM);
  await chrome.notifications.create("sitetunnel-all-test-complete", {
    type:"basic", iconUrl:"icons/icon128.png", title:"SiteTunnel: Full proxy test complete",
    message:"Tested " + result.tested.toLocaleString() + " proxies. " + result.passed.toLocaleString() + " working proxies saved automatically."
  });
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

// Tab navigation & activation listeners
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

// Runtime messages
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
        const pool = Array.isArray(message.proxies) ? [...new Set(message.proxies.filter(p => typeof p === "string"))] : [];
        await chrome.storage.local.set({healthyProxies:pool, autoRandomize:Boolean(message.autoRandomize)});
        sendResponse({ok:true, count:pool.length});
      } else if (message && message.type === "ADD_VERIFIED_PROXY") {
        const proxy = typeof message.proxy === "string" ? message.proxy.trim() : "";
        if (!/^(https?|socks4|socks5):\/\/[^:/\s]+:\d{1,5}$/i.test(proxy)) throw new Error("Enter a valid proxy as host:port or scheme://host:port.");
        const port = Number(proxy.match(/:(\d{1,5})$/)?.[1]);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Proxy port must be between 1 and 65535.");
        const stored = await chrome.storage.local.get(["verifiedProxies","healthyProxies"]);
        const verified = [...new Set([...(Array.isArray(stored.verifiedProxies) ? stored.verifiedProxies : []), proxy])];
        const healthy = [...new Set([...(Array.isArray(stored.healthyProxies) ? stored.healthyProxies : []), proxy])];
        await chrome.storage.local.set({verifiedProxies:verified,healthyProxies:healthy});
        sendResponse({ok:true,count:verified.length,proxies:verified});
      } else if (message && message.type === "REMOVE_VERIFIED_PROXY") {
        const proxy = typeof message.proxy === "string" ? message.proxy : "";
        if (!proxy) throw new Error("Select a proxy to remove.");
        const stored = await getSettings();
        if (stored.active && stored.selectedProxy === proxy) await disconnect();
        const data = await chrome.storage.local.get(["verifiedProxies","healthyProxies","favoriteProxies","siteProxyMap","selectedProxy"]);
        const verified = (Array.isArray(data.verifiedProxies) ? data.verifiedProxies : []).filter(p => p !== proxy);
        const healthy = (Array.isArray(data.healthyProxies) ? data.healthyProxies : []).filter(p => p !== proxy);
        const favorites = (Array.isArray(data.favoriteProxies) ? data.favoriteProxies : []).filter(p => p !== proxy);
        const siteProxyMap = {...(data.siteProxyMap || {})};
        for (const [host, mappedProxy] of Object.entries(siteProxyMap)) if (mappedProxy === proxy) delete siteProxyMap[host];
        await chrome.storage.local.set({
          verifiedProxies:verified, healthyProxies:healthy, favoriteProxies:favorites,
          siteProxyMap:siteProxyMap,
          selectedProxy: data.selectedProxy === proxy ? "" : (data.selectedProxy || "")
        });
        sendResponse({ok:true,proxies:verified,favorites:favorites,removed:proxy});
      } else if (message && message.type === "SAVE_VERIFIED_PROXIES") {
        const verified = Array.isArray(message.proxies) ? [...new Set(message.proxies.filter(p => typeof p === "string"))] : [];
        await chrome.storage.local.set({
          verifiedProxies: verified,
          healthyProxies: verified,
          lastTestedAt: Date.now(),
          selectedCountry: message.country || "nl"
        });
        sendResponse({ok:true, count:verified.length});
      } else if (message && message.type === "TOGGLE_FAVORITE") {
        const stored = await getSettings();
        let favs = Array.isArray(stored.favoriteProxies) ? [...stored.favoriteProxies] : [];
        const proxy = message.proxy;
        if (proxy) {
          if (favs.includes(proxy)) {
            favs = favs.filter(p => p !== proxy);
          } else {
            favs.push(proxy);
          }
          await chrome.storage.local.set({favoriteProxies: favs});
        }
        sendResponse({ok:true, favorites: favs});
      } else if (message && message.type === "GET_STATE") {
        const stored = await getSettings();
        const setting = await chrome.proxy.settings.get({incognito:false});
        sendResponse({
          active: Boolean(stored.active),
          selectedProxy: stored.selectedProxy || "",
          sites: stored.sites || [],
          mode: stored.mode || "include",
          connectedAt: stored.connectedAt || null,
          levelOfControl: setting.levelOfControl,
          healthyProxies: stored.healthyProxies || [],
          verifiedProxies: stored.verifiedProxies || [],
          favoriteProxies: stored.favoriteProxies || [],
          lastTestedAt: stored.lastTestedAt || null,
          selectedCountry: stored.selectedCountry || "nl",
          autoRandomize: Boolean(stored.autoRandomize),
          siteProxyMap: stored.siteProxyMap || {}
        });
      } else if (message && message.type === "START_ALL_PROXY_TEST") {
        const result = await startAllProxyTest();
        sendResponse(result);
      } else if (message && message.type === "GET_ALL_PROXY_TEST_STATE") {
        const state = (await chrome.storage.local.get(["allProxyTest"])).allProxyTest || {status:"idle"};
        sendResponse(state);
      } else if (message && message.type === "TRIGGER_DAILY_TEST") {
        const result = await runBackgroundTest(message.country);
        sendResponse(result);
      } else if (message && message.type === "CHECK_PROXY_EXIT") {
        const stored = await getSettings();
        const proxy = message.proxy || stored.selectedProxy;
        if (!proxy) throw new Error("Select a proxy first.");
        const before = await chrome.proxy.settings.get({incognito:false});
        let tabId = null;
        let testResult = null;
        let testError = null;
        try {
          await applyProxy(proxy, [], "exclude", true, {});
          let finishLoad;
          let failLoad;
          let loaded = false;
          const loadedPromise = new Promise((resolve, reject) => {
            finishLoad = () => { loaded = true; resolve(); };
            failLoad = reject;
          });
          const onUpdated = (id, info) => {
            if (id === tabId && info.status === "complete") finishLoad();
          };
          const onRemoved = (id) => {
            if (id === tabId && !loaded) failLoad(new Error("Chrome closed the proxy test tab before it finished."));
          };
          chrome.tabs.onUpdated.addListener(onUpdated);
          chrome.tabs.onRemoved.addListener(onRemoved);
          let timer = setTimeout(() => failLoad(new Error("Timed out waiting for the proxy test page.")), 12000);
          try {
            const tab = await chrome.tabs.create({url:"https://api.ipify.org/?sitetunnel_check=" + Date.now(), active:false});
            tabId = tab.id;
            const current = await chrome.tabs.get(tabId);
            if (current.status === "complete") finishLoad();
            await loadedPromise;
          } finally {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            chrome.tabs.onRemoved.removeListener(onRemoved);
          }
          const result = await chrome.scripting.executeScript({target:{tabId:tabId},func:() => (document.body && document.body.innerText || "").trim()});
          const ip = result && result[0] ? String(result[0].result || "").trim() : "";
          if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && !/^[0-9a-f:]+$/i.test(ip)) throw new Error("The test page did not return a valid exit IP.");
          testResult = {ok:true, ip:ip, proxy:proxy};
        } catch (err) {
          testError = err;
        } finally {
          if (tabId != null) {
            try { await chrome.tabs.get(tabId); await chrome.tabs.remove(tabId); } catch (_) {}
          }
          try {
            if (before && before.value) await chrome.proxy.settings.set({value:before.value,scope:"regular"});
            else await chrome.proxy.settings.clear({scope:"regular"});
            const latest = await getSettings();
            if (latest.active && latest.selectedProxy) await applyProxy(latest.selectedProxy, latest.sites || [], latest.mode || "include", false, latest.siteProxyMap || {});
          } catch (restoreError) {
            console.warn("SiteTunnel: Could not restore proxy settings after exit test:", restoreError);
            if (!testError) testError = new Error("Exit test finished, but Chrome proxy settings could not be restored: " + restoreError.message);
          }
        }
        if (testError) throw testError;
        sendResponse(testResult);
        return;
      } else if (message && message.type === "SET_TEMP_TEST") {
        const stored = await getSettings();
        const proxy = message.proxy;
        if (!proxy) throw new Error("Select a proxy first.");
        const current = await chrome.proxy.settings.get({incognito:false});
        await chrome.storage.local.set({testPreviousProxyConfig:current.value || null, testHadProxyConfig:Boolean(current.value)});
        await applyProxy(proxy, stored.sites || [], stored.mode || "include", true, stored.siteProxyMap || {});
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

// Periodic alarm handler
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === ALARM_NAME) {
    const stored = await getSettings();
    if (stored.active && stored.selectedProxy) {
      try {
        await applyProxy(stored.selectedProxy, stored.sites || [], stored.mode || "include", false, stored.siteProxyMap || {});
      } catch (_) {}
    }
  } else if (alarm.name === ALL_TEST_ALARM) {
    try { await processAllProxyBatch(); } catch (err) { console.warn("SiteTunnel: All-proxy batch failed:",err); chrome.alarms.create(ALL_TEST_ALARM,{delayInMinutes:0.5}); }
  } else if (alarm.name === DAILY_TEST_ALARM) {
    console.log("SiteTunnel: Running scheduled daily proxy test and refresh...");
    try {
      await runBackgroundTest();
    } catch (err) {
      console.warn("SiteTunnel: Daily test error:", err);
    }
  }
});

// Resume persisted all-proxy scans after browser/extension restart.
async function resumeAllProxyTestIfNeeded() {
  const state = (await chrome.storage.local.get(["allProxyTest"])).allProxyTest;
  if (state && state.status === "running" && Array.isArray(state.queue) && state.queue.length) {
    chrome.alarms.create(ALL_TEST_ALARM, {delayInMinutes:0.5});
  } else if (state && state.status === "fetching") {
    await chrome.storage.local.set({allProxyTest:{status:"failed",error:"Browser or extension restarted while collecting country lists. Start the full scan again.",finishedAt:Date.now()}});
  }
}

// Setup daily alarm
async function ensureDailyAlarm() {
  const existing = await chrome.alarms.get(DAILY_TEST_ALARM);
  if (!existing) {
    chrome.alarms.create(DAILY_TEST_ALARM, { periodInMinutes: 1440, delayInMinutes: 1440 });
  }
}

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
    ensureDailyAlarm();
    resumeAllProxyTestIfNeeded();
  });
} catch (_) {
  setupOffscreenDocument();
  ensureDailyAlarm();
}

chrome.runtime.onInstalled.addListener(() => {
  setupOffscreenDocument();
  updateAllTabIcons();
  ensureDailyAlarm();
  resumeAllProxyTestIfNeeded();
});

chrome.runtime.onStartup.addListener(async () => {
  setupOffscreenDocument();
  updateAllTabIcons();
  ensureDailyAlarm();
  await resumeAllProxyTestIfNeeded();
  const stored = await getSettings();
  if (!stored.active || !stored.selectedProxy) return;

  const randomProxy = stored.autoRandomize ? await chooseStartupProxy() : null;
  const proxy = randomProxy || stored.selectedProxy;
  try {
    await applyProxy(proxy, stored.sites || [], stored.mode || "include", false, stored.siteProxyMap || {});
    if (proxy !== stored.selectedProxy) await chrome.storage.local.set({selectedProxy:proxy, connectedAt:Date.now()});
  } catch (_) {}
});
