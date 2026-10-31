(() => {
  if (window.__wg?.cxDebug) return;
  const NS = (window.__wg = window.__wg || {});
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const LABEL_RE = /[（(【\[]\s*(单选题|多选题|判断题|填空题|简答题|论述题|名词解释)/;
  const BARE_RE = /^\s*(?:第?\d+[题.、)）]?\s*)?(单选题|多选题|判断题|填空题|简答题|论述题|名词解释)/;
  const ATTRS = ['typeName', 'typename', 'data-type', 'data-typename', 'questiontype'];

  function diagnostics() {
    const iframes = [...document.querySelectorAll('iframe, frame')].slice(0, 10).map((f) => {
      let accessible = false;
      try { accessible = Boolean(f.contentDocument?.body); } catch {}
      return {
        id: f.id || f.name || '',
        cls: String(f.className || '').slice(0, 60),
        src: (f.getAttribute('src') || '').slice(0, 100),
        accessible
      };
    });
    const counts = {
      inputs: document.querySelectorAll('input').length,
      textareas: document.querySelectorAll('textarea').length,
      editables: document.querySelectorAll('[contenteditable]:not([contenteditable="false"])').length,
      editors: document.querySelectorAll('.edui-editor, .cke_editable, .ql-editor, [class*="answerEditor"]').length,
      optionBlocks: document.querySelectorAll('.answerBg, [class*="answerBg"], [class*="answerItem"], [class*="optionItem"]').length,
      answers: document.querySelectorAll('.Answer, .ui-input-text').length
    };
    const typeNames = [];
    for (const el of document.querySelectorAll('[typeName], [data-type], [questiontype]')) {
      const value = ATTRS.map((a) => el.getAttribute(a)).filter(Boolean)[0] || '';
      typeNames.push({ cls: String(el.className || '').slice(0, 50), value: String(value).slice(0, 24) });
      if (typeNames.length >= 8) break;
    }
    const labels = [];
    const all = document.querySelectorAll('i, span, b, strong, em, div, p, li, h3, h4, label');
    for (const el of all) {
      const text = norm(el.innerText).slice(0, 90);
      if (!text || !(LABEL_RE.test(text) || BARE_RE.test(text))) continue;
      labels.push({ cls: String(el.className || '').slice(0, 60), text });
      if (labels.length >= 10) break;
    }
    const html = document.body ? norm(document.body.innerHTML).slice(0, 180) : '';
    return { iframes, counts, typeNames, labels, html };
  }

  NS.cxDebug = { diagnostics };
})();
