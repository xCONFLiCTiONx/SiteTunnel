
const ALARM_NAME = "sitetunnel-reapply";

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
async function nativeTorCommand(command) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    let port;
    try { port = chrome.runtime.connectNative("com.xconflictionx.sitetunnel"); }
    catch (error) { reject(new Error("SiteTunnel Windows helper is not installed. Run the SiteTunnel Windows installer.")); return; }
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { port.disconnect(); } catch (_) {}
      reject(new Error("The SiteTunnel Windows helper did not respond in time."));
    }, 35000);
    port.onMessage.addListener(message => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { port.disconnect(); } catch (_) {}
      if (message && message.ok) resolve(message);
      else reject(new Error(message && message.error ? message.error : "The Tor helper failed."));
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(chrome.runtime.lastError?.message || "Could not connect to the SiteTunnel Windows helper. Re-run the installer."));
    });
    port.postMessage({command});
  });
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
  return {ok:true};
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message && message.type === "CONNECT") sendResponse(await connect(message.proxy, message.sites, message.mode));
      else if (message && message.type === "DISCONNECT") {
        const stored = await getSettings();
        const result = await disconnect();
        if (stored.selectedProxy === "socks5://127.0.0.1:9150") {
          try { await nativeTorCommand("STOP_TOR"); } catch (_) {}
        }
        sendResponse(result);
      } else if (message && message.type === "CONNECT_TOR") {
        await nativeTorCommand("START_TOR");
        const stored = await getSettings();
        const sites = normalizeSites(message.sites ?? stored.sites ?? []);
        // With no domain list, make the one-click Tor action useful by routing all Chrome sites through Tor.
        const mode = sites.length === 0 ? "exclude" :
          (message.mode === "exclude" ? "exclude" : (stored.mode === "exclude" ? "exclude" : "include"));
        sendResponse(await connect("socks5://127.0.0.1:9150", sites, mode));
      } else if (message && message.type === "TOR_STATUS") {
        sendResponse(await nativeTorCommand("TOR_STATUS"));
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
      if (stored.selectedProxy === "socks5://127.0.0.1:9150") await nativeTorCommand("START_TOR");
      await applyProxy(stored.selectedProxy, stored.sites || [], stored.mode || "include", false, stored.siteProxyMap || {});
    } catch (_) {}
  }
});
chrome.runtime.onStartup.addListener(async () => {
  const stored = await getSettings();
  if (!stored.active || !stored.selectedProxy) return;
  const randomProxy = stored.autoRandomize ? await chooseHealthyProxy() : null;
  const proxy = randomProxy || stored.selectedProxy;
  try {
    if (proxy === "socks5://127.0.0.1:9150") await nativeTorCommand("START_TOR");
    await applyProxy(proxy, stored.sites || [], stored.mode || "include", false, stored.siteProxyMap || {});
    if (proxy !== stored.selectedProxy) await chrome.storage.local.set({selectedProxy:proxy, connectedAt:Date.now()});
  } catch (_) {}
});
