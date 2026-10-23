
const ALARM_NAME = "sitetunnel-reapply";

function normalizeSites(sites) {
  const input = Array.isArray(sites) ? sites : [];
  const out = [];
  for (const raw of input) {
    let host = String(raw || "").trim().toLowerCase();
    host = host.replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^\*?\./, "").replace(/\.$/, "");
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

function pacScript(proxy, sites, mode, includeIpCheck) {
  const directive = proxyToPac(proxy);
  const normalized = normalizeSites(sites);
  const selectedMode = mode === "exclude" ? "exclude" : "include";
  return "function FindProxyForURL(url, host) {\n" +
    "host = String(host || '').toLowerCase();\n" +
    (includeIpCheck ? "if (host === 'api.ipify.org') return " + JSON.stringify(directive) + ";\n" : "") +
    "var sites = " + JSON.stringify(normalized) + ";\n" +
    "var matched = false;\n" +
    "for (var i = 0; i < sites.length; i++) { if (host === sites[i] || host.endsWith('.' + sites[i])) { matched = true; break; } }\n" +
    "if (" + JSON.stringify(selectedMode) + " === 'include') return matched ? " + JSON.stringify(directive) + " : 'DIRECT';\n" +
    "return matched ? 'DIRECT' : " + JSON.stringify(directive) + ";\n}";
}

async function getSettings() {
  return await chrome.storage.local.get(["active", "selectedProxy", "sites", "mode", "previousProxyConfig", "hasPreviousProxyConfig"]);
}
async function applyProxy(proxy, sites, mode, includeIpCheck) {
  const setting = await chrome.proxy.settings.get({incognito:false});
  if (setting.levelOfControl === "controlled_by_other_extensions" || setting.levelOfControl === "not_controllable") {
    throw new Error("Another extension or browser policy controls Chrome proxy settings.");
  }
  const data = pacScript(proxy, sites, mode, includeIpCheck);
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
  await applyProxy(proxy, cleanSites, cleanMode, false);
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
      else if (message && message.type === "DISCONNECT") sendResponse(await disconnect());
      else if (message && message.type === "SAVE_RULES") {
        const sites = normalizeSites(message.sites);
        const mode = message.mode === "exclude" ? "exclude" : "include";
        const stored = await getSettings();
        await chrome.storage.local.set({sites:sites, mode:mode});
        if (stored.active && stored.selectedProxy) await applyProxy(stored.selectedProxy, sites, mode, false);
        sendResponse({ok:true, sites:sites, mode:mode, active:Boolean(stored.active)});
      } else if (message && message.type === "GET_STATE") {
        const stored = await getSettings();
        const setting = await chrome.proxy.settings.get({incognito:false});
        sendResponse({active:Boolean(stored.active), selectedProxy:stored.selectedProxy || "", sites:stored.sites || [], mode:stored.mode || "include", connectedAt:stored.connectedAt || null, levelOfControl:setting.levelOfControl});
      } else if (message && message.type === "SET_TEMP_TEST") {
        const stored = await getSettings();
        const proxy = stored.active ? stored.selectedProxy : message.proxy;
        if (!proxy) throw new Error("Select a proxy first.");
        await applyProxy(proxy, stored.sites || [], stored.mode || "include", true);
        sendResponse({ok:true});
      } else if (message && message.type === "RESTORE_TARGETS") {
        const stored = await getSettings();
        if (stored.active && stored.selectedProxy) await applyProxy(stored.selectedProxy, stored.sites || [], stored.mode || "include", false);
        else await chrome.proxy.settings.clear({scope:"regular"});
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
    try { await applyProxy(stored.selectedProxy, stored.sites || [], stored.mode || "include", false); } catch (_) {}
  }
});
chrome.runtime.onStartup.addListener(async () => {
  const stored = await getSettings();
  if (stored.active && stored.selectedProxy) {
    try { await applyProxy(stored.selectedProxy, stored.sites || [], stored.mode || "include", false); } catch (_) {}
  }
});
