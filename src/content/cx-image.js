(() => {
  if (window.__wg?.cxImage) return;
  const NS = (window.__wg = window.__wg || {});
  const cache = new Map();

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

  function resized(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          if (!width || !height) return resolve(dataUrl);
          const scale = Math.min(1, 1024 / Math.max(width, height));
          if (scale === 1 && dataUrl.length < 700000) return resolve(dataUrl);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function toDataUrl(url) {
    if (cache.has(url)) return cache.get(url);
    let dataUrl = url;
    if (!/^data:/i.test(url)) {
      const res = await send({ type: 'FETCH_IMAGE', url });
      if (!res?.ok || !res.dataUrl) return null;
      dataUrl = res.dataUrl;
    }
    if (dataUrl.length > 4_000_000) return null;
    const out = await resized(dataUrl);
    if (out) cache.set(url, out);
    return out;
  }

  async function prepare(urls) {
    const out = [];
    for (const url of (urls || []).slice(0, 2)) {
      const data = await toDataUrl(url);
      if (data) out.push(data);
    }
    return out;
  }

  NS.cxImage = { prepare };
})();
