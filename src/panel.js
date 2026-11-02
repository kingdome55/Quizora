const $ = (id) => document.getElementById(id);
let initialized = false;
let port = null;
let pillLockUntil = 0;

function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function setPill(text, tone = 'idle') {
  const pill = $('statusPill');
  pill.textContent = text;
  pill.className = `pill ${tone}`;
}

function holdPill(ms) {
  pillLockUntil = Date.now() + ms;
}

function addLog(entry) {
  const list = $('logs');
  const li = document.createElement('li');
  li.className = entry.level || 'info';
  const time = document.createElement('time');
  time.textContent = fmtTime(entry.ts);
  const span = document.createElement('span');
  span.textContent = entry.text || '';
  li.append(time, span);
  list.prepend(li);
  while (list.children.length > 100) list.lastElementChild.remove();
}

function fail(e) {
  const text = e?.message || String(e);
  addLog({ level: 'error', text, ts: Date.now() });
  setPill(text, 'error');
}

function fillConfig(cfg) {
  $('baseUrl').value = cfg.baseUrl || '';
  $('apiKey').value = cfg.apiKey || '';
  fillModelSelect(cfg);
  const base = ((cfg.minDelay ?? 1500) + (cfg.maxDelay ?? 3000)) / 2000;
  const clamped = Math.min(3, Math.max(0.3, base));
  $('delay').value = String(clamped);
  $('delayOut').textContent = `${clamped.toFixed(1)}s`;
  $('dryRun').checked = Boolean(cfg.dryRun);
  $('examSkip').checked = cfg.examSkipAnswered !== false;
  $('examScroll').checked = cfg.examScrollLoad !== false;
}

function applyState(state) {
  if (!state?.status) return;
  if (Date.now() < pillLockUntil) return;
  const text = state.detail ? `${state.status} · ${state.detail}` : state.status;
  setPill(text, state.tone || 'idle');
  if (state.total) {
    $('qno').textContent = `${state.question ?? '—'} / ${state.total}`;
  }
}

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!res) return;
    if (!initialized && res.config) {
      fillConfig(res.config);
      initialized = true;
    }
    $('cacheCount').textContent = res.cache?.count ?? 0;
    if (res.site) {
      const labels = { chaoxing: '学习通', wayground: 'Wayground', educoder: '头歌', generic: '通用网页' };
      $('siteName').textContent = labels[res.site] || res.site;
    }
    applyState(res.state);
  } catch {}
}

async function saveConfig({ notify = true } = {}) {
  const baseUrl = $('baseUrl').value.trim();
  if (!baseUrl) throw new Error('请先填写 API Base URL');
  let origin;
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'https:') throw new Error('protocol');
    origin = `${u.origin}/*`;
  } catch {
    throw new Error('Base URL 需要是 https 地址');
  }
  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted) throw new Error('未授权访问该 API 域名');

  const sec = Number($('delay').value) || 1.5;
  const model = currentModel();
  if (!model) throw new Error('请选择或填写模型');
  const res = await chrome.runtime.sendMessage({
    type: 'SAVE_CONFIG',
    patch: {
      baseUrl,
      apiKey: $('apiKey').value.trim(),
      model,
      minDelay: Math.round(sec * 800),
      maxDelay: Math.round(sec * 1200),
      dryRun: $('dryRun').checked,
      examSkipAnswered: $('examSkip').checked,
      examScrollLoad: $('examScroll').checked,
      useCache: true
    }
  });
  if (!res?.config) throw new Error('保存失败');
  if (notify) addLog({ level: 'ok', text: '配置已保存', ts: Date.now() });
  return res.config;
}

function renderSnapshot(s) {
  const pre = $('probe');
  pre.hidden = false;
  if (!s) {
    pre.textContent = '未获取到页面信息';
    return;
  }
  if (s.mode === 'exam') {
    const types = Object.entries(s.types || {})
      .map(([k, v]) => `${k}×${v}`)
      .join(' / ');
    const lines = [
      `URL: ${s.url}`,
      `题目数: ${s.count}`,
      `题型: ${types || '—'}`,
      '前 8 题:'
    ];
    (s.questions || []).forEach((q) => {
      lines.push(`  ${q.index + 1}. [${q.type}] ${q.stem}`);
      if (q.options.length) lines.push(`     选项: ${q.options.join(' | ')}`);
      if (q.type === 'blank') lines.push(`     空格数: ${q.blanks}`);
      if (q.hasEditor) lines.push('     含富文本编辑器');
      if (q.answered) lines.push('     （已有答案）');
    });
    if (s.count === 0 && s.diagnostics) {
      const d = s.diagnostics;
      const c = d.counts || {};
      lines.push('', '诊断：');
      if (d.error) lines.push(`扫描异常: ${d.error}`);
      lines.push(
        `输入框 ${c.inputs ?? 0} / 文本域 ${c.textareas ?? 0} / 可编辑区 ${c.editables ?? 0} / 编辑器 ${c.editors ?? 0} / 选项块 ${c.optionBlocks ?? 0} / 答题区 ${c.answers ?? 0}`
      );
      if (d.typeNames?.length) {
        lines.push('typeName: ' + d.typeNames.map((t) => `${t.cls || '?'}=${t.value}`).join(' | '));
      }
      if (d.iframes?.length) {
        lines.push(
          'iframe：' +
            d.iframes
              .map((f) => `${f.id || f.cls || '?'}${f.accessible ? '(可读)' : '(跨域)'}`)
              .join(' | ')
        );
      }
      (d.labels || []).forEach((l) => lines.push(`候选块 [${l.cls}] ${l.text}`));
      const hits = Object.entries(d.selectors || {})
        .filter(([, v]) => v && v.raw)
        .map(([k, v]) => `${k} 原始${v.raw}/可见${v.visible}/带标签${v.labelled}`);
      if (hits.length) lines.push('容器命中: ' + hits.join(' ; '));
      if (s.frames?.length) {
        lines.push('各 frame:');
        s.frames.forEach((f) =>
          lines.push(`  #${f.frameId} 题${f.count} 标签${f.labels} ${f.error ? '错误:' + f.error : f.url || ''}`)
        );
      }
      if (d.html) lines.push(`HTML片段: ${d.html}`);
      lines.push('若“可编辑区/编辑器”为 0，说明当前页没有答题框（可能是查看页）。');
    }
    pre.textContent = lines.join('\n');
    return;
  }
  const lines = [
    `URL: ${s.url}`,
    `题号: ${s.counter ? `${s.counter.current} / ${s.counter.total}` : '未识别'}`,
    `题干: ${s.question || '未识别'}`,
    `策略: ${s.strategy}`,
    `输入框: ${s.input ? '有' : '无'}`,
    '选项:'
  ];
  if (s.options.length) {
    s.options.forEach((o) => lines.push(`  ${o.index}. ${o.text}`));
  } else {
    lines.push('  （未识别到选项）');
  }
  pre.textContent = lines.join('\n');
}

$('delay').addEventListener('input', () => {
  $('delayOut').textContent = `${Number($('delay').value).toFixed(1)}s`;
});

$('toggleKey').addEventListener('click', () => {
  const input = $('apiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('toggleKey').textContent = show ? '隐藏 Key' : '显示 Key';
});

$('clearKey').addEventListener('click', () => {
  $('apiKey').value = '';
  $('apiKey').focus();
  setPill('请输入新的 Key 后保存', 'warn');
});

$('saveBtn').addEventListener('click', async () => {
  try {
    await saveConfig();
    setPill('配置已保存', 'ok');
  } catch (e) {
    fail(e);
  }
});

$('testBtn').addEventListener('click', async () => {
  try {
    await saveConfig({ notify: false });
    setPill('连接测试中…', 'work');
    const res = await chrome.runtime.sendMessage({ type: 'TEST' });
    if (!res?.ok) throw new Error(res?.error || '连接失败');
    addLog({
      level: 'ok',
      text: `连接正常，测试题答案下标 ${res.index}（置信度 ${Math.round((res.confidence ?? 0) * 100)}%）`,
      ts: Date.now()
    });
    setPill('连接正常', 'ok');
  } catch (e) {
    fail(e);
  }
});

$('startBtn').addEventListener('click', async () => {
  try {
    await saveConfig({ notify: false });
    const res = await chrome.runtime.sendMessage({ type: 'START' });
    if (!res?.ok) throw new Error(res?.error || '启动失败');
    if (res.siteLabel) $('siteName').textContent = res.siteLabel;
    setPill('运行中', 'work');
  } catch (e) {
    fail(e);
  }
});

$('stopBtn').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP' });
    setPill('已停止', 'idle');
  } catch (e) {
    fail(e);
  }
});

$('probeBtn').addEventListener('click', async () => {
  try {
    setPill('探测中…', 'work');
    const res = await chrome.runtime.sendMessage({ type: 'PROBE' });
    if (!res?.ok) throw new Error(res?.error || '探测失败');
    renderSnapshot(res.snapshot);
    if (res.siteLabel) $('siteName').textContent = res.siteLabel;
    if (!res.snapshot) {
      addLog({ level: 'warn', text: '未取到页面快照：内容脚本没有响应，请查看上方的“脚本注入/自检”日志', ts: Date.now() });
      setPill('未识别到题目', 'warn');
      return;
    }

    const isExam = res.snapshot?.mode === 'exam';
    const count = isExam ? res.snapshot?.count || 0 : res.snapshot?.options?.length || 0;
    const ok = isExam ? count > 0 : count >= 2;
    addLog({
      level: ok ? 'ok' : 'warn',
      text: isExam
        ? `探测完成：识别到 ${count} 道题`
        : `探测完成：识别到 ${count} 个选项，策略 ${res.snapshot?.strategy || 'none'}`,
      ts: Date.now()
    });
    if (isExam && count === 0) {
      const s = res.snapshot || {};
      const d = s.diagnostics || {};
      const c = d.counts || {};
      addLog({
        level: 'warn',
        text: `诊断：输入${c.inputs ?? 0} 文本域${c.textareas ?? 0} 编辑区${c.editables ?? 0} 编辑器${c.editors ?? 0} 选项块${c.optionBlocks ?? 0} 答题区${c.answers ?? 0}`,
        ts: Date.now()
      });
      const hits = Object.entries(d.selectors || {})
        .filter(([, v]) => v && v.raw)
        .map(([k, v]) => `${k}:${v.raw}`)
        .join(' ');
      if (hits) addLog({ level: 'warn', text: '容器命中：' + hits, ts: Date.now() });
      if (d.typeNames?.length) {
        addLog({
          level: 'info',
          text: 'typeName：' + d.typeNames.map((t) => `${t.cls || '?'}=${t.value}`).join(' / '),
          ts: Date.now()
        });
      }
      if (d.labels?.length) {
        addLog({
          level: 'info',
          text: '标签：' + d.labels.slice(0, 3).map((l) => `[${l.cls || '?'}] ${l.text}`).join(' / '),
          ts: Date.now()
        });
      }
      (s.frames || []).forEach((f) =>
        addLog({
          level: 'info',
          text: `frame #${f.frameId} 题${f.count} 标签${f.labels} ${f.error || f.url || ''}`,
          ts: Date.now()
        })
      );
      if (d.html) addLog({ level: 'info', text: 'HTML：' + d.html, ts: Date.now() });
    }
    setPill(ok ? '探测完成' : isExam ? '未识别到题目' : '未识别到选项', ok ? 'ok' : 'warn');
  } catch (e) {
    fail(e);
  }
});

$('clearBtn').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    $('cacheCount').textContent = '0';
    setPill('缓存已清空', 'ok');
  } catch (e) {
    fail(e);
  }
});
function connectPort() {
  try {
    port = chrome.runtime.connect({ name: 'wg-panel' });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'LOG') addLog(msg);
      else if (msg.type === 'HISTORY') {
        $('logs').innerHTML = '';
        (msg.history || []).slice().reverse().forEach(addLog);
      } else if (msg.type === 'STATE') {
        applyState(msg.state);
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connectPort, 1000);
    });
  } catch {
    setTimeout(connectPort, 1500);
  }
}
initModelSelect();
connectPort();
refresh();
setInterval(refresh, 3000);
