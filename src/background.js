import { getConfig, saveConfig } from './background/config.js';
import { getCached, putCached, cacheStats, clearCache } from './background/cache.js';
import { askLLM, askExam, askCode } from './background/llm.js';
import { siteForUrl, isReadOnlyUrl } from './background/sites.js';
import { pickFrame, pickFrames, clearFrame } from './background/frame.js';

const ports = new Set();
const history = [];
let lastState = { status: '待机', detail: '未开始', tone: 'idle' };
let run = { tabId: null, running: false };

try {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} catch {}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  } catch {}
});

function broadcast(msg) {
  for (const port of ports) {
    try {
      port.postMessage(msg);
    } catch {}
  }
}

function pushLog(level, text) {
  const entry = { type: 'LOG', level, text, ts: Date.now() };
  history.push(entry);
  if (history.length > 100) history.shift();
  broadcast(entry);
}

async function resolveTab(tabId) {
  if (tabId) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function selfCheck(tab) {
  try {
    const out = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => ({
        url: String(location.href).slice(0, 140),
        hasAdapter: Boolean(window.__wg?.cxAdapter || window.__wg?.eduAdapter),
        hasMain: Boolean(window.__wg?.cxMain || window.__wg?.eduMain),
        hasEdu: Boolean(window.__wg?.eduMain),
        version: (() => {
          try {
            return chrome.runtime.getManifest().version;
          } catch {
            return '';
          }
        })()
      })
    });
    return out.slice(0, 12).map((r) => ({ frameId: r.frameId, ...(r.result || {}) }));
  } catch (e) {
    return [{ frameId: -1, error: String(e?.message || e).slice(0, 160) }];
  }
}

function logInjection(injection) {
  if (!injection) return;
  if (injection.ok) {
    const extra = injection.error ? `（全帧失败：${injection.error}）` : '';
    pushLog('info', `脚本注入：${injection.mode === 'all' ? '全帧成功' : '仅顶层成功'}${extra}`);
  } else {
    pushLog('error', `脚本注入失败：${injection.error}`);
  }
}

async function logSelfCheck(tab) {
  const rows = await selfCheck(tab);
  for (const row of rows) {
    if (row.error) {
      pushLog('error', `自检失败：${row.error}`);
      continue;
    }
    pushLog(
      'info',
      `自检 #${row.frameId} v${row.version || '?'} adapter=${row.hasAdapter ? '有' : '无'} main=${row.hasMain ? '有' : '无'} ${row.url}`
    );
  }
  return rows;
}

function logBlankDetails(snapshot, tag = '') {
  for (const b of snapshot?.blankDetails || []) {
    const extra = b.cells ? ` / 空框 ${b.cells}` : '';
    pushLog('info', `${tag}填空 #${b.index}：空格 ${b.blanks} / 输入框 ${b.inputs}${extra}`);
    if (b.sample) pushLog('info', `${tag}空框样本：${b.sample}`);
    if (b.parent) pushLog('info', `${tag}空框父级：${b.parent}`);
  }
}

async function startRun(tabIdArg) {
  const tab = await resolveTab(tabIdArg);
  if (!tab) return { ok: false, error: '找不到活动标签页' };
  const site = siteForUrl(tab.url);
  if (!site) return { ok: false, error: '当前标签页不是支持的对局或考试页' };
  if (site.id === 'chaoxing' && isReadOnlyUrl(tab.url)) {
    return { ok: false, error: '当前是作业/考试查看页，不能作答；请进入“做作业/开始作答”页面' };
  }
  if (site.id === 'educoder' && /\/exam\b/i.test(new URL(tab.url).pathname)) {
    return { ok: false, error: '头歌考试页不自动作答；仅支持练习/作业关卡' };
  }
  if (run.running) await stopRun();
  pushLog('info', '正在启动…');
  try {
    const multi = site.id === 'chaoxing';
    const picked = multi ? await pickFrames(tab, site.files) : await pickFrame(tab, site.files);
    const targets = multi
      ? picked.frames || []
      : picked.usable
        ? [{ frameId: picked.frameId, count: picked.count, snapshot: picked.snapshot }]
        : [];

    if (!targets.length) {
      logInjection(picked.injection);
      await logSelfCheck(tab);
      resetRun('未识别到题目', 'error');
      return { ok: false, error: '未识别到题目，请先点“探测当前页”查看诊断' };
    }

    const { apiKey, ...settings } = await getConfig();
    pushLog('info', `任务点分布：${targets.map((f, i) => `#${i + 1} ${f.count}题`).join('，')}`);
    for (let i = 0; i < targets.length; i += 1) {
      logBlankDetails(targets[i].snapshot, targets.length > 1 ? `[任务点${i + 1}] ` : '');
    }
    const started = [];
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      const mode = /\/exam\b/i.test(new URL(target.snapshot?.url || tab.url).pathname) ? 'exam' : 'work';
      try {
        await chrome.tabs.sendMessage(
          tab.id,
          { type: 'WG_START', settings: { ...settings, mode }, site: site.id },
          { frameId: target.frameId }
        );
        started.push({ ...target, mode });
      } catch (e) {
        pushLog('warn', `任务点 ${i + 1} 启动失败：${String(e?.message || e).slice(0, 120)}`);
      }
    }

    if (!started.length) {
      resetRun('启动失败', 'error');
      return { ok: false, error: '所有任务点都启动失败，请刷新页面后重试' };
    }

    run = {
      tabId: tab.id,
      running: true,
      site: site.id,
      frames: new Map(started.map((f, i) => [f.frameId, { label: `任务点${i + 1}`, count: f.count }])),
      totalFrames: started.length,
      anyFilled: false,
      anyDone: false,
      anyFailed: false
    };
    const totalCount = started.reduce((sum, f) => sum + (f.count || 0), 0);
    lastState = {
      status: '运行中',
      detail: `${site.label} · ${started.length} 个任务点`,
      tone: 'work',
      site: site.id
    };
    pushLog('ok', `已启动（${site.label}）：${started.length} 个任务点，共 ${totalCount} 题`);
    return { ok: true, tabId: tab.id, site: site.id, siteLabel: site.label, frames: started.length };
  } catch (e) {
    clearFrame(tab.id);
    resetRun('启动失败', 'error');
    return { ok: false, error: e?.message || '注入失败，请刷新页面后重试' };
  }
}

async function stopRun() {
  const tabId = run.tabId || (await resolveTab())?.id;
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'WG_STOP' });
    } catch {}
  }
  resetRun('已停止');
  return { ok: true };
}

function resetRun(status = '已停止', tone = 'idle') {
  run = { tabId: null, running: false };
  lastState = { status, detail: '', tone };
  broadcast({ type: 'STATE', state: lastState });
}

async function probe(tabIdArg) {
  const tab = await resolveTab(tabIdArg);
  if (!tab) return { ok: false, error: '找不到活动标签页' };
  const site = siteForUrl(tab.url);
  if (!site) return { ok: false, error: '当前标签页不是支持的对局或考试页' };
  pushLog('info', '正在探测页面…');
  try {
    const picked = await pickFrame(tab, site.files);
    let check = null;
    if (!picked.usable) {
      logInjection(picked.injection);
      check = await logSelfCheck(tab);
      if (!picked.snapshot) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [0] },
            files: site.files
          });
        } catch {}
        await new Promise((r) => setTimeout(r, 400));
        try {
          const res = await chrome.tabs.sendMessage(tab.id, { type: 'WG_PROBE' });
          if (res?.snapshot) picked.snapshot = res.snapshot;
        } catch {}
      }
    }
    logBlankDetails(picked.snapshot);
    return {
      ok: true,
      site: site.id,
      siteLabel: site.label,
      snapshot: picked.snapshot,
      injection: picked.injection,
      selfCheck: check
    };
  } catch (e) {
    clearFrame(tab.id);
    return { ok: false, error: e?.message || '探测失败' };
  }
}

async function testConnection() {
  const config = await getConfig();
  const res = await askLLM({
    config,
    question: 'Which number is the largest?',
    options: ['3', '4', '5', '6'],
    kind: 'mc'
  });
  if (!res.ok) return res;
  return { ok: true, index: res.index, confidence: res.confidence, reason: res.reason };
}

async function fetchImage(url) {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '不支持的图片地址' };
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return { ok: false, error: '图片下载失败 HTTP ' + res.status };
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\//i.test(type)) return { ok: false, error: '返回内容不是图片' };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 3_000_000) return { ok: false, error: '图片超过 3MB' };
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return { ok: true, dataUrl: `data:${type};base64,${btoa(binary)}` };
  } catch (e) {
    return { ok: false, error: e?.message || '图片下载失败' };
  }
}

async function testVision() {
  const config = await getConfig();
  if (!config.apiKey) return { ok: false, error: '未填写 API Key' };
  try {
    const res = await fetch(chrome.runtime.getURL('src/test/vision.png'));
    if (!res.ok) return { ok: false, error: '测试图片读取失败' };
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const dataUrl = `data:image/png;base64,${btoa(binary)}`;
    return await askExam({
      config,
      question: '图片中矩形框内标注的电压值是多少？请只回答数值和单位。',
      type: 'short',
      images: [dataUrl]
    });
  } catch (e) {
    return { ok: false, error: e?.message || '图形识别测试失败' };
  }
}

async function handle(msg, sender) {
  switch (msg?.type) {
    case 'GET_STATE': {
      return {
        config: await getConfig(),
        cache: await cacheStats(),
        running: run.running,
        site: run.site || null,
        state: lastState,
        history
      };
    }
    case 'SAVE_CONFIG':
      return { config: await saveConfig(msg.patch || {}) };
    case 'START':
      return startRun(msg.tabId);
    case 'STOP':
      return stopRun();
    case 'PROBE':
      return probe(msg.tabId);
    case 'TEST':
      return testConnection();
    case 'TEST_VISION':
      return testVision();
    case 'CLEAR_CACHE': {
      await clearCache();
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith('wg_exam_done_v1'));
      if (keys.length) await chrome.storage.local.remove(keys);
      pushLog('info', '缓存已清空');
      return { ok: true };
    }
    case 'GET_CACHE':
      return { entry: await getCached(msg.hash) };
    case 'FETCH_IMAGE':
      return fetchImage(msg.url);
    case 'SOLVE': {
      const config = await getConfig();
      const options = msg.payload?.options || [];
      const res = await askLLM({
        config,
        question: msg.payload?.question,
        options,
        kind: msg.payload?.kind || 'mc'
      });
      if (res.ok && msg.hash) {
        await putCached(msg.hash, {
          answerText: res.text || options[res.index] || '',
          confidence: res.confidence,
          reason: res.reason
        });
      }
      return res;
    }
    case 'SOLVE_EXAM': {
      const config = await getConfig();
      const payload = msg.payload || {};
      const res = await askExam({
        config,
        question: payload.question,
        type: payload.type,
        options: payload.options || [],
        blankCount: payload.blankCount || 0,
        images: payload.images || []
      });
      if (res.ok && msg.hash && payload.type !== 'short') {
        await putCached(msg.hash, {
          answer: { indices: res.indices || [], blanks: res.blanks || [] },
          question: payload.question || '',
          type: payload.type || '',
          blankCount: payload.blankCount || 0,
          confidence: res.confidence,
          reason: res.reason
        });
      }
      return res;
    }
    case 'EDU_STATE': {
      const tabId = sender?.tab?.id;
      if (!tabId) return { ok: false, error: '缺少标签页' };
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [sender.frameId ?? 0] },
          world: 'MAIN',
          func: () => {
            const monaco = window.monaco;
            if (!monaco?.editor?.getModels) return { ok: false, error: 'Monaco 未加载' };
            try {
              const models = monaco.editor.getModels().map((m) => ({
                uri: String(m.uri),
                language: m.getLanguageId ? m.getLanguageId() : '',
                value: m.getValue()
              }));
              return {
                ok: true,
                models,
                taskId: window.taskId || '',
                paths: window.taskChallengePath || '',
                url: location.href
              };
            } catch (e) {
              return { ok: false, error: String(e?.message || e) };
            }
          }
        });
        return results?.[0]?.result || { ok: false, error: '无返回' };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case 'EDU_SET_CODE': {
      const tabId = sender?.tab?.id;
      if (!tabId || typeof msg.code !== 'string') return { ok: false, error: '缺少代码' };
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [sender.frameId ?? 0] },
          world: 'MAIN',
          func: (uri, code) => {
            const monaco = window.monaco;
            const models = monaco?.editor?.getModels?.() || [];
            if (!models.length) return { ok: false, error: '未找到代码模型' };
            let model = uri ? models.find((m) => String(m.uri) === uri) : null;
            if (!model) model = models.slice().sort((a, b) => b.getValue().length - a.getValue().length)[0];
            try {
              model.setValue(code);
              return { ok: true, uri: String(model.uri), length: model.getValue().length };
            } catch (e) {
              return { ok: false, error: String(e?.message || e) };
            }
          },
          args: [String(msg.uri || ''), msg.code]
        });
        return results?.[0]?.result || { ok: false, error: '无返回' };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case 'EDU_SOLVE': {
      const config = await getConfig();
      const payload = msg.payload || {};
      return askCode({
        config,
        title: payload.title,
        description: payload.description,
        language: payload.language,
        code: payload.code,
        error: payload.error
      });
    }
    case 'WG_FONT_TABLE': {
      try {
        const res = await fetch(chrome.runtime.getURL('src/vendor/cx-font-table.json'));
        return { ok: true, table: await res.json() };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case 'WG_UE_FILL': {
      const tabId = sender?.tab?.id;
      if (!tabId || !msg.name) return { ok: false, error: '缺少 UE 上下文' };
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [sender.frameId ?? 0] },
          world: 'MAIN',
          func: (name, text) => {
            try {
              const host = window.UE ? window : window.parent;
              const editor = host?.UE?.getEditor?.(name);
              if (!editor?.setContent) return { ok: false, error: 'UE 不可用' };
              editor.setContent(text);
              editor.sync?.();
              return { ok: true };
            } catch (e) {
              return { ok: false, error: String(e?.message || e) };
            }
          },
          args: [String(msg.name), String(msg.text || '')]
        });
        return results?.[0]?.result || { ok: false, error: '无返回' };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case 'WG_LOG': {
      const tag = run.totalFrames > 1 ? run.frames?.get?.(sender?.frameId)?.label : '';
      pushLog(msg.level || 'info', tag ? `[${tag}] ${msg.text || ''}` : msg.text || '');
      return { ok: true };
    }
    case 'WG_STATE':
      lastState = msg.state || lastState;
      broadcast({ type: 'STATE', state: lastState });
      return { ok: true };
    case 'WG_STOPPED': {
      if (!run.running) return { ok: true };
      if (msg.reason === 'stop') {
        for (const frameId of run.frames?.keys?.() || []) {
          try {
            await chrome.tabs.sendMessage(run.tabId, { type: 'WG_STOP' }, { frameId });
          } catch {}
        }
        run.frames?.clear?.();
        run.running = false;
        lastState = { status: '已停止', detail: '已手动停止', tone: 'idle', site: run.site || lastState.site };
        broadcast({ type: 'STATE', state: lastState });
        return { ok: true };
      }
      const frameInfo = run.frames?.get?.(sender?.frameId);
      if (!frameInfo) return { ok: true };
      run.frames.delete(sender.frameId);
      if (msg.reason === 'filled' || msg.reason === 'done' || msg.reason === 'failed') run.anyFilled = true;
      if (msg.reason === 'done') run.anyDone = true;
      if (msg.reason === 'failed') run.anyFailed = true;

      const remaining = run.frames.size;
      if (remaining > 0) {
        lastState = {
          status: '运行中',
          detail: `剩余 ${remaining} 个任务点`,
          tone: 'work',
          site: run.site || lastState.site
        };
        broadcast({ type: 'STATE', state: lastState });
        return { ok: true };
      }

      run.running = false;
      const done = run.anyDone;
      const failed = run.anyFailed;
      const filled = run.anyFilled;
      const notfound = !done && !filled && msg.reason === 'notfound';
      lastState = {
        status: done ? '已完成' : failed ? '未通过' : filled ? '已填完' : notfound ? '未识别到题目' : '已停止',
        detail: notfound ? lastState.detail || '' : `${run.totalFrames || 1} 个任务点${failed ? '（有未通过关卡）' : ''}`,
        tone: failed ? 'warn' : done || filled ? 'ok' : notfound ? 'error' : 'idle',
        site: run.site || lastState.site
      };
      broadcast({ type: 'STATE', state: lastState });
      return { ok: true };
    }
    default:
      return { ok: false, error: '未知指令' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wg-panel') return;
  ports.add(port);
  port.postMessage({ type: 'HISTORY', history });
  port.onDisconnect.addListener(() => ports.delete(port));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearFrame(tabId);
  if (run.tabId === tabId) resetRun('标签页已关闭');
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') clearFrame(tabId);
  if (!run.tabId || tabId !== run.tabId) return;
  if (info.status === 'loading' || info.url) resetRun('页面已切换');
});
