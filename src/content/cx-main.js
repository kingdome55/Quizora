(() => {
  if (window.__wg?.cxMain) return;
  const NS = (window.__wg = window.__wg || {});
  const A = NS.cxAdapter;
  const I = NS.cxImage;
  const F = NS.cxFill;
  const H = NS.hud;

  let settings = {};
  let running = false;
  let token = 0;
  let total = 0;
  let filled = 0;
  let skipped = 0;
  let failed = [];
  let lastReport = '';
  const DONE_KEY = `wg_exam_done_v1:${location.origin}${location.pathname}${location.search}`;
  let doneKeys = new Set();
  let doneLoaded = false;
  const processed = new Set();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(min + Math.random() * Math.max(1, max - min));
  async function ensureDone() {
    if (doneLoaded) return;
    doneLoaded = true;
    const stored = await chrome.storage.local.get(DONE_KEY).catch(() => ({}));
    doneKeys = new Set(Object.keys(stored[DONE_KEY] || {}));
  }
  function saveDone() {
    const obj = {};
    doneKeys.forEach((key) => (obj[key] = Date.now()));
    try { chrome.storage.local.set({ [DONE_KEY]: obj }); } catch {}
  }
  function send(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.then === 'function') {
        return p.catch((e) => ({ ok: false, error: String(e) }));
      }
      return Promise.resolve({ ok: false, error: '扩展未响应' });
    } catch (e) {
      return Promise.resolve({ ok: false, error: String(e) });
    }
  }
  function report(status, detail, tone) {
    const key = `${status}|${detail}|${tone}`;
    if (key === lastReport) return;
    lastReport = key;
    H?.set({ status, detail, tone });
    send({
      type: 'WG_STATE',
      state: { status, detail, question: filled, total, tone }
    });
  }
  function log(level, text) {
    send({ type: 'WG_LOG', level, text });
  }
  function stop(reason) {
    running = false;
    token += 1;
    saveDone();
    report('已停止', reason || '', 'idle');
    send({ type: 'WG_STOPPED', reason: 'stop' });
    log('warn', `停止：${reason || ''}`);
  }
  function finish() {
    running = false;
    token += 1;
    saveDone();
    const extra = failed.length ? `，${failed.length} 题失败` : '';
    const skipNote = skipped ? `，跳过 ${skipped} 题` : '';
    const detail = `${filled}/${total} 已填${extra}${skipNote}，请检查后手动提交`;
    H?.set({ status: '已填完', detail, tone: failed.length ? 'warn' : 'ok' });
    send({
      type: 'WG_STATE',
      state: { status: '已填完', detail, question: filled, total, tone: failed.length ? 'warn' : 'ok' }
    });
    send({ type: 'WG_STOPPED', reason: 'filled' });
    log('ok', `整卷完成：${detail}`);
  }

  function stopWith(status, detail, tone) {
    running = false;
    token += 1;
    saveDone();
    H?.set({ status, detail, tone });
    send({ type: 'WG_STATE', state: { status, detail, question: filled, total, tone } });
    send({ type: 'WG_STOPPED', reason: 'notfound' });
    log('error', `${status}：${detail}`);
  }

  function start(next) {
    settings = next || {};
    token += 1;
    running = true;
    total = 0;
    filled = 0;
    skipped = 0;
    failed = [];
    lastReport = '';
    processed.clear();
    F.clearMarks();

    H.ensure();
    H.onStop(() => {
      if (running) stop('用户点击 HUD');
    });
    report('扫描中', '正在查找题目…', 'work');
    log('info', '学习通整卷模式启动（只填不交）');
    run(token);
  }

  async function run(tk) {
    try {
      if (settings.examScrollLoad) {
        const y = window.scrollY;
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(800);
        window.scrollTo(0, y);
      }

      const seen = new Set();
      await ensureDone();
      for (let pass = 0; pass < 3; pass += 1) {
        if (!running || tk !== token) return;
        const scan = A.scan();
        if (!scan.count && total === 0) {
          stopWith(
            '未识别到题目',
            '当前页可能不是作答页，或没有可编辑的答案框；请点“探测”查看诊断',
            'error'
          );
          return;
        }
        total = Math.max(total, scan.count);
        report('整卷模式', `识别 ${scan.count} 题 · 已填 ${filled}`, 'work');

        let acted = false;
        for (const q of scan.questions) {
          if (!running || tk !== token) return;
          if (seen.has(q.key)) continue;
          seen.add(q.key);

          if (q.type === 'unknown') {
            failed.push(q.index + 1);
            F.mark(q, 'fail', '无法识别题型');
            processed.add(q.key);
            continue;
          }
          if (!q.options.length && !q.inputs.length && !q.textarea && !q.iframe && !q.editable) {
            failed.push(q.index + 1);
            F.mark(q, 'fail', '无可用输入控件');
            processed.add(q.key);
            continue;
          }
          if (processed.has(q.key)) {
            skipped += 1;
            F.mark(q, 'skip', '本次已处理');
            continue;
          }
          const answered = q.answered;
          if (settings.examSkipAnswered && answered) {
            skipped += 1;
            F.mark(q, 'skip', '已有答案');
            doneKeys.add(q.key);
            processed.add(q.key);
            continue;
          }

          try {
            await handle(q, tk);
          } catch (e) {
            failed.push(q.index + 1);
            try {
              F.mark(q, 'fail', '异常：' + (e?.message || e));
            } catch {}
            log('error', `第 ${q.index + 1} 题异常：${e?.message || e}`);
          }
          processed.add(q.key);
          acted = true;
        }

        if (!running || tk !== token) return;
        if (!acted) break;
        await sleep(600);
      }

      if (!running || tk !== token) return;
      finish();
    } catch (e) {
      if (tk === token) stop('运行异常：' + (e?.message || e));
    }
  }

  async function solve(q, images) {
    if (settings.useCache !== false && q.type !== 'short') {
      const cached = await send({ type: 'GET_CACHE', hash: q.key });
      const entry = cached?.entry;
      const answer = entry?.answer;
      const sameQuestion = entry && entry.question === q.stem && entry.type === q.type;
      if (q.type === 'blank') {
        const blanks = answer?.blanks;
        if (sameQuestion && Number(entry.blankCount) === q.blankCount && Array.isArray(blanks) && blanks.length === q.blankCount) {
          return { ok: true, type: 'blank', blanks, source: 'cache' };
        }
      } else if (sameQuestion && answer?.indices?.length) {
        return { ok: true, type: q.type, indices: answer.indices, source: 'cache' };
      }
    }

    const res = await send({
      type: 'SOLVE_EXAM',
      hash: q.key,
      payload: {
        question: q.stem,
        type: q.type,
        options: q.options.map((o) => o.text),
        blankCount: q.blankCount,
        images
      }
    });
    if (!res?.ok) return { ok: false, error: res?.error || '判题失败' };
    return { ...res, source: 'llm' };
  }

  async function handle(q, tk) {
    const started = Date.now();
    report('判题中', q.stem.slice(0, 60), 'work');
    const images = q.images?.length ? await I.prepare(q.images) : [];
    if (!running || tk !== token) return;
    const ans = await solve(q, images);
    if (!running || tk !== token) return;

    if (!ans.ok) {
      failed.push(q.index + 1);
      F.mark(q, 'fail', ans.error);
      log('warn', `第 ${q.index + 1} 题失败：${ans.error}`);
      report('整卷模式', `已填 ${filled}/${total} · ${failed.length} 题失败`, 'warn');
      return;
    }

    if (settings.dryRun) {
      const preview =
        ans.type === 'blank'
          ? (ans.blanks || []).join(' / ')
          : ans.type === 'short'
            ? (ans.text || '').slice(0, 80)
            : (ans.indices || []).map((i) => q.options[i]?.text).filter(Boolean).join(' / ');
      skipped += 1;
      F.mark(q, 'skip', `演练建议：${preview}`);
      log('info', `第 ${q.index + 1} 题演练建议：${preview}`);
      report('演练模式', `第 ${q.index + 1} 题 · ${preview}`.slice(0, 90), 'work');
      return;
    }

    const min = settings.minDelay ?? 1200;
    const max = settings.maxDelay ?? 2600;
    const conf = Number.isFinite(ans.confidence) ? ans.confidence : 0.8;
    await sleep(Math.max(0, rand(min, max) - (Date.now() - started)));
    if (!running || tk !== token) return;

    const y = window.scrollY;
    let ok = false;
    let note = ans.source === 'cache' ? '缓存命中' : `模型作答 ${Math.round(conf * 100)}%`;

    try {
      if (q.type === 'blank') {
        const res = await F.fillBlanks(q, ans.blanks || []);
        ok = res.ok;
        if (!res.complete) note = '部分空未填';
      } else if (q.type === 'short') {
        ok = F.fillEditor(q, ans.text || '');
      } else {
        ok = F.choose(q, ans.indices || [], q.type);
      }

      if (ok && settings.mode === 'exam' && (q.type === 'blank' || q.type === 'short')) {
        if (F.save(q)) await sleep(700);
      }
    } catch (e) {
      ok = false;
      note = '写入异常：' + (e?.message || e);
      log('error', `第 ${q.index + 1} 题写入异常：${e?.message || e}`);
    }

    window.scrollTo(0, y);
    F.mark(q, ok ? 'ok' : 'fail', note);
    if (ok) { filled += 1; doneKeys.add(q.key); } else failed.push(q.index + 1);
    log(ok ? 'info' : 'warn', `第 ${q.index + 1} 题[${q.type}] ${ok ? '已填' : '失败'}（${note}）`);
    report('整卷模式', `已填 ${filled}/${total}`, ok ? 'ok' : 'work');
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

  NS.cxMain = { start, stop: () => stop('调试停止') };
})();
