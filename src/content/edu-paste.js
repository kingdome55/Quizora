(() => {
  if (window.__quizoraPasteUnlock) return;
  window.__quizoraPasteUnlock = '0.7.7';
  if (/\/exam\b/i.test(location.pathname)) return;

  const isTaskUrl = (url) => /\/api\/tasks|json\?homework_common_id/i.test(String(url || ''));

  function patchShixun(s) {
    if (!s || typeof s !== 'object') return;
    s.can_copy = true;
    s.forbid_copy = false;
    s.copy_for_exercise = true;
    s.active_copy = true;
    s.copy_for_exercise_save = true;
    // 查看入口类字段：参考答案、评论、测试集、代码目录、Git 地址
    s.is_disable_discuss = false;
    s.test_set_permission = true;
    s.open_answer_and_test = 1;
    s.show_code_dir = true;
    s.display_git_address = true;
    if ('hide_code' in s) s.hide_code = 0;
  }

  function patchChallenge(c) {
    if (!c || typeof c !== 'object') return;
    c.can_copy = true;
    c.forbid_copy = false;
    c.diasble_copy = false;
    c.disable_copy = false;
    c.hide_answer = false;
  }

  function patchGame(g) {
    if (!g || typeof g !== 'object') return;
    g.homework_common_answer_open = false;
    g.homework_common_comment_open = false;
    g.answer_open = 1;
  }

  function isTaskDetail(json) {
    return !!json && typeof json === 'object' && json.game && json.challenge && json.shixun;
  }

  function patchTaskView(json) {
    if (!isTaskDetail(json)) return false;
    json.has_answer = true;
    json.view_answer_tip = false;
    patchGame(json.game);
    patchChallenge(json.challenge);
    patchShixun(json.shixun);
    return true;
  }

  let announced = false;
  function notifyUnlocked() {
    if (announced) return;
    announced = true;
    try {
      window.postMessage({ source: 'quizora-edu', type: 'VIEW_UNLOCKED', version: '0.7.7' }, '*');
    } catch {}
    console.info('[题灵] 头歌查看限制已解除（含参考答案入口，0.7.7）');
  }

  function noteAnswerApi(url, json) {
    if (!/\/api\/tasks\/[^/]+\/(get_answer_info|unlock_answer|get_choose_answer|unlock_choose_answer|check_test_sets)\.json/i.test(url)) {
      return;
    }
    try {
      const message = json?.message;
      const entries = Array.isArray(message) ? message : message && typeof message === 'object' ? [message] : [];
      const hasContent = entries.some((e) => e && (e.answer_contents || e.contents || e.content));
      const costs = entries.map((e) => e?.answer_score).filter((n) => typeof n === 'number');
      console.info(
        `[题灵] 头歌查看接口 ${url.split('?')[0]} status=${json?.status} entries=${entries.length} content=${hasContent} cost=${costs.join(',') || '-'}`
      );
    } catch {}
  }

  function walk(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return;
    if (obj.shixun && typeof obj.shixun === 'object') patchShixun(obj.shixun);
    if (obj.challenge && typeof obj.challenge === 'object') patchChallenge(obj.challenge);
    if (obj.game && typeof obj.game === 'object' && (obj.challenge || obj.shixun)) patchGame(obj.game);
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') walk(value, depth + 1);
    }
  }

  function unlockJson(json) {
    let taskUnlocked = false;
    try {
      taskUnlocked = patchTaskView(json);
      walk(json);
      if (json && typeof json === 'object' && ('forbid_copy' in json || 'can_copy' in json)) patchShixun(json);
    } catch {}
    if (taskUnlocked) notifyUnlocked();
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
        noteAnswerApi(url, json);
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
  console.info('[题灵] 头歌粘贴/查看限制已解除（0.7.7）');
})();
