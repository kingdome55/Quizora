(() => {
  if (window.top !== window) return;
  if (/\/exam\b/i.test(location.pathname)) return;
  try {
    chrome.runtime.sendMessage({ type: 'EDU_PASTE_READY', url: location.href });
  } catch {}
})();
