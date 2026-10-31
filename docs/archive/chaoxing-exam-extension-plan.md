# 学习通整卷答题扩展 — 实施方案

## 1. 目标与决策

在现有 `wayground-auto` Edge MV3 扩展上增加学习通（超星）支持：

- 整页多题模式：一次扫描页面上所有题目，逐题填写/选择，而不是一题一推进。
- 题型：单选、多选、判断、填空（含多空）、简答/论述。
- **只填不交**：填完标记状态，由用户检查后手动提交。
- 页面范围：考试页 `/exam/...` 与作业页 `/work/dowork`。
- 原有 Wayground 逻辑不动，新增独立站点适配。

## 2. 开源参考（只借鉴思路，不复制代码）

| 项目 | 许可/热度 | 可借鉴点 |
| --- | --- | --- |
| [OCS 网课助手](https://github.com/ocsjs/ocsjs) | MIT，3.9k stars | 站点脚本注册、整卷题目遍历、答案提供器抽象、iframe 操控、考试页支持 |
| [超星学习通九九助手](https://scriptcat.org/zh-CN/script-show-page/1127) | 源码可见 | AI 答题覆盖单选/多选/填空/判断；简答题用 `textarea[name^="answerEditor"]` + `iframe[id*="ueditor"]` |
| [cxmooc-tools](https://github.com/chettoy/cxmooc-tools) | 开源，MV3 扩展 | 作业/考试答题、题目采集、提交前状态处理 |

关键结论：
1. 学习通题目是整页渲染，必须按题目容器遍历，不能沿用“一题一推进”状态机。
2. 题型写在题干头部（如“（单选题）”），可作为主要判断依据；无法判断时再看输入控件类型。
3. 简答题多为 UEditor 富文本，纯 `textarea.value` 赋值可能不生效，需要同时处理隐藏 textarea 与编辑器 iframe。
4. 填空题多空按 DOM 顺序对应答案数组。
5. 不要自动提交；考试提交不可逆。

## 3. 架构改动

```
panel ⇄ background（站点路由 + LLM）⇄ 学习通页面
                                 ├─ cx-adapter.js  扫描/解析整卷
                                 ├─ cx-fill.js     写入答案
                                 └─ cx-main.js     逐题调度 + HUD
```

新增 `src/background/sites.js` 做站点注册：

```js
wayground: hostname 匹配 wayground.com/quizizz.com → 注入现有 4 个脚本
chaoxing:  hostname 匹配 *.chaoxing.com 且路径含 /exam 或 /work
           → 注入 hud.js + cx-adapter.js + cx-fill.js + cx-main.js
```

`background.js` 的 `isGameUrl()` 改为 `siteForUrl()`；`startRun()` / `probe()` 按站点选脚本。
`manifest.json` 增加 `https://*.chaoxing.com/*` 到 `host_permissions`。

## 4. 新增文件

| 文件 | 职责 | 预算 |
| --- | --- | --- |
| `src/background/sites.js` | 站点匹配、脚本清单、显示名 | 80 行 |
| `src/content/cx-adapter.js` | 题目容器扫描、题型/题干/选项/输入框/UEditor 解析、诊断快照 | 290 行 |
| `src/content/cx-fill.js` | 单选/多选/判断点击、填空写入、简答 textarea/UEditor 写入、标记 | 220 行 |
| `src/content/cx-main.js` | 整卷调度、跳过已答、进度、停止、HUD | 260 行 |
| `src/background/llm.js`（改） | 新增 `askExam()`：按题型返回 indices/blanks/text | +80 行 |

复用：`config.js`（新增 `examSkipAnswered`）、`cache.js`（按题干 hash 缓存）、`hud.js`、`panel.*`。

## 5. 页面解析（cx-adapter）

### 5.1 题目容器

优先选择器（命中任一即视为题目块）：

```
.questionLi, .TiMu, [class*="questionLi"], [class*="TiMu"],
.exam-question, .question-item, .subject
```

每个容器必须至少包含一个 `input[type=radio|checkbox]`、文本输入框、`textarea` 或 UEditor iframe。
若主选择器全空，退化为“按输入控件向上找最近的、含题型文字的公共祖先”。

### 5.2 题型判定

1. 头部文字匹配：`（单选题）|（多选题）|（判断题）|（填空题）|（简答题）|（论述题）|（名词解释）`
2. 回退规则：
   - 有 `input[type=checkbox]` → 多选
   - 有 `input[type=radio]` → 单选；选项仅“对/错、正确/错误” → 判断
   - 有文本输入框且无选项 → 填空
   - 有 `textarea` 或 UEditor → 简答

### 5.3 题干

依次尝试 `.mark_name`、`.Zy_TItle`、`.stem`、`.question-title`、`h3`；都取不到时取容器内“第一个不含输入控件、文字长度 > 6”的块。去掉题号前缀与题型括号。

### 5.4 选项

- 每个 radio/checkbox 对应一个选项，按 DOM 顺序编号。
- 文本取 `input.closest('label')` 或最近的 `.answerBg` / `.answer_p` 容器；去掉 `A.` `B、` 等前缀。
- 记录控件引用，供写入使用。

### 5.5 输入与编辑器

- 填空：容器内可见的 `input`（排除 radio/checkbox/hidden）按 DOM 顺序。
- 简答：`textarea[name^="answerEditor"]` 或 `textarea.answerText`；同时记录同容器内 `iframe[id*="ueditor"]`。
- UEditor 判定：容器内存在 id 含 `ueditor` 的 iframe，或 class 含 `edui-editor`。

### 5.6 已答判定

任一项成立即视为已答：任一选项 `checked`；任一输入框有非空值；UEditor 正文非空；简答 textarea 非空。

### 5.7 诊断快照

`snapshot()` 返回前 8 题：`{index, type, stem, options[], blanks, hasEditor, answered}`，供面板“探测”核对。

## 6. 判题协议（LLM）

新增 `askExam({config, question, type, options, blankCount})`，输出严格 JSON：

```json
{
  "indices": [0],
  "blanks": ["答案1", "答案2"],
  "text": "简答内容",
  "confidence": 0.85,
  "reason": "不超过20字"
}
```

- 单选/判断：`indices` 长度 1。
- 多选：`indices` 去重、按选项下标升序，至少 1 个。
- 填空：`blanks` 按空顺序，数量等于 `blankCount`；不足时保留已有并标低置信。
- 简答/论述：`text` 80–200 字，分点作答；`temperature 0.2`。
- 失败重试 2 次；仍失败则该题标记“跳过”，继续下一题，不中断整卷。
- 缓存键：题干 + 题型 + 排序后的选项；简答题不缓存（避免重复答案）。

## 7. 写入答案（cx-fill）

1. **单选/判断**：点击选项 label（找不到则点 input 父节点）；点击后校验 `input.checked`，未生效则直接设值并派发 `click/change`。
2. **多选**：逐个目标选项点击；校验勾选数量，多选错则回滚重设。
3. **填空**：用原生 value setter 写值，依次派发 `input`、`change`、`blur`；多空按 DOM 顺序。
4. **简答（textarea）**：原生 setter + `input/change`。
5. **简答（UEditor）**：
   - 先写隐藏 textarea；
   - 再尝试 `window.UE.getEditor(textareaId).setContent(text)`；
   - 失败则写 `iframe.contentDocument.body.innerHTML` 并派发 `input`；
   - 三种方式都失败则标记“需手动填写”。
6. **标记**：在题目容器右上角插入小徽标（已填 / 跳过 / 失败），不遮挡选项。
7. 写入前滚动到题目，写入后回到原滚动位置，避免整页跳动。

## 8. 调度（cx-main）

1. 启动时 `scrollTo(0, document.body.scrollHeight)` 触发懒加载，等待 800ms 再回顶部（可在设置中关闭）。
2. 扫描 → 过滤：已答且开启“跳过已作答”则跳过；图片题/编程题/听力题标记“跳过”。
3. 逐题串行：判题 → 延迟（默认 1.2–3s，间隔随机）→ 写入 → 更新 HUD 进度。
4. 全部完成：HUD 显示“已填 X/Y，请检查后手动提交”，**绝不点提交**。
5. 停止：面板按钮、HUD、`Alt+Shift+S`；停止后不再写任何题。
6. 页面新增题目（翻页/懒加载）：MutationObserver 重新扫描并继续填充。
7. 单题失败不中断；结束后汇总失败题号。

## 9. 面板调整

- 显示当前站点（Wayground / 学习通）。
- 新增设置：`跳过已作答`（默认开）、`启动时滚动加载`（默认开）。
- “探测”在学习通模式下展示题目数量、题型分布与前 8 题摘要。
- 模式文案：学习通显示“整卷模式”，Wayground 仍为“单题模式”。

## 10. 限制与风险

- 仅支持顶层文档与**同源** iframe；跨域 iframe 内的整卷暂不支持，探测会提示。
- 图片题、编程题、听力题、连线/拖拽题不自动作答，标记跳过。
- UEditor 版本差异可能导致写入失败，失败会标红并提示手动填写。
- 学习通可能有切屏/焦点检测：所有操作在页内完成；但打开侧边栏可能触发焦点变化，建议配置完成后从 HUD 启动。
- 自动答题违反平台规定的风险由使用者承担；本工具不自动提交。

## 11. 验收

1. 语法检查通过，扩展重新加载无报错。
2. 本地 mock 整卷（单选/多选/判断/3 空填空/textarea 简答/可编辑区简答）全部正确写入，进度显示 6/6，未触发提交。
3. 真实学习通考试预览页“探测”：题目数、题型、题干、选项与页面一致。
4. 真实页面小范围试填 3 题：选项勾选正确、填空与简答写入成功、刷新前不丢。
5. 停止按钮与快捷键即时生效；已答题目在开启“跳过已作答”时不被覆盖。

## 12. 执行顺序

1. `sites.js` + manifest 权限 + background 路由改造。
2. `llm.js` 增加 `askExam()` 与题型解析。
3. `cx-adapter.js` 扫描与快照。
4. `cx-fill.js` 写入与标记。
5. `cx-main.js` 调度、HUD、停止。
6. 面板增加学习通模式展示与两个设置项。
7. mock 整卷测试，修 bug。
8. 真实页面探测校准，交付使用说明。
