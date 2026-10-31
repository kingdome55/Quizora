export const SITES = {
  wayground: {
    id: 'wayground',
    label: 'Wayground',
    files: [
      'src/content/adapter.js',
      'src/content/hud.js',
      'src/content/solver.js',
      'src/content/main.js'
    ],
    match: (u) =>
      /(^|\.)(wayground|quizizz)\.com$/i.test(u.hostname) &&
      (/\/(game|play|activity)\b/i.test(u.pathname) || /^\/join/i.test(u.pathname))
  },
  chaoxing: {
    id: 'chaoxing',
    label: '学习通',
    files: [
      'src/content/hud.js',
      'src/content/cx-debug.js',
      'src/content/cx-generic.js',
      'src/content/cx-plain.js',
      'src/content/cx-adapter.js',
      'src/content/cx-image.js',
      'src/content/cx-fill.js',
      'src/content/cx-main.js'
    ],
    match: (u) => /(^|\.)chaoxing\.com$/i.test(u.hostname)
  },
  generic: {
    id: 'generic',
    label: '通用网页',
    files: [
      'src/content/hud.js',
      'src/content/cx-debug.js',
      'src/content/cx-generic.js',
      'src/content/cx-plain.js',
      'src/content/cx-adapter.js',
      'src/content/cx-image.js',
      'src/content/cx-fill.js',
      'src/content/cx-main.js'
    ],
    match: (u) => /^https?:$/.test(u.protocol)
  }
};

export function siteForUrl(url) {
  try {
    const u = new URL(url);
    return Object.values(SITES).find((site) => site.match(u)) || null;
  } catch {
    return null;
  }
}

export function isReadOnlyUrl(url) {
  try {
    return /\/(work\/view|exam\/analysis)\b/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
