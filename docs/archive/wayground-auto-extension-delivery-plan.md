# Wayground 自动答题：Edge 扩展交付与验证方案

## 1. 结论

做 **Edge MV3 扩展**，不做油猴脚本、控制台脚本或 Playwright。

决定性理由：对局进行中不能刷新页面，只有扩展能用 `chrome.scripting.executeScript` 注入**已经打开**的标签页，不丢进度、不需要重新加入对局。油猴与控制台通常要刷新才生效；Playwright 必须另起带调试端口的 Edge 实例。

## 2. 现状盘点

代码已落地在工作区 `wayground-auto/`，共 12 个文件，`node --check` 与 manifest JSON 校验全部通过：

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `manifest.json` | 22 | MV3 声明、权限、side panel |
| `src/background.js` | 210 | 注入、消息路由、运行态、日志广播 |
| `src/background/config.js` | 40 | 默认配置与 API 域名授权判断 |
| `src/background/llm.js` | 144 | OpenAI 兼容客户端、JSON 宽松解析、重试 |
| `src/background/cache.js` | 37 | 按题目 hash 缓存答案 |
| `src/content/adapter.js` | 316 | 题号/题干/选项/输入框识别、点击、诊断快照 |
| `src/content/solver.js` | 131 | 缓存 → 规则 → LLM 调度 |
| `src/content/main.js` | 307 | 状态机、延迟、推进校验、停止条件 |
| `src/content/hud.js` | 103 | Shadow DOM 悬浮状态条 |
| `src/panel.html/css/js` | 76/260/226 | 深色侧边栏控制台 |

已验证：语法、manifest、拼字重排算法（`browser` 与题干字母集一致；`resworb` 同为变位词，因此规则不抢答，交给模型）。
未验证：真实 Wayground 页面的 DOM 选择器、扩展在 Edge 的实际加载、端到端作答。
测试脚手架已就绪但尚未执行：`%TEMP%\wg-test\mock.html` + 本地静态服务 `http://localhost:8765/mock.html`（服务当前仍在后台运行）。

## 3. 架构

```
侧边栏 panel ⇄ background(service worker) ⇄ 大模型 API
                     │ executeScript 注入（不刷新）
                     ▼
              content：adapter → solver → main → HUD
```

- **background** 是唯一持有 API Key 的地方；content 只拿答案，不碰 Key。
- panel 关闭不影响运行；HUD 常驻页面左下角，可随时停止。

## 4. 关键实现（已存在，无需重写）

1. **不刷新注入**：`src/background.js` 的 `startRun()` 先 `executeScript` 注入 4 个 content 脚本，再发 `WG_START`；`main.js` 用 `NS.main` 防重复注册。
2. **三级选择器兜底**（`adapter.js`）：
   - `aria`：`aria-label` 匹配 `^Option\s*\d+[,:.-]`；
   - `group`：同一父节点下 2–8 个尺寸相近的可点击块；
   - `geo`：按视口比例 12%–55% 宽、5%–35% 高的块做几何聚类。
   都失败则返回 `strategy: 'none'`，HUD 停住而不是乱点。
3. **判题顺序**（`solver.js`）：缓存命中 → 字母重排规则 → LLM。LLM 输出严格 JSON `{index, confidence, reason}`，失败重试 2 次后降级并报错。
4. **推进校验**（`main.js`）：点击后等计数器变化；8 秒未推进重试一次，18 秒未推进暂停；题号被老师重置时只跟随当前计数器，不假设递增。
5. **安全阀**：演练模式默认开启（只高亮不点击）；低置信度可暂停；`Alt+Shift+S`、面板停止、HUD 停止三处均可中断。
6. **缓存**：`question + 排序后的选项` 做 FNV hash，重复题毫秒级作答，上限 2000 条。

## 5. 交付后的使用流程

1. `edge://extensions` → 打开"开发人员模式" → "加载解压缩的扩展" → 选择 `wayground-auto/`。
2. 打开任意 Wayground 对局页；点工具栏图标打开侧边栏。
3. 填写 API Base URL、Key、Model（默认 `https://api.deepseek.com/v1` + `deepseek-chat`），点"测试连接"（会弹出一次该域名的访问授权）。
4. 点"探测当前页"，核对题号、题干、4 个选项是否与页面逐字一致，记录 `策略`（应为 `aria` / `group` / `geo`）。
5. 保持"演练模式"开启，观察 3 题的推荐答案；确认后取消勾选，点"开始"实跑 5 题。
6. 确认无误后按需把速度滑杆拉到 0.3–0.6s 全速跑完。

## 6. 剩余工作（按顺序）

1. **压缩行数**：`adapter.js` 316 行、`main.js` 307 行，略超 300 行预算。仅删除函数间空行与合并短块，不改逻辑；目标 ≤300。
2. **执行 mock 端到端测试**：用浏览器打开 `http://localhost:8765/mock.html`，等待 15 秒，断言 `__mock.clicks === 4`、`__mock.idx === 4`、HUD 显示"已完成"、4 道题（3 选择 + 1 填空）全部推进。测试通过后删除 `%TEMP%\wg-test` 并停止本地服务。
3. **加载扩展**：按第 5 节步骤在 Edge 中加载，确认 Service Worker 无红色报错。
4. **真实页面校准**：对局页执行"探测"。若选项数 <2，用 DevTools 检查选项节点的 class/role/aria，把实际选择器补进 `adapter.js` 的 `optionCandidates()` 列表，或微调 `geometryOptions()` 的宽高阈值。
5. **小步实跑**：演练 3 题 → 实跑 5 题 → 全速。任何一步异常按第 7 节处理。

## 7. 故障对照表

| 现象 | 处理 |
| --- | --- |
| 点"开始"提示"不是对局页" | 确认地址是 `wayground.com/join/game/...` 或 `quizizz.com/play/...`，且当前标签页处于激活状态 |
| 探测到 0 个选项 | 用 DevTools 找选项容器，补选择器；必要时把 `geometryOptions` 宽度上限从 0.55 调到 0.7 |
| 题干识别成选项文字 | 调高 `findQuestion()` 的 `rect.top` 下限或字号阈值，排除选项区 |
| 测试连接 401/403 | Key 错误或无权限；404 则是 Base URL 少了 `/v1` |
| 点了但页面不推进 | 8 秒会自动重试一次；仍失败会暂停，检查是否被道具/锁定态拦截 |
| 置信度低频繁暂停 | 面板关闭"低置信度暂停"，或换更强的模型 |

## 8. 验收标准

- 扩展加载无报错；侧边栏可打开；配置可保存。
- "测试连接"返回有效选项下标。
- 探测结果与页面逐字一致，选项顺序正确。
- 演练模式只高亮不点击；实跑连续 5 题全部推进，无重复点击。
- 缓存命中单题 <300ms；LLM 单题 <3s（含网络）。
- 停止按钮、HUD、快捷键均即时生效；刷新页面后脚本停止，需重新开始。

## 9. 风险与限制

- Wayground 改版会导致选择器失效，靠三级兜底 + 探测快照定位，最坏情况需改 `adapter.js`。
- 不支持连线、拖拽排序、多选、图片题；遇到会停住，不盲点。
- API Key 以明文存于 `chrome.storage.local`，仅限本机使用。
- 自动答题可能违反课堂/平台规则，成绩与账号风险由使用者承担；建议只在自测、复习、模拟局使用。
- 上次对局已过去多日，当前对局大概率结束；本方案面向下一场对局。
