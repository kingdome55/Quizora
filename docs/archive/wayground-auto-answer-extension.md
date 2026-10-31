# Wayground 自动答题 Edge 扩展 — 实施方案

## 1. 结论：做 Edge MV3 扩展，不做油猴/Playwright

| 形态 | 能否接管"已打开的对局" | 结论 |
| --- | --- | --- |
| Edge MV3 扩展 | 能。`chrome.scripting.executeScript` 注入现有标签页，不刷新、不丢当前进度 | **采用** |
| 油猴脚本 | 一般要刷新页面才生效，当前对局会断 | 否 |
| 控制台脚本 | 零安装，但刷新即失效、Key 暴露在页面上下文 | 否 |
| Playwright/CDP | 必须另起带调试端口的 Edge 实例，当前登录态与对局都要重来 | 否 |

核心约束：对局进行中不能刷新页面，所以"能注入已打开标签页"是选型的决定性因素。

## 2. 现状分析

- 工作区为空，属于从零新建；Node 22 可用，Edge 已安装，系统环境变量中没有任何大模型 Key。
- 目标页：`https://wayground.com/join/game/...`，`gameType=live`，作答后页面自动推进到下一题，无 Next 按钮。
- 已通过 UI Automation 证实：四个选项被暴露为 `Option N, <文本>` 的可选元素，说明 DOM 中选项是可枚举、可点击的节点。
- 题型观察：四选一、True/False、字母重排（选项即候选单词）、组句（选项即完整句子）、少量填空输入。
- 上次会话已答到第 66 题；距今已多日，该对局大概率结束。本工具面向**任意 Wayground 对局页**，下次开局时点"开始"即可接管。

## 3. 总体架构

```
┌──────────────┐   port 消息(日志/状态)   ┌──────────────────┐
│ 侧边栏 panel │ ◄──────────────────────► │ background (SW)  │
│ 开关/配置/日志│ ──── 开始/停止/探测 ────► │ 注入·配置·LLM·缓存│
└──────────────┘                          └────────┬─────────┘
                                                   │ executeScript
                                          ┌────────▼─────────┐
                                          │ content (隔离世界)│
                                          │ adapter→solver→  │
                                          │ clicker→HUD      │
                                          └──────────────────┘
                                                   │ fetch
                                          ┌────────▼─────────┐
                                          │ OpenAI 兼容 API  │
                                          └──────────────────┘
```

- **background**：唯一持有 API Key 的地方；负责注入、消息路由、LLM 调用、缓存读写。
- **content**：只做 DOM 解析、点击、状态机，不接触 Key。
- **panel**：控制台与日志，关闭不影响运行。

## 4. 文件清单（交付到 `wayground-auto/`）

| 文件 | 职责 | 预算 |
| --- | --- | --- |
| `manifest.json` | MV3 声明、权限、side panel | 40 行 |
| `src/background.js` | 消息路由、标签页注入、运行状态 | 200 行 |
| `src/background/llm.js` | OpenAI 兼容客户端、JSON 提取、错误分类、重试 | 180 行 |
| `src/background/cache.js` | 题库缓存（hash → 答案） | 100 行 |
| `src/background/config.js` | 默认配置、动态域名授权 | 90 行 |
| `src/content/adapter.js` | 计数器/题干/选项/输入框识别、题目 hash、诊断快照 | 260 行 |
| `src/content/solver.js` | 缓存 → 规则 → LLM 调度、置信度判定 | 180 行 |
| `src/content/main.js` | 状态机主循环、点击、推进校验、停止条件 | 260 行 |
| `src/content/hud.js` | Shadow DOM 悬浮状态条 | 140 行 |
| `src/panel.html` / `panel.css` / `panel.js` | 深色侧边栏（圆角 24、紫蓝渐变） | 260 行 |

按你的习惯，每个文件控制在 300 行内；content 的四个脚本按顺序注入同一隔离世界，共享 `window.__wg` 命名空间。

## 5. DOM 适配策略（最大风险点）

三级兜底，不做单点依赖：

1. **题号计数器**：在顶部区域匹配 `/(\d{1,3})\s*\/\s*(\d{1,3})/`，取最近的可视文本节点。
2. **选项**：
   - 一级：`[role="listitem"], [role="button"], button`，且可访问名匹配 `/^Option\s*\d/`；
   - 二级：`[class*="option" i], [data-cy*="option" i]` 中的可点击祖先；
   - 三级：按候选文本与页面可见文本块精确匹配，取其最近可点击祖先。
3. **题干**：选项容器的公共父节点内、字号最大的文本块；再用"包含 `?` 或长度 > 20"修正。
4. **输入型题**：存在 `input[type=text]`、`textarea`、`[contenteditable]` 时走文本作答分支。
5. **点击**：`scrollIntoView` → `pointerdown/mousedown/pointerup/mouseup/click` 序列，比只调 `.click()` 更接近真实点击。
6. **诊断模式**："探测"按钮返回 `{counter, question, options[], selectorHits, url}`，首次使用先核对一遍再实跑。

## 6. 判题策略

按优先级串行：

1. **缓存命中**：`hash(规范化题干 + 排序后的选项集)`，命中直接作答（毫秒级）。
2. **本地规则**（无 Key 也能救一部分）：
   - 字母重排：题干中大写字母组排序后与选项字母集相等者胜出；
   - 选项文本出现在题干中：优先该选项。
3. **LLM 判题**（主力）：`POST {baseUrl}/chat/completions`

```json
{
  "model": "deepseek-chat",
  "temperature": 0,
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": "你是答题助手。根据题干与选项选出唯一正确项；题目可能涉及计算机基础、英语语法、拼写重排。只输出 JSON：{\"index\":0-3,\"confidence\":0-1,\"reason\":\"不超过20字\"}；若为填空则输出 {\"text\":\"...\"}。" },
    { "role": "user", "content": "题干：...\n选项：\n0. ...\n1. ...\n2. ...\n3. ..." }
  ]
}
```

- 兼容性：若服务端不认 `response_format` 返回 400，去掉该字段重试一次；解析用"截取首个 `{` 到末个 `}`"的宽松策略。
- 失败重试 2 次（1s / 3s 退避）；仍失败则降级到规则，并标红"低置信"。
- `confidence < 0.6` 且开启"低置信暂停"时：只高亮推荐项、不点击，等待人工确认。

## 7. 运行策略与安全边界

- **不刷新注入**：`chrome.scripting.executeScript` 注入当前标签页；`window.__wg.loaded` 防重复注入。
- **节奏**：面板滑杆 0.3–3s，默认 1.5–3s 随机；LLM 返回早于延迟则等满延迟，晚于延迟则立即点。
- **推进校验**：点击后监听计数器变化或选项锁定；8s 未变则重试一次（换次优答案），再失败暂停并报错。
- **对局被重置**：只跟随页面当前计数器，不假设题号单调递增（上次实测出现过跳回）。
- **停止方式**：面板"停止" / HUD 按钮 / `Alt+Shift+S` / 计数达到 `N/N`。
- **演练模式**：只高亮不点击，首次校准与抽查用；默认开启，确认无误后关闭。
- **不做**：自动加入对局、多账号、绕过平台限制；仅接管当前已加入的对局。

## 8. 配置与权限

```json
{
  "manifest_version": 3,
  "name": "Wayground Auto Answer",
  "version": "0.1.0",
  "permissions": ["scripting", "storage", "tabs", "activeTab", "sidePanel"],
  "host_permissions": ["https://wayground.com/*", "https://*.quizizz.com/*"],
  "optional_host_permissions": ["https://*/*"],
  "background": { "service_worker": "src/background.js", "type": "module" },
  "action": { "default_title": "Wayground Auto" },
  "side_panel": { "default_path": "src/panel.html" }
}
```

- Key 只存 `chrome.storage.local`，不写进代码、不同步云端；面板内以密码框显示。
- 保存 API Base URL 时用 `chrome.permissions.request({origins:[origin+"/*"]})` 动态申请该域名，避免全站常驻权限。
- 默认 `baseUrl=https://api.deepseek.com/v1`、`model=deepseek-chat`，可在面板改 OpenAI / 通义 / Gemini 兼容地址。
- 面板字段：Base URL、Key、Model、"测试连接"、速度滑杆、低置信暂停、演练模式、开始/停止、日志（最近 100 条）、缓存数量/清空。

## 9. 实施步骤

1. 建 `wayground-auto/`，写 `manifest.json` 与 `background/config.js`（默认值 + 动态授权）。
2. 写 `background/llm.js`（请求、400 降级、重试、JSON 宽松解析）与 `cache.js`。
3. 写 `background.js`：`START/STOP/PROBE/CONFIG/TEST` 消息、注入、运行态广播。
4. 写 `content/adapter.js`：计数器、题干、选项三级兜底、输入框、诊断快照。
5. 写 `content/solver.js`：缓存 → 规则 → LLM → 置信度。
6. 写 `content/main.js` + `hud.js`：状态机、延迟、点击序列、推进校验、停止条件。
7. 写 `panel.*`：深色渐变 UI、配置持久化、Port 日志流。
8. 在 `edge://extensions` 开启开发人员模式 → 加载解压缩的扩展 → 指向 `wayground-auto/`。
9. 打开任意 Wayground 对局页 → 面板"探测"核对识别结果 → 演练模式抽查 3 题 → 关闭演练实跑 5 题 → 全速跑完。

## 10. 验收标准

- 扩展加载无报错，Service Worker 无红色错误。
- 探测结果与页面逐字一致：计数器、题干、4 个选项文本、选项顺序。
- 演练模式只高亮不点击；关闭后连续 5 题均正确推进，无重复点击、无卡死。
- 缓存命中时单题 < 300ms 作答；走 LLM 时单题 < 3s（含网络）。
- 停止按钮、`Alt+Shift+S`、"低置信暂停"均即时生效。
- 对局重置/跳题时脚本跟随当前计数器继续，不报错退出。
- 刷新页面后脚本自动停止，需重新点"开始"（预期行为，避免误答）。

## 11. 风险与限制

- **DOM 变更**：Wayground 改版会导致选择器失效；三级兜底 + 探测快照用于快速修正。
- **不支持题型**：连线、拖拽排序、多选、图片题；遇到时 HUD 标黄并暂停，不盲目点击。
- **Key 安全**：`chrome.storage.local` 为明文，仅限本机；不要在共用电脑上保存。
- **平台规则**：自动答题可能违反课堂/平台规定，成绩与账号风险由使用者承担；建议仅在自测、复习、模拟局使用。
