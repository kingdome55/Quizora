export const DEFAULT_CONFIG = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
  minDelay: 1500,
  maxDelay: 3000,
  dryRun: true,
  examSkipAnswered: true,
  useCache: true,
  examScrollLoad: true
};

const KEY = 'wg_config_v1';

export async function getConfig() {
  const stored = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_CONFIG, ...(stored[KEY] || {}) };
}

export async function saveConfig(patch) {
  const cfg = { ...(await getConfig()), ...patch };
  await chrome.storage.local.set({ [KEY]: cfg });
  return cfg;
}

export function originPattern(baseUrl) {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'https:') return null;
    return `${u.origin}/*`;
  } catch {
    return null;
  }
}

export async function hasOrigin(baseUrl) {
  const pattern = originPattern(baseUrl);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}
