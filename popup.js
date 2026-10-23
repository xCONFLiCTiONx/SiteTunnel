
const LIST_URL = "https://raw.githubusercontent.com/maximilianfeix/free-proxy-list/main/countries/nl.txt";
const $ = id => document.getElementById(id);
let proxies = [];
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
  $("refreshBtn").disabled = true;
  $("listStatus").textContent = "Fetching the current Netherlands list…";
  try {
    const response = await fetch(LIST_URL, {cache:"no-store"});
    if (!response.ok) throw new Error("List source returned HTTP " + response.status);
    proxies = parseProxyLines(await response.text());
    renderProxies();
    $("listStatus").textContent = proxies.length + " entries loaded from the public Netherlands list.";
    if (proxies.length) setMessage("Choose a proxy, then connect.");
  } catch (error) {
    proxies = []; renderProxies();
    $("listStatus").textContent = "Could not load list: " + error.message;
    setMessage("Proxy list unavailable. Check your connection and refresh.", "error");
  } finally { $("refreshBtn").disabled = false; }
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
$("modeInclude").addEventListener("change", updateModeHelp);
$("modeExclude").addEventListener("change", updateModeHelp);
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
  await refreshList();
  await updateState();
  const state = await send("GET_STATE");
  $("autoRandomize").checked = Boolean(state.autoRandomize);
  if (state.healthyProxies && state.healthyProxies.length) $("poolStatus").textContent = state.healthyProxies.length + " saved healthy proxies available for startup randomization.";
})();
