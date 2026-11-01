(() => {
  if (window.__wg?.cxFont) return;
  const NS = (window.__wg = window.__wg || {});

  // 学习通 font-cxsecret 反爬：字体里真实字形被映射到随机汉字码位。
  // 方案来自成熟开源实现（超星字体解密 / Typr.js + 字形路径 MD5 映射表）：
  // 解析页面内嵌 TTF -> 计算每个码位的字形路径 MD5 -> 查表得到真实码位。
  const TABLE_PATH = 'src/vendor/cx-font-table.json';
  let readyPromise = null;
  let map = null; // encrypted codepoint -> real codepoint
  let info = { font: false, mapped: 0, reason: '' };

  function decodeBase64(b64) {
    const raw = atob(String(b64 || ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function fontBytes() {
    const docs = [document];
    try {
      if (window.parent && window.parent !== window) docs.push(window.parent.document);
      if (window.top && window.top !== window.parent && window.top !== window) docs.push(window.top.document);
    } catch {}
    for (const doc of docs) {
      for (const style of doc.querySelectorAll('style')) {
        const text = style.textContent || '';
        if (!text.includes('font-cxsecret')) continue;
        const b64 = text.match(/base64,([A-Za-z0-9+/=]+)/);
        if (b64) {
          try {
            return { bytes: decodeBase64(b64[1]), source: 'base64' };
          } catch {}
        }
        const url = text.match(/url\(['"]?([^'")]+\.(?:ttf|otf))['"]?\)/i);
        if (url) return { url: url[1], source: 'url' };
      }
    }
    return null;
  }

  async function loadFont() {
    const found = fontBytes();
    if (!found) return null;
    if (found.bytes) return found.bytes;
    const abs = new URL(found.url, location.href).href;
    const res = await fetch(abs);
    return new Uint8Array(await res.arrayBuffer());
  }

  function decrypt(text) {
    if (!map) return String(text || '');
    let out = '';
    const src = String(text || '');
    for (let i = 0; i < src.length; i += 1) {
      const code = src.charCodeAt(i);
      const real = map[code];
      out += real ? String.fromCharCode(real) : src[i];
    }
    return out;
  }

  function rewriteDom() {
    if (!map) return;
    const roots = document.querySelectorAll('.font-cxsecret');
    if (!roots.length) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (parent && parent.closest('.font-cxsecret')) nodes.push(node);
    }
    for (const node of nodes) {
      const next = decrypt(node.data);
      if (next !== node.data) node.data = next;
    }
  }

  async function init() {
    if (!window.Typr || !window.md5) {
      info.reason = 'Typr 未加载';
      return false;
    }
    let bytes = null;
    try {
      bytes = await loadFont();
    } catch (e) {
      info.reason = '字体读取失败：' + String(e?.message || e);
      return false;
    }
    if (!bytes) {
      info.reason = '未发现 font-cxsecret';
      return false;
    }
    let font = null;
    try {
      font = Typr.parse(bytes)[0];
    } catch (e) {
      info.reason = '字体解析失败：' + String(e?.message || e);
      return false;
    }
    if (!font) {
      info.reason = '字体为空';
      return false;
    }

    let table = null;
    try {
      const res = await fetch(chrome.runtime.getURL(TABLE_PATH));
      if (res.ok) table = await res.json();
    } catch {}
    if (!table) {
      // 页面 CSP 可能拦截内容脚本的扩展资源请求，改由 background 读取
      try {
        const res = await chrome.runtime.sendMessage({ type: 'WG_FONT_TABLE' });
        table = res?.table || null;
      } catch {}
    }
    if (!table) {
      info.reason = '映射表加载失败';
      return false;
    }

    map = {};
    for (let code = 19968; code <= 40869; code += 1) {
      const gid = Typr.U.codeToGlyph(font, code);
      if (!gid) continue;
      try {
        const key = md5(JSON.stringify(Typr.U.glyphToPath(font, gid))).slice(24);
        const real = table[key];
        if (real && real !== code) map[code] = real;
      } catch {}
    }
    info.font = true;
    info.mapped = Object.keys(map).length;
    info.reason = info.mapped ? '' : '字符未命中映射表';
    rewriteDom();
    return info.mapped > 0;
  }

  function ready() {
    if (!readyPromise) readyPromise = init().catch(() => false);
    return readyPromise;
  }

  NS.cxFont = {
    ready,
    decrypt,
    info: () => ({ ...info })
  };
  ready();
})();
