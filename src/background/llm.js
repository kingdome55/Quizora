const SYSTEM_PROMPT = `你是答题助手，负责从给定选项中选出唯一正确的一项。
题目可能涉及计算机基础、英语语法、拼写重排、常识判断。
只依据题干与选项判断，不要臆造。
只输出一个 JSON 对象，不要输出任何其他文字：
选择题输出 {"index": 0, "confidence": 0.0, "reason": "不超过20字"}，index 为选项的 0 基下标；
填空题输出 {"text": "答案"}。`;

const EXAM_PROMPT = `你是严谨的考试答题助手，根据题型、题干与选项给出最终答案。
先在内部逐项分析、排除明显错误项，再作答；reason 用 1-2 句（不超过 60 字）说明关键依据。
只输出一个 JSON 对象，不要输出任何其他文字：
{"answer": "B", "blanks": ["答案1"], "text": "简答内容", "confidence": 0.0, "reason": "不超过60字"}
规则：
- single（单选）：answer 只写一个选项字母（A/B/C/D…），不要写选项全文；
- multiple（多选）：answer 写全部正确选项字母，按字母顺序连写（如 ACD）；不要漏选，也不要为了凑“多选”而添加错误项；只有一个正确项时也可只写一个字母；
- judge（判断）：answer 只写“对”或“错”，也可以写选项字母；
- blank（填空）：blanks 按空格顺序给出，只给要填入的词/短语，不要解释；数量必须严格等于题目要求的空格数；
  blanks 的每个元素只对应一个空，不要把多个空的答案合并成一个字符串，也不要用“；”“、”等分隔符塞进一个元素；
- short（简答/论述）：text 用中文作答，分点陈述，80-200 字；
- 也兼容 indices（0 基下标），但优先使用 answer；
- 计算/电路/图片题：先结合图片完成计算，只给最终结果；
- 不确定时给出最可能的答案，并把 confidence 调低。`;

const CODE_PROMPT = `你是资深编程作业代码生成器，目标是通过头歌（EduCoder）平台的自动评测。
只输出完整、可直接运行的代码，不要解释，不要输出 Markdown 代码块围栏。
必须保留代码模板中的全部结构、函数签名、已有导入和注释标记（如 #代码开始 / #代码结束 / // BEGIN / // END）。
按任务说明一次性完成所有小题，不要只实现第一题，不要只写部分题目。
必须保留模板中的所有 #题目N 标记并逐题输出；模板有 #代码结束 时也要保留；SQL 顶部保留 use library。
先在内部按任务说明逐条核对表名、字段、distinct、排序、子查询，再输出完整代码。
严格遵循题目要求的输出格式、列名、列顺序、分隔符、函数名与参数。
不要引入未安装的第三方依赖，不要写伪代码、TODO 或省略号。
如果是 SQL，按题目顺序写完整查询语句，保留模板中的题号注释。
如果是算法/编程题，确保能编译运行，并覆盖常见边界情况。`;

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

function cleanStem(text) {
  let s = String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^第\s*\d+\s*题\s*[：:.、]?\s*/, '');
  s = s.replace(/^\d{1,2}\s*[、．:：]\s*/, '');
  s = s.replace(/^\d{1,2}\.\s+/, '');
  s = s.replace(/^(单选题|多选题|判断题|填空题|简答题|论述题)\s*[：:]\s*/, '');
  return s.trim();
}

function cleanOption(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[A-Fa-f]\s*[.、．:：]\s*/, '');
}

function optionLetter(i) {
  return String.fromCharCode(65 + i);
}

function buildExamMessages({ question, type, options, blankCount, images = [] }) {
  const stem = cleanStem(question);
  const lines = [`题型：${TYPE_LABELS[type] || type}`, `题干：\n${stem}`];
  if (options.length) {
    lines.push('\n选项：');
    options.forEach((o, i) => lines.push(`${optionLetter(i)}. ${cleanOption(o)}`));
  }
  if (type === 'blank') {
    lines.push(`\n空格数量：${blankCount || 1}`);
    lines.push(`blanks 数组长度必须严格等于 ${blankCount || 1}。`);
    lines.push('第 1 个元素对应第 1 空，第 2 个对应第 2 空，以此类推。');
    lines.push('每个元素只写一个空的答案；不要用分隔符把多个空合并进一个元素。');
  }
  const rules = {
    single: '本题是单选：answer 只写一个选项字母（如 B）。',
    multiple: '本题是多选：answer 写全部正确选项字母，按字母顺序连写（如 ACD）。',
    judge: '本题是判断：answer 只写 对 或 错（也可写选项字母）。',
    blank: '本题是填空：每个空一个元素，数量严格等于空格数。',
    short: '本题是简答：text 写中文答案。'
  };
  if (rules[type]) lines.push(`\n${rules[type]}`);
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

async function callChat({ config, messages, jsonMode, temperature = 0, timeoutMs = 20000 }) {
  const url = endpoint(config.baseUrl);
  if (!url) throw new Error('API Base URL 为空');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[，。；：、,.!?！？()（）]/g, '')
    .toLowerCase();
}

function parseAnswerLetters(answer, count) {
  const s = String(answer || '').trim();
  if (!s || s.length > 12) return [];
  if (!/^[A-Za-z](?:\s*[,，、;；/]?\s*[A-Za-z])*$/.test(s)) return [];
  const out = [];
  for (const ch of s.match(/[A-Za-z]/g) || []) {
    const idx = ch.toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < count && !out.includes(idx)) out.push(idx);
  }
  return out.sort((a, b) => a - b);
}

function judgeIndex(answer, options) {
  const a = normalizeText(answer);
  if (!a) return -1;
  const yes = /^(对|正确|是|√|true|t|1)$/i.test(a);
  const no = /^(错|错误|否|×|false|f|0)$/i.test(a);
  if (!yes && !no) return -1;
  const pattern = yes ? /对|正确|是|√|true|t|1/ : /错|错误|否|×|false|f|0/;
  return options.findIndex((o) => pattern.test(normalizeText(cleanOption(o))));
}

function matchOptionText(answer, options) {
  const stripped = String(answer || '')
    .trim()
    .replace(/^[A-Fa-f]\s*[.、．:：]\s*/, '');
  const target = normalizeText(stripped);
  if (!target) return -1;
  let exact = -1;
  options.forEach((o, i) => {
    if (normalizeText(cleanOption(o)) === target) exact = i;
  });
  if (exact >= 0) return exact;
  if (target.length < 2) return -1;
  let best = -1;
  options.forEach((o, i) => {
    const n = normalizeText(cleanOption(o));
    if (n.length >= 2 && (n.includes(target) || target.includes(n))) {
      if (best < 0 || n.length > normalizeText(cleanOption(options[best])).length) best = i;
    }
  });
  return best;
}

function normalizeExam(parsed, type, options = [], blankCount = 0) {
  if (!parsed) return { ok: false, error: '模型返回无法解析' };
  const optionCount = options.length;
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7) || 0.7));
  const reason = String(parsed.reason || '').slice(0, 80);
  const answer = String(parsed.answer ?? '')
    .trim()
    .replace(/[。.]+$/, '');
  let indices = [];

  if (type === 'judge') {
    const judged = judgeIndex(answer, options);
    if (judged >= 0) indices = [judged];
  }
  if (!indices.length && answer) {
    const letters = parseAnswerLetters(answer, optionCount);
    if (letters.length) indices = letters;
  }
  if (!indices.length && answer) {
    const textIndex = matchOptionText(answer, options);
    if (textIndex >= 0) indices = [textIndex];
  }
  if (!indices.length && Array.isArray(parsed.indices)) indices = parsed.indices.map(Number);
  if (!indices.length && parsed.index !== undefined) indices = [Number(parsed.index)];

  if (type === 'single' || type === 'judge') {
    const valid = [...new Set(indices.filter((i) => Number.isInteger(i) && i >= 0 && i < optionCount))];
    if (valid.length !== 1) return { ok: false, error: '单选/判断必须返回一个有效选项' };
    return { ok: true, indices: [valid[0]], confidence, reason };
  }

  if (type === 'multiple') {
    const uniq = [...new Set(indices.filter((i) => Number.isInteger(i) && i >= 0 && i < optionCount))].sort(
      (a, b) => a - b
    );
    if (!uniq.length) return { ok: false, error: '模型未返回有效多选选项' };
    return { ok: true, indices: uniq, confidence, reason };
  }

  if (type === 'blank') {
    let blanks = [];
    if (Array.isArray(parsed.blanks)) {
      blanks = parsed.blanks.map((s) => String(s ?? '').trim()).filter(Boolean);
    }
    if (!blanks.length && answer) {
      blanks = String(answer)
        .split(/\r?\n|#|；|;|、|\||｜|\s+\/\s+|／/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (!blanks.length && parsed.text) blanks = [String(parsed.text).trim()].filter(Boolean);
    if (!blanks.length) return { ok: false, error: '模型未给出填空答案' };
    if (blanks.length === 1 && blankCount > 1) {
      const split = splitCombinedBlanks(blanks[0], blankCount);
      if (split) blanks = split;
    }
    if (blankCount > 0 && blanks.length !== blankCount) {
      return {
        ok: false,
        error: `填空答案数量不符：需要 ${blankCount} 个，模型给了 ${blanks.length} 个`
      };
    }
    return { ok: true, blanks, confidence, reason };
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
      const result = validate(extractJson(raw));
      if (result?.ok) return result;
      lastError = new Error(result?.error || '模型答案无效');
      if (attempt < 2) {
        await sleep(attempt === 0 ? 900 : 1800);
        continue;
      }
      return result || { ok: false, error: lastError.message };
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

function stripCode(raw) {
  let text = String(raw || '').trim();
  const fence = text.match(/```[a-zA-Z0-9+#._-]*\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  text = text.replace(/^(以下是|下面是)?(完整)?(代码|答案)[：:]\s*/i, '').trim();
  return text;
}

export async function askCode({ config, title = '', description = '', language = '', code = '', error = '' }) {
  if (!config?.apiKey) return { ok: false, error: '未填写 API Key' };
  if (!config?.baseUrl) return { ok: false, error: '未填写 API Base URL' };
  if (!description && !code) return { ok: false, error: '任务说明与代码模板均为空' };

  const lines = [`语言：${language || '未知'}`];
  if (title) lines.push(`任务标题：${title}`);
  if (description) lines.push(`任务说明：\n${String(description).slice(0, 12000)}`);
  if (code) lines.push(`当前代码模板：\n${String(code).slice(0, 12000)}`);
  if (error) {
    lines.push(`上一次评测未通过，平台返回：\n${String(error).slice(0, 2500)}`);
    lines.push('请针对错误修复，并输出完整代码。');
  }
  lines.push('请输出完整代码（覆盖整个文件），不要只输出新增片段。');

  const messages = [
    { role: 'system', content: CODE_PROMPT },
    { role: 'user', content: lines.join('\n\n') }
  ];

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await callChat({ config, messages, jsonMode: false, temperature: 0.1, timeoutMs: 90000 });
      const out = stripCode(raw);
      if (!out) throw new Error('模型返回空代码');
      if (out.length < 4 || /^(抱歉|无法|我不能|很抱歉)/.test(out)) throw new Error('模型拒绝生成代码');
      return { ok: true, code: out, confidence: 0.85, reason: `生成 ${out.length} 字符` };
    } catch (e) {
      lastError = e;
      if (e.status === 401 || e.status === 403) {
        return { ok: false, error: `Key 无效或无权限（HTTP ${e.status}）` };
      }
      if (e.status === 404) return { ok: false, error: '接口地址不存在，请检查 Base URL' };
      if (attempt === 0) await sleep(1500);
    }
  }
  const reason = lastError?.name === 'AbortError' ? '代码生成超时' : lastError?.message || '代码生成失败';
  return { ok: false, error: reason };
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
      validate: (parsed) => normalizeExam(parsed, type, options, blankCount)
    });

  const out = await request(images);
  if (!out.ok && images.length && /image|400|content/i.test(out.error || '')) {
    return request([]);
  }
  return out;
}
