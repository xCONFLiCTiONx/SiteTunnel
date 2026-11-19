// renderIcon.js - Adaptive extension icon theme handler
function renderIcon() {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function updateTheme() {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) {
      mediaQuery.removeEventListener("change", updateTheme);
      return;
    }

    const isDarkMode = mediaQuery.matches;

    try {
      chrome.runtime.sendMessage({ action: "updateIcon", type: "UPDATE_THEME_ICON", isDarkMode }, () => {
        if (chrome.runtime.lastError) {
          // Handled to suppress unchecked runtime.lastError
        }
      });
    } catch (e) {
      mediaQuery.removeEventListener("change", updateTheme);
    }
  }

  updateTheme();
  mediaQuery.removeEventListener("change", updateTheme);
  mediaQuery.addEventListener("change", updateTheme);
}

globalThis.renderIcon = renderIcon;
renderIcon();
