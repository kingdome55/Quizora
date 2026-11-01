(() => {
  if (window.__wg?.cxFill) return;
  const NS = (window.__wg = window.__wg || {});
  const A = NS.cxAdapter;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function setNativeValue(el, value) {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return;
    }
    const win = el.ownerDocument?.defaultView || window;
    const Ctor =
      el.tagName === 'TEXTAREA'
        ? win.HTMLTextAreaElement || HTMLTextAreaElement
        : win.HTMLInputElement || HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(Ctor.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clickBox(box) {
    if (!box) return;
    box.scrollIntoView({ block: 'center', inline: 'center' });
    try {
      box.click();
    } catch {
      box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  }

  function choose(q, indices, type) {
    if (!q.options.length) return false;
    const wanted = new Set(indices);
    let ok = true;

    for (const opt of q.options) {
      const desired = wanted.has(opt.index);
      if (type !== 'multiple' && !desired) continue;
      if (A.isSelected(opt) === desired) continue;

      if (opt.input) {
        clickBox(opt.box || opt.input);
        if (opt.input.checked !== desired && opt.input.type === 'radio' && desired) {
          opt.input.checked = true;
          opt.input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (opt.input.checked !== desired && opt.input.type === 'checkbox') {
          opt.input.checked = desired;
          opt.input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (opt.input.checked !== desired) ok = false;
      } else if (opt.el) {
        clickBox(opt.el.querySelector('a, .answer_p') || opt.box || opt.el);
      } else {
        ok = false;
      }
    }

    if (type !== 'multiple') {
      const selected = q.options.filter((o) => A.isSelected(o)).length;
      const hasInput = q.options.some((o) => o.input);
      if (hasInput && selected !== 1) ok = false;
      if (!hasInput && selected > 1) ok = false;
    }
    return ok;
  }

  function save(q) {
    if (!q.el) return false;
    const nodes = [...q.el.querySelectorAll('button, a, [role="button"], [class*="save" i]')];
    const btn = nodes.find((n) => norm(n.innerText) === '保存');
    if (!btn) return false;
    clickBox(btn);
    return true;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  }

  function allTextTargets() {
    return [...document.querySelectorAll('input, textarea, [contenteditable]:not([contenteditable="false"])')].filter(
      (el) => {
        if (el.tagName === 'INPUT') {
          const t = (el.getAttribute('type') || 'text').toLowerCase();
          if (['radio', 'checkbox', 'hidden', 'button', 'submit', 'file', 'image'].includes(t)) return false;
        }
        return true;
      }
    );
  }

  function findNewTarget(before) {
    return allTextTargets().find((el) => !before.has(el) && isTextTarget(el) && isVisible(el)) || null;
  }

  function findSiblingBox(cell) {
    const parent = cell?.parentElement;
    if (!parent) return null;
    return (
      [...parent.children]
        .filter((n) => {
          if (n === cell) return false;
          if (/第\s*\d+\s*空/.test(norm(n.innerText))) return false;
          if (n.querySelector('input, textarea, [contenteditable="true"]')) return false;
          const rect = n.getBoundingClientRect();
          return rect.width >= 100 && rect.height >= 15;
        })
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] || null
    );
  }

  function findAnswerOption(cell, answer) {
    const scope = cell?.parentElement || cell;
    const text = norm(answer);
    if (!scope || !text) return null;
    const opts = [...scope.querySelectorAll('[role="option"], .option, .option-item, li')].filter(isVisible);
    return (
      opts.find((el) => {
        const t = norm(el.innerText);
        return t && t !== text && t.includes(text) && !/第\s*\d+\s*空/.test(t);
      }) || null
    );
  }

  function splitCombinedBlanks(value, count) {
    const text = String(value || '').trim();
    if (!text || count < 2) return null;
    const parts = text
      .split(/\r?\n|；|;|、|\||｜|\s+\/\s+|／/)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length === count ? parts : null;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function freshInputs(q) {
    try {
      const list = A?.collectInputs?.(q.scope || q.el, 'blank');
      if (Array.isArray(list) && list.length) return list;
    } catch {}
    return q.inputs || [];
  }

  function inputValue(input) {
    return norm(input.isContentEditable ? input.innerText : input.value);
  }

  function isAnswerCell(cell) {
    if (/XztiHover/i.test(String(cell?.className || ''))) return true;
    return Boolean(cell?.querySelector?.('input, textarea, iframe, [contenteditable="true"]'));
  }

  function cellSlot(cell, fallback) {
    const prev = cell?.previousElementSibling;
    const m1 = norm(prev?.innerText || '').match(/第\s*(\d+)\s*空/);
    if (m1) return Number(m1[1]);
    const m2 = norm(cell?.innerText || '').match(/第\s*(\d+)\s*空/);
    if (m2) return Number(m2[1]);
    return fallback;
  }

  function cellForSlot(q, slot) {
    const cells = q.blankCells || [];
    return cells.find((cell) => cellSlot(cell, 0) === slot) || cells[slot - 1] || null;
  }

  function textInputIn(cell) {
    if (!cell) return null;
    const direct = cell.querySelector('input.inp');
    if (direct && !direct.disabled) return direct;
    return (
      [...cell.querySelectorAll('input')].find((el) => {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        return !['radio', 'checkbox', 'hidden', 'button', 'submit', 'file', 'image'].includes(t) && !el.disabled;
      }) || null
    );
  }

  function bg(msg) {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return Promise.resolve({ ok: false });
      const p = chrome.runtime.sendMessage(msg);
      return p && typeof p.then === 'function' ? p.catch(() => ({ ok: false })) : Promise.resolve({ ok: false });
    } catch {
      return Promise.resolve({ ok: false });
    }
  }

  function isTextTarget(el) {
    return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
  }

  function findBlankBoxes(cell) {
    if (!cell) return [];
    const nodes = [...cell.querySelectorAll('div, span, p, section, td')];
    return nodes
      .filter((n) => {
        if (!n.isConnected) return false;
        if (n.querySelector('input, textarea, [contenteditable="true"]')) return false;
        const rect = n.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 18;
      })
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)
      .slice(0, 2);
  }

  async function activateCell(cell) {
    if (!cell) return;
    const targets = [cell, ...findBlankBoxes(cell)];
    for (const target of targets) {
      try {
        target.scrollIntoView({ block: 'center', inline: 'center' });
        target.focus?.();
      } catch {}
      for (const type of [
        'pointerover',
        'pointerenter',
        'mouseover',
        'mouseenter',
        'mousemove',
        'pointerdown',
        'mousedown',
        'mouseup',
        'click'
      ]) {
        try {
          target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        } catch {}
      }
      await sleep(60);
    }
  }

  async function targetForSlot(q, i, answer) {
    const visibleInput = freshInputs(q)[i];
    if (visibleInput) return { el: visibleInput, visual: false };
    const cell = cellForSlot(q, i + 1);
    if (!cell) return null;

    const before = new Set(allTextTargets());
    await activateCell(cell);

    const created = findNewTarget(before);
    if (created) return { el: created, visual: false };
    const active = document.activeElement;
    if (isTextTarget(active)) return { el: active, visual: false };

    const parent = cell.parentElement;
    const parentInput = parent?.querySelector('input, textarea, [contenteditable]:not([contenteditable="false"])');
    if (parentInput) return { el: parentInput, visual: false };

    const option = findAnswerOption(cell, answer);
    if (option) return { option, visual: false };

    const box = findBlankBoxes(cell)[0] || findSiblingBox(cell);
    if (box) {
      try {
        box.tabIndex = 0;
        box.focus();
        box.contentEditable = 'true';
      } catch {}
      return { el: box, visual: true };
    }
    return null;
  }

  async function fillUEditor(cell, text) {
    const ta = cell.querySelector('textarea');
    const name = (ta?.getAttribute('name') || ta?.id || '').trim();
    let ok = false;

    // 内容直接写入 UEditor 的编辑 iframe（同源，跨 world 也可用）
    const iframe = cell.querySelector('iframe');
    if (iframe) {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          doc.body.innerHTML = toHtml(text);
          doc.body.dispatchEvent(new InputEvent('input', { bubbles: true }));
          ok = true;
        }
      } catch {}
    }

    // 主 world 调用 UE.getEditor(name).setContent()，与成熟实现一致
    if (name) {
      const res = await bg({ type: 'WG_UE_FILL', name, text });
      if (res?.ok) ok = true;
    }

    if (!ok && ta && isVisible(ta)) {
      try {
        setNativeValue(ta, text);
        ok = true;
      } catch {}
    }
    if (ok && ta) {
      try {
        ta.value = text;
      } catch {}
    }
    return ok;
  }

  async function fillCell(cell, text) {
    if (!cell) return false;
    const input = textInputIn(cell);
    if (input) {
      try {
        input.scrollIntoView({ block: 'center', inline: 'center' });
        input.focus?.();
        setNativeValue(input, text);
        return true;
      } catch {}
    }
    if (await fillUEditor(cell, text)) return true;
    const editable = cell.querySelector('[contenteditable="true"]');
    if (editable) {
      try {
        editable.focus();
        setNativeValue(editable, text);
        return true;
      } catch {}
    }
    return false;
  }

  async function fillAnswerCells(q, cells, list) {
    const ordered = cells
      .map((cell, i) => ({ cell, slot: cellSlot(cell, i + 1) }))
      .sort((a, b) => a.slot - b.slot);
    const target = Math.min(list.length, ordered.length);
    let done = 0;
    for (let i = 0; i < target; i += 1) {
      const cell = ordered[i].cell;
      const text = String(list[i] || '').trim();
      if (!text) continue;
      let ok = await fillCell(cell, text);
      if (!ok) {
        await activateCell(cell);
        await sleep(100);
        ok = await fillCell(cell, text);
      }
      if (ok) done += 1;
    }
    // 以页面真实答案格数量为准：答案少于格子时仍会标记“部分空未填”
    return { ok: done > 0, complete: done >= ordered.length, visual: false };
  }

  async function fillBlanks(q, blanks) {
    if (!blanks.length) return { ok: false, complete: false };
    const cells = q.blankCells || [];
    let list = blanks.map((s) => String(s || '').trim()).filter(Boolean);
    if (list.length === 1 && q.blankCount > 1) {
      const split = splitCombinedBlanks(list[0], q.blankCount);
      if (split) list = split;
    }
    const answerCells = cells.filter(isAnswerCell);
    if (answerCells.length) {
      return fillAnswerCells(q, answerCells, list);
    }

    let inputs = freshInputs(q);
    if (!inputs.length && q.blankCells?.length) {
      for (const cell of q.blankCells) await activateCell(cell);
      inputs = freshInputs(q);
    }
    if (!inputs.length && !q.blankCells?.length) {
      if (q.textarea || q.iframe || q.editable) {
        return { ok: fillEditor(q, list.join(' ')), complete: true };
      }
      return { ok: false, complete: false };
    }

    const target = Math.min(list.length, Math.max(inputs.length, q.blankCells?.length || 0));
    const filled = new Set();
    let visual = false;

    for (let i = 0; i < target; i += 1) {
      const hit = await targetForSlot(q, i, list[i]);
      if (!hit) continue;
      if (hit.option) {
        try {
          clickBox(hit.option);
          filled.add(i);
        } catch {}
        continue;
      }
      if (hit.visual) visual = true;
      try {
        hit.el.scrollIntoView({ block: 'center', inline: 'center' });
        hit.el.focus?.();
        setNativeValue(hit.el, list[i]);
        hit.el.blur?.();
        filled.add(i);
      } catch {}
    }

    // 页面可能重渲染；对仍为空的已定位输入补写一次
    await sleep(100);
    const current = freshInputs(q);
    for (let i = 0; i < target; i += 1) {
      if (filled.has(i) || !current[i] || inputValue(current[i])) continue;
      try {
        setNativeValue(current[i], list[i]);
        current[i].dispatchEvent(new Event('change', { bubbles: true }));
        filled.add(i);
      } catch {}
    }

    return { ok: filled.size > 0, complete: filled.size >= list.length, visual };
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function toHtml(text) {
    return String(text)
      .split(/\n+/)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('');
  }

  function editorFor(q) {
    try {
      const instants = window.UE?.instants;
      if (!instants) return null;
      return (
        Object.values(instants).find((ins) => {
          try {
            const dom = ins.container || ins.ui?.getDom?.();
            return Boolean(dom && q.el?.contains(dom));
          } catch {
            return false;
          }
        }) || null
      );
    } catch {
      return null;
    }
  }

  function fillEditor(q, text) {
    let ok = false;
    if (q.textarea) {
      setNativeValue(q.textarea, text);
      q.textarea.dispatchEvent(new Event('blur', { bubbles: true }));
      ok = true;
    }

    if (q.editable) {
      q.editable.focus();
      q.editable.innerHTML = toHtml(text);
      q.editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      ok = true;
    }

    const editor = editorFor(q);
    if (editor?.setContent) {
      try {
        editor.setContent(text);
        editor.focus?.();
        ok = true;
      } catch {}
    }

    if (q.iframe) {
      try {
        const id = q.textarea?.id || q.iframe.id?.replace(/ueditor_?/i, '');
        const byId = id && window.UE?.getEditor ? window.UE.getEditor(id) : null;
        if (byId?.setContent) {
          byId.setContent(text);
          byId.focus?.();
          ok = true;
        }
      } catch {}
      try {
        const body = q.iframe.contentDocument?.body;
        if (body) {
          body.innerHTML = toHtml(text);
          body.dispatchEvent(new InputEvent('input', { bubbles: true }));
          body.dispatchEvent(new Event('change', { bubbles: true }));
          ok = true;
        }
      } catch {}
    }

    if (editor && q.textarea) setNativeValue(q.textarea, text);
    return ok;
  }

  function mark(q, status, note) {
    try {
      const el = q.el;
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      let badge = el.querySelector(':scope > .__wg_cx_badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = '__wg_cx_badge';
        badge.style.cssText =
          'position:absolute;top:6px;right:8px;z-index:5;font:600 11px/1.4 "Microsoft YaHei",sans-serif;' +
          'padding:2px 7px;border-radius:9px;pointer-events:none;';
        el.appendChild(badge);
      }
      const colors = {
        ok: ['rgba(52,211,153,.16)', '#34d399'],
        skip: ['rgba(251,191,36,.14)', '#fbbf24'],
        fail: ['rgba(248,113,113,.14)', '#f87171']
      };
      const [bg, color] = colors[status] || colors.skip;
      badge.textContent = { ok: '已填', skip: '跳过', fail: '失败' }[status] || status;
      badge.style.background = bg;
      badge.style.color = color;
      badge.style.border = `1px solid ${color}66`;
      badge.title = note || '';
    } catch {}
  }

  function clearMarks() {
    document.querySelectorAll('.__wg_cx_badge').forEach((el) => el.remove());
  }

  NS.cxFill = { choose, fillBlanks, fillEditor, save, mark, clearMarks, setNativeValue };
})();
