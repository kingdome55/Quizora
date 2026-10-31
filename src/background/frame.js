const cache = new Map();

function usable(snapshot) {
  if (!snapshot) return false;
  if (Number.isFinite(snapshot.count) && snapshot.count > 0) return true;
  return Array.isArray(snapshot.options) && snapshot.options.length > 0;
}

function weight(snapshot) {
  if (!snapshot) return -1;
  return (Number(snapshot.count) || 0) * 1000 + (Array.isArray(snapshot.options) ? snapshot.options.length : 0);
}

function evidence(snapshot) {
  if (!snapshot) return -1;
  const d = snapshot.diagnostics || {};
  const counts = d.counts || {};
  const labels = (d.labels || []).length;
  const typeNames = (d.typeNames || []).length;
  const blocks = Object.values(d.selectors || {}).reduce((sum, v) => sum + (Number(v?.visible) || 0), 0);
  return (
    (snapshot.count || 0) * 1000 +
    labels * 20 +
    typeNames * 15 +
    blocks * 5 +
    (counts.editors || 0) * 3 +
    (counts.optionBlocks || 0) * 2 +
    (counts.textareas || 0) * 2 +
    (counts.inputs || 0)
  );
}

function frameSummary(probes) {
  return probes.map((p) => ({
    frameId: p.frameId,
    depth: p.depth || 0,
    url: String(p.snapshot?.url || '').slice(0, 140),
    count: p.snapshot?.count || 0,
    labels: (p.snapshot?.diagnostics?.labels || []).length,
    typeNames: (p.snapshot?.diagnostics?.typeNames || []).length,
    error: p.error || ''
  }));
}

async function listFrames(tab) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    if (Array.isArray(frames) && frames.length) {
      const byId = new Map(frames.map((f) => [f.frameId, f]));
      const depthOf = (frameId) => {
        let depth = 0;
        let cur = byId.get(frameId);
        let guard = 0;
        while (cur && cur.parentFrameId >= 0 && byId.has(cur.parentFrameId) && guard < 20) {
          depth += 1;
          cur = byId.get(cur.parentFrameId);
          guard += 1;
        }
        return depth;
      };
      return frames
        .filter((f) => f.frameId >= 0)
        .map((f) => ({ frameId: f.frameId, depth: depthOf(f.frameId) }));
    }
  } catch {}
  return [{ frameId: 0, depth: 0 }];
}

async function sendProbe(tab, frameId, depth = 0) {
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'WG_PROBE' }, { frameId });
    return { frameId, depth, snapshot: res?.snapshot || null, error: '' };
  } catch (e) {
    return { frameId, depth, snapshot: null, error: String(e?.message || e).slice(0, 120) };
  }
}

async function injectFiles(tab, files) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files });
    return { ok: true, mode: 'all', error: '' };
  } catch (e1) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files });
      return { ok: true, mode: 'top', error: String(e1?.message || e1).slice(0, 160) };
    } catch (e2) {
      return { ok: false, mode: 'none', error: String(e2?.message || e2).slice(0, 160) };
    }
  }
}

async function probeAll(tab) {
  const frames = await listFrames(tab);
  return Promise.all(frames.map((frame) => sendProbe(tab, frame.frameId, frame.depth)));
}

export async function pickFrame(tab, files) {
  const hit = cache.get(tab.id);
  if (hit && hit.url === tab.url) {
    const probe = await sendProbe(tab, hit.frameId);
    if (usable(probe.snapshot)) {
      return {
        frameId: hit.frameId,
        snapshot: probe.snapshot,
        count: probe.snapshot.count || 0,
        usable: true,
        injection: null
      };
    }
    cache.delete(tab.id);
  }

  let probes = await probeAll(tab);
  let injection = null;

  if (!probes.some((p) => usable(p.snapshot))) {
    injection = await injectFiles(tab, files);
    probes = await probeAll(tab);
  }

  const responded = probes.filter((p) => p.snapshot);
  const ranked = responded
    .filter((p) => usable(p.snapshot))
    .sort((a, b) => weight(b.snapshot) - weight(a.snapshot) || (b.depth || 0) - (a.depth || 0));
  const best = ranked[0] || null;

  const chosen = best?.frameId ?? -1;
  for (const frameId of probes.map((p) => p.frameId)) {
    if (frameId === chosen) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        func: () => document.getElementById('__wg_hud')?.remove()
      });
    } catch {}
  }

  if (best) {
    cache.set(tab.id, { url: tab.url, frameId: best.frameId });
    best.snapshot.frames = frameSummary(probes);
    return {
      frameId: best.frameId,
      snapshot: best.snapshot,
      count: best.snapshot.count || 0,
      usable: true,
      injection
    };
  }

  const fallback = responded
    .slice()
    .sort((a, b) => evidence(b.snapshot) - evidence(a.snapshot) || (b.depth || 0) - (a.depth || 0))[0];
  let snapshot = fallback?.snapshot || null;
  if (snapshot) {
    snapshot.frames = frameSummary(probes);
    snapshot.injection = injection;
  }
  cache.delete(tab.id);
  return { frameId: fallback?.frameId ?? 0, snapshot, count: 0, usable: false, injection };
}

export function clearFrame(tabId) {
  cache.delete(tabId);
}
