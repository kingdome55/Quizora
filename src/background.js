import { getConfig, saveConfig } from './background/config.js';
import { getCached, putCached, cacheStats, clearCache } from './background/cache.js';
import { askLLM, askExam } from './background/llm.js';
import { siteForUrl, isReadOnlyUrl } from './background/sites.js';
import { pickFrame, clearFrame } from './background/frame.js';

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
        hasAdapter: Boolean(window.__wg?.cxAdapter),
        hasMain: Boolean(window.__wg?.cxMain),
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

async function startRun(tabIdArg) {
  const tab = await resolveTab(tabIdArg);
  if (!tab) return { ok: false, error: '找不到活动标签页' };
  const site = siteForUrl(tab.url);
  if (!site) return { ok: false, error: '当前标签页不是支持的对局或考试页' };
  if (site.id === 'chaoxing' && isReadOnlyUrl(tab.url)) {
    return { ok: false, error: '当前是作业/考试查看页，不能作答；请进入“做作业/开始作答”页面' };
  }
  if (run.running) await stopRun();
  pushLog('info', '正在启动…');
  try {
    const picked = await pickFrame(tab, site.files);
    if (!picked.usable) {
      logInjection(picked.injection);
      await logSelfCheck(tab);
      resetRun('未识别到题目', 'error');
      return { ok: false, error: '未识别到题目，请先点“探测当前页”查看诊断' };
    }
    const { apiKey, ...settings } = await getConfig();
    settings.mode = /\/exam\b/i.test(new URL(tab.url).pathname) ? 'exam' : 'work';
    await chrome.tabs.sendMessage(
      tab.id,
      { type: 'WG_START', settings, site: site.id },
      { frameId: picked.frameId }
    );
    run = { tabId: tab.id, frameId: picked.frameId, running: true, site: site.id };
    lastState = { status: '运行中', detail: `${site.label} · 已注入`, tone: 'work', site: site.id };
    pushLog('ok', `已启动（${site.label}）：${tab.url.slice(0, 80)}`);
    return { ok: true, tabId: tab.id, site: site.id, siteLabel: site.label };
  } catch (e) {
    clearFrame(tab.id);
    resetRun('启动失败', 'error');
    return { ok: false, error: e?.message || '注入失败，请刷新页面后重试' };
  }
}

async function stopRun() {
  if (run.tabId) {
    try {
      await chrome.tabs.sendMessage(run.tabId, { type: 'WG_STOP' });
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

async function handle(msg) {
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
          confidence: res.confidence,
          reason: res.reason
        });
      }
      return res;
    }
    case 'WG_LOG':
      pushLog(msg.level || 'info', msg.text || '');
      return { ok: true };
    case 'WG_STATE':
      lastState = msg.state || lastState;
      broadcast({ type: 'STATE', state: lastState });
      return { ok: true };
    case 'WG_STOPPED': {
      run.running = false;
      const done = msg.reason === 'done';
      const filled = msg.reason === 'filled';
      const notfound = msg.reason === 'notfound';
      lastState = {
        status: done ? '已完成' : filled ? '已填完' : notfound ? '未识别到题目' : '已停止',
        detail: notfound ? lastState.detail || '' : msg.reason || '',
        tone: done || filled ? 'ok' : notfound ? 'error' : 'idle',
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
