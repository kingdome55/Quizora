(() => {
  if (window.__wg?.cxGeneric) return;
  const NS = (window.__wg = window.__wg || {});
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  };
  const STEM_RE = /[？?]|＿|____|【|（\s*(单选|多选|判断|填空|简答|论述|名词解释)/;
  const isSearch = (el) =>
    /search|搜索/i.test(`${el.placeholder || ''} ${el.closest('[class*="search" i]')?.className || ''}`);

  function questionFor(node) {
    let cur = node?.parentElement;
    let candidate = null;
    for (let i = 0; i < 8 && cur && cur !== document.body; i += 1) {
      const text = norm(cur.innerText);
      if (text.length > 2000) break;
      if (text.length >= 12) candidate = cur;
      if (STEM_RE.test(text)) return cur;
      cur = cur.parentElement;
    }
    return candidate;
  }

  function find() {
    const out = [];
    const push = (el) => {
      if (el && !out.includes(el)) out.push(el);
    };

    const inputs = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"]')].filter(visible);
    const grouped = new Map();
    for (const input of inputs) {
      const key = input.name || questionFor(input);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(input);
    }
    for (const group of grouped.values()) {
      if (group.length >= 2) push(questionFor(group[0]));
    }

    const custom = [...document.querySelectorAll(
      '[class*="answerBg" i], [class*="option" i], [class*="choice" i]'
    )].filter(visible);
    const parents = new Map();
    for (const opt of custom) {
      const parent = opt.parentElement;
      if (!parent) continue;
      if (!parents.has(parent)) parents.set(parent, []);
      parents.get(parent).push(opt);
    }
    for (const [parent, list] of parents) {
      if (list.length >= 2) push(questionFor(parent));
    }

    const fields = [...document.querySelectorAll(
      'textarea, input[type="text"], input:not([type]), [contenteditable="true"]'
    )].filter(visible);
    for (const field of fields) {
      if (isSearch(field)) continue;
      const box = questionFor(field);
      if (!box) continue;
      const text = norm(box.innerText);
      if (text.length >= 15 && text.length <= 800 && STEM_RE.test(text)) push(box);
    }

    return out
      .filter((el) => !out.some((other) => other !== el && other.contains(el)))
      .sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1))
      .slice(0, 60);
  }

  NS.cxGeneric = { find };
})();
