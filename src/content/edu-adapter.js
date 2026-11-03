(() => {
  if (window.__wg?.eduAdapter) return;
  const NS = (window.__wg = window.__wg || {});

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const text = (el) => norm(el?.innerText || (el?.tagName === 'INPUT' ? el.value : '') || el?.textContent || '');

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
  }

  function innermost(list) {
    return list.filter((el) => !list.some((other) => other !== el && el.contains(other)));
  }

  function allButtons() {
    return [
      ...document.querySelectorAll('button, [role="button"], .v-btn, a, input[type="button"], input[type="submit"]')
    ].filter(isVisible);
  }

  function findExact(label) {
    const list = allButtons().filter((el) => {
      const t = text(el);
      if (!t || t.length > label.length + 6 || !t.includes(label)) return false;
      if (/记录|历史|详情|结果|说明/.test(t)) return false;
      return true;
    });
    return innermost(list)[0] || null;
  }

  function findLike(re) {
    const list = allButtons().filter((el) => {
      const t = text(el);
      return t.length <= 12 && re.test(t);
    });
    return innermost(list)[0] || null;
  }

  function isDisabled(el) {
    if (!el) return true;
    const t = text(el);
    if (/\d+\s*秒|倒计时|冷却|等待|稍后/.test(t)) return true;
    return (
      Boolean(el.disabled) ||
      el.getAttribute('aria-disabled') === 'true' ||
      /v-btn--disabled|disabled/i.test(String(el.className || ''))
    );
  }

  function cooldownText() {
    const re = /评测.*(频繁|冷却|稍后)|请.*秒后.*(评测|再试)|评测.*(?:等待|倒计时)|(?:冷却|倒计时)\s*\d+/;
    const list = [
      ...document.querySelectorAll(
        'button, [role="button"], .v-btn, [class*="toast"], [class*="message"], [class*="notice"], [class*="tip"], [class*="alert"], .test-result'
      )
    ].filter(isVisible);
    for (const el of list) {
      const t = text(el);
      if (!t || t.length > 100) continue;
      if (re.test(t)) return t.slice(0, 100);
    }
    return '';
  }

  function click(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {}
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch {}
    }
    return true;
  }

  function findTextExact(label) {
    const list = [...document.querySelectorAll('a, button, div, span, li, [role="tab"]')].filter(
      (el) => isVisible(el) && text(el) === label
    );
    return innermost(list)[0] || null;
  }

  function clickTab(label) {
    const el = findTextExact(label);
    if (!el) return false;
    return click(el);
  }

  async function readAnswerPanel(timeout = 10000) {
    clickTab('参考答案');
    const start = Date.now();
    let best = '';
    while (Date.now() - start < timeout) {
      const inner = [...document.querySelectorAll('.answer-content [id^="answer-content-"]')].filter(isVisible);
      const nodes = inner.length ? inner : [...document.querySelectorAll('.answer-content')].filter(isVisible);
      for (const el of nodes) {
        const t = String(el.innerText || el.textContent || '').trim();
        if (!t || /禁止复制参考答案/.test(t)) continue;
        if (t.length > best.length) best = t;
      }
      if (best) {
        clickTab('学习内容');
        return best;
      }
      await sleep(400);
    }
    return '';
  }

  function marker(re) {
    const hits = [...document.querySelectorAll('div, section, span, h1, h2, h3, h4, p, strong, label')].filter((el) => {
      if (!isVisible(el)) return false;
      const t = text(el);
      return t.length <= 40 && re.test(t);
    });
    return innermost(hits)[0] || null;
  }

  function description() {
    const found = marker(/^(任务描述|任务说明|题目描述)$/);
    if (found) {
      let cur = found.parentElement;
      for (let i = 0; i < 5 && cur && cur !== document.body; i += 1) {
        if (cur.querySelector?.('.monaco-editor')) break;
        const t = text(cur);
        if (t.length >= 60 && t.length <= 12000) return t;
        cur = cur.parentElement;
      }
    }
    const vw = window.innerWidth || 1200;
    let best = '';
    for (const el of document.querySelectorAll('div, section, article, main')) {
      if (el === document.body || !isVisible(el)) continue;
      if (el.querySelector?.('.monaco-editor')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.left > vw * 0.62 || rect.width < vw * 0.22 || rect.height < 120) continue;
      if (el.children.length > 40) continue;
      const t = text(el);
      if (t.length < 60 || t.length > 12000) continue;
      if (t.length > best.length) best = t;
    }
    return best;
  }

  function taskTitle() {
    const raw = String(document.title || '').trim();
    const cleaned = raw.replace(/\s*[-_|–]\s*(头歌|EduCoder|实践教学平台).*$/i, '').trim();
    if (cleaned && !/^(头歌|EduCoder|实践教学平台)$/i.test(cleaned)) return cleaned.slice(0, 120);
    const desc = description();
    const first = desc.split(/[。\n]/)[0] || '';
    return first.length <= 80 ? first : '';
  }

  function blocked() {
    if (/\/exam\b/i.test(location.pathname)) return 'URL 为考试页';
    const body = norm(document.body?.innerText || '');
    if (/考试剩余时间|交卷|监考|切屏检测|考试进行中/.test(body)) return '页面出现考试/交卷标识';
    return '';
  }

  function resultPanelText() {
    const found = marker(/测试结果|评测结果/);
    if (!found) return '';
    // 结果面板通常是 marker 的父/祖父容器；取其整个文本，避免只拿到标题
    const headLen = text(found).length;
    const pick = (el) =>
      el && !el.querySelector?.('.monaco-editor') && text(el).length > headLen ? el : null;
    const container = pick(found.parentElement) || pick(found.parentElement?.parentElement);
    if (container) {
      const t = text(container);
      if (t.length <= 6000) return t;
    }
    // 部分布局中结果正文是标题的下一个兄弟节点
    const sib = found.nextElementSibling;
    if (sib && !sib.querySelector?.('.monaco-editor')) {
      const t = text(sib);
      if (t.length > 1 && t.length <= 6000) return t;
    }
    const candidates = [];
    let cur = found.parentElement;
    for (let i = 0; i < 4 && cur && cur !== document.body; i += 1) {
      if (cur.querySelector?.('.monaco-editor')) break;
      const t = text(cur);
      if (t.length > headLen && t.length <= 6000) candidates.push(t);
      cur = cur.parentElement;
    }
    return candidates.find((t) => /测试集|用例|未通过|通过|错误|失败|评测/.test(t)) || candidates[0] || text(found);
  }

  function readResult() {
    const panel = resultPanelText();
    const t = panel || '';
    const failure = /未通过|不通过|评测失败|答案错误|编译错误|运行错误|格式错误|超时|错误详情|请检查/.test(t);
    const success =
      !failure &&
      (/(恭喜|全部通过|评测通过|通过评测|答案正确|测试通过|满分|通过率\s*100|100\s*分)/.test(t) ||
        /(^|[\s，。:：])通过($|[\s，。])/.test(t) ||
        /\bAC\b/.test(t));
    return { text: t, success, failure, panel: Boolean(panel) };
  }

  function snapshot() {
    const reason = blocked();
    const hasEditor = Boolean(
      document.querySelector(
        '.monaco-editor, .monaco-editor textarea, .ace_editor, .CodeMirror, .cm-editor, .cm-content[contenteditable="true"], [role="textbox"]'
      )
    );
    const desc = description();
    const evalBtn = findExact('评测');
    const nextBtn = findLike(/^(下一关|下一题|继续|进入下一关)$/);
    const title = taskTitle();
    const taskPath = /\/tasks\//i.test(location.pathname);
    const count = !reason && (taskPath || hasEditor) && (hasEditor || evalBtn) ? 1 : 0;
    const question = {
      index: 0,
      type: 'code',
      stem: `${title || '编程题'}${desc ? ' · ' + desc.slice(0, 60) : ''}`,
      options: [],
      blanks: 0,
      hasEditor,
      images: 0,
      answered: false
    };
    return {
      mode: 'exam',
      site: 'educoder',
      url: location.href,
      count,
      types: count ? { code: 1 } : {},
      questions: count ? [question] : [],
      title,
      descriptionLength: desc.length,
      hasEditor,
      hasEvaluate: Boolean(evalBtn),
      hasNext: Boolean(nextBtn),
      blocked: Boolean(reason),
      buttons: allButtons()
        .map((el) => text(el))
        .filter((t) => t && t.length <= 10)
        .slice(0, 16),
      result: resultPanelText().slice(0, 300),
      diagnostics: reason
        ? { error: `已拒绝：${reason}` }
        : !hasEditor && !evalBtn
          ? { error: '未检测到编辑器与“评测”按钮' }
          : !evalBtn
            ? { warn: '“评测”按钮暂不可用，将在评测前等待' }
            : null
    };
  }

  function fingerprint() {
    return `${location.href}|${taskTitle()}|${description().slice(0, 400)}`;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout = 10000, interval = 300) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = fn();
      if (value) return value;
      await sleep(interval);
    }
    return null;
  }

  NS.eduAdapter = {
    snapshot,
    description,
    taskTitle,
    findExact,
    findLike,
    isDisabled,
    cooldownText,
    click,
    findTextExact,
    clickTab,
    readAnswerPanel,
    readResult,
    resultPanelText,
    fingerprint,
    blocked,
    sleep,
    waitFor
  };
})();
