const $ = id => document.getElementById(id);

const send = async (type, extra = {}) => {
  try {
    return await chrome.runtime.sendMessage(Object.assign({ type: type }, extra));
  } catch (err) {
    console.warn(`SiteTunnel: Message '${type}' failed:`, err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
};

let statusTimer = null;
function showStatusMessage(msg, type = "success") {
  const el = $("statusMessage");
  if (!el) return;
  el.textContent = msg;
  el.className = "statusMessage " + type;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.className = "statusMessage";
    el.textContent = "";
  }, 4000);
}

function normalizeHost(value) {
  let host = String(value || "").trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^\*?\./, "").replace(/\.$/, "");
  return host;
}

function parseSites() {
  const parts = $("siteList").value.split(/[\n,;]+/);
  const sites = [], seen = new Set();
  for (const raw of parts) {
    const host = normalizeHost(raw);
    if (!host || host.startsWith("#")) continue;
    if (host.length > 253 || !host.includes(".")) continue;
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) continue;
    if (!seen.has(host)) {
      seen.add(host);
      sites.push(host);
    }
  }
  return sites;
}

function getMode() {
  return $("modeExclude").checked ? "exclude" : "include";
}

// Load initial state into UI
async function loadState() {
  const state = await send("GET_STATE");
  if (!state || state.ok === false) return;

  $("warpHostInput").value = state.warpHost || "127.0.0.1";
  $("warpPortInput").value = state.warpPort || 40000;
  $("warpProtocolSelect").value = state.warpProtocol || "socks5";
  $("fallbackPolicySelect").value = state.fallbackPolicy || "fail-closed";
  $("webrtcProtection").checked = Boolean(state.webrtcProtection);

  if (Array.isArray(state.sites)) {
    $("siteList").value = state.sites.join("\n");
    $("siteCountBadge").textContent = state.sites.length + " domains";
  }

  if (state.mode === "include") {
    $("modeInclude").checked = true;
  } else {
    $("modeExclude").checked = true;
  }

  if ($("tabRoutingToggle")) {
    $("tabRoutingToggle").checked = state.tabRouting !== false;
  }

  if ($("dynamicDomainsSummary")) {
    if (state.discoveredCount > 0) {
      $("dynamicDomainsSummary").textContent = "⚡ " + state.discoveredCount + " external subresource domain(s) dynamically captured & proxied in active tab sessions.";
    } else {
      $("dynamicDomainsSummary").textContent = "Subresources and third-party APIs loaded by target tabs are automatically captured and routed.";
    }
  }

  if (state.lastTestResult) {
    displayDiagResult(state.lastTestResult);
  }
}

function displayDiagResult(res) {
  const card = $("diagCard");
  const text = $("diagStatusText");
  card.style.display = "block";

  if (!res.ok) {
    card.className = "diagBox error";
    text.innerHTML = "<strong>✕ Test Failed:</strong> " + (res.error || "Cannot reach local WARP proxy.");
    return;
  }

  if (res.warpActive) {
    card.className = "diagBox success";
    text.innerHTML = "<strong>✓ WARP Connection Active:</strong> " +
      "Exit IP: <code>" + res.ip + "</code> · " +
      "Cloudflare Colocation: <code>" + res.colo + "</code> (" + res.loc + ") · " +
      "WARP Status: <code>" + res.warpStatus + "</code> · " +
      "Zero Trust Gateway: <code>" + res.gatewayStatus + "</code>";
  } else {
    card.className = "diagBox error";
    text.innerHTML = "<strong>⚠️ Reached Cloudflare, but WARP is OFF:</strong> " +
      "Traffic reached Cloudflare, but WARP reported <code>warp=off</code>. Make sure the toggle switch in the Cloudflare WARP Windows app is set to <strong>Connected</strong>.";
  }
}

// Save WARP Endpoint Configuration
$("saveWarpConfigBtn").addEventListener("click", async () => {
  const host = $("warpHostInput").value.trim() || "127.0.0.1";
  const port = Number($("warpPortInput").value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    showStatusMessage("Port must be between 1 and 65535.", "error");
    return;
  }
  const protocol = $("warpProtocolSelect").value;
  const fallback = $("fallbackPolicySelect").value;
  const webrtc = $("webrtcProtection").checked;

  const btn = $("saveWarpConfigBtn");
  btn.disabled = true;

  try {
    const res = await send("SAVE_WARP_CONFIG", {
      warpHost: host,
      warpPort: port,
      warpProtocol: protocol,
      fallbackPolicy: fallback,
      webrtcProtection: webrtc
    });

    if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Failed to save configuration.");
    showStatusMessage("WARP settings saved successfully.", "success");
  } catch (err) {
    showStatusMessage(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// Run Live Diagnostic Test
$("testWarpDiagBtn").addEventListener("click", async () => {
  const btn = $("testWarpDiagBtn");
  btn.disabled = true;
  const card = $("diagCard");
  const text = $("diagStatusText");
  card.style.display = "block";
  card.className = "diagBox";
  text.textContent = "Testing live connection to Cloudflare through local proxy…";

  try {
    const res = await send("CHECK_WARP_STATUS");
    displayDiagResult(res);
    if (res && res.ok && res.warpActive) {
      showStatusMessage("Cloudflare Zero Trust / WARP active!", "success");
    } else {
      showStatusMessage("Diagnostic check completed with warnings.", "error");
    }
  } catch (err) {
    card.className = "diagBox error";
    text.textContent = "✕ Diagnostic error: " + err.message;
    showStatusMessage(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// Save Site Rules
async function saveSiteRules() {
  const sites = parseSites();
  $("siteList").value = sites.join("\n");
  $("siteCountBadge").textContent = sites.length + " domains";

  const tabRouting = $("tabRoutingToggle") ? $("tabRoutingToggle").checked : true;
  const result = await send("SAVE_RULES", {
    sites: sites,
    mode: getMode(),
    tabRouting: tabRouting
  });

  if (result && result.ok) {
    showStatusMessage("Saved " + sites.length + " domain rules.", "success");
    $("siteStatus").textContent = "Active: " + sites.length + " domain rules applied.";
  } else {
    showStatusMessage("Could not save site rules.", "error");
  }
}

if ($("tabRoutingToggle")) {
  $("tabRoutingToggle").addEventListener("change", async () => {
    const enabled = $("tabRoutingToggle").checked;
    await send("SAVE_TAB_ROUTING", { tabRouting: enabled });
    showStatusMessage(enabled ? "Whole-Tab Tunneling enabled." : "Whole-Tab Tunneling disabled.", "success");
  });
}

$("saveSitesBtn").addEventListener("click", saveSiteRules);
$("siteList").addEventListener("change", saveSiteRules);
$("modeInclude").addEventListener("change", saveSiteRules);
$("modeExclude").addEventListener("change", saveSiteRules);

// Clear Site Rules
$("clearSitesBtn").addEventListener("click", async () => {
  $("siteList").value = "";
  $("siteCountBadge").textContent = "0 domains";
  await send("SAVE_RULES", { sites: [], mode: getMode() });
  $("siteStatus").textContent = "List cleared. 0 rules active.";
  showStatusMessage("Domain list cleared.", "normal");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.sites && Array.isArray(changes.sites.newValue)) {
      if (document.activeElement !== $("siteList")) {
        $("siteList").value = changes.sites.newValue.join("\n");
        $("siteCountBadge").textContent = changes.sites.newValue.length + " domains";
      }
    }
    if (changes.mode && typeof changes.mode.newValue === "string") {
      if (changes.mode.newValue === "include") $("modeInclude").checked = true;
      else $("modeExclude").checked = true;
    }
    if (changes.warpHost && changes.warpHost.newValue) {
      $("warpHostInput").value = changes.warpHost.newValue;
    }
    if (changes.warpPort && changes.warpPort.newValue) {
      $("warpPortInput").value = changes.warpPort.newValue;
    }
  }
});

(async function initOptions() {
  await loadState();
})();
