const TARGETS = ["pornhub.com", "xvideos.com"];
const ALARM_NAME = "sitetunnel-reapply";

function proxyToPac(proxy) {
  const match = /^(http|https|socks4|socks5):\/\/([^:/\s]+):(\d{1,5})$/i.exec(proxy);
  if (!match) throw new Error("Unsupported proxy entry.");
  const scheme = match[1].toLowerCase();
  const host = match[2];
  const port = Number(match[3]);
  if (port < 1 || port > 65535) throw new Error("Invalid proxy port.");
  const pacScheme = ({http: "PROXY", https: "HTTPS", socks4: "SOCKS", socks5: "SOCKS5"})[scheme];
  return `${pacScheme} ${host}:${port}`;
}

function pacScript(proxy, includeIpCheck = false) {
  const directive = proxyToPac(proxy);
  return `
    const TARGETS = ${JSON.stringify(TARGETS)};
    function FindProxyForURL(url, host) {
      host = String(host || "").toLowerCase();
      ${includeIpCheck ? 'if (host === "api.ipify.org") return ' + JSON.stringify(directive) + ';' : ''}
      for (let i = 0; i < TARGETS.length; i++) {
        if (host === TARGETS[i] || host.endsWith("." + TARGETS[i])) return ${JSON.stringify(directive)};
      }
      return "DIRECT";
    }
  `;
}

async function connect(proxy) {
  const data = pacScript(proxy);
  const stored = await chrome.storage.local.get(["previousProxyConfig", "hasPreviousProxyConfig"]);
  if (!stored.hasPreviousProxyConfig) {
    const before = await chrome.proxy.settings.get({ incognito: false });
    if (before.levelOfControl === "controlled_by_other_extensions" || before.levelOfControl === "not_controllable") {
      throw new Error("Another extension or browser policy controls proxy settings.");
    }
    await chrome.storage.local.set({ previousProxyConfig: before.value || null, hasPreviousProxyConfig: true });
  }
  await chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data } }, scope: "regular" });
  await chrome.storage.local.set({ active: true, selectedProxy: proxy, connectedAt: Date.now() });
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  return { ok: true };
}

async function disconnect() {
  const stored = await chrome.storage.local.get(["previousProxyConfig", "hasPreviousProxyConfig"]);
  if (stored.hasPreviousProxyConfig && stored.previousProxyConfig) {
    await chrome.proxy.settings.set({ value: stored.previousProxyConfig, scope: "regular" });
  } else {
    await chrome.proxy.settings.clear({ scope: "regular" });
  }
  await chrome.storage.local.set({ active: false, previousProxyConfig: null, hasPreviousProxyConfig: false });
  chrome.alarms.clear(ALARM_NAME);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "CONNECT") sendResponse(await connect(message.proxy));
      else if (message?.type === "DISCONNECT") sendResponse(await disconnect());
      else if (message?.type === "GET_STATE") {
        const stored = await chrome.storage.local.get(["active", "selectedProxy", "connectedAt"]);
        const setting = await chrome.proxy.settings.get({ incognito: false });
        sendResponse({ ...stored, levelOfControl: setting.levelOfControl, config: setting.value });
      } else if (message?.type === "SET_TEMP_TEST") {
        await chrome.proxy.settings.set({
          value: { mode: "pac_script", pacScript: { data: pacScript(message.proxy, true) } },
          scope: "regular"
        });
        sendResponse({ ok: true });
      } else if (message?.type === "RESTORE_TARGETS") {
        const stored = await chrome.storage.local.get(["active", "selectedProxy"]);
        if (stored.active && stored.selectedProxy) await connect(stored.selectedProxy);
        sendResponse({ ok: true });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAME) return;
  const stored = await chrome.storage.local.get(["active", "selectedProxy"]);
  if (stored.active && stored.selectedProxy) {
    try {
      const setting = await chrome.proxy.settings.get({ incognito: false });
      if (setting.levelOfControl === "controllable_by_this_extension" || setting.levelOfControl === "controlled_by_this_extension") {
        await chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacScript(stored.selectedProxy) } }, scope: "regular" });
      }
    } catch {}
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get(["active", "selectedProxy"]);
  if (stored.active && stored.selectedProxy) {
    try { await connect(stored.selectedProxy); } catch {}
  }
});