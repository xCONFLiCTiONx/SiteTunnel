const LIST_URL = "https://maximilianfeix.github.io/proxy-scraper/nl.txt";
const $ = id => document.getElementById(id);
let proxies = [];

function parseProxyLines(text) {
  const seen = new Set(), results = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = /^[a-z]+:\/\//i.test(line) ? line : `http://${line}`;
    const match = /^(http|https|socks4|socks5):\/\/([^:/\s]+):(\d{1,5})$/i.exec(normalized);
    if (!match) continue;
    const port = Number(match[3]);
    if (port < 1 || port > 65535) continue;
    const item = `${match[1].toLowerCase()}://${match[2]}:${port}`;
    if (!seen.has(item)) { seen.add(item); results.push(item); }
  }
  return results;
}
function setMessage(text, kind = "") { $("message").textContent = text; $("message").className = `message ${kind}`; }
function renderProxies() {
  const select = $("proxySelect"); select.replaceChildren();
  if (!proxies.length) {
    const option = document.createElement("option"); option.textContent = "No proxies loaded"; select.append(option);
    select.disabled = true; $("connectBtn").disabled = true; $("checkBtn").disabled = true;
    $("proxyDetails").textContent = "Refresh the list and try again."; return;
  }
  for (const proxy of proxies) { const option = document.createElement("option"); option.value = proxy; option.textContent = proxy; select.append(option); }
  select.disabled = false; $("connectBtn").disabled = false; $("checkBtn").disabled = false; updateProxyDetails();
}
function updateProxyDetails() {
  const proxy = $("proxySelect").value;
  $("proxyDetails").textContent = proxy ? `${proxy.split("://")[0].toUpperCase()} · Public endpoint · Availability is not guaranteed` : "No proxy selected";
}
async function refreshList() {
  $("refreshBtn").disabled = true; $("listStatus").textContent = "Fetching the current Netherlands list…";
  try {
    const response = await fetch(LIST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`List source returned HTTP ${response.status}`);
    proxies = parseProxyLines(await response.text()); renderProxies();
    $("listStatus").textContent = `${proxies.length} entries loaded from the public Netherlands list.`;
    setMessage("Choose a proxy, then connect.");
  } catch (error) {
    proxies = []; renderProxies(); $("listStatus").textContent = `Could not load list: ${error.message}`;
    setMessage("Proxy list unavailable. Check your connection and refresh.", "error");
  } finally { $("refreshBtn").disabled = false; }
}
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });
async function updateState() {
  try {
    const state = await send("GET_STATE"), active = Boolean(state.active);
    $("statusPill").textContent = active ? "ON" : "OFF"; $("statusPill").classList.toggle("on", active);
    $("disconnectBtn").disabled = !active;
    if (active && state.selectedProxy) {
      $("listStatus").textContent = `Connected with ${state.selectedProxy}`;
      const option = [...$("proxySelect").options].find(o => o.value === state.selectedProxy);
      if (option) $("proxySelect").value = state.selectedProxy;
      updateProxyDetails();
    }
    if (state.levelOfControl && !["controlled_by_this_extension", "controllable_by_this_extension"].includes(state.levelOfControl)) {
      setMessage("Another policy or extension controls Chrome's proxy settings.", "error");
    }
  } catch {}
}
$("proxySelect").addEventListener("change", updateProxyDetails);
$("refreshBtn").addEventListener("click", refreshList);
$("connectBtn").addEventListener("click", async () => {
  const proxy = $("proxySelect").value; if (!proxy) return;
  $("connectBtn").disabled = true; setMessage("Applying site-specific proxy rules…");
  try {
    const result = await send("CONNECT", { proxy });
    if (result?.ok) { setMessage("Connected. Only the two target domains are routed through this proxy.", "success"); await updateState(); }
    else setMessage(result?.error || "Could not apply proxy settings.", "error");
  } catch (error) { setMessage(error.message || "Could not connect.", "error"); }
  finally { $("connectBtn").disabled = false; }
});
$("disconnectBtn").addEventListener("click", async () => {
  try {
    const result = await send("DISCONNECT");
    if (result?.ok) {
      setMessage("Disconnected. Previous Chrome proxy settings restored.", "success");
      $("statusPill").textContent = "OFF"; $("statusPill").classList.remove("on"); $("disconnectBtn").disabled = true;
    } else setMessage(result?.error || "Could not disconnect.", "error");
  } catch (error) { setMessage(error.message || "Could not disconnect.", "error"); }
});
$("checkBtn").addEventListener("click", async () => {
  const proxy = $("proxySelect").value; if (!proxy) return;
  $("checkBtn").disabled = true; $("ipResult").textContent = "Checking…";
  try {
    const setup = await send("SET_TEMP_TEST", { proxy });
    if (!setup?.ok) throw new Error(setup?.error || "Could not configure test route.");
    const response = await fetch(`https://api.ipify.org/?sitetunnel=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`IP check returned HTTP ${response.status}`);
    $("ipResult").textContent = `Observed exit IP: ${(await response.text()).trim()}`;
    const restore = await send("RESTORE_TARGETS");
    if (!restore?.ok) throw new Error(restore?.error || "Could not restore target-only rules.");
    setMessage("Exit check complete; target-only routing restored.", "success");
  } catch (error) {
    try { await send("RESTORE_TARGETS"); } catch {}
    $("ipResult").textContent = `Check failed: ${error.message}`;
    setMessage("Proxy test failed. This endpoint may be offline or blocked.", "error");
  } finally { $("checkBtn").disabled = false; }
});
(async () => { await refreshList(); await updateState(); })();