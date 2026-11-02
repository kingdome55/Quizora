(() => {
  if (window.top !== window) return;
  if (/\/exam\b/i.test(location.pathname)) return;

  const BADGE_ID = '__wg_edu_badge';
  function ensureBadge() {
    if (document.getElementById(BADGE_ID)) return;
    const el = document.createElement('div');
    el.id = BADGE_ID;
    el.style.cssText =
      'position:fixed;right:16px;top:72px;z-index:2147483646;padding:8px 12px;border-radius:12px;' +
      'background:rgba(18,14,30,.92);border:1px solid rgba(139,92,246,.55);color:#e9e6ff;' +
      'font:12px/1.5 "Microsoft YaHei",sans-serif;box-shadow:0 8px 22px rgba(0,0,0,.35);' +
      'pointer-events:none;max-width:340px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)';
    el.innerHTML =
      '<div style="font-weight:600;color:#fff">题灵 · 头歌（EduCoder）</div>' +
      '<div style="font-size:11px;color:#b9b3d4;margin-top:2px">粘贴已解锁 · 自动答题可用（实验）</div>';
    (document.body || document.documentElement).appendChild(el);
  }

  if (document.body) ensureBadge();
  else document.addEventListener('DOMContentLoaded', ensureBadge, { once: true });
  try {
    new MutationObserver(() => {
      if (!document.getElementById(BADGE_ID)) ensureBadge();
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch {}

  try {
    chrome.runtime.sendMessage({ type: 'EDU_PASTE_READY', url: location.href });
  } catch {}
})();
