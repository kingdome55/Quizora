# Changelog

本项目采用语义化版本。当前处于公开测试阶段（0.x），接口与行为仍可能调整。

## [0.7.14] - 2026-11-03

### Fixed（wr is not defined / 编辑器优先级）

- 修复 `wr` 作用域错误：`wr` 声明在写入分支内，写后兜底判断在分支外引用导致 `ReferenceError`，日志表现为“已写入代码”后立即“停止：运行异常：wr is not defined”。
- 编辑器选择改为“可见优先 → MAIN world API 优先 → 类型/面积 → 长度”；页面同时有 `dom-monaco` 和 `cm5` 时优先选可读写 API 的 `cm5`，而不是 DOM 兜底。
- 写入成功后把 `model.type` 更新为实际写入类型（如 `cm5`），后续重试直接走 API。
- 0.7.13 的 CodeMirror 误判/重复代码修复与模板清理继续保留。

### Tested

- `edu-main` 参考答案写入/评测 mock 通过，不再出现 `wr is not defined`。
- 模板合并、重复模板清理、可见 Monaco 回退测试继续通过。

## [0.7.13] - 2026-11-03

### Fixed（CodeMirror 5 重复代码 / 误判写入失败）

- 截图日志为 `cm5:0`，`cm.setValue` 已返回 84 字符，但写后回读读取 `.CodeMirror-code` 虚拟行文本只有 52 字符，误判“未包含目标代码”，触发 DOM 覆盖，导致重复代码。
- 0.7.13 改为信任 `Monaco/CM5/CM6/Ace` 的 `setValue` 返回长度与 `visible` 标记；只有目标 `visible=false` 时才做 DOM 兜底，不再用 CodeMirror 虚拟行文本做精确校验。
- `mergeWithTemplate` 遇到多组 `#代码开始/#代码结束` 时，保留第一组前缀与最后一组后缀，清理历史重复模板后再插入答案。
- 0.7.12 的侧边栏精简与 AI 502 服务繁忙处理继续保留。

### Tested

- 0.7.9/0.7.10/0.7.11 的 model、模板、合并测试继续通过；新增重复模板清理用例。

## [0.7.12] - 2026-11-03

### Changed（面板精简）

- 侧边栏改为“运行 → 状态 → 日志 → 设置”结构；模型/Key/参数全部收进底部折叠“设置”，默认收起，减少视觉压力。
- 卡片间距、圆角、阴影缩小；设置区用 `<details>` 折叠，未配置 API Key 时自动展开。
- 所有原有按钮与设置 ID 保留，功能不变。

### Fixed（AI 服务繁忙误判为未通过）

- LLM 接口 429/500/502/503/504 时重试间隔改为 3 秒 / 8 秒，并在最终返回明确错误 `AI 服务繁忙（HTTP xxx）`。
- 头歌流程遇到服务繁忙时停止并显示“AI 服务繁忙”，不再继续点评测，也不再把接口失败标成“未通过”。
- 0.7.11 的可见 model 回退、写后回读、DOM 覆盖与模板合并继续保留。

## [0.7.11] - 2026-11-03

### Fixed（头歌仍写入隐藏 model）

- 0.7.10 的可见优先依赖 `monaco.editor.getEditors()`；部分页面该 API 不可用或返回空，隐藏 model 仍被当成可见。
- 0.7.11 增加 DOM 回退：没有 `getEditors` 结果时，用可见 `.monaco-editor .view-lines` 文本匹配 model，标记对应 model 为可见。
- 写入后回读可见编辑器：若未包含目标代码，自动用 DOM 覆盖写入；仍不一致则停止评测，不再“写隐藏后直接点评测”。
- 写入日志增加编辑器类型与 id，例如 `已写入代码（N 字符 · monaco · monaco:2）`。
- 0.7.10 的模板合并与无记录读取继续保留。

### Tested

- 0.7.9 可见/隐藏 model 测试、0.7.10 模板合并测试继续通过。
- 新增 DOM view-text 回退逻辑（未跑真机，待日志确认）。

## [0.7.10] - 2026-11-03

### Fixed（头歌答案格式）

- 参考答案/AI 返回的往往只是**解题片段**（如 `insert into reader(...);`），旧逻辑直接覆盖整个编辑器，导致片段跑到 `use library;` 前面。
- 新增 `mergeWithTemplate`：若当前编辑器含 `#代码开始` / `#代码结束`，把答案片段插入两个标记之间，保留 `use library;` 与模板结构；答案本身是完整代码（含标记）时保持原样。
- DOM 探测到的 `dom-monaco` 写入时，优先尝试 MAIN world 的 Monaco/CM/Ace API 覆盖式 `setValue`，失败再走 `insertText` 兜底，避免把答案插到模板开头。

### Added（无金币/无记录读取）

- 新增“头歌：只读已显示/缓存答案，不主动调用查看接口（避免金币/记录）”开关，**默认开启**。
- 启动时优先读取页面已经显示的 `.answer-content` 或 `sessionStorage` 缓存；有内容直接使用，不调用 `get_answer_info` / `unlock_answer`。
- `watchVisibleAnswer` 会在页面打开答案面板时自动缓存当前关卡答案，后续重新开始不再调用查看接口。
- 未发现已显示/缓存答案时，默认不主动调用平台查看接口，回退 AI 生成；关闭该开关后才恢复 `get_answer_info`（以及可选的自动解锁）。
- 说明：平台未解锁的参考答案属于服务端授权/金币逻辑，插件无法保证“零金币零记录”直接拿到；默认策略是**不主动触发**查看/解锁，避免新增扣分记录。

### Tested

- `mergeWithTemplate`：片段合并、完整代码保持、无模板去除重复 `use library;` 全部通过。
- 0.7.9 可见 model 选择测试继续通过。

## [0.7.9] - 2026-11-03

### Fixed（头歌写入错编辑器）

- **根因**：0.7.7 打开参考答案入口后，头歌页面会额外创建隐藏的 Monaco model；旧逻辑在 `eduEditorScript` 中按“内容最长”选择 model，结果把答案写进隐藏 model，页面可见编辑器仍是空模板，随后直接点评测。
- **修复**：编辑器发现改为**可见优先**（`monaco.editor.getEditors()` + DOM 面积），隐藏 model 排到后面；`EDU_SET_CODE` 收到隐藏 `editorId` 时也会重定向到可见 model；日志出现 `隐藏模型` 警告。
- 同时保留 0.7.8 的参考答案优先、XHR hook、冷却等待与停止修复。

### Tested

- Node VM：可见 model（25 字符）与隐藏 model（120 字符）同时存在时，`find` 选中可见 model；`set` 传隐藏 id 仍写入可见 model。
- 构建：见 `release/quizora-v0.7.9.zip`。

## [0.7.8] - 2026-11-03

### Added（头歌参考答案优先 + 稳定性）

- 新增 **XHR hook**：头歌任务数据实际走 axios/XHR，0.7.7 只 hook `fetch` 导致查看字段未生效；0.7.8 同时 hook `XMLHttpRequest` 的 `open/send/setRequestHeader` 与 `responseText/response`，任务 JSON、任务 ID、`Pc-Authorization` 等请求头可被采集。
- 直接调用平台官方 `get_answer_info.json` 读取参考答案（签名算法参考公开实现：`md5(base64("method=GET&ak=...&sk=...&time=..."))`）；不伪造答案、不改金币/成绩。
- 答题流程改为**参考答案优先**：读取到标准答案后直接写入编辑器并评测；参考答案未通过时自动回退 AI 修正。
- 新增侧边栏选项“头歌：参考答案未解锁时自动解锁（消耗金币/留记录）”，默认关闭；关闭时记录“参考答案未解锁”并回退 AI。
- 评测前检测冷却：按钮禁用、倒计时、冷却提示时最多等待 90 秒；失败后同样等待 90 秒再重试。
- 停止时向所有已启动 frame 广播 `WG_STOP` 并清理 frame 缓存；探测不再因“评测按钮暂时不可用”而直接识别为 0 题；重复开始会先停止旧任务再重启。

### Tested

- Node VM：XHR 任务 JSON 11 项断言、参考答案 API 状态 3/状态 1、MD5 签名与 Node crypto 一致、`edu-main` 参考答案优先写入/评测流程通过。
- 构建：见 `release/quizora-v0.7.8.zip`。

## [0.7.7] - 2026-11-03

### Added（头歌查看限制解除）

- MAIN world `fetch` hook 改写任务详情 JSON 的查看入口字段：`has_answer`、`challenge.hide_answer`、`game.homework_common_answer_open`、`game.answer_open`、`homework_common_comment_open`、`is_disable_discuss`。
- 恢复「参考答案 / 记录 / 评论 / 测试集 / 代码目录 / Git 地址」入口；参考答案正文仍由平台官方 `get_answer_info.json` / `unlock_answer.json` 返回，不伪造答案、不修改金币与成绩。
- 页面徽标与侧边栏增加“粘贴/查看限制已解除（含参考答案入口）”状态；页面控制台新增查看接口摘要（`status` / `entries` / `content` / `cost`），便于真机诊断。
- 考试页（路径含 `/exam`）继续硬性跳过，不注入查看/粘贴解锁逻辑。

### Tested

- Node VM mock：任务 JSON 17 项字段断言全部通过；`get_answer_info` 响应体未被改写；`/exam` 页面未 hook。

## [0.7.6] - 2026-11-02

### Improved（仅准确率，不改速度/功能）

- 选择题答案格式从 0 基下标改为**选项字母**（A/B/C/D，多选连写如 ACD），并兼容选项全文、判断题“对/错”；减少模型下标错位导致的错答。
- 题干/选项发送前清洗：去掉题号、题型前缀、选项自带的 A./B. 标签与多余空白。
- `runJson` 在模型返回格式无效、下标越界、填空数量不符时**重试**（最多 3 次），不再第一次无效就直接判失败。
- 填空题答案数量必须严格等于空格数；不足/多出都重试，避免“部分空未填”直接填入错误答案。
- 客观题填入后校验：目标选项必须全部选中，且单选/判断不能多选；未选中则标记失败，避免“看起来填了但实际没选上”。

## [0.7.5] - 2026-11-02

### Fixed

- **头歌 DOM 编辑器重复写入**：`EDU_DOM_SET` 在 `insertText` 成功后又执行 textarea setter / 合成 paste，导致一次运行出现两份相同代码（缩进可能不同）。现在只有编辑器内容确实未变化时才走 paste/textarea 兜底。
- 写入前比较当前编辑器内容：完全相同则跳过重复写入；检测到多份相同代码时日志警告并重写清理。
- 运行中再次收到 `WG_START`（双击“开始”/重复启动）会忽略，避免两条流程同时写入。
- 启动日志新增“说明 N 字符”与任务说明预览，便于确认是否读到题。
- 代码生成提示词强调保留所有 `#题目N`、`use library`、`#代码结束`，逐题核对字段/排序/子查询后再输出。

### Tested

- 头歌两关自动答题 mock 通过；同源 iframe CM6 的 DOM 写入 mock 通过。

## [0.7.4] - 2026-11-02

### Restored

- 恢复头歌（EduCoder）自动答题链路（0.7.0–0.7.2）：manifest 重新注入 `hud/edu-adapter/edu-main`，`sites.files` 恢复，`startRun`/`probe` 恢复正常的 frame 选择与自动答题。
- 0.7.3 的粘贴解锁继续保留：自动答题失败时，页面仍可直接粘贴用户自己的代码手动评测。

### Added

- 平台标识：侧边栏“站点”显示 `头歌（EduCoder）`，新增“模式”行显示 `自动答题（实验）+ 粘贴解锁`；页面右上角新增题灵·头歌徽标；HUD/日志统一加“头歌”前缀。
- 头歌徽标在自动答题运行时变为“自动答题运行中（实验）”，停止/结束后恢复“粘贴已解锁 · 自动答题可用（实验）”。
- `EDU_PASTE_READY` 状态改为“头歌（EduCoder）：粘贴已解锁；点开始可自动答题（实验）”。

### Tested

- 头歌两关自动答题 mock 仍通过；粘贴 API/DOM 解锁 mock 仍通过。

## [0.7.3] - 2026-11-02

### Changed

- **头歌改为“粘贴解锁”模式，不再自动生成/评测**：自动做题正确率依赖大模型对编程题的一次性正确性，失败会卡关；按用户要求退回到“让编辑器可以粘贴你自己的代码”。
- 新增 `src/content/edu-paste.js`（MAIN world，`document_start`，`all_frames`）：
  - hook `window.fetch`，改写任务 API（`/api/tasks`、`json?homework_common_id`）返回中的 `shixun.can_copy / forbid_copy / copy_for_exercise*` 与 `challenge.diasble_copy`，解锁平台级复制开关（参考 EduCoder Copy Helper 的修改点）；
  - 递归清理 `input/textarea/[contenteditable]/.monaco-editor/.cm-editor/.ace_editor/.CodeMirror` 上的 `onpaste`，恢复 `user-select:text`；
  - MutationObserver + 短轮询持续清理动态插入的编辑器。
- 新增 `src/content/edu-paste-ready.js`（隔离 world，`document_start`，仅 top frame）：上报 `EDU_PASTE_READY`，面板显示“头歌粘贴模式”。
- 面板/探测在头歌返回固定快照（`types.paste=1`）；开始按钮不再注入自动做题脚本。

### Removed

- `edu-adapter.js` / `edu-main.js` 不再参与头歌流程（文件保留用于后续可选恢复，不进 manifest）。

### Tested

- 本地 mock：任务 API 返回 `forbid_copy:true` 时，改写后 `can_copy=true / forbid_copy=false`；`document.onpaste`、编辑器 `onpaste` 被清空，`user-select:text` 生效。

## [0.7.2] - 2026-11-02

### Fixed

- **头歌编辑器仍然找不到**：0.7.1 用 `chrome.scripting` 在所有 frame 的 MAIN world 扫描，但真实页面的编辑器可能在 **sandbox/跨域 iframe** 中，`executeScript` 无法注入，导致 `main/dom` 均为 0。
- 新增 `match_origin_as_fallback: true`：让 `edu-main` 也能注入 `about:blank` / `srcdoc` / sandbox 的 opaque-origin 编辑器 frame。
- 新增 **DOM 回退链路**：background 通过 `chrome.tabs.sendMessage` 逐帧调用 `EDU_DOM_FIND`；内容脚本扫描当前 frame、同源 iframe 与 open shadow DOM，识别 `.monaco-editor` / `.cm-editor` / `.ace_editor` / `.CodeMirror` / textarea / contenteditable。
- `EDU_DOM_SET` 在编辑器 frame 内执行：
  - 点击/聚焦编辑器（Monaco `.inputarea`、CM6 `.cm-content`、Ace `ace_text-input`、CM5 textarea）；
  - Ctrl+A + `execCommand('selectAll')` 清空；
  - `execCommand('insertText')`；失败则合成 `ClipboardEvent('paste')` + `DataTransfer`（CM6/Monaco 都按 paste/input 处理）；
  - textarea 再回退原生 setter + input/change。
- DOM 回退会遍历同源 iframe 的 document 与 open shadow root；跨域/sandbox frame 由该 frame 自己的内容脚本响应。
- 启动日志会显示 `编辑器：dom-monaco/dom-cm6/... · frame#N`；写入失败会记录 active element，便于定位。

### Tested

- 本地 mock：同源 iframe 内 CodeMirror 6，top frame 的 `EDU_DOM_FIND` 跨 iframe 找到 `dom-cm6`，`EDU_DOM_SET` 成功替换为 `CREATE DATABASE library; show databases;`（`inserted=true`）。
- 原有两关流程 mock 仍通过。

## [0.7.1] - 2026-11-02

### Fixed

- **头歌编辑器识别失败**：真实页面中编辑器可能位于**子 iframe**，或已从 Monaco 换成 CodeMirror/Ace；0.7.0 只在内容脚本所在 frame 找 `window.monaco`，因此一直等待并最终报“未检测到 Monaco 编辑器”。
- 新增 `EDU_FIND_EDITOR`：在 background 侧用 `chrome.webNavigation.getAllFrames` 枚举全部 frame，再逐帧在 MAIN world 扫描编辑器，返回 `{type, id, frameId, language, value}`。
- 支持 6 类编辑器：Monaco、Ace、CodeMirror 5、CodeMirror 6、textarea、contenteditable。
  - Monaco/Ace/CM5/CM6 优先调用各自 setValue/dispatch；
  - CodeMirror 6 无实例时用 `.cm-content` + `execCommand('insertText')`（模拟输入，不触发 paste）；
  - textarea 用原生 setter + input/change。
- 启动日志新增 `编辑器：monaco/ace/cm5/cm6 · frame#N · 语言 · 模板 N 字符`，便于确认真实编辑器类型。
- 写入后回传实际编辑器 id；下一关重新跨 frame发现编辑器，兼容 URL/iframe 重建。

### Tested

- 本地 headless Edge mock：两关通过（含一次失败重试），日志出现编辑器类型与 frame；失败/演练/考试页路径保持正常。
- 说明：真实头歌页面的编辑器类型需以启动日志为准；若日志显示 `cm6`/`ace`，则 0.7.0 的 Monaco 假设不成立，本版已覆盖。

## [0.7.0] - 2026-11-02

### Added

- **头歌（EduCoder）编程作业模式**：适配左侧任务说明 + 右侧 Monaco 编辑器的作业页。
  - 读取 Monaco 模型与语言，提取左侧任务描述，调用大模型生成完整代码。
  - 通过 `chrome.scripting.executeScript({ world: 'MAIN' })` 读写 Monaco，绕过“禁止粘贴”的 DOM 限制。
  - 点击“评测”，解析“测试结果”面板；未通过时把错误详情回传给模型修复，默认最多 3 次。
  - 自动等待平台评测冷却；通过后点击“下一关/下一题/继续”，继续下一关。
  - 整页刷新后用 `sessionStorage` 自动续跑。
  - 考试页保护：URL 含 `/exam` 或页面出现“交卷/监考/考试剩余时间”时拒绝运行。
- 新增 `src/content/edu-adapter.js`、`src/content/edu-main.js`；`sites.js` 与 manifest 增加 `*.educoder.net` 站点与静态内容脚本。

### Changed

- 后台新增 `EDU_STATE` / `EDU_SET_CODE` / `EDU_SOLVE` 消息；新增 `askCode` 代码生成提示词与 90 秒超时。
- 评测失败结果会以 `WG_STOPPED reason=failed` 上报，面板显示“未通过”而不是“已填完”。
- `scripts/build.ps1` 校验所有 content_scripts 条目，而不只是学习通条目。

### Tested

- 本地 headless Edge mock 覆盖 5 条路径：两关正常通过（含一次失败重试）、连续失败达到上限、演练模式、考试页拒绝、结果面板解析；全部符合预期。
- 说明：真实头歌页面的按钮/结果文案仍需真机确认；当前只填充主代码文件。

## [0.6.0] - 2026-11-01

### Fixed

- **填空题按学习通真实结构写入**：答案格是 `.XztiHover1`（不是左侧 `span.tiankong` 标签）。
  - 格内优先写 `input.inp`；否则找 `textarea[name]` 对应的 UEditor：先写编辑 iframe，再通过 `chrome.scripting` 在 MAIN world 调用 `UE.getEditor(name).setContent()` + `sync()`。
  - 支持 `.Zy_ulTk`（作业）与 `.Cy_ulTk`（考试）两种容器；按“第 N 空”标签排序，不再依赖页面暴露的可见输入框数量。
  - 答案格内的值也纳入“已作答”判断，避免已完成填空被重复作答。
- **学习通字体反爬解密**：识别 `style` 中的 `font-cxsecret` 内嵌 TTF，使用 Typr.js 解析字形路径、MD5 查映射表，把题干/选项中的替换字还原为真实汉字。
  - 在扫描前完成解密；探测与启动都会等待字库就绪。
  - 日志输出“字体解密已就绪：N 个字形”，未命中时自动回退原文。
- 选择题选项收集排除 `.XztiHover1` / `.Zy_ulTk` / `.Cy_ulTk` 内的填空格，避免填空题被误判为选择题。

### Changed

- 新增 `src/vendor/typr-md5.js`、`src/vendor/cx-font-table.json`（MIT，见 README“第三方组件”）。
- `manifest.json` 增加 `web_accessible_resources` 以按需加载字形映射表。

### Tested

- 本地 mock 覆盖 7 组：旧版“span 标签 + 同级可编辑框”、`.XztiHover1 + input.inp`、`.XztiHover1 + UEditor iframe`、input/UEditor 混合、双题作用域隔离与 `isAnswered`、答案格 class 改版（标签后紧跟含控件的格）、答案数少于格子数（`complete=false`），均通过。

## [0.5.9] - 2026-11-01

### Fixed

- 真实页面的空框是 `span` 标签（`role=option`），不是答案框；填充改为点击标签后：
  - 检测页面全局新生成的 input/textarea/可编辑区；
  - 检查标签父级内的输入控件；
  - 查找同级答案框并直写；
  - 匹配父级选项列表中的答案文本并点击。
- 空框扫描范围扩展 `p/label/td/th/a`，并输出“空框父级”HTML，便于按真实结构适配。

## [0.5.8] - 2026-11-01

### Fixed

- 修复 0.5.7 在空框点击路径中引用未定义 `isVisible` 导致的 `ReferenceError`（本次“直接失败”的原因）。
- 空框无法激活出 input 时，回退为把空框内容区临时设为可编辑并写入答案；日志标注“空框直写，请核对”。
- 探测/启动日志增加“空框样本”HTML 片段，便于按真实 DOM 做最后适配。

## [0.5.7] - 2026-11-01

### Fixed

- 修复“输入框 0 / 空框 N”时提前返回、根本不点击激活的问题：现在先点击空框，再重新收集输入框。
- 填空按“第 N 空”逐槽定位：优先使用当前可见输入框，没有则点击对应空框并写入获得焦点的输入框/可编辑区。
- 只有实际写入成功的空数量达到答案数量时才标记完成；避免“页面空白但日志显示已填”。
- 点击空框时同时派发 pointerdown / mousedown / mouseup / click，兼容只监听鼠标按下的页面。

## [0.5.6] - 2026-11-01

### Fixed

- 多空填空从题干的 `____` 数量推断空格数，即使页面只暴露 1 个输入框，也会向模型请求全部空的答案。
- 题目容器只包含部分输入框时，自动向上扩展扫描范围；仍不足时尝试点击“第 N 空”空框以激活输入框。
- 填空题恢复“严格校验”的缓存：只有题面、题型、空格数与答案数组长度全部一致才命中，旧缓存不会复用。
- 同一轮运行内增加 `processed` 集合，避免多轮扫描对同一题重复判题，填空题不再反复调用模型。
- 缩短填空写入后的等待与补写间隔（160/120ms → 100/80ms）。

## [0.5.5] - 2026-11-01

### Fixed

- 修复填空题答案错乱/空填：禁用填空题答案缓存，并在读取选择题缓存时校验题目文本、题型与空格数，旧格式缓存自动失效。
- 修复写入使用扫描阶段旧 DOM 引用的问题：写入前后重新查询输入框，写入后延迟校验并补写一次。
- 修复同一页面多个任务点只处理第一个：学习通改为同时启动所有有题目的 frame，按任务点分别作答。
- 多任务点时日志增加 `[任务点N]` 前缀；任一任务点手动停止会停止其余任务点；全部结束后才汇总状态。

## [0.5.4] - 2026-11-01

### Fixed

- 修复一题多个空的填空题：
  - 模型把多个空的答案合并成一个字符串时，按空格数量拆分后再逐空写入；
  - 提示词明确要求 `blanks` 每个元素只对应一个空，禁止用分隔符合并；
  - 写入后逐框校验，避免整段答案只塞进第 1 空。
- 修复“部分填空被当作已完成”：
  - 填空题只有全部空格都有值才算已作答；
  - 跳过逻辑不再依赖容器 class 名或历史 `doneKeys`，仅按当前 DOM 的真实作答状态判断，避免刷新后 0/12 全部误跳。

## [0.5.3] - 2026-11-01

### Changed

- 品牌统一为「题灵 / Quizora」：扩展名称、侧边栏品牌、README 与知识库。
- 新增统一品牌图标（16 / 48 / 128，附 1024 源图）。
- 新增 GitHub 工程文件：README、LICENSE（MIT）、CHANGELOG、CONTRIBUTING、SECURITY、Issue/PR 模板、生产构建脚本。
- 新增 `docs/INSTALL.md` 与 `docs/release/` 发布说明。

### Fixed

- 修复学习通简答题在跨 frame 写入时抛 `Illegal invocation`：
  - 每帧只上报自身文档的题目（`ownerDocument === document`）；
  - frame 选择在题数相同时优先更深层 frame；
  - 原生 value setter 按元素所属 realm 获取；
  - 单题写入异常只标记该题，不再中断整卷。

> 上述简答修复已通过本地 mock 扫描回归，**尚待真实学习通页面复测**。

## [0.5.2] - 2026-10-31

### Added

- 学习通静态内容脚本（`all_frames` + `match_about_blank`），页面加载即注入。
- `webNavigation` 权限：按真实 frame 列表逐个探测。
- 探测失败时自动补注入、复测，并输出 `脚本注入 / 自检 #N v版本 adapter/main` 日志。

### Fixed

- 修复“探测显示未获取到页面信息 / 0 个选项”的注入层问题。
- 修复 Wayground 快照无 `count` 字段被误判为 0 题（`usable` / `weight`）。

## [0.5.1] - 2026-10-31

### Fixed

- 修复两个来源命中同一题目块时“相互去重、两份都消失”的 bug。
- 新增答题控件反推题目块，兼容无标准容器类、题型标签被加密的页面。
- 过滤讨论区/笔记/搜索框，避免被当作简答题。
- 探测为 0 时自动输出容器命中、`typeName`、标签、各 frame、HTML 片段诊断。

## [0.5.0] - 2026-10-31

### Fixed

- 修复混合“选择题 + 简答题”章节识别 0 题：
  - 合并所有容器选择器，不再首个命中即返回；
  - 支持 `[typeName]` / `[data-type]` 题型属性；
  - 新增题型标签锚定扫描；
  - 整卷包装层按内层题目拆分；
  - 每题构建独立容错。

## [0.4.9] - 2026-10-31

### Fixed

- 简答题容器在编辑器尚未渲染时不再被过滤。
- 支持无括号的“简答题/论述题/名词解释”题型标签。
- 简答题编辑器回退到任意 iframe，扫描过滤条件纳入编辑器。

## [0.4.x] - 2026-10（开发期）

- 学习通整卷扫描与逐题填写（单选/多选/判断/填空/简答）。
- 每题“保存”按钮、图片题、跳过已作答（按页面 URL 隔离）。
- 通用网页兜底（radio/checkbox/纯文本选项/textarea/contenteditable）。
- 删除低置信度暂停与二次复核，恢复低置信度照填与单次模型调用。

## [0.1.0] - 2026-10-28

- 首个 Wayground / Quizizz 单题自动答题版本：
  - 题号、题干、选项识别（aria → group → geo 三级兜底）；
  - 缓存 → 字母重排规则 → LLM；
  - 点击、推进校验、HUD、侧边栏、演练模式。
