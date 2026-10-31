const MODEL_PRESETS = {
  'deepseek-flash': 'https://api.deepseek.com/v1',
  'deepseek-v4-pro': 'https://api.deepseek.com/v1',
  'deepseek-chat': 'https://api.deepseek.com/v1'
};

function currentModel() {
  const value = document.getElementById('model').value;
  return value === '__custom__'
    ? document.getElementById('modelCustom').value.trim()
    : value;
}

function fillModelSelect(cfg) {
  const model = cfg.model || 'deepseek-flash';
  const select = document.getElementById('model');
  const customWrap = document.getElementById('customModelWrap');
  const customInput = document.getElementById('modelCustom');
  if (MODEL_PRESETS[model]) {
    select.value = model;
    customInput.value = '';
    customWrap.hidden = true;
  } else {
    select.value = '__custom__';
    customInput.value = model;
    customWrap.hidden = false;
  }
}

function initModelSelect() {
  document.getElementById('model').addEventListener('change', async () => {
    const value = document.getElementById('model').value;
    const customWrap = document.getElementById('customModelWrap');
    if (value === '__custom__') {
      customWrap.hidden = false;
      setTimeout(() => document.getElementById('modelCustom').focus(), 30);
      return;
    }
    customWrap.hidden = true;
    const base = MODEL_PRESETS[value];
    if (!base) return;
    document.getElementById('baseUrl').value = base;
    try {
      await saveConfig({ notify: false });
      setPill(`已切换到 ${value}`, 'ok');
      holdPill(6000);
      addLog({ level: 'ok', text: `模型：${value}，Base URL：${base}`, ts: Date.now() });
    } catch (e) {
      fail(e);
    }
  });
}
