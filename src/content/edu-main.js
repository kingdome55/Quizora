(() => {
  if (window.__wg?.eduMain) return;
  const NS = (window.__wg = window.__wg || {});
  const A = NS.eduAdapter;
  const H = NS.hud;

  let settings = {};
  let running = false;
  let token = 0;
  let passed = 0;
  let lastReport = '';
  const sleep = A.sleep;
  const referenceWaiters = new Map();
  const ANSWER_CACHE_KEY = 'quizora_edu_answer_cache_v1';

  function readCachedAnswer() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(ANSWER_CACHE_KEY) || 'null');
      if (cached && cached.path === location.pathname && cached.code) return String(cached.code).trim();
    } catch {}
    return '';
  }

  function cacheAnswer(code) {
    const text = String(code || '').trim();
    if (!text) return;
    try {
      sessionStorage.setItem(ANSWER_CACHE_KEY, JSON.stringify({ path: location.pathname, code: text, ts: Date.now() }));
    } catch {}
  }

  function watchVisibleAnswer() {
    const capture = () => {
      try {
        const code = A.readVisibleAnswer?.();
        if (code) cacheAnswer(code);
      } catch {}
    };
    capture();
    try {
      new MutationObserver(capture).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    } catch {}
    setInterval(capture, 2500);
  }

  function send(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.then === 'function') return p.catch((e) => ({ ok: false, error: String(e) }));
      return Promise.resolve({ ok: false, error: '扩展未响应' });
    } catch (e) {
      return Promise.resolve({ ok: false, error: String(e) });
    }
  }

  function log(level, text) {
    send({ type: 'WG_LOG', level, text });
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'quizora-edu') return;
    if (data.type !== 'REFERENCE_RESULT' || !data.requestId) return;
    const resolve = referenceWaiters.get(data.requestId);
    if (!resolve) return;
    referenceWaiters.delete(data.requestId);
    resolve(data);
  });

  function requestReference(timeout = 12000) {
    return new Promise((resolve) => {
      const requestId = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      referenceWaiters.set(requestId, resolve);
      try {
        window.postMessage({ source: 'quizora-edu', type: 'REFERENCE_REQUEST', requestId }, '*');
      } catch {
        referenceWaiters.delete(requestId);
        resolve({ ok: false, error: '无法发送参考答案请求' });
        return;
      }
      setTimeout(() => {
        if (!referenceWaiters.has(requestId)) return;
        referenceWaiters.delete(requestId);
        resolve({ ok: false, error: '参考答案请求超时' });
      }, timeout);
    });
  }

  function requestUnlock(answerId, timeout = 15000) {
    return new Promise((resolve) => {
      const requestId = `unlock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      referenceWaiters.set(requestId, resolve);
      try {
        window.postMessage(
          { source: 'quizora-edu', type: 'REFERENCE_UNLOCK_REQUEST', requestId, answerId },
          '*'
        );
      } catch {
        referenceWaiters.delete(requestId);
        resolve({ ok: false, error: '无法发送解锁请求' });
        return;
      }
      setTimeout(() => {
        if (!referenceWaiters.has(requestId)) return;
        referenceWaiters.delete(requestId);
        resolve({ ok: false, error: '参考答案解锁超时' });
      }, timeout);
    });
  }

  function setBadge(active) {
    try {
      window.dispatchEvent(new CustomEvent('quizora-edu-badge', { detail: { active: Boolean(active) } }));
    } catch {}
  }

  function report(status, detail, tone = 'work') {
    const shown = detail ? `头歌 · ${detail}` : '头歌';
    const key = `${status}|${shown}|${tone}`;
    if (key === lastReport) return;
    lastReport = key;
    H?.set({ status, detail: shown, tone });
    send({ type: 'WG_STATE', state: { status, detail: shown, question: passed + 1, tone } });
  }

  function saveRun() {
    try {
      sessionStorage.setItem('wg_edu_run', JSON.stringify({ settings, passed }));
    } catch {}
  }

  function clearRun() {
    try {
      sessionStorage.removeItem('wg_edu_run');
    } catch {}
  }

  function stop(reason) {
    running = false;
    token += 1;
    clearRun();
    setBadge(false);
    const shown = reason ? `头歌 · ${reason}` : '头歌';
    H?.set({ status: '已停止', detail: shown, tone: 'idle' });
    send({ type: 'WG_STATE', state: { status: '已停止', detail: shown, tone: 'idle' } });
    send({ type: 'WG_STOPPED', reason: 'stop' });
    log('warn', `停止：${reason || ''}`);
  }

  function stopWith(status, detail, tone, reason = 'failed') {
    running = false;
    token += 1;
    clearRun();
    setBadge(false);
    const shown = `头歌 · ${detail}`;
    H?.set({ status, detail: shown, tone });
    send({ type: 'WG_STATE', state: { status, detail: shown, question: passed, tone } });
    send({ type: 'WG_STOPPED', reason });
    log(tone === 'error' ? 'error' : 'warn', `${status}：${shown}`);
  }

  function finish(detail) {
    running = false;
    token += 1;
    clearRun();
    setBadge(false);
    const shown = `头歌 · ${detail}`;
    H?.set({ status: '已完成', detail: shown, tone: 'ok' });
    send({ type: 'WG_STATE', state: { status: '已完成', detail: shown, question: passed, total: passed, tone: 'ok' } });
    send({ type: 'WG_STOPPED', reason: 'done' });
    log('ok', shown);
  }

  let editorFrameId = null;
  let editorType = '';

  function scanRoots() {
    const roots = [];
    const docs = [document];
    const visitDoc = (doc) => {
      try {
        for (const f of doc.querySelectorAll('iframe')) {
          try {
            const d = f.contentDocument;
            if (d) {
              docs.push(d);
              visitDoc(d);
            }
          } catch {}
        }
      } catch {}
    };
    visitDoc(document);
    for (const doc of docs) {
      roots.push(doc);
      const visitShadow = (root) => {
        try {
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) {
              roots.push(el.shadowRoot);
              visitShadow(el.shadowRoot);
            }
          }
        } catch {}
      };
      visitShadow(doc);
    }
    return roots;
  }

  function pickEditor(selector) {
    let best = null;
    for (const root of scanRoots()) {
      let nodes = [];
      try {
        nodes = [...root.querySelectorAll(selector)];
      } catch {
        continue;
      }
      for (const el of nodes) {
        let rect;
        try {
          rect = el.getBoundingClientRect();
        } catch {
          continue;
        }
        if (rect.width < 120 || rect.height < 50) continue;
        const area = rect.width * rect.height;
        if (!best || area > best.area) best = { el, area };
      }
    }
    return best?.el || null;
  }

  function readEditor(type, el) {
    const valueEl =
      type === 'dom-cm6'
        ? el.querySelector('.cm-content')
        : type === 'dom-monaco'
          ? el.querySelector('.view-lines')
          : type === 'dom-ace'
            ? el.querySelector('.ace_content')
            : type === 'dom-cm5'
              ? el.querySelector('.CodeMirror-code')
              : el;
    return String(valueEl?.innerText || valueEl?.value || valueEl?.textContent || '');
  }

  function domFind() {
    const tries = [
      ['.monaco-editor', 'dom-monaco'],
      ['.cm-editor', 'dom-cm6'],
      ['.ace_editor', 'dom-ace'],
      ['.CodeMirror', 'dom-cm5'],
      ['textarea', 'dom-textarea'],
      ['[contenteditable="true"]', 'dom-editable']
    ];
    for (const [selector, type] of tries) {
      const el = pickEditor(selector);
      if (!el) continue;
      const value = readEditor(type, el);
      return { ok: true, url: location.href, editor: { type, id: type, language: '', value, length: value.length, visible: true } };
    }
    return { ok: false, error: '当前 frame 未找到编辑器' };
  }

  async function domSet(type, code) {
    const selector = {
      'dom-monaco': '.monaco-editor',
      'dom-cm6': '.cm-editor',
      'dom-ace': '.ace_editor',
      'dom-cm5': '.CodeMirror',
      'dom-textarea': 'textarea',
      'dom-editable': '[contenteditable="true"]'
    }[type];
    if (!selector) return { ok: false, error: `未知的 DOM 编辑器类型：${type}` };
    const el = pickEditor(selector);
    if (!el) return { ok: false, error: '未找到编辑器容器' };
    const target =
      type === 'dom-monaco'
        ? el.querySelector('textarea.inputarea') || el.querySelector('.view-lines') || el
        : type === 'dom-cm6'
          ? el.querySelector('.cm-content') || el
          : type === 'dom-ace'
            ? el.querySelector('.ace_text-input') || el.querySelector('.ace_content') || el
            : type === 'dom-cm5'
              ? el.querySelector('textarea') || el.querySelector('.CodeMirror-code') || el
              : el;
    const doc = target.ownerDocument || document;
    try {
      target.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {}
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try {
        target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: doc.defaultView || window }));
      } catch {}
    }
    try {
      target.focus();
    } catch {}
    await sleep(120);
    try {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true })
      );
      target.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true })
      );
    } catch {}
    const before = readEditor(type, el);
    try {
      doc.execCommand('selectAll', false, null);
    } catch {}
    let inserted = false;
    try {
      inserted = doc.execCommand('insertText', false, code);
    } catch {}
    await sleep(220);
    let value = readEditor(type, el);
    let changed = value !== before;

    // 只有确认没写进去时才走合成 paste，避免同一次写入出现两份
    if (!changed) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', code);
        target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch {}
      await sleep(220);
      value = readEditor(type, el);
      changed = value !== before;
    }

    // textarea 兜底同样只在没有变化时执行，避免 insertText + setter 重复写入
    const active = doc.activeElement;
    if (!changed && active && active.tagName === 'TEXTAREA') {
      try {
        const win = active.ownerDocument.defaultView || window;
        const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(active, code);
        else active.value = code;
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
        inserted = true;
      } catch {}
      await sleep(160);
      value = readEditor(type, el);
      changed = value !== before;
    }

    return {
      ok: changed && value.length > 0,
      length: value.length,
      beforeLength: before.length,
      inserted: changed,
      active: active ? `${active.tagName}.${String(active.className || '')}` : ''
    };
  }

  async function findEditor(tk, timeout = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!running || tk !== token) return null;
      const res = await send({ type: 'EDU_FIND_EDITOR' });
      if (res?.ok && res.editor) {
        editorFrameId = res.editor.frameId;
        editorType = res.editor.type;
        log(
          'info',
          `编辑器：${editorType} · frame#${editorFrameId} · ${res.editor.language || '未知语言'} · 模板 ${res.editor.value?.length || 0} 字符${res.editor.visible === false ? ' · 隐藏模型' : ''}`
        );
        if (res.editor.visible === false) log('warn', '选中的编辑器模型不可见，可能写到隐藏位置');
        if (res.editors?.length > 1) {
          log('info', `可选编辑器：${res.editors.map((e) => `${e.type}@#${e.frameId}`).join('，')}`);
        }
        return res.editor;
      }
      await sleep(800);
    }
    return null;
  }

  function mergeWithTemplate(template, code) {
    const tpl = String(template || '');
    let src = String(code || '').trim();
    if (!src) return src;
    const codeHasMarkers = /#代码开始/.test(src) && /#代码结束/.test(src);
    if (codeHasMarkers) return src;
    const starts = [...tpl.matchAll(/#代码开始[^\n]*/g)].map((m) => m.index);
    const ends = [...tpl.matchAll(/#代码结束/g)].map((m) => m.index);
    if (!starts.length || !ends.length || ends[ends.length - 1] < starts[0]) {
      return src.replace(/^\s*use\s+library\s*;\s*/i, '').trim();
    }
    const tplStart = starts[0];
    const tplEnd = ends[ends.length - 1];
    const startLineEnd = tpl.indexOf('\n', tplStart);
    const prefix = startLineEnd >= 0 ? tpl.slice(0, startLineEnd + 1) : `${tpl.slice(0, tplStart)}#代码开始\n`;
    const suffix = tpl.slice(tplEnd);
    const body = src.replace(/^\s*use\s+library\s*;\s*/i, '').trim();
    return `${prefix}${body}\n${suffix}`.replace(/\n{3,}/g, '\n\n');
  }

  function evalBaseline() {
    const next = A.findLike(/^(下一关|下一题|继续|进入下一关)$/);
    const r = A.readResult();
    return {
      text: r.text || '',
      nextFound: Boolean(next),
      nextDisabled: next ? A.isDisabled(next) : false
    };
  }

  async function waitResult(tk, before) {
    const start = Date.now();
    let started = false;
    let lastText = before.text;
    while (Date.now() - start < 90000) {
      if (!running || tk !== token) return { success: false, failure: true, text: '已停止' };
      await sleep(700);
      const r = A.readResult();
      const btn = A.findExact('评测');
      const disabled = btn ? A.isDisabled(btn) : false;
      if (disabled) started = true;
      if (r.text && r.text !== before.text && (r.success || r.failure)) return r;
      if (started && !disabled && (r.success || r.failure)) return r;
      if (r.text && r.text !== lastText) {
        lastText = r.text;
        log('info', `评测返回：${lastText.slice(0, 180)}`);
      }
      const next = A.findLike(/^(下一关|下一题|继续|进入下一关)$/);
      if (before.nextFound && before.nextDisabled && next && !A.isDisabled(next)) {
        return { success: true, failure: false, text: r.text || '下一关已解锁' };
      }
      if (started && !disabled && r.text) return { success: false, failure: true, text: r.text };
    }
    const r = A.readResult();
    return { success: false, failure: true, text: r.text || '评测超时，未获取到结果' };
  }

  async function waitCooldown(tk, timeout = 90000) {
    const start = Date.now();
    let lastLog = 0;
    while (Date.now() - start < timeout) {
      if (!running || tk !== token) return false;
      const btn = A.findExact('评测');
      const cooling = A.cooldownText?.() || '';
      if (btn && !A.isDisabled(btn) && !cooling) return true;
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        log('info', cooling ? `评测冷却中：${cooling}` : '等待“评测”按钮恢复…');
      }
      await sleep(1000);
    }
    return false;
  }

  async function waitEvaluateReady(tk, timeout = 90000) {
    const start = Date.now();
    let lastLog = 0;
    while (Date.now() - start < timeout) {
      if (!running || tk !== token) return null;
      const btn = A.findExact('评测');
      const cooling = A.cooldownText?.() || '';
      if (btn && !A.isDisabled(btn) && !cooling) return btn;
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        log('info', cooling ? `评测冷却中：${cooling}` : '等待“评测”按钮可用…');
      }
      await sleep(1000);
    }
    return null;
  }

  async function waitEnable(button, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (button && !A.isDisabled(button)) return true;
      await sleep(800);
    }
    return false;
  }

  async function advance(before) {
    await sleep(1000);
    if (A.fingerprint() !== before) return true;
    const next = A.findLike(/^(下一关|下一题|继续|进入下一关)$/);
    if (!next) return Boolean(await A.waitFor(() => A.fingerprint() !== before, 5000, 800));
    await waitEnable(next, 15000);
    A.click(next);
    return Boolean(await A.waitFor(() => A.fingerprint() !== before, 20000, 900));
  }

  async function run(tk) {
    try {
      if (A.blocked()) {
        stopWith('已拒绝', A.blocked(), 'error', 'stop');
        return;
      }
      report('准备中', '等待代码编辑器…', 'work');
      let model = await findEditor(tk, 25000);
      if (!model) {
        stopWith('未识别到题目', '未找到 Monaco/Ace/CodeMirror 编辑器，请刷新页面后重试', 'error', 'notfound');
        return;
      }

      for (let guard = 0; guard < 50; guard += 1) {
        if (!running || tk !== token) return;
        if (!model) {
          stopWith('未识别到题目', '代码编辑器为空', 'error', 'notfound');
          return;
        }
        const desc = A.description();
        const title = A.taskTitle();
        if (!desc && !model.value.trim()) {
          stopWith('未识别到题目', '任务说明与代码模板均为空', 'error', 'notfound');
          return;
        }

        let reference = null;
        if (settings.eduUseReference !== false && !settings.dryRun) {
          const visible = (A.readVisibleAnswer?.() || '').trim() || readCachedAnswer();
          if (visible) {
            reference = { ok: true, code: visible, name: '页面已显示/缓存答案' };
            cacheAnswer(visible);
            log('ok', `已读取页面已显示/缓存的参考答案（${visible.length} 字符，未调用查看接口）`);
          }
          if (!reference && settings.eduReferenceNoRecord !== false) {
            log('info', '未发现已显示/缓存的参考答案；按设置不主动调用查看接口，改用 AI 生成');
          } else if (!reference) {
            report('读取答案', '正在读取平台参考答案…', 'work');
            const ref = await requestReference(12000);
            if (!running || tk !== token) return;
            if (ref?.ok && ref.code) {
              reference = ref;
              cacheAnswer(ref.code);
              log('ok', `已读取平台参考答案（${ref.code.length} 字符${ref.name ? ` · ${ref.name}` : ''}）`);
            } else {
              if (ref?.locked && settings.eduAutoUnlock && ref.answerId) {
                log(
                  'warn',
                  `参考答案未解锁，正在按设置自动解锁（${ref.score ?? '?'} 金币，平台会留下查看记录）…`
                );
                const unlocked = await requestUnlock(ref.answerId, 15000);
                if (!running || tk !== token) return;
                if (unlocked?.ok && unlocked.code) {
                  reference = { ok: true, code: unlocked.code, name: '已解锁参考答案' };
                  log('ok', `已解锁并读取参考答案（${reference.code.length} 字符）`);
                } else {
                  log('warn', `自动解锁失败：${unlocked?.error || '未知错误'}`);
                }
              }
              if (!reference && !ref?.locked && A.readAnswerPanel) {
                const panel = await A.readAnswerPanel(10000);
                if (panel && panel.trim()) {
                  reference = { ok: true, code: panel.trim(), name: '页面参考答案' };
                  log('ok', `已从页面读取参考答案（${reference.code.length} 字符）`);
                }
              }
              if (reference) cacheAnswer(reference.code);
              if (!reference) {
                const hint = ref?.locked ? '；可在侧边栏勾选“参考答案自动解锁”，或先手动解锁' : '';
                log('warn', `参考答案不可用：${ref?.error || '未解锁'}${hint}；改用 AI 生成`);
              }
            }
          }
        }

        let feedback = '';
        let levelPassed = false;
        const configuredAttempts = Math.max(1, Math.min(6, Number(settings.eduMaxAttempts) || 3));
        const maxAttempts = reference ? Math.max(2, configuredAttempts) : configuredAttempts;
        let useReference = Boolean(reference);

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (!running || tk !== token) return;
          report(useReference ? '写入答案' : '生成代码', `第 ${passed + 1} 关 · 第 ${attempt}/${maxAttempts} 次`, 'work');
          log(
            'info',
            `第 ${passed + 1} 关：${title || '未命名'}（${model.language || '未知语言'}，说明 ${desc.length} 字符，模板 ${model.value.length} 字符）`
          );
          if (guard === 0 && desc) {
            log('info', `任务说明预览：${desc.slice(0, 140).replace(/\s+/g, ' ')}…`);
          }

          let ans;
          if (useReference) {
            ans = { ok: true, code: reference.code, source: 'reference' };
            log('ok', `使用平台参考答案写入（${ans.code.length} 字符）`);
          } else {
            ans = await send({
              type: 'EDU_SOLVE',
              payload: { title, description: desc, language: model.language, code: model.value, error: feedback }
            });
          }
          if (!running || tk !== token) return;
          if (!ans?.ok) {
            const err = ans?.error || '未知错误';
            log('error', `代码生成失败：${err}`);
            if (/AI 服务繁忙|Service is too busy|请求超时|timeout|HTTP 5|HTTP 4/i.test(err)) {
              stopWith('AI 服务繁忙', '模型接口暂时不可用，请稍后重试或切换模型', 'warn', 'stop');
            } else {
              stopWith('生成失败', `AI 生成失败：${err}`, 'warn', 'failed');
            }
            return;
          }
          if (settings.dryRun) {
            log('warn', `演练模式：已生成 ${ans.code.length} 字符代码，未写入/未评测。关闭演练后重新开始。`);
            log('info', `代码预览：${ans.code.slice(0, 120).replace(/\n/g, ' ')}…`);
            stopWith('演练模式', '已生成代码但未写入；请关闭“演练模式”后重试', 'warn', 'stop');
            return;
          }

          const writeCode = mergeWithTemplate(model.value, ans.code);
          if (writeCode !== ans.code) {
            log('info', `已按 #代码开始 / #代码结束 模板合并答案（${ans.code.length} → ${writeCode.length} 字符）`);
          }
          const normCode = (s) => String(s || '').replace(/\s+/g, '').trim();
          const codeNorm = normCode(writeCode);
          const valueNorm = normCode(model.value);
          const occurrences = codeNorm ? valueNorm.split(codeNorm).length - 1 : 0;
          let wr = null;
          if (valueNorm === codeNorm) {
            log('info', '编辑器内容与写入代码一致，跳过重复写入');
          } else {
            if (occurrences > 1) log('warn', `编辑器已有 ${occurrences} 份相同代码，重写清理`);
            wr = await send({
              type: 'EDU_SET_CODE',
              frameId: editorFrameId,
              editorId: model.id,
              editorType: model.type,
              code: writeCode
            });
            if (!wr?.ok) {
              log('error', `写入 ${editorType || '编辑器'} 失败：${wr?.error || '未知错误'}`);
              break;
            }
            if (wr.id) model.id = wr.id;
            if (wr.type) model.type = wr.type;
            log('ok', `已写入代码（${wr.length} 字符 · ${wr.type || editorType}${wr.id ? ` · ${wr.id}` : ''}）`);
          }
          model.value = writeCode;

          // API 写入（Monaco/CM/Ace）以 setValue 返回的长度为准；
          // 只有写入目标被标记为隐藏时才用 DOM 兜底，避免拿 CodeMirror 虚拟行文本误判。
          if (wr?.visible === false) {
            log('warn', '写入目标是隐藏编辑器，尝试 DOM 覆盖…');
            const domType =
              model.type === 'monaco'
                ? 'dom-monaco'
                : model.type === 'ace'
                  ? 'dom-ace'
                  : model.type === 'cm5'
                    ? 'dom-cm5'
                    : model.type === 'cm6'
                      ? 'dom-cm6'
                      : model.type;
            const dr = await domSet(domType, writeCode);
            if (!dr?.ok) {
              log('error', `DOM 覆盖写入失败：${dr?.error || '未知错误'}，停止评测`);
              break;
            }
            log('ok', `已通过 DOM 覆盖写入可见编辑器（${dr.length || writeCode.length} 字符）`);
          }
          model.value = writeCode;

          report('评测中', `第 ${passed + 1} 关 · 第 ${attempt}/${maxAttempts} 次`, 'work');
          const before = evalBaseline();
          const btn = A.findExact('评测');
          if (!btn) {
            log('error', '未找到“评测”按钮');
            break;
          }
          const ready = await waitEvaluateReady(tk, 90000);
          if (!ready) {
            log('warn', '“评测”按钮在 90 秒内仍不可用');
            break;
          }
          A.click(ready);
          const result = await waitResult(tk, before);
          if (!running || tk !== token) return;
          if (result.success) {
            levelPassed = true;
            passed += 1;
            saveRun();
            log('ok', `第 ${passed} 关评测通过`);
            report('已通过', `第 ${passed} 关`, 'ok');
            break;
          }
          feedback = result.text || '评测未通过';
          log('warn', `第 ${passed + 1} 关第 ${attempt} 次未通过：${feedback.slice(0, 160)}`);
          if (useReference) {
            useReference = false;
            log('warn', '参考答案评测未通过，后续改用 AI 修正');
          }
          if (attempt < maxAttempts) {
            const cooled = await waitCooldown(tk, 90000);
            if (!cooled) {
              log('warn', '等待评测冷却超时');
              break;
            }
          }
          if (!running || tk !== token) return;
        }

        if (!levelPassed) {
          stopWith('未通过', `第 ${passed + 1} 关未通过；已通过 ${passed} 关`, 'warn', 'failed');
          return;
        }

        const beforeFp = A.fingerprint();
        const moved = await advance(beforeFp);
        if (!moved) {
          finish(`已通过 ${passed} 关（未发现下一关）`);
          return;
        }
        log('info', `已进入第 ${passed + 1} 关`);
        model = await findEditor(tk, 20000);
        if (!model) {
          stopWith('未识别到题目', '下一关未加载出代码编辑器', 'error', 'failed');
          return;
        }
      }

      finish(`已通过 ${passed} 关（达到循环上限）`);
    } catch (e) {
      if (tk === token) stop('运行异常：' + (e?.message || e));
    }
  }

  function start(next, resume = 0) {
    if (running) {
      log('warn', '头歌自动答题已在运行，忽略重复开始');
      return;
    }
    settings = next || {};
    token += 1;
    running = true;
    passed = Math.max(0, Number(resume) || 0);
    lastReport = '';
    saveRun();
    H.ensure();
    setBadge(true);
    H.onStop(() => {
      if (running) stop('用户点击 HUD');
    });
    report('准备中', '正在读取任务与编辑器…', 'work');
    log('info', '头歌（EduCoder）自动答题启动（实验；同页粘贴/查看限制已解除）');
    run(token);
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        if (running) stop('快捷键 Alt+Shift+S');
      }
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'EDU_DOM_FIND') {
      sendResponse(domFind());
      return false;
    }
    if (msg?.type === 'EDU_DOM_SET') {
      domSet(msg.editorType, msg.code).then(sendResponse);
      return true;
    }
    if (msg?.type === 'WG_START') {
      start(msg.settings);
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'WG_STOP') {
      if (running) stop('面板停止');
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'WG_PROBE') {
      sendResponse({ snapshot: A.snapshot() });
      return false;
    }
    return false;
  });

  try {
    const raw = sessionStorage.getItem('wg_edu_run');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.settings) {
        setTimeout(() => {
          if (!running) {
            log('info', '检测到未完成的头歌任务，自动继续…');
            start(saved.settings, Number(saved.passed) || 0);
          }
        }, 1200);
      }
    }
  } catch {}

  watchVisibleAnswer();
  NS.eduMain = { start, stop: () => stop('调试停止') };
})();
