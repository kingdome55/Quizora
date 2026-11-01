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

  async function fillBlanks(q, blanks) {
    if (!blanks.length) return { ok: false, complete: false };
    let inputs = freshInputs(q);
    if (!inputs.length) {
      if (q.textarea || q.iframe || q.editable) {
        return { ok: fillEditor(q, blanks.join(' ')), complete: true };
      }
      return { ok: false, complete: false };
    }
    let list = blanks.map((s) => String(s || '').trim()).filter(Boolean);
    if (list.length === 1 && inputs.length > 1) {
      const split = splitCombinedBlanks(list[0], inputs.length);
      if (split) list = split;
    }
    if (inputs.length < list.length && q.blankCells?.length) {
      for (const cell of q.blankCells) clickBox(cell);
      await sleep(80);
      inputs = freshInputs(q);
    }
    const count = Math.min(inputs.length, list.length);
    const writeAt = (i) => {
      const current = freshInputs(q);
      const input = current[i];
      if (!input) return false;
      input.scrollIntoView({ block: 'center', inline: 'center' });
      input.focus();
      setNativeValue(input, list[i]);
      input.blur();
      return true;
    };

    for (let i = 0; i < count; i += 1) writeAt(i);

    // 页面可能在输入后重新渲染输入框，重新查询并补写一次
    await sleep(100);
    let current = freshInputs(q);
    const missing = [];
    for (let i = 0; i < count; i += 1) {
      if (!inputValue(current[i] || {})) missing.push(i);
    }
    for (const i of missing) writeAt(i);
    if (missing.length) await sleep(80);

    current = freshInputs(q);
    let written = 0;
    for (let i = 0; i < Math.min(current.length, list.length); i += 1) {
      if (inputValue(current[i])) written += 1;
    }
    return { ok: written > 0, complete: written === current.length };
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
