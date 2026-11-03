(() => {
  if (window.__quizoraPasteUnlock) return;
  window.__quizoraPasteUnlock = '0.7.16';
  if (/\/exam\b/i.test(location.pathname)) return;

  const AK = 'e9dd5b4322f9f7d83d009de9bfa100c3';
  const SK = '2e3da06ae26ba9f76a5d8d355746f2fe';
  const TASK_API_RE = /\/api\/tasks\/([^/?#]+)\.json/i;
  const isTaskUrl = (url) => /\/api\/tasks|json\?homework_common_id/i.test(String(url || ''));
  const md5Fn = typeof window.md5 === 'function' ? window.md5 : null;

  function cookieValue(name) {
    try {
      const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return m ? decodeURIComponent(m[1]) : '';
    } catch {
      return '';
    }
  }

  function taskIdFromPath() {
    try {
      const m = location.pathname.match(/\/tasks\/(?:[^/]+\/)*([^/?#]+)\/?$/);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  function rememberTask(id, homeworkId) {
    try {
      if (id) {
        window.__quizoraEduTaskId = String(id);
        sessionStorage.setItem('quizora_edu_task_id', String(id));
      }
      if (homeworkId) {
        window.__quizoraEduHomeworkId = String(homeworkId);
        sessionStorage.setItem('quizora_edu_homework_id', String(homeworkId));
      }
    } catch {}
  }

  function currentTaskId() {
    const pathId = taskIdFromPath();
    if (pathId) return pathId;
    return (
      window.__quizoraEduTaskId ||
      (() => {
        try {
          return sessionStorage.getItem('quizora_edu_task_id') || '';
        } catch {
          return '';
        }
      })()
    );
  }

  function currentHomeworkId() {
    return (
      window.__quizoraEduHomeworkId ||
      (() => {
        try {
          return sessionStorage.getItem('quizora_edu_homework_id') || '';
        } catch {
          return '';
        }
      })()
    );
  }

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

  function findTaskDetail(json, depth = 0) {
    if (!json || typeof json !== 'object' || depth > 4) return null;
    if (json.game && json.challenge && json.shixun) return json;
    for (const value of Object.values(json)) {
      if (value && typeof value === 'object') {
        const found = findTaskDetail(value, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function patchTaskView(json) {
    const detail = findTaskDetail(json);
    if (!detail) return false;
    detail.has_answer = true;
    detail.view_answer_tip = false;
    patchGame(detail.game);
    patchChallenge(detail.challenge);
    patchShixun(detail.shixun);
    if (json && typeof json === 'object') {
      json.has_answer = true;
      json.view_answer_tip = false;
    }
    rememberTask(detail.game?.identifier, detail.homework_common_id || detail.game?.homework_common_id);
    return true;
  }

  let announced = false;
  function notifyUnlocked() {
    if (announced) return;
    announced = true;
    try {
      window.postMessage({ source: 'quizora-edu', type: 'VIEW_UNLOCKED', version: '0.7.16' }, '*');
    } catch {}
    console.info('[题灵] 头歌查看限制已解除（含参考答案入口，0.7.16）');
  }

  function decodeEntities(value) {
    try {
      const ta = document.createElement('textarea');
      ta.innerHTML = value;
      if (ta.value) return ta.value;
    } catch {}
    return String(value)
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
  }

  function answerToCode(value) {
    let s = String(value || '');
    if (!s.trim()) return '';
    const fenced = [...s.matchAll(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
    if (fenced.length) return fenced.join('\n\n').trim();
    if (!/<[a-z][\s\S]*>/i.test(s)) {
      return s.replace(/^\s*```[a-zA-Z0-9_-]*\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '').trim();
    }
    try {
      const blocks = [...s.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => m[1]);
      if (blocks.length) {
        s = blocks
          .map((b) => b.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
          .join('\n\n');
      } else {
        s = s
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|li|tr|blockquote|h[1-6])>/gi, '\n')
          .replace(/<[^>]+>/g, '');
      }
      s = decodeEntities(s);
    } catch {}
    return s
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/^\s*```[a-zA-Z0-9_-]*\s*\n?/i, '')
      .replace(/\n?\s*```\s*$/i, '')
      .trim();
  }

  function captureAnswerInfo(url, json) {
    if (!/get_answer_info\.json/i.test(url)) return;
    try {
      const message = json?.message;
      const entries = Array.isArray(message) ? message : message && typeof message === 'object' ? [message] : [];
      if (!entries.length) return;
      const slim = entries.map((e) => ({
        answer_id: e?.answer_id,
        answer_name: String(e?.answer_name || ''),
        answer_score: e?.answer_score,
        answer_ratio: e?.answer_ratio,
        answer_contents: String(e?.answer_contents || e?.contents || e?.content || '')
      }));
      window.__quizoraEduAnswerInfo = { ts: Date.now(), status: json?.status, entries: slim };
      try {
        window.postMessage(
          { source: 'quizora-edu', type: 'ANSWER_INFO', payload: { status: json?.status, entries: slim } },
          '*'
        );
      } catch {}
    } catch {}
  }

  function noteAnswerApi(url, json) {
    if (
      !/\/api\/tasks\/[^/]+\/(get_answer_info|unlock_answer|get_choose_answer|unlock_choose_answer|check_test_sets)\.json/i.test(
        url
      )
    ) {
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

  function processJson(url, json) {
    let taskUnlocked = false;
    try {
      taskUnlocked = patchTaskView(json);
      walk(json);
      if (json && typeof json === 'object' && ('forbid_copy' in json || 'can_copy' in json)) patchShixun(json);
    } catch {}
    noteAnswerApi(url, json);
    captureAnswerInfo(url, json);
    if (taskUnlocked) notifyUnlocked();
    return json;
  }

  function captureFetchHeaders(args) {
    try {
      const source = args[0]?.headers || args[1]?.headers;
      if (!source) return;
      const get = (name) => {
        try {
          return typeof source.get === 'function' ? source.get(name) : source[name] || source[name.toLowerCase()];
        } catch {
          return '';
        }
      };
      const auth = get('Pc-Authorization');
      if (auth) window.__quizoraEduAuth = String(auth);
      const type = get('X-EDU-Type');
      if (type) window.__quizoraEduType = String(type);
    } catch {}
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function (...args) {
      captureFetchHeaders(args);
      const response = await nativeFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (!isTaskUrl(url)) return response;
        const type = response.headers.get('content-type') || '';
        if (!/json/i.test(type)) return response;
        const clone = response.clone();
        const json = await clone.json();
        processJson(url, json);
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

  function captureTaskId(url) {
    const m = String(url || '').match(TASK_API_RE);
    if (m) rememberTask(m[1]);
  }

  function hookXhr() {
    const XHR = window.XMLHttpRequest;
    if (!XHR || XHR.prototype.__quizoraHooked) return;
    const proto = XHR.prototype;
    proto.__quizoraHooked = true;
    const nativeOpen = proto.open;
    const nativeSend = proto.send;
    const nativeSetHeader = proto.setRequestHeader;
    const textDesc = Object.getOwnPropertyDescriptor(proto, 'responseText');
    const responseDesc = Object.getOwnPropertyDescriptor(proto, 'response');

    function defineInstanceGetters(xhr) {
      if (xhr.__quizoraGetters) return;
      xhr.__quizoraGetters = true;
      try {
        if (textDesc?.get) {
          Object.defineProperty(xhr, 'responseText', {
            configurable: true,
            get() {
              if (this.readyState === 4) {
                try {
                  patchXhr(this);
                } catch {}
              }
              if (this.__quizoraText != null) return this.__quizoraText;
              return textDesc.get.call(this);
            }
          });
        }
      } catch {}
      try {
        if (responseDesc?.get) {
          Object.defineProperty(xhr, 'response', {
            configurable: true,
            get() {
              if (this.readyState === 4) {
                try {
                  patchXhr(this);
                } catch {}
              }
              if (this.__quizoraJson != null) return this.__quizoraJson;
              if (this.__quizoraResponseWasString) return this.__quizoraText;
              return responseDesc.get.call(this);
            }
          });
        }
      } catch {}
    }

    proto.open = function (method, url, ...rest) {
      try {
        this.__quizoraMethod = String(method || '').toUpperCase();
        this.__quizoraUrl = String(url || '');
        captureTaskId(this.__quizoraUrl);
        defineInstanceGetters(this);
      } catch {}
      return nativeOpen.call(this, method, url, ...rest);
    };

    proto.setRequestHeader = function (name, value) {
      try {
        const key = String(name || '');
        if (/^(Pc-Authorization|X-EDU-)/i.test(key)) {
          this.__quizoraHeaders = this.__quizoraHeaders || {};
          this.__quizoraHeaders[key] = String(value);
          if (/^pc-authorization$/i.test(key)) window.__quizoraEduAuth = String(value);
          if (/^x-edu-type$/i.test(key)) window.__quizoraEduType = String(value);
        }
      } catch {}
      return nativeSetHeader.call(this, name, value);
    };

    function patchXhr(xhr) {
      if (!xhr || xhr.__quizoraPatched) return;
      xhr.__quizoraPatched = true;
      const url = xhr.__quizoraUrl || '';
      if (!isTaskUrl(url)) return;
      let textValue = null;
      let nativeObj = null;
      try {
        const text = textDesc?.get ? textDesc.get.call(xhr) : xhr.responseText;
        if (typeof text === 'string' && text) textValue = text;
      } catch {}
      try {
        const obj = responseDesc?.get ? responseDesc.get.call(xhr) : xhr.response;
        if (obj && typeof obj === 'object') nativeObj = obj;
        else if (typeof obj === 'string' && !textValue) textValue = obj;
      } catch {}
      let json = nativeObj;
      if (!json && textValue) {
        try {
          json = JSON.parse(textValue);
        } catch {}
      }
      if (!json) return;
      processJson(url, json);
      try {
        xhr.__quizoraText = JSON.stringify(json);
      } catch {}
      xhr.__quizoraJson = nativeObj ? json : null;
      xhr.__quizoraResponseWasString = Boolean(textValue) && !nativeObj;
      try {
        if (xhr.__quizoraHeaders) window.__quizoraEduHeaders = { ...xhr.__quizoraHeaders };
      } catch {}
    }

    proto.send = function (...args) {
      try {
        this.addEventListener('readystatechange', () => {
          if (this.readyState === 4) {
            try {
              patchXhr(this);
            } catch {}
          }
        });
      } catch {}
      return nativeSend.apply(this, args);
    };

    try {
      if (textDesc?.get) {
        Object.defineProperty(proto, 'responseText', {
          configurable: true,
          enumerable: textDesc.enumerable,
          get() {
            if (this.readyState === 4) {
              try {
                patchXhr(this);
              } catch {}
            }
            if (this.__quizoraText != null) return this.__quizoraText;
            return textDesc.get.call(this);
          }
        });
      }
    } catch {}

    try {
      if (responseDesc?.get) {
        Object.defineProperty(proto, 'response', {
          configurable: true,
          enumerable: responseDesc.enumerable,
          get() {
            if (this.readyState === 4) {
              try {
                patchXhr(this);
              } catch {}
            }
            if (this.__quizoraJson != null) return this.__quizoraJson;
            return responseDesc.get.call(this);
          }
        });
      }
    } catch {}
  }

  function uuid() {
    try {
      if (crypto?.randomUUID) return crypto.randomUUID();
    } catch {}
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function signature(method, timeMs) {
    if (!md5Fn) throw new Error('MD5 未加载');
    const raw = `method=${String(method).toUpperCase()}&ak=${AK}&sk=${SK}&time=${timeMs}`;
    return md5Fn(btoa(raw));
  }

  let clockOffset = null;
  async function serverNow(force = false) {
    if (!force && clockOffset !== null) return Date.now() + clockOffset;
    try {
      const res = await nativeFetch('https://www.educoder.net/', {
        method: 'HEAD',
        credentials: 'include',
        cache: 'no-store'
      });
      const date = res.headers.get('date');
      clockOffset = date ? new Date(date).getTime() - Date.now() : 0;
    } catch {
      clockOffset = 0;
    }
    return Date.now() + clockOffset;
  }

  function eduHeaders(method, time) {
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'X-EDU-Type': window.__quizoraEduType || 'pc',
      'X-EDU-Timestamp': String(time),
      'X-EDU-Signature': signature(method, time),
      'X-Original-Protocol': 'https:',
      'X-Original-Host': 'www.educoder.net',
      'X-Original-Origin': 'https://www.educoder.net',
      'X-Request-Id': uuid()
    };
    const auth = window.__quizoraEduAuth || cookieValue('_educoder_session');
    if (auth) headers['Pc-Authorization'] = auth;
    return headers;
  }

  async function eduApiGet(taskId, suffix, params = {}) {
    if (!taskId) return { ok: false, error: '未获取到任务 ID' };
    const url = new URL(`https://data.educoder.net/api/tasks/${encodeURIComponent(taskId)}${suffix}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    let last = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const time = await serverNow(attempt > 0);
        const res = await nativeFetch(url.href, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: eduHeaders('GET', time)
        });
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        if (json?.status === -102) {
          clockOffset = null;
          last = { ok: false, error: '服务器时间不匹配' };
          continue;
        }
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        if (!json) return { ok: false, error: '返回不是 JSON' };
        return { ok: true, json };
      } catch (e) {
        last = { ok: false, error: String(e?.message || e) };
      }
    }
    return last || { ok: false, error: '请求失败' };
  }

  async function getReferenceAnswer() {
    const taskId = currentTaskId();
    const costTime = (() => {
      try {
        return Number(localStorage.getItem('taskBuildTimes') || 0) || 0;
      } catch {
        return 0;
      }
    })();
    const out = await eduApiGet(taskId, '/get_answer_info.json', {
      homework_common_id: currentHomeworkId() || undefined,
      cost_time: costTime
    });
    if (!out.ok) return out;
    const json = out.json;
    const message = json?.message;
    const entries = Array.isArray(message) ? message : message && typeof message === 'object' ? [message] : [];
    const withContent = entries
      .map((e) => ({
        id: e?.answer_id,
        name: String(e?.answer_name || ''),
        score: e?.answer_score,
        raw: String(e?.answer_contents || e?.contents || e?.content || '')
      }))
      .filter((e) => e.raw.trim());
    if (withContent.length) {
      const best = withContent.slice().sort((a, b) => b.raw.length - a.raw.length)[0];
      const code = answerToCode(best.raw);
      if (code) return { ok: true, code, name: best.name, status: json?.status, entries: withContent.length };
      return { ok: false, error: '参考答案正文为空' };
    }
    const locked = entries.find((e) => e && (e.answer_id !== undefined || e.answer_score !== undefined));
    if (locked) {
      const cost = typeof locked.answer_score === 'number' ? `（需 ${locked.answer_score} 金币）` : '';
      return {
        ok: false,
        locked: true,
        answerId: locked.answer_id,
        score: locked.answer_score,
        status: json?.status,
        error: `参考答案未解锁${cost}`
      };
    }
    return { ok: false, error: `未返回参考答案（status=${json?.status ?? '?'}）` };
  }

  async function unlockReferenceAnswer(answerId) {
    if (!answerId) return { ok: false, error: '缺少 answer_id' };
    const out = await eduApiGet(currentTaskId(), '/unlock_answer.json', { answer_id: answerId });
    if (!out.ok) return out;
    const content = out.json?.contents || out.json?.content || out.json?.message?.contents || '';
    const code = answerToCode(content);
    if (!code) return { ok: false, error: `解锁未返回正文（status=${out.json?.status ?? '?'}）` };
    return { ok: true, code, status: out.json?.status };
  }

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.source !== 'quizora-edu') return;
    if (data.type === 'REFERENCE_REQUEST') {
      let result;
      try {
        result = await getReferenceAnswer();
      } catch (e) {
        result = { ok: false, error: String(e?.message || e) };
      }
      try {
        window.postMessage({ source: 'quizora-edu', type: 'REFERENCE_RESULT', requestId: data.requestId, ...result }, '*');
      } catch {}
    }
    if (data.type === 'REFERENCE_UNLOCK_REQUEST') {
      let result;
      try {
        result = await unlockReferenceAnswer(data.answerId);
      } catch (e) {
        result = { ok: false, error: String(e?.message || e) };
      }
      try {
        window.postMessage({ source: 'quizora-edu', type: 'REFERENCE_RESULT', requestId: data.requestId, ...result }, '*');
      } catch {}
    }
  });

  hookXhr();

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
  console.info('[题灵] 头歌粘贴/查看限制已解除（0.7.16）');
})();
