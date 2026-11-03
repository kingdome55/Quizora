(() => {
  if (window.top !== window) return;
  if (/\/exam\b/i.test(location.pathname)) return;

  const BADGE_ID = '__wg_edu_badge';
  let viewUnlocked = false;

  function badgeHtml(detail) {
    return (
      '<div style="font-weight:600;color:#fff">题灵 · 头歌（EduCoder）</div>' +
      `<div style="font-size:11px;color:#b9b3d4;margin-top:2px">${detail}</div>`
    );
  }

  function detailText() {
    return viewUnlocked ? '粘贴/查看限制已解除 · 参考答案入口已显示' : '粘贴已解锁 · 自动答题可用（实验）';
  }

  function renderBadge(el) {
    el.innerHTML = badgeHtml(detailText());
  }

  function ensureBadge() {
    const existing = document.getElementById(BADGE_ID);
    if (existing) {
      renderBadge(existing);
      return;
    }
    const el = document.createElement('div');
    el.id = BADGE_ID;
    el.style.cssText =
      'position:fixed;right:16px;top:72px;z-index:2147483646;padding:8px 12px;border-radius:12px;' +
      'background:rgba(18,14,30,.92);border:1px solid rgba(139,92,246,.55);color:#e9e6ff;' +
      'font:12px/1.5 "Microsoft YaHei",sans-serif;box-shadow:0 8px 22px rgba(0,0,0,.35);' +
      'pointer-events:none;max-width:360px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)';
    renderBadge(el);
    (document.body || document.documentElement).appendChild(el);
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'quizora-edu' || data.type !== 'VIEW_UNLOCKED') return;
    viewUnlocked = true;
    const el = document.getElementById(BADGE_ID);
    if (el) renderBadge(el);
    try {
      chrome.runtime.sendMessage({ type: 'EDU_VIEW_UNLOCKED', url: location.href });
    } catch {}
  });

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
