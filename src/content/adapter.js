(() => {
  if (window.__wg?.adapter) return;
  const NS = (window.__wg = window.__wg || {});

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const HUD_ID = '__wg_hud';
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
  }
  function clickableOf(el) {
    let cur = el;
    for (let i = 0; i < 5 && cur && cur !== document.body; i += 1) {
      if (cur.matches('button,[role="button"],[role="listitem"],[role="radio"],[tabindex]:not([tabindex="-1"])')) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return el;
  }
  function optionText(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) {
      const m = aria.match(/^option\s*\d+\s*[,:.\-]\s*(.+)$/i);
      if (m) return norm(m[1]);
    }
    let text = norm(el.innerText || el.textContent);
    text = text.replace(/^[A-Da-d][).:]\s+/, '');
    text = text.replace(/^[A-D]\s*\n\s*/, '');
    return text;
  }
  function findCounter() {
    const re = /\b(\d{1,3})\s*\/\s*(\d{1,3})\b/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let best = null;
    while (walker.nextNode()) {
      const text = norm(walker.currentNode.textContent);
      if (!text || text.length > 18) continue;
      const m = text.match(re);
      if (!m) continue;
      const el = walker.currentNode.parentElement;
      if (!isVisible(el) || el.closest('#' + HUD_ID)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.35) continue;
      const current = Number(m[1]);
      const total = Number(m[2]);
      if (total < 2 || current < 0 || current > total) continue;
      if (!best || rect.top < best.top) best = { current, total, el, top: rect.top };
    }
    return best ? { current: best.current, total: best.total, el: best.el } : null;
  }
  function optionCandidates() {
    const selectors = [
      '[role="listitem"]', '[role="button"]', '[role="radio"]', 'button',
      '[aria-label^="Option" i]', '[class*="option" i]', '[data-cy*="option" i]'
    ];
    const seen = new Set();
    const out = [];
    for (const sel of selectors) {
      let nodes = [];
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const node of nodes) {
        if (node.closest('#' + HUD_ID)) continue;
        const el = clickableOf(node);
        if (!el || seen.has(el) || !isVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < window.innerWidth * 0.1 || rect.height < 40) continue;
        if (rect.width > window.innerWidth * 0.96 && rect.height > window.innerHeight * 0.15) continue;
        const text = optionText(el);
        if (!text || text.length > 400) continue;
        seen.add(el);
        out.push({ el, text, rect, aria: el.getAttribute('aria-label') || '' });
      }
    }
    return out;
  }
  function groupOptions(cands) {
    const groups = new Map();
    for (const c of cands) {
      const parent = c.el.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(c);
    }
    let best = null;
    let bestScore = 0;
    for (const arr of groups.values()) {
      if (arr.length < 2 || arr.length > 8) continue;
      const areas = arr.map((x) => x.rect.width * x.rect.height);
      const ratio = Math.max(...areas) / Math.max(1, Math.min(...areas));
      if (ratio > 3) continue;
      const labeled = arr.filter((x) => /^option\s*\d/i.test(x.aria)).length;
      const score = arr.length * 10 + labeled * 6 + (ratio < 1.6 ? 6 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = arr;
      }
    }
    return best;
  }
  function findOptions() {
    const byNumber = new Map();
    for (const el of document.querySelectorAll('[aria-label]')) {
      const aria = el.getAttribute('aria-label') || '';
      const m = aria.match(/^option\s*(\d+)\s*[,:.\-]\s*(.+)$/i);
      if (!m || !isVisible(el) || el.closest('#' + HUD_ID)) continue;
      const rect = el.getBoundingClientRect();
      const n = Number(m[1]);
      const prev = byNumber.get(n);
      const area = rect.width * rect.height;
      if (!prev || area > prev.area) {
        byNumber.set(n, { el, text: norm(m[2]), rect, area, n, aria });
      }
    }
    if (byNumber.size >= 2) {
      const arr = [...byNumber.values()].sort((a, b) => a.n - b.n);
      return { options: arr.map((o, i) => ({ index: i, text: o.text, el: o.el })), strategy: 'aria' };
    }

    const group = groupOptions(optionCandidates());
    if (group && group.length >= 2) {
      const arr = [...group].sort((a, b) => {
        const dy = a.rect.top - b.rect.top;
        return Math.abs(dy) > 40 ? dy : a.rect.left - b.rect.left;
      });
      return { options: arr.map((o, i) => ({ index: i, text: o.text, el: o.el })), strategy: 'group' };
    }
    const geo = geometryOptions(optionCandidates());
    if (geo && geo.length >= 2) {
      const arr = [...geo].sort((a, b) => {
        const dy = a.rect.top - b.rect.top;
        return Math.abs(dy) > 40 ? dy : a.rect.left - b.rect.left;
      });
      return { options: arr.map((o, i) => ({ index: i, text: o.text, el: o.el })), strategy: 'geo' };
    }
    return { options: [], strategy: 'none' };
  }
  function geometryOptions(cands) {
    const arr = cands.filter((c) => {
      const w = c.rect.width / window.innerWidth;
      const h = c.rect.height / window.innerHeight;
      return w >= 0.12 && w <= 0.55 && h >= 0.05 && h <= 0.35 && c.text.length <= 200;
    });
    const seen = new Set();
    const uniq = [];
    for (const c of arr) {
      const key = norm(c.text).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(c);
    }
    return uniq.length >= 2 && uniq.length <= 8 ? uniq : null;
  }
  function findQuestion(options) {
    const optEls = options.map((o) => o.el);
    const nodes = document.querySelectorAll('div,p,span,h1,h2,h3,h4,strong');
    const cands = [];
    for (const el of nodes) {
      if (el.closest('#' + HUD_ID)) continue;
      if (optEls.includes(el) || optEls.some((o) => el.contains(o))) continue;
      if (!isVisible(el)) continue;
      const text = norm(el.innerText);
      if (text.length < 12 || text.length > 600) continue;
      if (/^\d{1,3}\s*\/\s*\d{1,3}$/.test(text)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top < 30 || rect.top > window.innerHeight * 0.65) continue;
      if (rect.height > window.innerHeight * 0.5) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
      if (fs < 14) continue;
      if (text.split(/\s+/).length < 4 && !/[?？]/.test(text)) continue;
      const leaf = el.children.length === 0;
      const score =
        fs * Math.min(text.length, 200) + (leaf ? 60 : 0) + (/[?？]/.test(text) ? 40 : 0);
      cands.push({ el, text, score });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    return { text: cands[0].text, el: cands[0].el };
  }
  function findInput() {
    for (const el of document.querySelectorAll('input, textarea, [contenteditable="true"]')) {
      if (el.closest('#' + HUD_ID)) continue;
      if (el.tagName === 'INPUT' && !['text', 'search', 'number', ''].includes((el.getAttribute('type') || '').toLowerCase())) continue;
      if (isVisible(el) && !el.disabled && !el.readOnly) return el;
    }
    return null;
  }
  function isLocked(el) {
    if (!el) return false;
    if (el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled')) return true;
    return getComputedStyle(el).pointerEvents === 'none';
  }
  function clickEl(el) {
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true }));
      el.dispatchEvent(new MouseEvent('mousedown', base));
      el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true }));
      el.dispatchEvent(new MouseEvent('mouseup', base));
      el.dispatchEvent(new MouseEvent('click', base));
    } catch {
      el.click();
    }
    return true;
  }
  function fillInput(el, text) {
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    } else {
      const proto =
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  function submitInput() {
    const els = document.querySelectorAll('button,[role="button"]');
    for (const el of els) {
      if (!isVisible(el)) continue;
      const text = norm(el.innerText || el.getAttribute('aria-label'));
      if (/^(submit|check|enter|提交|确定|check answer)/i.test(text)) {
        clickEl(el);
        return true;
      }
    }
    return false;
  }

  let highlighted = null;
  let originalStyle = null;
  function highlight(index, options) {
    clearHighlight();
    const el = options?.[index]?.el;
    if (!el) return;
    originalStyle = { outline: el.style.outline, outlineOffset: el.style.outlineOffset };
    el.style.setProperty('outline', '3px solid #a78bfa', 'important');
    el.style.setProperty('outline-offset', '3px', 'important');
    highlighted = el;
  }
  function clearHighlight() {
    if (!highlighted) return;
    highlighted.style.outline = originalStyle?.outline || '';
    highlighted.style.outlineOffset = originalStyle?.outlineOffset || '';
    highlighted = null;
    originalStyle = null;
  }
  function parse() {
    const counter = findCounter();
    const found = findOptions();
    const question = findQuestion(found.options);
    const input = findInput();
    return {
      url: location.href,
      counter,
      question: question?.text || '',
      questionEl: question?.el || null,
      options: found.options,
      strategy: found.strategy,
      input
    };
  }
  function snapshot() {
    const parsed = parse();
    return {
      url: parsed.url,
      counter: parsed.counter ? { current: parsed.counter.current, total: parsed.counter.total } : null,
      question: parsed.question,
      options: parsed.options.map((o) => ({ index: o.index, text: o.text })),
      input: Boolean(parsed.input),
      strategy: parsed.strategy
    };
  }

  NS.adapter = {
    parse, snapshot, clickEl, fillInput, submitInput, isLocked, highlight, clearHighlight
  };
})();
