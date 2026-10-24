const COUNTRY_NAMES = {
  nl: "Netherlands", us: "United States", gb: "United Kingdom", de: "Germany",
  fr: "France", ca: "Canada", ch: "Switzerland", se: "Sweden",
  no: "Norway", fi: "Finland", dk: "Denmark", ie: "Ireland",
  pl: "Poland", cz: "Czechia", es: "Spain", it: "Italy",
  jp: "Japan", sg: "Singapore", au: "Australia"
};

const $ = id => document.getElementById(id);
let verifiedProxies = [];
let favoriteProxies = [];
let savedSiteProxyMap = {};
const send = (type, extra = {}) => chrome.runtime.sendMessage(Object.assign({type: type}, extra));

// SVG Icons (viewBox="0 0 16 16")
const ICON_PATH_DEFAULT = "M5.5 13h4c.83 0 1.5-.67 1.5-1.5v-9A1.5 1.5 0 0 0 9.5 1h-4A1.5 1.5 0 0 0 4 2.5v9c0 .83.67 1.5 1.5 1.5m.65-8.85A.5.5 0 0 1 6.5 4h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.5-.5.5.5 0 0 1 .15-.35m0 4A.5.5 0 0 1 6.5 8h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.5-.5.5.5 0 0 1 .15-.35m0 2A.5.5 0 0 1 6.5 10h2a.5.5 0 1 1 0 1h-2a.5.5 0 0 1-.35-.85m7.82 4.17-1.5-4A.5.5 0 0 0 12 10v1.5A2.5 2.5 0 0 1 9.5 14h-4A2.5 2.5 0 0 1 3 11.5V10a.5.5 0 0 0-.47.32l-1.5 4q-.05.12-.03.24a.5.5 0 0 0 .5.44h12a.5.5 0 0 0 .41-.22.5.5 0 0 0 .06-.46";
const ICON_PATH_CONNECTED = "M10 8h.5a.5.5 0 1 0 0-1H10V5.5A2.5 2.5 0 0 0 9.5 4h1a.5.5 0 1 0 0-1h-1a.5.5 0 0 0-.5.5v.01A2.5 2.5 0 0 0 7.5 3H7v-.5A1.5 1.5 0 0 1 8.5 1h3A1.5 1.5 0 0 1 13 2.5v6c0 .83-.67 1.5-1.5 1.5H10zm4 .41.97 2.93a.5.5 0 0 1-.07.45.5.5 0 0 1-.4.21h-3.25l-.33-.97V11h.58A2.5 2.5 0 0 0 14 8.5zm-4 3 .98 2.93a.5.5 0 0 1-.07.45.5.5 0 0 1-.4.21h-9a.5.5 0 0 1-.5-.42 1 1 0 0 1 .02-.24L2 11.42v.08A2.5 2.5 0 0 0 4.5 14h3a2.5 2.5 0 0 0 2.5-2.5zM7.5 13h-3A1.5 1.5 0 0 1 3 11.5v-6A1.5 1.5 0 0 1 4.5 4h3A1.5 1.5 0 0 1 9 5.5v6c0 .83-.67 1.5-1.5 1.5m-2-7a.5.5 0 1 0 0 1h1a.5.5 0 1 0 0-1zm0 4a.5.5 0 1 0 0 1h1a.5.5 0 1 0 0-1z";

function getSvgMarkup(isConnected, color) {
  const path = isConnected ? ICON_PATH_CONNECTED : ICON_PATH_DEFAULT;
  const fillColor = color || "currentColor";
  return '<svg width="100%" height="100%" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="' + fillColor + '" d="' + path + '"/></svg>';
}

function syncThemeIcon() {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  chrome.runtime.sendMessage({ type: 'UPDATE_THEME_ICON', isDarkMode: isDark }).catch(() => {});
  updatePageFavicon(isDark);
  updateBrandIcon();
}

function updatePageFavicon(isDark) {
  const isDarkMode = typeof isDark === 'boolean' ? isDark : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const iconColor = isDarkMode ? '%23FFFFFF' : '%23000000';
  const svgString = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="' + iconColor + '" d="' + ICON_PATH_DEFAULT + '"/></svg>';
  const dataUri = 'data:image/svg+xml;utf8,' + svgString;
  let link = document.querySelector("link[rel*='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = dataUri;
}

let lastTabIsConnected = false;
function updateBrandIcon(isConnected) {
  if (typeof isConnected === 'boolean') {
    lastTabIsConnected = isConnected;
  }
  const brandEl = $("brandIcon");
  if (brandEl) {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const color = isDark ? '#FFFFFF' : '#000000';
    brandEl.innerHTML = getSvgMarkup(lastTabIsConnected, color);
  }
}

try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeIcon);
  syncThemeIcon();
} catch (_) {}

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

function parseSites() {
  const parts = $("siteList").value.split(/[\n,;]+/);
  const sites = [], seen = new Set();
  for (let raw of parts) {
    let host = raw.trim().toLowerCase();
    if (!host || host.startsWith("#")) continue;
    host = host.replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^\*?\./, "").replace(/\.$/, "");
    if (!host || host.length > 253 || !host.includes(".")) continue;
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) continue;
    if (!seen.has(host)) { seen.add(host); sites.push(host); }
  }
  return sites;
}

function mode() { return $("modeExclude").checked ? "exclude" : "include"; }
function setMessage(message, kind) {
  $("message").textContent = message;
  $("message").className = "message" + (kind ? " " + kind : "");
}
function updateModeHelp() {
  $("modeHelp").textContent = mode() === "include"
    ? "Only sites in this list use the selected proxy. All other sites connect directly."
    : "All sites use the selected proxy except sites in this list, which connect directly.";
}

function renderProxies() {
  const select = $("proxySelect");
  select.replaceChildren();
  const starBtn = $("starBtn");
  
  if (!verifiedProxies.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No verified proxies available";
    select.append(opt);
    select.disabled = true;
    $("connectBtn").disabled = true;
    $("checkBtn").disabled = true;
    if (starBtn) {
      starBtn.disabled = true;
      starBtn.classList.remove("isFav");
    }
    $("verifiedCountBadge").textContent = "0 verified";
    $("listStatus").textContent = "Proxy list is empty. Click 'Fetch, test & build verified list' below to create it.";
    updateProxyDetails();
    return;
  }

  $("verifiedCountBadge").textContent = verifiedProxies.length + " verified";
  $("listStatus").textContent = verifiedProxies.length + " working proxies verified & ready to use.";

  const favSet = new Set(favoriteProxies);
  const favList = verifiedProxies.filter(p => favSet.has(p));
  const otherList = verifiedProxies.filter(p => !favSet.has(p));

  if (favList.length) {
    const favGroup = document.createElement("optgroup");
    favGroup.label = "★ Favorite Proxies";
    for (const proxy of favList) {
      const opt = document.createElement("option");
      opt.value = proxy;
      opt.textContent = "★ " + proxy;
      favGroup.append(opt);
    }
    select.append(favGroup);
  }

  if (otherList.length) {
    const otherGroup = document.createElement("optgroup");
    otherGroup.label = "Verified Working Proxies";
    for (const proxy of otherList) {
      const opt = document.createElement("option");
      opt.value = proxy;
      opt.textContent = proxy;
      otherGroup.append(opt);
    }
    select.append(otherGroup);
  }

  select.disabled = false;
  $("connectBtn").disabled = false;
  $("checkBtn").disabled = false;
  if (starBtn) starBtn.disabled = false;
  updateProxyDetails();
  renderFavoritesSection();
}

function updateProxyDetails() {
  const proxy = $("proxySelect").value;
  const starBtn = $("starBtn");
  if (!proxy) {
    $("proxyDetails").textContent = "No verified proxy selected.";
    if (starBtn) starBtn.classList.remove("isFav");
    return;
  }
  const isFav = favoriteProxies.includes(proxy);
  if (starBtn) starBtn.classList.toggle("isFav", isFav);
  $("proxyDetails").textContent = proxy.split("://")[0].toUpperCase() + " · Verified live connection · " + (isFav ? "★ Favorite" : "Not starred");
}

function renderFavoritesSection() {
  const container = $("favoritesList");
  const badge = $("favCountBadge");
  badge.textContent = favoriteProxies.length + " favorites";

  if (!favoriteProxies.length) {
    container.innerHTML = '<p class="small muted">No favorite proxies added yet. Select a verified proxy above and click ★ to add it here.</p>';
    return;
  }

  container.replaceChildren();
  for (const proxy of favoriteProxies) {
    const item = document.createElement("div");
    item.className = "favItem";

    const label = document.createElement("span");
    const isOnline = verifiedProxies.includes(proxy);
    label.textContent = "★ " + proxy + (isOnline ? " (verified)" : " (unverified/offline)");
    label.style.color = isOnline ? "var(--green)" : "var(--muted)";

    const removeBtn = document.createElement("button");
    removeBtn.className = "quiet";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      await toggleFavorite(proxy);
    });

    item.append(label, removeBtn);
    container.append(item);
  }
}

async function toggleFavorite(proxy) {
  if (!proxy) return;
  const res = await send("TOGGLE_FAVORITE", {proxy: proxy});
  if (res && res.ok) {
    favoriteProxies = res.favorites || [];
    renderProxies();
    updateProxyDetails();
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

function renderConnection(state, currentTabRoute) {
  const active = Boolean(state && state.active);
  const banner = $("connectionBanner");
  banner.classList.toggle("connected", active);
  banner.classList.toggle("disconnected", !active);
  $("connectionIcon").innerHTML = getSvgMarkup(active, "currentColor");
  $("connectionTitle").textContent = active ? "PROXY CONNECTED" : "Proxy disconnected";
  const selectedMode = state && state.mode === "exclude" ? "Exclude list" : "Include list";

  let detailMsg = "Your saved site rules are not active.";
  if (active) {
    if (currentTabRoute && currentTabRoute.mappedProxy) {
      detailMsg = "Current tab mapped → " + currentTabRoute.mappedProxy + " · Default: " + (state.selectedProxy || "None");
    } else {
      detailMsg = (state.selectedProxy || "Proxy active") + " · " + selectedMode + " · " + ((state.sites || []).length) + " domains";
    }
  }
  $("connectionDetail").textContent = detailMsg;
  $("statusPill").textContent = active ? "CONNECTED" : "DISCONNECTED";
  $("statusPill").classList.toggle("on", active);
  $("disconnectBtn").disabled = !active;
  
  if (state && state.siteProxyMap) savedSiteProxyMap = state.siteProxyMap;
  if (state && state.sites) {
    $("siteList").value = state.sites.join("\n");
    if (state.mode === "exclude") $("modeExclude").checked = true;
    else $("modeInclude").checked = true;
    updateModeHelp();
    renderSiteProxyMappings();
  }
  if (active && state.selectedProxy) {
    const option = Array.from($("proxySelect").options).find(o => o.value === state.selectedProxy);
    if (option) $("proxySelect").value = state.selectedProxy;
    updateProxyDetails();
  }
}

async function updateTabRoute(state) {
  const active = Boolean(state && state.active);
  const routeDetailEl = $("tabRouteDetail");
  try {
    const tabs = await chrome.tabs.query({active:true, currentWindow:true});
    const url = tabs && tabs[0] ? tabs[0].url : "";
    let parsed = null;
    try { parsed = new URL(url || ""); } catch (_) {}

    if (!active) {
      updateBrandIcon(false);
      if (routeDetailEl) routeDetailEl.textContent = "Current tab: Direct (SiteTunnel is disconnected)";
      return { isConnected: false, mappedProxy: null };
    }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || !parsed.hostname.includes(".")) {
      updateBrandIcon(false);
      if (routeDetailEl) routeDetailEl.textContent = "Current tab: Direct (system or internal page)";
      return { isConnected: false, mappedProxy: null };
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const map = state.siteProxyMap && typeof state.siteProxyMap === "object" ? state.siteProxyMap : {};
    let mappedHost = "";
    let mappedProxy = "";
    for (const [rawDomain, proxy] of Object.entries(map)) {
      const domain = normalizeHost(rawDomain);
      if (domain && typeof proxy === "string" && proxy && hostMatches(host, domain) && domain.length > mappedHost.length) {
        mappedHost = domain;
        mappedProxy = proxy;
      }
    }
    let route = "";
    let tabUsesProxy = false;
    if (mappedProxy) {
      route = "Mapped → " + mappedProxy;
      tabUsesProxy = true;
    } else {
      const sites = Array.isArray(state.sites) ? state.sites.map(normalizeHost).filter(Boolean) : [];
      const matched = sites.some(domain => hostMatches(host, domain));
      const usesDefault = state.mode === "exclude" ? !matched : matched;
      route = usesDefault ? ("Proxy → " + (state.selectedProxy || "active")) : "Direct (bypassed)";
      tabUsesProxy = usesDefault;
    }
    updateBrandIcon(tabUsesProxy);
    if (routeDetailEl) routeDetailEl.textContent = "Current tab (" + host + "): " + route;
    return { isConnected: tabUsesProxy, mappedProxy: mappedProxy || null };
  } catch (_) {
    updateBrandIcon(active);
    if (routeDetailEl) {
      routeDetailEl.textContent = active ? "Current tab: Active" : "Current tab: Direct";
    }
    return { isConnected: active, mappedProxy: null };
  }
}

async function updateState() {
  try {
    const state = await send("GET_STATE");
    if (state) {
      verifiedProxies = Array.isArray(state.verifiedProxies) ? state.verifiedProxies : [];
      favoriteProxies = Array.isArray(state.favoriteProxies) ? state.favoriteProxies : [];
      if (state.selectedCountry) $("countrySelect").value = state.selectedCountry;
      if (state.lastTestedAt) {
        const d = new Date(state.lastTestedAt);
        $("lastTestedInfo").textContent = "Last verified: " + d.toLocaleDateString() + " " + d.toLocaleTimeString();
      }
      renderProxies();
      const tabRoute = await updateTabRoute(state);
      renderConnection(state, tabRoute);
      if (state.levelOfControl && !["controlled_by_this_extension", "controllable_by_this_extension"].includes(state.levelOfControl)) {
        setMessage("Another policy or extension controls Chrome's proxy settings.", "error");
      }
    }
  } catch (_) {}
}

function renderSiteProxyMappings() {
  const container = $("siteProxyMappings");
  if (!container) return;
  const sites = parseSites();
  container.replaceChildren();
  if (!sites.length) {
    container.textContent = "Add domains to your site list to assign preferred proxies.";
    return;
  }
  for (const host of sites) {
    const row = document.createElement("div"); row.className = "siteProxyRow";
    const label = document.createElement("label"); label.textContent = host; label.htmlFor = "siteproxy-" + host;
    const select = document.createElement("select"); select.id = "siteproxy-" + host; select.dataset.host = host;
    const def = document.createElement("option"); def.value = ""; def.textContent = "Use default proxy"; select.append(def);
    
    const options = [...verifiedProxies];
    if (savedSiteProxyMap[host] && !options.includes(savedSiteProxyMap[host])) {
      options.unshift(savedSiteProxyMap[host]);
    }
    for (const proxy of options) {
      const opt = document.createElement("option");
      opt.value = proxy;
      const isFav = favoriteProxies.includes(proxy);
      opt.textContent = (isFav ? "★ " : "") + proxy;
      select.append(opt);
    }
    select.value = savedSiteProxyMap[host] || "";
    row.append(label, select);
    container.append(row);
  }
}

function updateCurrentSiteButton() {
  $("currentSiteBtn").textContent = mode() === "include" ? "Include this site" : "Exclude this site";
}

async function getCurrentTabHost() {
  const tabs = await chrome.tabs.query({active:true, currentWindow:true});
  const url = tabs && tabs[0] ? tabs[0].url : "";
  if (!url) throw new Error("Could not read the current tab URL.");
  let parsed;
  try { parsed = new URL(url); } catch (_) { throw new Error("This tab does not have a supported website address."); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || !parsed.hostname.includes(".")) throw new Error("Open a regular HTTP or HTTPS website first.");
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}

$("currentSiteBtn").addEventListener("click", async () => {
  const button = $("currentSiteBtn");
  button.disabled = true;
  try {
    const host = await getCurrentTabHost();
    const sites = parseSites();
    if (!sites.includes(host)) sites.push(host);
    const selectedMode = mode();
    const result = await send("SAVE_RULES", {sites:sites, mode:selectedMode});
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : "Could not save site rule.");
    $("siteList").value = result.sites.join("\n");
    $("siteStatus").textContent = result.sites.length + " valid domains saved · " + (selectedMode === "include" ? "Include" : "Exclude") + " mode.";
    $("currentSiteStatus").textContent = host + (selectedMode === "include" ? " added to the Include list." : " added to the Exclude list.");
    setMessage(result.active ? "Current site rule saved and applied." : "Current site added. Connect a proxy to activate rules.", "success");
    await updateState();
  } catch (error) { $("currentSiteStatus").textContent = error.message; setMessage(error.message, "error"); }
  finally { button.disabled = false; updateCurrentSiteButton(); }
});

$("starBtn").addEventListener("click", async () => {
  const proxy = $("proxySelect").value;
  if (!proxy) return;
  await toggleFavorite(proxy);
});

$("siteList").addEventListener("input", renderSiteProxyMappings);
$("saveSiteProxyMapBtn").addEventListener("click", async () => {
  try {
    const sites = parseSites(); const selectedMode = mode();
    const rules = await send("SAVE_RULES", {sites:sites, mode:selectedMode});
    if (!rules || !rules.ok) throw new Error(rules && rules.error ? rules.error : "Could not save site list.");
    const map = {}; for (const select of $("siteProxyMappings").querySelectorAll("select[data-host]")) if (select.value) map[select.dataset.host] = select.value;
    const result = await send("SAVE_SITE_PROXY_MAP", {map:map});
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : "Could not save proxy preferences.");
    savedSiteProxyMap = result.map || {}; $("siteProxyStatus").textContent = Object.keys(savedSiteProxyMap).length + " per-site proxy overrides saved.";
    setMessage("Domain proxy preferences saved and applied.", "success"); await updateState();
  } catch (error) { $("siteProxyStatus").textContent = error.message; setMessage(error.message, "error"); }
});

$("modeInclude").addEventListener("change", () => { updateModeHelp(); updateCurrentSiteButton(); });
$("modeExclude").addEventListener("change", () => { updateModeHelp(); updateCurrentSiteButton(); });
$("proxySelect").addEventListener("change", updateProxyDetails);

$("clearSitesBtn").addEventListener("click", () => {
  $("siteList").value = "";
  $("siteStatus").textContent = "List cleared in the editor. Save & apply rules to commit it.";
});

$("saveSitesBtn").addEventListener("click", async () => {
  const sites = parseSites(), selectedMode = mode();
  try {
    const result = await send("SAVE_RULES", {sites:sites, mode:selectedMode});
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : "Could not save rules.");
    $("siteList").value = sites.join("\n");
    $("siteStatus").textContent = sites.length + " valid domains saved · " + (selectedMode === "include" ? "Include" : "Exclude") + " mode.";
    setMessage(result.active ? "Rules saved and applied to the active proxy." : "Rules saved. Connect a proxy to activate them.", "success");
    await updateState();
  } catch (error) { setMessage(error.message || "Could not save rules.", "error"); }
});

$("connectBtn").addEventListener("click", async () => {
  const proxy = $("proxySelect").value;
  if (!proxy) return;
  $("connectBtn").disabled = true;
  setMessage("Applying your site rules…");
  try {
    const sites = parseSites(), selectedMode = mode();
    const result = await send("CONNECT", {proxy:proxy, sites:sites, mode:selectedMode});
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : "Could not apply proxy settings.");
    $("siteList").value = result.sites.join("\n");
    $("siteStatus").textContent = result.sites.length + " valid domains saved.";
    setMessage("Connected. Your " + selectedMode + " rules are active.", "success");
    await updateState();
  } catch (error) { setMessage(error.message || "Could not connect.", "error"); }
  finally { $("connectBtn").disabled = !verifiedProxies.length; }
});

$("disconnectBtn").addEventListener("click", async () => {
  try {
    const result = await send("DISCONNECT");
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : "Could not disconnect.");
    setMessage("Disconnected. Previous Chrome proxy settings restored.", "success");
    await updateState();
  } catch (error) { setMessage(error.message || "Could not disconnect.", "error"); }
});

// Check route: if current tab has a mapped domain proxy, check that mapped proxy; otherwise check active proxy
$("checkBtn").addEventListener("click", async () => {
  let proxyToCheck = $("proxySelect").value;
  let targetDesc = proxyToCheck;
  try {
    const currentState = await send("GET_STATE");
    const tabs = await chrome.tabs.query({active:true, currentWindow:true});
    const url = tabs && tabs[0] ? tabs[0].url : "";
    let host = "";
    try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch (_) {}
    
    if (host && currentState && currentState.siteProxyMap && currentState.siteProxyMap[host]) {
      proxyToCheck = currentState.siteProxyMap[host];
      targetDesc = "Mapped proxy for " + host + " (" + proxyToCheck + ")";
    } else if (currentState && currentState.active && currentState.selectedProxy) {
      proxyToCheck = currentState.selectedProxy;
      targetDesc = "Active default (" + proxyToCheck + ")";
    }
  } catch (_) {}

  if (!proxyToCheck) return;
  $("checkBtn").disabled = true;
  $("ipResult").textContent = "Checking via " + targetDesc + "…";

  try {
    const setup = await send("SET_TEMP_TEST", {proxy: proxyToCheck});
    if (!setup || !setup.ok) throw new Error(setup && setup.error ? setup.error : "Could not configure test route.");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let observedIp = null;

    try {
      const resp = await fetch("https://cloudflare.com/cdn-cgi/trace?sitetunnel_exit=" + Date.now(), {
        cache: "no-store",
        signal: controller.signal
      });
      if (resp.ok) {
        const text = await resp.text();
        const m = /^ip=([^\r\n]+)/m.exec(text);
        if (m) observedIp = m[1].trim();
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!observedIp) {
      // Fallback to ipify if Cloudflare trace is blocked
      const ipResp = await fetch("https://api.ipify.org/?sitetunnel_exit=" + Date.now(), {cache:"no-store"});
      if (ipResp.ok) observedIp = (await ipResp.text()).trim();
    }

    const restore = await send("RESTORE_TARGETS");
    if (!restore || !restore.ok) throw new Error(restore && restore.error ? restore.error : "Could not restore site rules.");

    if (observedIp) {
      $("ipResult").textContent = "Observed exit IP: " + observedIp + " (routed via " + proxyToCheck + ")";
      setMessage("Exit check complete; your site rules have been restored.", "success");
    } else {
      throw new Error("Proxy did not return an exit IP.");
    }
  } catch (error) {
    try { await send("RESTORE_TARGETS"); } catch (_) {}
    $("ipResult").textContent = "Check failed: " + error.message;
    setMessage("Proxy test failed. The endpoint may be offline or timing out.", "error");
  } finally {
    $("checkBtn").disabled = !verifiedProxies.length;
  }
});

// Testing and building verified proxy pool
$("buildPoolBtn").addEventListener("click", async () => {
  const button = $("buildPoolBtn");
  button.disabled = true;
  const country = $("countrySelect").value || "nl";
  $("poolStatus").textContent = "Fetching candidate proxies for " + (COUNTRY_NAMES[country] || country) + "…";
  
  try {
    const resp = await fetch("https://raw.githubusercontent.com/maximilianfeix/free-proxy-list/main/countries/" + encodeURIComponent(country) + ".txt", {cache: "no-store"});
    if (!resp.ok) throw new Error("Could not download candidate list (HTTP " + resp.status + ")");
    const candidates = parseProxyLines(await resp.text());
    if (!candidates.length) throw new Error("No proxy candidates found for " + country);

    const sample = candidates.slice(0, 30);
    const healthy = [];
    $("poolStatus").textContent = "Rendering and testing real web requests through " + sample.length + " proxies…";

    for (let i = 0; i < sample.length; i++) {
      const proxy = sample[i];
      $("poolStatus").textContent = "Testing " + (i + 1) + "/" + sample.length + ": " + proxy + " (" + healthy.length + " passed)";
      try {
        const setup = await send("SET_TEMP_TEST", {proxy: proxy});
        if (!setup || !setup.ok) continue;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const started = Date.now();
        let verifiedIp = null;

        try {
          const checkResp = await fetch("https://cloudflare.com/cdn-cgi/trace?sitetunnel_check=" + Date.now(), {
            cache: "no-store",
            signal: controller.signal
          });
          if (checkResp.ok) {
            const body = await checkResp.text();
            const match = /^ip=([^\r\n]+)/m.exec(body);
            if (match) verifiedIp = match[1].trim();
          }
        } catch (_) {
          // Continue to an independent endpoint; some proxies block Cloudflare.
        } finally {
          clearTimeout(timeout);
        }

        if (!verifiedIp) {
          const fallbackController = new AbortController();
          const fallbackTimeout = setTimeout(() => fallbackController.abort(), 5000);
          try {
            const fallback = await fetch("https://api.ipify.org/?sitetunnel_check=" + Date.now(), {
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

        const elapsed = Date.now() - started;
        if (verifiedIp) healthy.push({proxy: proxy, latency: elapsed, ip: verifiedIp});
      } catch (_) {
      } finally {
        try { await send("RESTORE_TARGETS"); } catch (_) {}
      }
    }

    healthy.sort((a, b) => a.latency - b.latency);
    const workingList = healthy.map(x => x.proxy);

    const saved = await send("SAVE_VERIFIED_PROXIES", {proxies: workingList, country: country});
    if (!saved || !saved.ok) throw new Error("Failed to save verified proxies.");

    verifiedProxies = workingList;
    renderProxies();
    renderSiteProxyMappings();
    
    $("poolStatus").textContent = "Successfully tested " + sample.length + " servers with real web requests: " + workingList.length + " passed tests.";
    setMessage(workingList.length ? ("Created list with " + workingList.length + " verified proxies.") : "None of the tested public proxies responded to web requests. Try another country.", workingList.length ? "success" : "error");
  } catch (error) {
    $("poolStatus").textContent = "Testing failed: " + error.message;
    setMessage(error.message, "error");
  } finally {
    button.disabled = false;
    await updateState();
  }
});

$("autoRandomize").addEventListener("change", async () => {
  const checked = $("autoRandomize").checked;
  const state = await send("GET_STATE");
  await send("SAVE_HEALTHY_POOL", {proxies: state.healthyProxies || [], autoRandomize: checked});
  setMessage(checked ? "Startup randomizer enabled: will pick from your favorites." : "Startup randomizer disabled.", "success");
});

(async function init() {
  const saved = await chrome.storage.local.get(["sites", "mode"]);
  if (Array.isArray(saved.sites)) $("siteList").value = saved.sites.join("\n");
  if (saved.mode === "exclude") $("modeExclude").checked = true;
  updateModeHelp();
  updateCurrentSiteButton();
  renderSiteProxyMappings();
  await updateState();
  const state = await send("GET_STATE");
  if (state) {
    $("autoRandomize").checked = Boolean(state.autoRandomize);
  }
})();
