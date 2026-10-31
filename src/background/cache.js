const KEY = 'wg_cache_v1';
const LIMIT = 2000;
let mem = null;

async function load() {
  if (mem) return mem;
  const stored = await chrome.storage.local.get(KEY);
  mem = stored[KEY] || {};
  return mem;
}

export async function getCached(hash) {
  const map = await load();
  return map[hash] || null;
}

export async function putCached(hash, entry) {
  const map = await load();
  map[hash] = { ...entry, ts: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > LIMIT) {
    keys.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
    for (const k of keys.slice(0, keys.length - LIMIT)) delete map[k];
  }
  mem = map;
  await chrome.storage.local.set({ [KEY]: map });
}

export async function cacheStats() {
  const map = await load();
  return { count: Object.keys(map).length };
}

export async function clearCache() {
  mem = {};
  await chrome.storage.local.set({ [KEY]: {} });
}
