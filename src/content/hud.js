(() => {
  const NS = (window.__wg = window.__wg || {});
  if (NS.hud) return;

  const TONES = {
    idle: '#8b8b9e',
    work: '#a78bfa',
    ok: '#34d399',
    warn: '#fbbf24',
    error: '#f87171'
  };

  let host = null;
  let root = null;
  let statusEl = null;
  let detailEl = null;
  let dotEl = null;
  let stopHandler = null;

  function ensure() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = '__wg_hud';
    host.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .card {
          box-sizing: border-box;
          width: 268px;
          padding: 12px 14px;
          border-radius: 18px;
          background: rgba(18, 14, 30, 0.92);
          border: 1px solid rgba(139, 92, 246, 0.45);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 0 24px rgba(124, 58, 237, 0.18);
          color: #e9e6ff;
          font: 12px/1.45 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          user-select: none;
        }
        .row { display: flex; align-items: center; gap: 8px; }
        .dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #8b8b9e; box-shadow: 0 0 10px currentColor;
          flex: none;
        }
        .status { font-weight: 600; letter-spacing: 0.2px; }
        .stop {
          margin-left: auto;
          padding: 4px 10px;
          border-radius: 10px;
          border: 1px solid rgba(248, 113, 113, 0.45);
          background: rgba(248, 113, 113, 0.12);
          color: #fca5a5;
          font: inherit;
          cursor: pointer;
        }
        .stop:hover { background: rgba(248, 113, 113, 0.22); }
        .detail {
          margin-top: 6px;
          color: #b9b3d4;
          font-size: 11.5px;
          line-height: 1.5;
          word-break: break-word;
        }
      </style>
      <div class="card">
        <div class="row">
          <span class="dot"></span>
          <span class="status">待机</span>
          <button class="stop" type="button">停止</button>
        </div>
        <div class="detail">未开始</div>
      </div>`;
    document.documentElement.appendChild(host);
    statusEl = root.querySelector('.status');
    detailEl = root.querySelector('.detail');
    dotEl = root.querySelector('.dot');
    root.querySelector('.stop').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      stopHandler?.();
    });
  }

  function set({ status, detail, tone = 'idle' }) {
    ensure();
    statusEl.textContent = status || '待机';
    detailEl.textContent = detail || '';
    const color = TONES[tone] || TONES.idle;
    dotEl.style.background = color;
    dotEl.style.color = color;
  }

  NS.hud = {
    ensure,
    set,
    onStop(fn) {
      stopHandler = fn;
    }
  };
})();
