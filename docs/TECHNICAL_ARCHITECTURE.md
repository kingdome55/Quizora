# 技术架构

> 对应版本：0.7.10 · 所有路径相对 `wayground-auto/`

## 1. 总体架构

```
┌──────────────────────────┐
│ 侧边栏 panel.html/js      │  配置 / 开始 / 停止 / 探测 / 日志
└─────────────┬────────────┘
              │ chrome.runtime.sendMessage
┌─────────────▼───────────────────────────────────────────┐
│ background.js (MV3 Service Worker)                       │
│  · 站点路由 sites.js                                     │
│  · frame 枚举 / 探测 / 择优 / 注入兜底 frame.js           │
│  · 运行态 run、日志 history、端口广播                     │
│  · LLM 调用 llm.js（唯一持有 API Key）                    │
│  · 缓存 cache.js、配置 config.js                          │
└─────────────┬───────────────────────────────────────────┘
              │ chrome.scripting.executeScript（按站点文件清单）
┌─────────────▼───────────────────────────────────────────┐
│ 页面内容脚本（隔离世界，共享 window.__wg 命名空间）        │
│  Wayground：adapter → solver → main + hud                 │
│  学习通/通用：cx-font / cx-debug / cx-generic / cx-plain /│
│               cx-adapter / cx-image / cx-fill / cx-main   │
│  头歌：edu-adapter / edu-main（Monaco 主 world 读写）      │
│  字体依赖：vendor/typr-md5.js + cx-font-table.json         │
└─────────────┬───────────────────────────────────────────┘
              │ fetch（仅 background）
┌─────────────▼───────────────────────────────────────────┐
│ OpenAI 兼容接口（默认 api.deepseek.com/v1）               │
└──────────────────────────────────────────────────────────┘
```

### 1.1 学习通 0.6.0 两条新链路

- **字体解密（cx-font.js）**：页面 `<style>` 内嵌 `font-cxsecret` TTF → `Typr.parse` → 对 CJK 码位算 `glyphToPath` 的 MD5 → 查 `cx-font-table.json` → 构建“替换码位 → 真实码位”映射；`cx-adapter.norm()` 在文本进入模型前解密，并同步改写 `.font-cxsecret` 文本节点。
- **填空写入（cx-fill.js）**：`.XztiHover1` 是答案格（左侧 `span.tiankong` 只是“第 N 空”标签）→ 格内 `input.inp` 用原生 setter 写入；UEditor 先写同源编辑 iframe，再通过 background `WG_UE_FILL` 在 MAIN world 调 `UE.getEditor(name).setContent()+sync()`。

### 1.3 头歌（EduCoder）粘贴/查看限制解除 + 参考答案（0.7.3–0.7.10）

- **平台级**：`edu-paste.js` 在 `document_start`、MAIN world、`all_frames` 注入；同时 hook `window.fetch` 与 `XMLHttpRequest`（头歌任务数据实际走 axios/XHR，0.7.7 只 hook fetch 时字段不生效），对 `/api/tasks` / `json?homework_common_id` 的 JSON 递归改写复制与查看入口字段：
  - 复制：`shixun.can_copy=true`、`forbid_copy=false`、`copy_for_exercise* = true`、`challenge.diasble_copy/disable_copy=false`；
  - 查看：`has_answer=true`、`challenge.hide_answer=false`、`game.homework_common_answer_open=false`、`game.answer_open=1`、`game.homework_common_comment_open=false`、`shixun.is_disable_discuss=false`、`test_set_permission=true`、`open_answer_and_test=1`、`show_code_dir=true`、`display_git_address=true`。
- **编辑器级**：递归清理 `input/textarea/[contenteditable]/.monaco-editor/.cm-editor/.ace_editor/.CodeMirror` 的 `onpaste`，恢复 `user-select:text`；MutationObserver + 12 次短轮询覆盖动态编辑器。
- **参考答案**：`edu-paste.js` 采集任务 ID、`Pc-Authorization` 等请求头，并使用公开签名算法 `md5(base64("method=GET&ak=...&sk=...&time=..."))` 直接调用官方 `get_answer_info.json`；正文不伪造。`unlock_answer.json` 仅在侧边栏开启“自动解锁（消耗金币/留记录）”时调用；未解锁则回退 AI。
- **参考答案优先流程**：`edu-main` 通过 `window.postMessage` 请求 `edu-paste` 读取答案；拿到后直接写入编辑器并评测，参考答案未通过时自动回退 `EDU_SOLVE` AI 修正。若签名接口失败，回退读取页面 `.answer-content` 的已解锁答案。
- **编辑器选择（0.7.9）**：0.7.7 打开参考答案入口后页面会创建隐藏 Monaco model，旧逻辑按“内容最长”选择会写错位置。`eduEditorScript` 现在用 `monaco.editor.getEditors()` + DOM 面积标记 `visible/area`，排序可见优先；`EDU_SET_CODE` 收到隐藏 `editorId` 时重定向到可见 model。
- **模板合并（0.7.10）**：参考答案/AI 往往只返回解题片段。`mergeWithTemplate` 检测当前编辑器的 `#代码开始` / `#代码结束`，把片段插入标记之间并保留 `use library;`；完整答案（自身含标记）原样写入。
- **无记录读取（0.7.10）**：默认 `eduReferenceNoRecord=true`，`edu-main` 优先读 `.answer-content` 或 `sessionStorage` 缓存，不调用 `get_answer_info` / `unlock_answer`；未命中时回退 AI。关闭该开关才恢复平台接口与可选自动解锁。
- **冷却与停止**：`edu-adapter.cooldownText()` + `isDisabled()` 检测评测按钮冷却，`waitEvaluateReady`/`waitCooldown` 最多等待 90 秒；`stopRun` 向所有已启动 frame 广播 `WG_STOP` 并 `clearFrame`，修复停止后探测失败/重复开始被忽略。
- **状态**：`edu-paste-ready.js`（隔离 world，top frame）发 `EDU_PASTE_READY`；收到 MAIN world 的 `VIEW_UNLOCKED` 后发 `EDU_VIEW_UNLOCKED`，徽标/侧边栏更新为“粘贴/查看限制已解除（含参考答案入口）”。
- **边界**：`/exam` 不解锁；不修改答案内容、金币、成绩或评测状态。

### 1.2 头歌（EduCoder）自动答题链路（0.7.0–0.7.2，0.7.4 恢复）

- **站点**：`*.educoder.net` 直接打开，或作为学习通 `doHomeWorkNew` 内的跨域 iframe；两种形态都由静态内容脚本 `all_frames` 注入。
- **edu-adapter.js（DOM 侧）**：读取左侧“任务描述”文本；按文本查找“评测 / 下一关”按钮；读取“测试结果”面板并按关键词判定通过/失败；几何+文本启发式，避免依赖具体 class。
- **编辑器发现（0.7.1/0.7.2）**：`EDU_FIND_EDITOR` 先用 `webNavigation.getAllFrames` 枚举所有 frame，逐帧在 MAIN world 扫描 Monaco / Ace / CodeMirror 5/6 / textarea / contenteditable；若 MAIN world 注入失败（sandbox/跨域 iframe），再通过 `chrome.tabs.sendMessage` 逐帧调用内容脚本 `EDU_DOM_FIND`，后者扫描当前 frame、同源 iframe document 与 open shadow DOM。写入走 `EDU_DOM_SET`：聚焦 + selectAll + `execCommand('insertText')`，失败时合成 `ClipboardEvent('paste')` + `DataTransfer`。
- **edu-main.js（流程侧）**：`findEditor` 选择编辑器并记录 frameId；`EDU_SOLVE` 调 `askCode` 生成完整代码；`EDU_SET_CODE` 按 frameId 在 MAIN world 写入对应编辑器；点击评测 → 轮询结果 → 失败时把错误回传模型 → 等待按钮冷却 → 重试；通过后点击“下一关”。
- **续跑**：`sessionStorage` 保存 `{settings, passed}`（不含 API Key）；整页刷新后自动继续。
- **边界**：只在作业/练习页运行；URL 含 `/exam` 或页面出现“交卷/监考/考试剩余时间”时拒绝。当前只填充主编辑器；多文件任务暂不支持。

关键边界：

- API Key 只存在于 background；内容脚本只能拿到判题结果。
- panel 关闭不影响运行，HUD 常驻页面左下角。
- 所有内容脚本用 `if (window.__wg?.xxx) return;` 防重复注册；静态注入与动态注入可能重叠，但不会重复初始化。

## 2. 站点注册

`src/background/sites.js`：

```js
wayground → /(^|\.)(wayground|quizizz)\.com$/ 且路径含 game/play/activity/join
chaoxing  → 任意 *.chaoxing.com（章节页 studentstudy 也算）
generic   → 任意 http/https
```

`isReadOnlyUrl()` 拦截 `/work/view`、`/exam/analysis`（只读查看页），`/exam/preview` 放行（预览页实际可作答）。

## 3. 注入与 frame 选择（0.5.3）

### 3.1 两种注入路径

| 路径 | 适用 | 实现 |
| --- | --- | --- |
| 静态内容脚本 | 学习通 | `manifest.content_scripts`：`all_frames: true`、`match_about_blank: true`、`run_at: document_idle` |
| 动态注入 | Wayground / 通用网页 / 兜底 | `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files })` |

### 3.2 `pickFrame(tab, files)` 流程

1. 若缓存中存在同 URL 的 frame，先探测它，可用就直接返回。
2. `chrome.webNavigation.getAllFrames({ tabId })` 拿到真实 frame 列表，并按 `parentFrameId` 链计算**嵌套深度**。
3. 对每个 frame 发送 `WG_PROBE`，收集 `{ frameId, depth, snapshot, error }`。
4. “可用”的判定：`snapshot.count > 0` **或** `snapshot.options.length > 0`（兼容没有 `count` 字段的 Wayground）。
5. 排序：先按权重（题数 ×1000 + 选项数），再按**深度降序**（题数相同时选更深、即真正持有题目的 frame）。
6. 若没有任何可用 frame，则注入一次文件（先全帧，失败退顶层），再复测一轮。
7. 清理其他 frame 残留的 HUD；成功的 frame 写入缓存。
8. 返回 `{ frameId, snapshot, count, usable, injection }`；全失败时返回“最有证据”的 frame 快照 + 各 frame 摘要，供面板诊断。

### 3.3 为什么不用“全帧广播”

早期停止/启动用广播，出现 `No frame with id ... in tab` 一类失效 frameId 报错，且同一页面的父 frame 与子 frame 会重复看到同一批题（`roots()` 递归扫描）。0.5.3 起改为：

- **单 frame 执行**：只向选中的 frame 发 `WG_START`；
- **同文档过滤**：`cx-adapter.scan()` 只接受 `el.ownerDocument === document` 的题目，父 frame 不再“代管”子 frame 的题目；
- **深度优先**：避免在父 frame 里跨 realm 操作子 frame 的 DOM。

## 4. 消息协议

### 4.1 panel / background

| type | 方向 | 作用 |
| --- | --- | --- |
| `GET_STATE` | panel → bg | 返回配置、缓存数量、运行态、日志 |
| `SAVE_CONFIG` | panel → bg | 合并保存配置 |
| `START` | panel → bg | 启动（先 `stopRun`，再 `pickFrame` → `WG_START`） |
| `STOP` | panel → bg | 广播 `WG_STOP`，复位运行态 |
| `PROBE` | panel → bg | 探测页面并返回快照/注入信息/自检 |
| `TEST` | panel → bg | 用固定英文题测试接口连通性 |
| `TEST_VISION` | panel → bg | 用内置 `vision.png` 测试图形识别 |
| `CLEAR_CACHE` | panel → bg | 清空答案缓存与所有 `wg_exam_done_v1*` 键 |
| `GET_CACHE` / `SOLVE` / `SOLVE_EXAM` | content → bg | 缓存查询 / 单题判题 / 整卷判题 |
| `FETCH_IMAGE` | content → bg | 下载远程图片为 data URL（content 无跨域抓图能力） |
| `WG_LOG` / `WG_STATE` / `WG_STOPPED` | content → bg | 日志、状态、结束原因 |

### 4.2 background / content

| type | 作用 |
| --- | --- |
| `WG_START` | 携带 `settings` 与 `site`，启动内容脚本 |
| `WG_STOP` | 停止当前运行（广播，不带 frameId） |
| `WG_PROBE` | 返回当前 frame 的 `snapshot()` |

### 4.3 panel 端口

`chrome.runtime.connect({ name: 'wg-panel' })`：background 在连接时推送 `HISTORY`，之后 `LOG` / `STATE` 实时广播；最多保留 100 条日志。

## 5. 内容脚本模块职责

### 5.1 Wayground（单题）

| 文件 | 职责 |
| --- | --- |
| `adapter.js` | 计数器（顶部 `N/M` 文本）、题干、选项三级兜底（aria → group → geo）、文本输入框、点击/填充、锁定态、诊断快照 |
| `solver.js` | 缓存 → 字母重排规则 → LLM；`decide()` 返回 index/text |
| `main.js` | 单题状态机：识别 → 判题 → 延迟 → 点击/填写 → 推进校验（8s 重试、18s 暂停）→ 完成 |
| `hud.js` | Shadow DOM 状态条、停止按钮 |

历史遗留：`main.js` 仍保留 `settings.pauseOnLowConfidence` 分支，但面板与默认配置已不再提供该字段（死代码，见 KNOWN_ISSUES）。

### 5.2 学习通 / 通用（整卷）

| 文件 | 职责 |
| --- | --- |
| `cx-debug.js` | 诊断：iframe、输入框/编辑器/选项块计数、`typeName`、题型标签、HTML 片段 |
| `cx-generic.js` | 通用控件反推：radio/checkbox 按 name 或父容器分组、`.answerBg` 按父节点分组、文本域按题干文字上溯 |
| `cx-plain.js` | 纯文本 `A/B/C/D` 选项识别（支持 `A、`、`A.`、`A ` 三种前缀） |
| `cx-adapter.js` | 整卷扫描核心：容器选择器、标签锚定、属性题型、控件反推、合并去重、题目构建、诊断快照 |
| `cx-image.js` | 题目图片去重、转发下载、缩放（≤1024、JPEG 0.82） |
| `cx-fill.js` | 选择点击、填空写入、富文本写入、保存按钮、徽标标记 |
| `cx-main.js` | 整卷调度：滚动加载、最多 3 轮扫描、跳过已答、判题、写入、保存、进度、停止 |

## 6. 整卷扫描算法（cx-adapter）

### 6.1 题目块来源（三路 + 通用兜底）

1. **容器选择器**：`.questionLi`、`.TiMu`、`[class*="questionLi"]`、`[class*="TiMu"]`、`.question-item`、`.questionItem`、`.work-question`、`.mark_item`、`[typeName]`、`[data-type]`、`[questiontype]`。
2. **题型标签锚定**：扫描 `i/span/b/strong/em/div/p/li/h3/h4/label` 中短文本，命中 `【单选题】`、`（简答题）`、`[单选题]`、`1、单选题` 等；从标签节点向上爬到“不包含其他题型标签”的最高祖先，作为题目块。
3. **答题控件反推**：radio/checkbox（按 `name` 或最近的 `ul/[class*=answer]/[class*=option]` 分组）、`.answerBg`（按父节点分组）、`textarea/.edui-editor/[contenteditable]`；从控件向上爬，遇到“别的题目的控件”超过阈值即停止。
4. **通用兜底**：`cx-generic.find()`。

三路结果合并时：

- 同一元素只保留一份；
- 被其他块包含的块优先保留外层（但把所有命中的内层块用于拆分“整卷包装层”）；
- 若主结果只有 1 个块、且该块包含多个内层题目块，则拆分为内层；
- 丢弃跨多个题目的超大包装块（内部包含 >1 个其他候选块）。

### 6.2 题型判定优先级

1. 属性：`typeName` / `data-type` / `questiontype`（含祖先 6 层）→ 直接映射；
2. 题干开头：`（单选题）`、`【多选题】`、`[判断题]`、无括号的 `1、简答题`；
3. 控件：checkbox → 多选；radio → 单选/判断（选项仅为 对/错 时判断）；无选项 + 纯文本输入 → 填空；`textarea/edui/contenteditable` → 简答；
4. 仍无法判定 → `unknown`，运行时会标记失败并跳过。

### 6.3 题目对象结构

```js
{
  index, el, type,            // single|multiple|judge|blank|short|unknown
  stem,                       // 去题号、去题型括号的题干
  options: [{ index, text, input?, box?, el? }],
  inputs,                     // 填空输入框（DOM 顺序）
  textarea, iframe, editable, // 简答三种载体
  images: [url],              // 最多 2 张大图
  blankCount, answered, key    // key = FNV(type|stem|options)
}
```

### 6.4 快照与诊断

`snapshot()` 返回：

- `mode: 'exam'`、`url`、`count`、`types`；
- 前 8 题摘要（题干 160 字、选项 6 个、空格数、是否有编辑器、是否已答）；
- `count === 0` 时附带 `diagnostics`：输入框/文本域/编辑器/选项块/答题区计数、`typeName`、候选标签、iframe 可读性、容器命中统计（原始/可见/带标签）、HTML 片段、扫描异常；
- `frames`（由 background 附加）：各 frame 的题数、标签数、URL、错误。

## 7. 写入链路（cx-fill）

1. **选择/判断**：优先点击 `label`/选项容器；有 `input` 时校验 `checked`，必要时直接设值并派发 `change`；无 `input` 时只点击，不硬校验 class（避免“成功却报失败”）。
2. **多选**：逐个目标点击；最终只校验“没有多选到非目标项”。
3. **填空**：按 DOM 顺序逐个写值；原生 setter + `input`/`change`；无 input 时回退到编辑器。
4. **简答**：
   - 隐藏 `textarea` 写值 + `blur`；
   - `contenteditable` 写 HTML + `input`；
   - UEditor：先按 `UE.instants` 找到当前题目容器内的实例并 `setContent`，再用 `UE.getEditor(id)`，最后回退写 `iframe.contentDocument.body.innerHTML`；
   - 写完后如存在实例，再次同步隐藏 textarea。
5. **跨 realm 安全**：`setNativeValue` 以 `el.tagName` 判断类型，并从 `el.ownerDocument.defaultView` 取对应构造器原型上的原生 setter（修复 `Illegal invocation`）。
6. **保存**：考试模式下，若题目容器内存在文字恰好为“保存”的按钮则点击并等待 700ms；**不点交卷**。
7. **标记**：题目右上角插入“已填 / 跳过 / 失败”徽标；`clearMarks()` 在每次启动时清理。

## 8. 整卷调度（cx-main）

```
start
  └─ 可选：滚动到底部触发懒加载，800ms 后回原位
  └─ 读取当前页面的 doneKeys（chrome.storage.local）
  └─ 最多 3 轮：
       scan → 若 0 题且尚未填过 → 停止并报“未识别到题目”
       → 对每题：
            unknown / 无控件 → 记失败
            已答 或 doneKeys 命中（且开启跳过）→ 跳过
            判题（缓存或 SOLVE_EXAM）→ 延迟 → 写入 →（考试）保存
            单题任何异常 → 只标记该题失败，继续下一题
       → 本轮没有任何实际动作 → 结束
  └─ finish：显示 X/Y、失败数、跳过数，提示手动提交
```

停止方式：面板“停止”、HUD 停止、`Alt+Shift+S`、页面切换/标签关闭。

`settings.mode` 由 background 按路径判断：路径含 `/exam` 为 `exam`，否则 `work`；仅影响“是否点每题保存”。

## 9. LLM 协议（llm.js）

### 9.1 两套调用

| 函数 | 用途 | 输出 |
| --- | --- | --- |
| `askLLM` | Wayground 单题 | 选择题 `{index, confidence, reason}`；填空题 `{text}` |
| `askExam` | 学习通/通用整卷 | `{indices:[], blanks:[], text, confidence, reason}` |

### 9.2 请求策略

- `POST {baseUrl}/chat/completions`，`Authorization: Bearer <key>`；
- 默认 `response_format: {type:'json_object'}`；服务端 400 时自动关闭该字段重试；
- 每次请求 20s 超时（`AbortController`）；
- 最多 3 次尝试，退避 1s / 3s；
- 401/403 直接返回“Key 无效”；404 返回“接口地址不存在”；
- 宽松 JSON 解析：截取首个 `{` 到末个 `}`。

### 9.3 提示词要点

- 单选/判断：`indices` 只给 1 个；
- 多选：给全正确项、不凑数；
- 填空：只给词/短语，数量等于空格数；
- 简答：中文分点 80–200 字，`temperature 0.2`；
- 图片题：附 `image_url`，只给最终结果；
- 失败时用低置信度仍给出最可能答案（前端不再因低置信度暂停）。

### 9.4 图片链路

`cx-adapter` 收集题目内 ≥120×80 的图片 URL（最多 2 张）→ `cx-image` 通过 background `FETCH_IMAGE`（带 cookie 下载、≤3MB）→ 页面内 canvas 缩放（长边 1024、JPEG 0.82）→ 以 `image_url` 传入。若图片请求因模型不支持返回错误，`askExam` 会自动去掉图片重试一次。

## 10. 缓存与去重

| 数据 | 键 | 位置 | 说明 |
| --- | --- | --- | --- |
| 答案缓存 | FNV(题干 + 排序选项/题型) | `chrome.storage.local` `wg_cache_v1` | 最多 2000 条，按时间淘汰；简答题不缓存 |
| 已处理题目 | `wg_exam_done_v1:${origin}${pathname}${search}` | `chrome.storage.local` | 按页面隔离；保存题目 key 集合 |
| frame 缓存 | tabId | background 内存 | URL 变化/页面刷新即清空 |

## 11. 配置与权限

默认配置（`config.js`）：

```json
{
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "",
  "model": "deepseek-flash",
  "minDelay": 1500,
  "maxDelay": 3000,
  "dryRun": true,
  "examSkipAnswered": true,
  "useCache": true,
  "examScrollLoad": true
}
```

manifest 权限：

- `scripting` / `storage` / `tabs` / `activeTab` / `sidePanel` / `webNavigation`
- `host_permissions`：wayground、quizizz、chaoxing、以及**全部 http/https**
- `content_scripts`：仅学习通，全 frame + `match_about_blank`

> `host_permissions` 覆盖全站是“通用网页兜底”的代价；面板还会调用 `chrome.permissions.request` 申请 API 域名（实际上已被全站权限覆盖）。见 TECHNICAL_DECISIONS 与 KNOWN_ISSUES。

## 12. HUD 与面板

- HUD：`attachShadow` 自定义卡片，显示状态、明细、停止按钮；全局 id `__wg_hud`；`pickFrame` 会清理非选中 frame 的 HUD。
- 面板：深色侧边栏，含模型连接、运行参数、状态（站点/题号/缓存）、探测快照、日志（最多 100 条）。
- 面板模型预设：`deepseek-flash`、`deepseek-v4-pro`、`deepseek-chat`、自定义；切换预设会同步 Base URL 并保存。

## 13. 关键时序（探测）

```
panel PROBE
  → background.resolveTab / siteForUrl
  → frame.pickFrame
      → 缓存命中? probe
      → webNavigation 列 frame + 深度
      → 逐 frame WG_PROBE
      → 无可用 → 注入 → 再探测
      → 选最优（题数 → 深度）
      → 清理其他 HUD / 写缓存
  → 若无可用：logInjection + 逐 frame 自检（版本 / adapter / main / URL）
  → panel.renderSnapshot + 诊断日志
```
