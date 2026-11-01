const SYSTEM_PROMPT = `你是答题助手，负责从给定选项中选出唯一正确的一项。
题目可能涉及计算机基础、英语语法、拼写重排、常识判断。
只依据题干与选项判断，不要臆造。
只输出一个 JSON 对象，不要输出任何其他文字：
选择题输出 {"index": 0, "confidence": 0.0, "reason": "不超过20字"}，index 为选项的 0 基下标；
填空题输出 {"text": "答案"}。`;

const EXAM_PROMPT = `你是严谨的考试答题助手，根据题型、题干与选项给出最终答案。
先在内部逐项分析、排除明显错误项，再作答；reason 用 1-2 句（不超过 60 字）说明关键依据。
只输出一个 JSON 对象，不要输出任何其他文字：
{"indices": [0], "blanks": ["答案1"], "text": "简答内容", "confidence": 0.0, "reason": "不超过60字"}
规则：
- single（单选）/ judge（判断）：indices 只放 1 个 0 基下标；
- multiple（多选）：indices 必须包含全部正确下标，按升序；不要为了凑“多选”而添加错误项，只有一个正确项时也可只给一个；
- blank（填空）：blanks 按空格顺序给出，只给要填入的词/短语，不要解释；数量必须等于题目要求的空格数；
  blanks 的每个元素只对应一个空，不要把多个空的答案合并成一个字符串，也不要用“；”“、”等分隔符塞进一个元素；
- short（简答/论述）：text 用中文作答，分点陈述，80-200 字；
- 计算/电路/图片题：先结合图片完成计算，只给最终结果；
- 不确定时给出最可能的答案，并把 confidence 调低。`;

const TYPE_LABELS = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  blank: '填空题',
  short: '简答题'
};

function endpoint(baseUrl) {
  const b = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  return /\/chat\/completions$/i.test(b) ? b : `${b}/chat/completions`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractJson(raw) {
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function contentOf(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  }
  return '';
}

function buildMessages(question, options, kind) {
  const lines = [`题干：\n${question}`];
  if (kind === 'text') {
    lines.push('\n这是填空题，请直接给出要填入的答案。');
  } else {
    lines.push('\n选项：');
    options.forEach((o, i) => lines.push(`${i}. ${o}`));
    lines.push('\n请选出正确选项的 0 基下标。');
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') }
  ];
}

function buildExamMessages({ question, type, options, blankCount, images = [] }) {
  const lines = [`题型：${TYPE_LABELS[type] || type}`, `题干：\n${question}`];
  if (options.length) {
    lines.push('\n选项：');
    options.forEach((o, i) => lines.push(`${String.fromCharCode(65 + i)}. ${o}（下标 ${i}）`));
  }
  if (type === 'blank') {
    lines.push(`\n空格数量：${blankCount || 1}`);
    lines.push('blanks 数组长度必须与空格数量一致。');
    lines.push('第 1 个元素对应第 1 空，第 2 个对应第 2 空，以此类推。');
    lines.push('每个元素只写一个空的答案；不要用分隔符把多个空合并进一个元素。');
  }
  if (images.length) lines.push('\n题干图片已附上，请结合图片理解题意。');

  const text = lines.join('\n');
  const content = images.length
    ? [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : text;
  return [
    { role: 'system', content: EXAM_PROMPT },
    { role: 'user', content }
  ];
}

async function callChat({ config, messages, jsonMode, temperature = 0 }) {
  const url = endpoint(config.baseUrl);
  if (!url) throw new Error('API Base URL 为空');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const body = {
    model: config.model || 'deepseek-chat',
    temperature,
    messages
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      err.status = res.status;
      throw err;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('响应不是合法 JSON');
    }
    return contentOf(data);
  } finally {
    clearTimeout(timer);
  }
}

function normalize(parsed, count, kind) {
  if (!parsed) return { ok: false, error: '模型返回无法解析' };
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7) || 0.7));
  const reason = String(parsed.reason || '').slice(0, 80);
  if (kind === 'text') {
    const text = String(parsed.text || '').trim();
    if (!text) return { ok: false, error: '模型未给出填空答案' };
    return { ok: true, text, confidence, reason };
  }
  let index = Number(parsed.index);
  if (!Number.isInteger(index)) return { ok: false, error: '模型未返回有效选项下标' };
  if (index === count && count >= 2) index -= 1;
  if (index < 0 || index >= count) return { ok: false, error: `选项下标越界：${parsed.index}` };
  return { ok: true, index, confidence, reason };
}

function splitCombinedBlanks(value, count) {
  const text = String(value || '').trim();
  if (!text || count < 2) return null;
  const parts = text
    .split(/\r?\n|；|;|、|\||｜|\s+\/\s+|／/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length === count ? parts : null;
}

function normalizeExam(parsed, type, optionCount, blankCount) {
  if (!parsed) return { ok: false, error: '模型返回无法解析' };
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7) || 0.7));
  const reason = String(parsed.reason || '').slice(0, 80);
  let indices = Array.isArray(parsed.indices) ? parsed.indices.map(Number) : [];
  if (!indices.length && parsed.index !== undefined) indices = [Number(parsed.index)];

  if (type === 'single' || type === 'judge') {
    const index = indices[0];
    if (!Number.isInteger(index) || index < 0 || index >= optionCount) {
      return { ok: false, error: '模型未返回有效选项' };
    }
    return { ok: true, indices: [index], confidence, reason };
  }

  if (type === 'multiple') {
    const uniq = [...new Set(indices.filter((i) => Number.isInteger(i) && i >= 0 && i < optionCount))].sort(
      (a, b) => a - b
    );
    if (!uniq.length) return { ok: false, error: '模型未返回有效多选下标' };
    return { ok: true, indices: uniq, confidence, reason };
  }

  if (type === 'blank') {
    const raw = Array.isArray(parsed.blanks) ? parsed.blanks : [parsed.text];
    let blanks = raw.map((s) => String(s ?? '').trim()).filter(Boolean);
    if (!blanks.length) return { ok: false, error: '模型未给出填空答案' };
    if (blanks.length === 1 && blankCount > 1) {
      const split = splitCombinedBlanks(blanks[0], blankCount);
      if (split) blanks = split;
    }
    const out = blankCount > 0 ? blanks.slice(0, blankCount) : blanks;
    return { ok: true, blanks: out, confidence, reason, partial: blankCount > 0 && out.length < blankCount };
  }

  const text = String(parsed.text || parsed.answer || '').trim();
  if (!text) return { ok: false, error: '模型未给出简答内容' };
  return { ok: true, text, confidence, reason };
}

async function runJson({ config, messages, temperature = 0, validate }) {
  let jsonMode = true;
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await callChat({ config, messages, jsonMode, temperature });
      return validate(extractJson(raw));
    } catch (e) {
      lastError = e;
      if (e.status === 400 && jsonMode) {
        jsonMode = false;
        continue;
      }
      if (e.status === 401 || e.status === 403) {
        return { ok: false, error: 'Key 无效或无权限（HTTP ' + e.status + '）' };
      }
      if (e.status === 404) {
        return { ok: false, error: '接口地址不存在，请检查 Base URL' };
      }
      if (attempt < 2) {
        await sleep(attempt === 0 ? 1000 : 3000);
      }
    }
  }

  const reason = lastError?.name === 'AbortError' ? '请求超时' : lastError?.message || '调用失败';
  return { ok: false, error: reason };
}

export async function askLLM({ config, question, options = [], kind = 'mc' }) {
  if (!config?.apiKey) return { ok: false, error: '未填写 API Key' };
  if (!config?.baseUrl) return { ok: false, error: '未填写 API Base URL' };
  if (!question) return { ok: false, error: '题干为空' };

  return runJson({
    config,
    messages: buildMessages(question, options, kind),
    validate: (parsed) => normalize(parsed, options.length, kind)
  });
}

export async function askExam({ config, question, type = 'single', options = [], blankCount = 0, images = [] }) {
  if (!config?.apiKey) return { ok: false, error: '未填写 API Key' };
  if (!config?.baseUrl) return { ok: false, error: '未填写 API Base URL' };
  if (!question) return { ok: false, error: '题干为空' };
  if (!TYPE_LABELS[type]) return { ok: false, error: `不支持的题型：${type}` };

  const request = (imgs) =>
    runJson({
      config,
      messages: buildExamMessages({ question, type, options, blankCount, images: imgs }),
      temperature: type === 'short' ? 0.2 : 0,
      validate: (parsed) => normalizeExam(parsed, type, options.length, blankCount)
    });

  const out = await request(images);
  if (!out.ok && images.length && /image|400|content/i.test(out.error || '')) {
    return request([]);
  }
  return out;
}
