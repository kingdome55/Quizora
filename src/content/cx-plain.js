(() => {
  if (window.__wg?.cxPlain) return;
  const NS = (window.__wg = window.__wg || {});
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  };
  const OPTION_RE = /^[A-Da-d](?:[.、)]|\s)/;

  function collect(el) {
    const nodes = [...el.querySelectorAll('li, div, p')].filter(
      (n) => visible(n) && OPTION_RE.test(norm(n.innerText)) && norm(n.innerText).length <= 160
    );
    const boxes = nodes.filter((n) => !nodes.some((o) => o !== n && n.contains(o)));
    const seen = new Set();
    return boxes.reduce((out, box) => {
      const text = norm(box.innerText).replace(/^[A-Da-d][.、)]?\s*/, '').trim();
      if (!text || seen.has(text)) return out;
      seen.add(text);
      out.push({ index: out.length, text, el: box, box, input: null });
      return out;
    }, []);
  }

  NS.cxPlain = { collect, count: (el) => collect(el).length };
})();
