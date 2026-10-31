document.getElementById('testVisionBtn').addEventListener('click', async () => {
  try {
    await saveConfig({ notify: false });
    setPill('图形识别测试中…', 'work');
    const res = await chrome.runtime.sendMessage({ type: 'TEST_VISION' });
    if (!res?.ok) throw new Error(res?.error || '图形识别测试失败');
    const text = res.text || (res.indices ? `选项 ${res.indices.join(',')}` : '无返回内容');
    addLog({
      level: 'ok',
      text: `图形识别：${text}（置信度 ${Math.round((res.confidence ?? 0) * 100)}%）`,
      ts: Date.now()
    });
    setPill('图形识别完成', 'ok');
    holdPill(6000);
  } catch (e) {
    fail(e);
  }
});
