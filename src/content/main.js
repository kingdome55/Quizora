(() => {
  const NS = (window.__wg = window.__wg || {});
  if (NS.main) return;
  const A = NS.adapter;
  const S = NS.solver;
  const H = NS.hud;

  let settings = {};
  let running = false;
  let timer = null;
  let busy = false;
  let runToken = 0;
  let current = { sig: null, clickedAt: 0, retried: false, counter: null, startedAt: 0 };
  let lastDrySig = null;
  let lastAnswer = null;
  let questionNo = 0;
  let totalNo = 0;
  let lastSeenAt = 0;
  let lastReport = '';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(min + Math.random() * Math.max(1, max - min));
  const send = (msg) => {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  };
  function sigOf(p) {
    const counter = p.counter ? `${p.counter.current}/${p.counter.total}` : '?';
    return [counter, p.question, p.options.map((o) => o.text).join('§')].join('|');
  }
  function report(status, detail, tone) {
    const key = `${status}|${detail}|${tone}`;
    if (key === lastReport) return;
    lastReport = key;
    H?.set({ status, detail, tone });
    send({
      type: 'WG_STATE',
      state: { status, detail, question: questionNo, total: totalNo, tone }
    });
  }
  function log(level, text) {
    send({ type: 'WG_LOG', level, text });
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (!running) return;
    timer = setTimeout(tick, ms);
  }
  function halt(reason, tone, statusText) {
    running = false;
    runToken += 1;
    clearTimeout(timer);
    A.clearHighlight();
    report(statusText || '已停止', reason || '', tone || 'idle');
    send({ type: 'WG_STOPPED', reason: statusText === '已完成' ? 'done' : 'stop' });
    log(tone === 'ok' ? 'ok' : 'warn', `${statusText || '已停止'}：${reason || ''}`);
  }

  const pause = (reason) => halt(reason, 'warn', '已暂停');
  function finish() {
    halt(`共 ${totalNo} 题`, 'ok', '已完成');
  }
  function resetFor(parsed, now) {
    current = {
      sig: sigOf(parsed),
      clickedAt: 0,
      retried: false,
      counter: parsed.counter,
      startedAt: now
    };
    lastDrySig = null;
  }
  function start(next) {
    settings = next || {};
    S.configure(settings);
    clearTimeout(timer);
    runToken += 1;
    running = true;
    busy = false;
    lastAnswer = null;
    lastDrySig = null;
    questionNo = 0;
    totalNo = 0;
    lastSeenAt = 0;
    lastReport = '';
    current = { sig: null, clickedAt: 0, retried: false, counter: null, startedAt: Date.now() };

    H.ensure();
    H.onStop(() => {
      if (running) halt('用户点击 HUD 停止', 'idle', '已停止');
    });
    report('运行中', settings.dryRun ? '演练模式：只高亮不点击' : '等待题目', 'work');
    log('info', settings.dryRun ? '已启动（演练模式）' : '已启动');
    tick();
  }
  async function tick() {
    if (!running || busy) return;
    busy = true;
    const token = runToken;
    try {
      await step(token);
    } catch (e) {
      log('error', '运行异常：' + (e?.message || e));
      if (token === runToken) schedule(1500);
    } finally {
      busy = false;
    }
  }
  async function step(token) {
    if (token !== runToken) return;

    const parsed = A.parse();
    if (!parsed.question || (parsed.options.length < 2 && !parsed.input)) {
      if (totalNo && questionNo >= totalNo && current.clickedAt && Date.now() - current.clickedAt > 3000) {
        finish();
        return;
      }
      if (lastSeenAt && Date.now() - lastSeenAt > 25000) {
        pause('25 秒未识别到题目');
        return;
      }
      report('等待题目', '等待题目出现…', 'work');
      schedule(800);
      return;
    }
    lastSeenAt = Date.now();
    if (parsed.counter) {
      questionNo = parsed.counter.current;
      totalNo = parsed.counter.total;
    }

    const sig = sigOf(parsed);
    const now = Date.now();

    if (current.clickedAt) {
      const waited = now - current.clickedAt;
      const moved =
        parsed.counter &&
        current.counter &&
        (parsed.counter.current !== current.counter.current ||
          parsed.counter.total !== current.counter.total);

      if (sig !== current.sig && (moved || waited > 2500)) {
        resetFor(parsed, now);
      } else {
        if (waited > 18000) {
          pause('页面 18 秒未推进');
          return;
        }
        if (waited > 8000 && !current.retried) {
          current.retried = true;
          log('warn', '未检测到推进，重试点击');
          if (lastAnswer && Number.isInteger(lastAnswer.index)) {
            A.clickEl(parsed.options[lastAnswer.index]?.el);
          }
        }
        if (parsed.counter && parsed.counter.current === parsed.counter.total && waited > 4000) {
          finish();
          return;
        }
        schedule(500);
        return;
      }
    } else if (sig !== current.sig) {
      current = {
        sig,
        clickedAt: 0,
        retried: false,
        counter: parsed.counter,
        startedAt: current.startedAt || now
      };
      lastDrySig = null;
      report(
        parsed.counter ? `第 ${parsed.counter.current}/${parsed.counter.total} 题` : '识别到题目',
        '判题中…',
        'work'
      );
    }

    if (parsed.options.length && parsed.options.every((o) => A.isLocked(o.el))) {
      schedule(700);
      return;
    }

    if (settings.dryRun) {
      if (lastDrySig === sig) {
        schedule(900);
        return;
      }
      lastDrySig = sig;
      const ans = await S.decide(parsed);
      if (!running || token !== runToken) return;
      lastAnswer = ans;
      if (ans.error) {
        log('error', ans.error);
        pause('判题失败');
        return;
      }
      if (Number.isInteger(ans.index) && parsed.options[ans.index]) {
        A.highlight(ans.index, parsed.options);
      }
      const shown = ans.text || parsed.options[ans.index]?.text || '';
      report(`第 ${questionNo || '?'} 题`, `演练建议：${shown}`.slice(0, 90), 'work');
      log('info', `演练建议：${shown}（${ans.source}）`);
      schedule(1500);
      return;
    }

    const started = Date.now();
    const ans = await S.decide(parsed);
    if (!running || token !== runToken) return;
    lastAnswer = ans;

    if (ans.error) {
      log('error', ans.error);
      pause('判题失败');
      return;
    }

    if (
      settings.pauseOnLowConfidence &&
      (ans.confidence ?? 0) < (settings.confidenceThreshold ?? 0.6)
    ) {
      if (Number.isInteger(ans.index)) A.highlight(ans.index, parsed.options);
      pause(`低置信度 ${Math.round((ans.confidence || 0) * 100)}%`);
      return;
    }

    const delay = rand(settings.minDelay ?? 1500, settings.maxDelay ?? 3000);
    await sleep(Math.max(0, delay - (Date.now() - started)));
    if (!running || token !== runToken) return;

    const check = A.parse();
    if (sigOf(check) !== sig) {
      resetFor(check, Date.now());
      report('题号已变化', '重新判题', 'work');
      schedule(120);
      return;
    }

    if (ans.text && check.input) {
      A.fillInput(check.input, ans.text);
      await sleep(120);
      A.submitInput();
      log('info', `第 ${questionNo || '?'} 题 → 填空 ${ans.text}（${ans.source}）`);
    } else if (Number.isInteger(ans.index) && parsed.options[ans.index]) {
      A.clickEl(parsed.options[ans.index].el);
      log(
        'info',
        `第 ${questionNo || '?'} 题 → ${parsed.options[ans.index].text}（${ans.source} ${Math.round(
          (ans.confidence ?? 0) * 100
        )}%）`
      );
    } else {
      pause('没有可执行的答案');
      return;
    }

    current.clickedAt = Date.now();
    current.counter = parsed.counter;
    report(`第 ${questionNo || '?'} 题`, `已作答 · ${ans.source}`, 'ok');
    schedule(700);
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        if (running) halt('快捷键 Alt+Shift+S', 'idle', '已停止');
      }
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'WG_START') {
      start(msg.settings);
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'WG_STOP') {
      if (running) halt('面板停止', 'idle', '已停止');
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'WG_PROBE') {
      sendResponse({ snapshot: A.snapshot() });
      return false;
    }
    return false;
  });

  NS.main = { start, stop: () => halt('调试停止', 'idle', '已停止') };
})();
