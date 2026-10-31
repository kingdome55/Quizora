(() => {
  if (window.__wg?.cxAdapter) return;
  const NS = (window.__wg = window.__wg || {});
  const HUD_ID = '__wg_hud';
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
  }
  const CONTAINER_SELECTORS = [
    '.questionLi',
    '.TiMu',
    '[class*="questionLi"]',
    '[class*="TiMu"]',
    '.exam-question',
    '.question-item',
    '.questionItem',
    '[class*="questionItem"]',
    '[class*="question-item"]',
    '.work-question',
    '.mark_item',
    '[typeName]',
    '[data-type]',
    '[questiontype]'
  ];
  const LABEL_RE = /[（(【\[]\s*(单选题|多选题|判断题|填空题|简答题|论述题|名词解释)/;
  const LABEL_BARE_RE = /^\s*(?:第?\d+[题.、)）]?\s*)?(单选题|多选题|判断题|填空题|简答题|论述题|名词解释)/;
  const TYPE_ANY_RE = /单选题|多选题|判断题|填空题|简答题|论述题|名词解释|主观题/;
  const TYPE_ATTRS = ['typeName', 'typename', 'data-type', 'data-typename', 'questiontype', 'data-questiontype'];
  const TYPE_MAP = {
    单选题: 'single',
    多选题: 'multiple',
    判断题: 'judge',
    填空题: 'blank',
    简答题: 'short',
    论述题: 'short',
    名词解释: 'short'
  };
  function typeFromText(text) {
    const s = norm(text);
    if (/多项选择|多选题|multi/i.test(s)) return 'multiple';
    if (/单项选择|单选题|single/i.test(s)) return 'single';
    if (/判断题|判断|judge/i.test(s)) return 'judge';
    if (/填空题|填空|blank|fill/i.test(s)) return 'blank';
    if (/简答题|论述题|名词解释|主观题|short|essay/i.test(s)) return 'short';
    return null;
  }
  function attrType(el) {
    let cur = el;
    for (let i = 0; i < 6 && cur && cur !== document.body; i += 1) {
      for (const name of TYPE_ATTRS) {
        try {
          const value = cur.getAttribute?.(name);
          const type = value ? typeFromText(value) : null;
          if (type) return type;
        } catch {}
      }
      cur = cur.parentElement;
    }
    return null;
  }
  function hasTypeLabel(el) {
    const head = norm(el.innerText).slice(0, 120);
    return LABEL_RE.test(head) || LABEL_BARE_RE.test(head) || TYPE_ANY_RE.test(head.slice(0, 40)) || Boolean(attrType(el));
  }
  function hasAnswerable(el) {
    return Boolean(
      el.querySelector(
        'input:not([type="hidden"]), textarea, iframe, .edui-editor, .cke_editable, .ql-editor, ' +
          '[contenteditable]:not([contenteditable="false"]), [class*="answerEditor" i], ' +
          '.Answer, .ui-input-text, .answerBg, [class*="answerBg"], [class*="answerItem"], [class*="optionItem"], ' +
          '.Zy_ul, .Zy_ulTop, [class*="Zy_ul"]'
      )
    );
  }
  function roots() {
    const list = [document];
    for (const frame of document.querySelectorAll('iframe, frame')) {
      try {
        const doc = frame.contentDocument;
        if (doc?.body) list.push(doc);
      } catch {}
    }
    return list;
  }
  function outermost(nodes) {
    return nodes.filter((el) => !nodes.some((other) => other !== el && other.contains(el)));
  }
  function pickQuestionNodes(nodes) {
    const kept = outermost(nodes);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < kept.length; i += 1) {
        const el = kept[i];
        const inner = outermost(nodes.filter((other) => other !== el && el.contains(other)));
        if (inner.length > 1) {
          kept.splice(i, 1, ...inner);
          changed = true;
          break;
        }
      }
    }
    return outermost(kept);
  }
  function findContainers() {
    const nodes = [];
    for (const sel of CONTAINER_SELECTORS) {
      for (const root of roots()) {
        let found = [];
        try {
          found = [...root.querySelectorAll(sel)];
        } catch {
          continue;
        }
        for (const el of found) {
          try {
            if (isVisible(el) && (hasAnswerable(el) || hasTypeLabel(el))) nodes.push(el);
          } catch {}
        }
      }
    }
    if (!nodes.length) return [];
    return pickQuestionNodes([...new Set(nodes)]);
  }
  let labelCache = { at: 0, blocks: [] };
  function labelBlocks() {
    if (Date.now() - labelCache.at < 1200) return labelCache.blocks;
    const labels = [];
    for (const root of roots()) {
      let all = [];
      try {
        all = root.querySelectorAll('i, span, b, strong, em, div, p, li, h3, h4, label');
      } catch {
        continue;
      }
      for (const el of all) {
        try {
          if (!isVisible(el)) continue;
          const head = norm(el.innerText).slice(0, 120);
          if (!head || !(LABEL_RE.test(head) || LABEL_BARE_RE.test(head))) continue;
          labels.push(el);
        } catch {}
      }
    }
    const leafLabels = labels.filter((el) => !labels.some((other) => other !== el && el.contains(other)));
    const blocks = [];
    for (const label of leafLabels) {
      let cur = label;
      let best = null;
      for (let i = 0; i < 7 && cur && cur !== document.body; i += 1) {
        cur = cur.parentElement;
        if (!cur) break;
        if (leafLabels.some((other) => other !== label && cur.contains(other))) break;
        if (norm(cur.innerText).length > 3000) break;
        best = cur;
      }
      if (best) blocks.push(best);
    }
    const leaf = outermost(blocks).filter((el) => {
      try {
        return isVisible(el) && norm(el.innerText).length > 8;
      } catch {
        return false;
      }
    });
    labelCache = { at: Date.now(), blocks: leaf };
    return leaf;
  }
  function visibleNear(el) {
    let cur = el;
    for (let i = 0; i < 3 && cur; i += 1) {
      try {
        if (isVisible(cur)) return true;
      } catch {}
      cur = cur.parentElement;
    }
    return false;
  }
  function blockFor(group, root) {
    const set = new Set(group);
    let cur = group[0];
    let best = null;
    const body = root.body || document.body;
    for (let i = 0; i < 8 && cur && cur !== body; i += 1) {
      cur = cur.parentElement;
      if (!cur || cur === body) break;
      let others = 0;
      let tooMany = false;
      try {
        const nodes = cur.querySelectorAll(
          'input[type="radio"], input[type="checkbox"], .answerBg, [class*="answerBg"], ' +
            '[class*="optionItem"], textarea, .edui-editor'
        );
        for (const node of nodes) {
          if (set.has(node)) continue;
          others += 1;
          if (others > 2) {
            tooMany = true;
            break;
          }
        }
      } catch {}
      if (tooMany) break;
      if (norm(cur.innerText).length > 2500) break;
      best = cur;
    }
    return best;
  }
  function controlBlocks() {
    const out = [];
    const noise = (el) =>
      /search|comment|discuss|chat|reply|note/i.test(
        `${el.placeholder || ''} ${el.id || ''} ${String(el.className || '')} ` +
          `${el.closest?.('[class*="search" i], [class*="comment" i], [class*="discuss" i], [class*="note" i], [class*="chat" i], .formNote, .dotNote_box')?.className || ''}`
      );
    for (const root of roots()) {
      const groups = new Map();
      const add = (key, node) => {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(node);
      };
      let inputs = [];
      try {
        inputs = root.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      } catch {}
      for (const input of inputs) {
        try {
          if (input.disabled || !visibleNear(input)) continue;
          add(
            input.name
              ? 'n:' + input.name
              : input.closest('ul, ol, [class*="answer" i], [class*="option" i]') || input.parentElement,
            input
          );
        } catch {}
      }
      let boxes = [];
      try {
        boxes = root.querySelectorAll('.answerBg, [class*="answerBg"], [class*="optionItem"]');
      } catch {}
      for (const box of boxes) {
        try {
          if (!isVisible(box)) continue;
          add(box.parentElement || box, box);
        } catch {}
      }
      let editors = [];
      try {
        editors = root.querySelectorAll('textarea, .edui-editor, .cke_editable, .ql-editor, [contenteditable="true"]');
      } catch {}
      for (const editor of editors) {
        try {
          if (noise(editor) || !visibleNear(editor)) continue;
          add(editor, editor);
        } catch {}
      }
      for (const group of groups.values()) {
        const block = blockFor(group, root);
        if (block) out.push(block);
      }
    }
    return outermost([...new Set(out)].slice(0, 120));
  }
  function optionText(box) {
    let text = norm(box.innerText || box.textContent);
    if (text.length > 240) {
      const inner = box.querySelector('p, span');
      if (inner) text = norm(inner.innerText);
    }
    return text.replace(/^[A-Za-z][.、)]\s*/, '').replace(/^\d+[.、)]\s*/, '').replace(/^[A-Da-d]\s+/, '').trim();
  }
  function optionInfo(input, root) {
    let box =
      input.closest('label') ||
      input.closest('.answerBg, .answer_p, .option, .choice, li');
    if (!box || box === root) {
      let cur = input.parentElement;
      for (let i = 0; i < 3 && cur && cur !== root; i += 1) {
        const text = norm(cur.innerText);
        if (text && text.length <= 200) {
          box = cur;
          break;
        }
        cur = cur.parentElement;
      }
    }
    box = box || input.parentElement;
    return { text: optionText(box), box };
  }
  function collectChoice(el) {
    const inputs = [...el.querySelectorAll('input[type="radio"], input[type="checkbox"]')].filter((i) => !i.disabled);
    if (inputs.length) {
      const options = [];
      for (const input of inputs) {
        const info = optionInfo(input, el);
        if (!info.text) continue;
        options.push({ index: options.length, text: info.text, input, box: info.box });
      }
      return options;
    }
    return collectDivChoice(el);
  }
  function collectDivChoice(el) {
    const boxes = [...el.querySelectorAll(
      '.answerBg, [class*="answerBg"], [class*="answerItem"], [class*="optionItem"], .Zy_ul li, .Zy_ulTop li, [class*="Zy_ul"] li'
    )].filter(isVisible).filter((b, i, arr) => !arr.some((o) => o !== b && b.contains(o)));
    if (!boxes.length) return NS.cxPlain?.collect?.(el) || [];
    const seen = new Set();
    return boxes.reduce((out, box) => {
      const text = optionText(box);
      if (text && text.length <= 200 && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        out.push({ index: out.length, text, el: box, box, input: null });
      }
      return out;
    }, []);
  }
  function judgeOptions(options) {
    return options.length === 2 && options.every((o) => /^(对|错|正确|错误|是|否|true|false)$/i.test(o.text));
  }
  function detectType(el, options) {
    const attr = attrType(el);
    if (attr) return attr;
    const head = norm(el.innerText).slice(0, 120);
    const m = head.match(LABEL_RE);
    if (m) return TYPE_MAP[m[1]];
    const bare = head.match(LABEL_BARE_RE);
    if (bare) return TYPE_MAP[bare[1]];
    if (/简答题|论述题|名词解释|主观题/.test(head)) return 'short';
    const hasChoiceInput = el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (!hasChoiceInput && options.length >= 2) return judgeOptions(options) ? 'judge' : 'single';
    if (el.querySelector('input[type="checkbox"]')) return 'multiple';
    if (el.querySelector('input[type="radio"]')) return judgeOptions(options) ? 'judge' : 'single';
    if (el.querySelector('iframe[id*="ueditor" i], .edui-editor, textarea, [contenteditable="true"]')) return 'short';
    if (el.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])')) return 'blank';
    return 'unknown';
  }
  function cleanStem(text) {
    return norm(text)
      .replace(/[（(【\[]\s*(单选题|多选题|判断题|填空题|简答题|论述题|名词解释)[^）)】\]]*[）)】\]]/g, '')
      .replace(/^\s*(?:第\s*\d+\s*题\s*[.、,，]?\s*|\d+\s*[.、,，)）]\s*)/, '')
      .replace(/\s*\d+\s*分\s*$/, '')
      .trim();
  }
  const STEM_SELECTORS = ['.mark_name', '.Zy_TItle', '.stem', '.question-title', '.timu', 'h3', 'h4'];
  function findStem(el) {
    for (const sel of STEM_SELECTORS) {
      const node = el.querySelector(sel);
      const text = node ? norm(node.innerText) : '';
      if (text.length > 3) return cleanStem(text);
    }
    for (const child of el.children) {
      if (child.querySelector('input, textarea, iframe')) continue;
      const text = norm(child.innerText);
      if (text.length > 6) return cleanStem(text);
    }
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input, textarea, iframe, .answerBg, .Answer, .answer_p, .edui-editor, label').forEach((n) => n.remove());
    return cleanStem(clone.innerText).slice(0, 300);
  }
  function collectInputs(el, type) {
    if (type !== 'blank') return [];
    return [...el.querySelectorAll('input, textarea, [contenteditable]:not([contenteditable="false"])')].filter((node) => {
      if (node.tagName === 'INPUT') {
        const t = (node.getAttribute('type') || 'text').toLowerCase();
        if (['radio', 'checkbox', 'hidden', 'button', 'submit', 'file', 'image'].includes(t) || node.disabled) return false;
      }
      return isVisible(node);
    });
  }
  function collectEditor(el, type) {
    if (!['short', 'blank'].includes(type)) return { textarea: null, iframe: null, editable: null };
    const textarea = el.querySelector('textarea[name^="answerEditor"], textarea.answerText, textarea');
    const iframe = [...el.querySelectorAll('iframe')].find(
      (f) => /ueditor/i.test(f.id || '') || /ueditor/i.test(f.className || '')
    ) || el.querySelector('iframe');
    const editable = el.querySelector('[contenteditable="true"]');
    return { textarea, iframe, editable };
  }
  function isSelected(opt) {
    if (opt.input) return opt.input.checked;
    const el = opt.el;
    if (!el) return false;
    const raw = String(el.className || '') + ' ' + String(el.querySelector('a, i, span')?.className || '');
    if (/\b(check_answer_bg|check_answer|cur|selected|checked|active|choosed|choose)\b/i.test(raw)) return true;
    return ['aria-checked', 'aria-selected', 'data-checked', 'data-selected'].some(
      (attr) => el.getAttribute(attr) === 'true'
    );
  }
  function isAnswered(q) {
    if (q.options?.length) {
      const n = q.options.filter((o) => isSelected(o)).length;
      if (q.type === 'multiple' ? n > 0 && n < q.options.length : n === 1) return true;
    }
    if (q.inputs?.some((i) => norm(i.isContentEditable ? i.innerText : i.value) && !/^请输入/.test(norm(i.isContentEditable ? i.innerText : i.value)))) return true;
    if (q.textarea && norm(q.textarea.value) && !/^请输入/.test(norm(q.textarea.value))) return true;
    if (q.editable && norm(q.editable.innerText) && !/^请输入/.test(norm(q.editable.innerText))) return true;
    if (q.iframe) {
      try {
        const body = q.iframe.contentDocument?.body;
        if (body && norm(body.innerText)) return true;
      } catch {}
    }
    return false;
  }
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }
  function collectImages(el) {
    const area = (img) => (img.naturalWidth || img.width) * (img.naturalHeight || img.height);
    const big = (img) => isVisible(img) && (img.naturalWidth || img.width) >= 120 && (img.naturalHeight || img.height) >= 80;
    return [...el.querySelectorAll('img')]
      .filter(big)
      .sort((a, b) => area(b) - area(a))
      .slice(0, 2)
      .map((img) => img.currentSrc || img.getAttribute('data-src') || img.getAttribute('data-original') || img.src)
      .filter(Boolean);
  }
  function buildQuestion(el, index) {
    const choicePreview = collectChoice(el);
    const type = detectType(el, choicePreview);
    const options = ['single', 'multiple', 'judge'].includes(type) ? choicePreview : [];
    const inputs = collectInputs(el, type);
    const { textarea, iframe, editable } = collectEditor(el, type);
    const stem = findStem(el);
    const q = {
      index,
      el,
      type,
      stem,
      options,
      inputs,
      textarea,
      iframe,
      editable,
      images: collectImages(el),
      blankCount: inputs.length || (textarea || iframe || editable ? 1 : 0),
      answered: false
    };
    q.answered = isAnswered(q);
    q.key = hash(`${type}|${stem}|${options.map((o) => o.text).join('|')}`);
    return q;
  }
  function mergeContainers(primary, extra) {
    const pool = extra.filter((el, i, arr) => {
      if (arr.some((other, j) => j !== i && other !== el && other.contains(el))) return false;
      const inner = arr.filter((other, j) => j !== i && other !== el && el.contains(other));
      return inner.length <= 1;
    });
    if (!primary.length) return pool;
    if (primary.length === 1 && pool.length > 1 && pool.every((el) => primary[0].contains(el))) return pool;
    const out = [...primary];
    for (const el of pool) {
      if (out.some((other) => other === el || other.contains(el) || el.contains(other))) continue;
      out.push(el);
    }
    return out;
  }
  function scan() {
    const extras = [].concat(labelBlocks(), controlBlocks(), NS.cxGeneric?.find?.() || []);
    const containers = mergeContainers(findContainers(), extras);
    const questions = [];
    containers.forEach((el, i) => {
      if (el.ownerDocument !== document) return;
      try {
        const q = buildQuestion(el, i);
        if (q.type !== 'unknown' || q.options.length || q.inputs.length || q.textarea || q.iframe || q.editable) {
          questions.push(q);
        }
      } catch {}
    });
    const types = {};
    for (const q of questions) types[q.type] = (types[q.type] || 0) + 1;
    return { mode: 'exam', url: location.href, count: questions.length, types, questions };
  }
  function selectorStats() {
    const out = {};
    for (const sel of CONTAINER_SELECTORS) {
      let raw = 0;
      let visible = 0;
      let labelled = 0;
      for (const root of roots()) {
        let found = [];
        try {
          found = root.querySelectorAll(sel);
        } catch {
          continue;
        }
        for (const el of found) {
          raw += 1;
          try {
            if (isVisible(el)) visible += 1;
          } catch {}
          try {
            if (hasTypeLabel(el)) labelled += 1;
          } catch {}
        }
      }
      out[sel] = { raw, visible, labelled };
    }
    return out;
  }
  function snapshot() {
    let res = null;
    try {
      res = scan();
    } catch (e) {
      res = { mode: 'exam', url: location.href, count: 0, types: {}, questions: [], error: String(e?.message || e) };
    }
    const snap = {
      mode: 'exam',
      url: res.url,
      count: res.count,
      types: res.types,
      questions: res.questions.slice(0, 8).map((q) => ({
        index: q.index,
        type: q.type,
        stem: q.stem.slice(0, 160),
        options: q.options.map((o) => o.text).slice(0, 6),
        blanks: q.blankCount,
        hasEditor: Boolean(q.textarea || q.iframe || q.editable),
        images: q.images.length,
        answered: q.answered
      }))
    };
    if (!res.count) {
      let diagnostics = null;
      try {
        diagnostics = NS.cxDebug?.diagnostics?.() || null;
      } catch {}
      snap.diagnostics = { ...(diagnostics || {}), selectors: selectorStats(), error: res.error || '' };
    }
    return snap;
  }
  NS.cxAdapter = { scan, snapshot, isAnswered, isSelected };
})();
