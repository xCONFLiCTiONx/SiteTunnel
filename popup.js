
const COUNTRY_NAMES = {nl:"Netherlands",us:"United States",gb:"United Kingdom",de:"Germany",fr:"France",ca:"Canada",ch:"Switzerland",se:"Sweden",no:"Norway",fi:"Finland",dk:"Denmark",ie:"Ireland",pl:"Poland",cz:"Czechia",es:"Spain",it:"Italy",jp:"Japan",sg:"Singapore",au:"Australia"};
const $ = id => document.getElementById(id);
let proxies = [];
let allCandidates = [];
let proxyCountry = {};
let savedSiteProxyMap = {};
const send = (type, extra = {}) => chrome.runtime.sendMessage(Object.assign({type:type}, extra));

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
  if (!proxies.length) {
    const opt = document.createElement("option"); opt.textContent = "No proxies loaded"; select.append(opt);
    select.disabled = true; $("connectBtn").disabled = true; $("checkBtn").disabled = true;
    $("proxyDetails").textContent = "Refresh the list and try again.";
    return;
  }
  for (const proxy of proxies) {
    const opt = document.createElement("option"); opt.value = proxy; opt.textContent = proxy; select.append(opt);
  }
  select.disabled = false; $("connectBtn").disabled = false; $("checkBtn").disabled = false;
  updateProxyDetails();
}
function updateProxyDetails() {
  const proxy = $("proxySelect").value;
  $("proxyDetails").textContent = proxy ? proxy.split("://")[0].toUpperCase() + " · Public endpoint · Availability is not guaranteed" : "No proxy selected";
}
function renderConnection(state) {
  const active = Boolean(state && state.active);
  const banner = $("connectionBanner");
  banner.classList.toggle("connected", active);
  banner.classList.toggle("disconnected", !active);
  $("connectionIcon").textContent = active ? "✓" : "●";
  $("connectionTitle").textContent = active ? "PROXY CONNECTED" : "Proxy disconnected";
  const selectedMode = state && state.mode === "exclude" ? "Exclude list" : "Include list";
  $("connectionDetail").textContent = active
    ? (state.selectedProxy || "Proxy active") + " · " + selectedMode + " · " + ((state.sites || []).length) + " domains"
    : "Your saved site rules are not active.";
  $("statusPill").textContent = active ? "CONNECTED" : "DISCONNECTED";
  $("statusPill").classList.toggle("on", active);
  $("disconnectBtn").disabled = !active;
  if (state && state.siteProxyMap) savedSiteProxyMap = state.siteProxyMap;
  if (state && state.sites) {
    $("siteList").value = state.sites.join("\n");
    if (state.mode === "exclude") $("modeExclude").checked = true;
    else $("modeInclude").checked = true;
    updateModeHelp();
  }
  if (active && state.selectedProxy) {
    const option = Array.from($("proxySelect").options).find(o => o.value === state.selectedProxy);
    if (option) $("proxySelect").value = state.selectedProxy;
    updateProxyDetails();
  }
}
async function refreshList() {
  $("refreshBtn").disabled = true; $("loadCountryBtn").disabled = true;
  const code = $("countrySelect").value || "nl";
  $("listStatus").textContent = "Fetching " + (COUNTRY_NAMES[code] || code.toUpperCase()) + " proxy candidates…";
  try {
    const response = await fetch("https://raw.githubusercontent.com/maximilianfeix/free-proxy-list/main/countries/" + encodeURIComponent(code) + ".txt", {cache:"no-store"});
    if (!response.ok) throw new Error("Country list returned HTTP " + response.status);
    const loaded = parseProxyLines(await response.text());
    for (const proxy of loaded) { if (!allCandidates.includes(proxy)) allCandidates.push(proxy); proxyCountry[proxy] = code; }
    proxies = loaded; renderProxies(); renderSiteProxyMappings();
    $("listStatus").textContent = loaded.length + " candidates from " + (COUNTRY_NAMES[code] || code.toUpperCase()) + "; " + allCandidates.length + " total candidates loaded across countries.";
    if (proxies.length) setMessage("Loaded country proxy candidates. Test before trusting them.");
  } catch (error) { proxies = []; renderProxies(); $("listStatus").textContent = "Could not load country list: " + error.message; setMessage("Country proxy list unavailable.", "error"); }
  finally { $("refreshBtn").disabled = false; $("loadCountryBtn").disabled = false; }
}
async function updateState() {
  try {
    const state = await send("GET_STATE");
    renderConnection(state);
    if (state.levelOfControl && !["controlled_by_this_extension", "controllable_by_this_extension"].includes(state.levelOfControl)) {
      setMessage("Another policy or extension controls Chrome's proxy settings.", "error");
    }
  } catch (_) {}
}
function renderSiteProxyMappings() {
  const container = $("siteProxyMappings");
  if (!container) return;
  const sites = parseSites(); container.replaceChildren();
  if (!sites.length) { container.textContent = "Add domains to your list to assign preferred proxies."; return; }
  for (const host of sites) {
    const row = document.createElement("div"); row.className = "siteProxyRow";
    const label = document.createElement("label"); label.textContent = host; label.htmlFor = "siteproxy-" + host;
    const select = document.createElement("select"); select.id = "siteproxy-" + host; select.dataset.host = host;
    const def = document.createElement("option"); def.value = ""; def.textContent = "Use default proxy"; select.append(def);
    const options = [...allCandidates]; if (savedSiteProxyMap[host] && !options.includes(savedSiteProxyMap[host])) options.unshift(savedSiteProxyMap[host]);
    for (const proxy of options) { const opt = document.createElement("option"); opt.value = proxy; opt.textContent = (COUNTRY_NAMES[proxyCountry[proxy]] || (proxyCountry[proxy] || "Saved proxy").toUpperCase()) + " · " + proxy; select.append(opt); }
    select.value = savedSiteProxyMap[host] || ""; row.append(label, select); container.append(row);
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
$("countrySelect").addEventListener("change", refreshList);
$("loadCountryBtn").addEventListener("click", refreshList);
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
$("refreshBtn").addEventListener("click", refreshList);
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
  finally { $("connectBtn").disabled = !proxies.length; }
});
$("disconnectBtn").addEventListener("click", async () => {
  try {
    const result = await send("DISCONNECT");
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : "Could not disconnect.");
    setMessage("Disconnected. Previous Chrome proxy settings restored.", "success");
    await updateState();
  } catch (error) { setMessage(error.message || "Could not disconnect.", "error"); }
});
$("checkBtn").addEventListener("click", async () => {
  const proxy = $("proxySelect").value;
  if (!proxy) return;
  $("checkBtn").disabled = true; $("ipResult").textContent = "Checking…";
  try {
    const setup = await send("SET_TEMP_TEST", {proxy:proxy});
    if (!setup || !setup.ok) throw new Error(setup && setup.error ? setup.error : "Could not configure test route.");
    const response = await fetch("https://api.ipify.org/?sitetunnel=" + Date.now(), {cache:"no-store"});
    if (!response.ok) throw new Error("IP check returned HTTP " + response.status);
    $("ipResult").textContent = "Observed exit IP: " + (await response.text()).trim();
    const restore = await send("RESTORE_TARGETS");
    if (!restore || !restore.ok) throw new Error(restore && restore.error ? restore.error : "Could not restore site rules.");
    setMessage("Exit check complete; your site rules have been restored.", "success");
  } catch (error) {
    try { await send("RESTORE_TARGETS"); } catch (_) {}
    $("ipResult").textContent = "Check failed: " + error.message;
    setMessage("Proxy test failed. The endpoint may be offline or blocked.", "error");
  } finally { $("checkBtn").disabled = !proxies.length; }
});
$("buildPoolBtn").addEventListener("click", async () => {
  const button = $("buildPoolBtn");
  button.disabled = true;
  const sample = proxies.slice(0, Math.min(12, proxies.length));
  const healthy = [];
  $("poolStatus").textContent = "Testing " + sample.length + " public proxies. This can take a minute…";
  try {
    for (let i = 0; i < sample.length; i++) {
      const proxy = sample[i];
      $("poolStatus").textContent = "Testing " + (i + 1) + "/" + sample.length + ": " + proxy;
      try {
        const setup = await send("SET_TEMP_TEST", {proxy:proxy});
        if (!setup || !setup.ok) throw new Error("Could not configure test route");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const started = Date.now();
        let ok = false;
        try {
          const response = await fetch("https://api.ipify.org/?sitetunnel=" + Date.now(), {cache:"no-store", signal:controller.signal});
          if (response.ok) { const ip = (await response.text()).trim(); ok = ip.split(".").length === 4 && ip.split(".").every(part => part.length > 0 && part.length <= 3 && Number(part) >= 0 && Number(part) <= 255); }
        } finally { clearTimeout(timeout); }
        const elapsed = Date.now() - started;
        if (ok && elapsed < 5000) healthy.push({proxy:proxy, latency:elapsed});
      } catch (_) { }
      finally { try { await send("RESTORE_TARGETS"); } catch (_) {} }
    }
    healthy.sort((a,b) => a.latency - b.latency);
    const pool = healthy.slice(0, 8).map(x => x.proxy);
    const saved = await send("SAVE_HEALTHY_POOL", {proxies:pool, autoRandomize:$("autoRandomize").checked});
    if (!saved || !saved.ok) throw new Error(saved && saved.error ? saved.error : "Could not save pool");
    $("poolStatus").textContent = "Saved " + pool.length + " responsive proxies from " + sample.length + " tested. Fastest measured: " + (healthy.length ? healthy[0].latency + " ms" : "none") + ". Randomization " + ($("autoRandomize").checked ? "enabled" : "disabled") + ".";
    setMessage(pool.length ? "Healthy proxy pool saved." : "No proxies passed the basic test. Try refreshing the list later.", pool.length ? "success" : "error");
  } catch (error) { $("poolStatus").textContent = "Pool test failed: " + error.message; setMessage(error.message, "error"); }
  finally { button.disabled = false; await updateState(); }
});
$("autoRandomize").addEventListener("change", async () => {
  const state = await send("GET_STATE");
  const result = await send("SAVE_HEALTHY_POOL", {proxies:state.healthyProxies || [], autoRandomize:$("autoRandomize").checked});
  if (result && result.ok) setMessage($("autoRandomize").checked ? "Randomization enabled for the next browser startup." : "Startup randomization disabled.", "success");
});
(async function init() {
  const saved = await chrome.storage.local.get(["sites", "mode"]);
  if (Array.isArray(saved.sites)) $("siteList").value = saved.sites.join("\n");
  if (saved.mode === "exclude") $("modeExclude").checked = true;
  updateModeHelp();
  updateCurrentSiteButton();
  renderSiteProxyMappings();
  await refreshList();
  await updateState();
  const state = await send("GET_STATE");
  $("autoRandomize").checked = Boolean(state.autoRandomize);
  if (state.healthyProxies && state.healthyProxies.length) $("poolStatus").textContent = state.healthyProxies.length + " saved healthy proxies available for startup randomization.";
})();
