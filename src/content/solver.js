(() => {
  const NS = (window.__wg = window.__wg || {});
  if (NS.solver) return;
  const A = NS.adapter;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  function questionHash(question, options) {
    const base =
      norm(question) + '||' + options.map((o) => norm(typeof o === 'string' ? o : o.text)).sort().join('|');
    return hash(base);
  }

  let settings = { useCache: true, confidenceThreshold: 0.6 };

  function configure(next) {
    if (next) settings = { ...settings, ...next };
  }

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

  function extractScramble(question) {
    const groups = question.match(/\b(?:[A-Z]\s+){2,}[A-Z]\b/g) || [];
    for (const group of groups) {
      const letters = group.replace(/\s+/g, '');
      if (letters.length >= 3) return letters;
    }
    return null;
  }

  function lettersOf(text) {
    return String(text || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .split('')
      .sort()
      .join('');
  }

  function ruleAnswer(parsed) {
    const scramble = extractScramble(parsed.question);
    if (scramble && parsed.options.length) {
      const target = lettersOf(scramble);
      const hits = parsed.options.filter((o) => lettersOf(o.text) === target);
      if (hits.length === 1) {
        return { index: hits[0].index, confidence: 1, reason: '字母重排匹配', source: 'rule' };
      }
    }
    return null;
  }

  async function decide(parsed) {
    const isText = Boolean(parsed.input) && parsed.options.length < 2;
    const hashKey = questionHash(parsed.question, isText ? [] : parsed.options);

    if (settings.useCache) {
      const res = await send({ type: 'GET_CACHE', hash: hashKey });
      const entry = res?.entry;
      if (entry?.answerText) {
        if (isText) {
          return {
            text: entry.answerText,
            confidence: entry.confidence ?? 0.9,
            reason: entry.reason || '缓存命中',
            source: 'cache',
            hash: hashKey
          };
        }
        const index = parsed.options.findIndex((o) => norm(o.text) === norm(entry.answerText));
        if (index >= 0) {
          return {
            index,
            confidence: entry.confidence ?? 0.9,
            reason: entry.reason || '缓存命中',
            source: 'cache',
            hash: hashKey
          };
        }
      }
    }

    if (!isText) {
      const ruled = ruleAnswer(parsed);
      if (ruled) return { ...ruled, hash: hashKey };
    }

    const res = await send({
      type: 'SOLVE',
      hash: hashKey,
      payload: {
        question: parsed.question,
        options: isText ? [] : parsed.options.map((o) => o.text),
        kind: isText ? 'text' : 'mc'
      }
    });

    if (!res?.ok) {
      return { error: res?.error || '判题失败', source: 'none', hash: hashKey };
    }

    if (res.text) {
      return { text: res.text, confidence: res.confidence ?? 0.6, reason: res.reason, source: 'llm', hash: hashKey };
    }

    if (!Number.isInteger(res.index) || !parsed.options[res.index]) {
      return { error: '模型返回的选项下标无效', source: 'none', hash: hashKey };
    }

    return { index: res.index, confidence: res.confidence ?? 0.6, reason: res.reason, source: 'llm', hash: hashKey };
  }

  NS.solver = { configure, decide };
})();
