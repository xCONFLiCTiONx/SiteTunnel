// offscreen.js - Isolated window context for accurate system media query theme detection
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function notifyTheme(isDark) {
  try {
    chrome.runtime.sendMessage({
      type: 'THEME_CHANGED',
      isDarkMode: Boolean(isDark)
    }).catch(() => {});
  } catch (_) {}
}

mediaQuery.addEventListener('change', (e) => {
  notifyTheme(e.matches);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'CHECK_COLOR_SCHEME') {
    sendResponse({ isDarkMode: mediaQuery.matches });
    return true;
  }
});

// Notify initial state on creation
notifyTheme(mediaQuery.matches);
