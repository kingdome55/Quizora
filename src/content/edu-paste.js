(() => {
  if (window.__quizoraPasteUnlock) return;
  window.__quizoraPasteUnlock = '0.7.3';
  if (/\/exam\b/i.test(location.pathname)) return;

  const isTaskUrl = (url) => /\/api\/tasks|json\?homework_common_id/i.test(String(url || ''));

  function patchShixun(s) {
    if (!s || typeof s !== 'object') return;
    s.can_copy = true;
    s.forbid_copy = false;
    s.copy_for_exercise = true;
    s.active_copy = true;
    s.copy_for_exercise_save = true;
  }

  function patchChallenge(c) {
    if (!c || typeof c !== 'object') return;
    c.can_copy = true;
    c.forbid_copy = false;
    c.diasble_copy = false;
    c.disable_copy = false;
  }

  function walk(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return;
    if (obj.shixun && typeof obj.shixun === 'object') patchShixun(obj.shixun);
    if (obj.challenge && typeof obj.challenge === 'object') patchChallenge(obj.challenge);
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') walk(value, depth + 1);
    }
  }

  function unlockJson(json) {
    try {
      walk(json);
      if (json && typeof json === 'object' && ('forbid_copy' in json || 'can_copy' in json)) patchShixun(json);
    } catch {}
    return json;
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function (...args) {
      const response = await nativeFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (!isTaskUrl(url)) return response;
        const type = response.headers.get('content-type') || '';
        if (!/json/i.test(type)) return response;
        const clone = response.clone();
        const json = await clone.json();
        unlockJson(json);
        return new Response(JSON.stringify(json), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch {
        return response;
      }
    };
  }

  function allowPaste(root = document) {
    try {
      document.onpaste = null;
      for (const el of root.querySelectorAll(
        'input, textarea, [contenteditable], .monaco-editor, .cm-editor, .ace_editor, .CodeMirror'
      )) {
        el.onpaste = null;
        try {
          el.style.userSelect = 'text';
          el.style.webkitUserSelect = 'text';
        } catch {}
      }
    } catch {}
  }

  function injectStyle() {
    try {
      const style = document.createElement('style');
      style.textContent =
        'input,textarea,[contenteditable],.monaco-editor,.cm-editor,.ace_editor,.CodeMirror{user-select:text!important;-webkit-user-select:text!important}';
      (document.head || document.documentElement).appendChild(style);
    } catch {}
  }

  function boot() {
    injectStyle();
    allowPaste();
    try {
      new MutationObserver(() => allowPaste()).observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    } catch {}
    let ticks = 0;
    const timer = setInterval(() => {
      allowPaste();
      ticks += 1;
      if (ticks > 12) clearInterval(timer);
    }, 500);
  }

  if (document.documentElement) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
  console.info('[题灵] 头歌粘贴限制已解除（0.7.3）');
})();
