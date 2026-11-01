# 环境搭建、构建与测试

## 1. 环境与依赖

| 项 | 值 |
| --- | --- |
| 运行环境 | Microsoft Edge / Google Chrome（Manifest V3、Side Panel 支持版本） |
| 开发系统 | Windows（本轮审计环境） |
| Node.js | v24.16.0（仅用于语法检查与本地 mock 服务，不参与构建） |
| 第三方依赖 | **无**。没有 `package.json`、没有 `node_modules`、没有打包器 |
| 产物 | 源码目录本身即扩展产物 |

> 这是“零构建”项目：修改 `.js/.html/.css` 后，在扩展管理页点“重新加载”即可生效。

## 2. 首次加载

1. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）。
2. 打开“开发人员模式”。
3. 点“加载解压缩的扩展”，选择目录：

   ```
   C:\Users\make\Documents\Trae-CN\temp_20261014_01\wayground-auto
   ```

4. 确认无红色报错；点击工具栏图标打开侧边栏。
5. 在面板填写 API Base URL / Key / 模型，点“保存”或“测试连接”。

## 3. 修改后的固定操作顺序

> 顺序错了会出现“代码已改但行为没变”或“内容脚本不响应”。

1. `edge://extensions` → 该扩展 → **重新加载**；
2. **关闭并重新打开侧边栏**（面板脚本也会更新）；
3. 目标页面 **Ctrl+F5**（学习通使用静态内容脚本，必须刷新页面才会加载新脚本）；
4. 点“探测当前页”，确认题数与题型；
5. 再点“开始”。

## 4. 校验命令（可复现）

在项目根目录执行：

```powershell
# 所有 JS 语法
Get-ChildItem -Recurse -File -Filter *.js | ForEach-Object { node --check $_.FullName }

# manifest 合法性
Get-Content manifest.json -Raw | ConvertFrom-Json | Out-Null
```

2026-10-31 审计结果：

- ✅ 全部 20 个 JS 文件通过 `node --check`
- ✅ `manifest.json` JSON 解析通过

## 5. 本地 mock 测试（当前不在仓库内）

> ⚠️ 这是历史测试方式，测试文件位于 `%TEMP%\wg-cx-test`，**没有纳入版本库**。下一阶段应迁入 `tests/`。

### 5.1 mock 覆盖的布局（10 题）

| Case | 布局 | 期望 |
| --- | --- | --- |
| A | 学习通 `.TiMu`：单选题 + 简答题（UEditor + 隐藏 textarea） | 2 题，single + short |
| B | `.questionLi` + `typeName` 属性，简答题暂无编辑器 | 2 题，属性识别题型 |
| C | 外层 `.TiMu` 包两道内层题 | 拆分为 2 题 |
| D | 无标准容器，仅题型标签 + 编辑区 | 2 题 |
| E | 未知容器、无题型标签、radio（模拟字体加密） | 1 题 single |
| F | 未知容器、无题型标签、textarea | 1 题 short |
| G | 讨论区 textarea（`formNote`） | 必须被忽略 |

预期输出：`count=10`，`types={"single":4,"short":5,"multiple":1}`。

### 5.2 运行方式（重建步骤）

```powershell
# 1. 建临时目录，拷贝被测脚本与 mock.html
#    需要：cx-plain.js / cx-debug.js / cx-adapter.js
# 2. 启动静态服务（端口 8766）
node -e "…http server…"
# 3. 浏览器打开 http://localhost:8766/ ，读取 #out 的文本
```

mock 页面自身在末尾调用：

```js
window.__wg.cxAdapter.snapshot()
```

并把 `count/types/每题摘要` 写到 `#out`，因此可直接核对扫描结果。

> 该 mock 只验证**扫描**，不验证 LMM 调用、不验证真实页面写入与 UEditor 同步。

## 6. 真机验证清单（0.5.5 待执行）

以“学习通混合卷（5 单选 + 5 多选 + 1 简答）”为样本：

1. 重新加载扩展 → 重开侧边栏 → 页面 `Ctrl+F5`。
2. 点“探测当前页”：
   - [ ] 题目数 = 11
   - [ ] 题型分布 = `single×5 / multiple×5 / short×1`
   - [ ] 前 8 题题干/选项与页面一致
3. 打开“演练模式”跑一遍：只出建议、不写入。
4. 关闭演练模式，点“开始”：
   - [ ] 进度到 `11/11`
   - [ ] 日志无 `运行异常 / Illegal invocation`
   - [ ] 最后一题简答编辑区有内容
   - [ ] 未发生任何自动提交
5. 若简答仍失败：记录日志中 `第 11 题写入异常：…` 原文。
6. 抽查已答题目：刷新页面后再次探测，确认“已作答”判定正确（若开启跳过）。

Wayground 回归（另开一局或复用测试局）：

- [ ] 探测能识别题号/题干/选项
- [ ] 演练模式给出建议
- [ ] 实跑至少 5 题，页面正常推进
- [ ] 停止按钮/HUD/快捷键均生效

## 7. 调试方法

| 场景 | 方法 |
| --- | --- |
| Service Worker 报错 | `edge://extensions` → 扩展卡片 → “Service Worker” → 打开控制台 |
| 页面内容脚本 | 目标页面 F12 → Console；内容脚本日志在隔离世界，需看扩展日志或面板 |
| 探测无快照 | 面板日志找 `脚本注入：…` / `自检 #N v… adapter=… main=…` |
| 识别 0 题 | 探测面板的“容器命中 / typeName / 标签 / 各 frame / HTML 片段” |
| 单题写入失败 | 日志 `第 N 题写入异常：…`（0.5.3 起不中断整卷） |
| 缓存异常 | 面板“清空缓存”；或在 SW 控制台执行 `chrome.storage.local.get(null)` |
| 已答记录异常 | 清除缓存会同时删除所有 `wg_exam_done_v1*` |

## 8. 回滚方式

**0.5.3 之前没有 Git**，只能靠目录备份；0.5.3 起已建立仓库并推送 main/tag。回滚建议：

1. 优先使用 Git：`git checkout <已知良好 tag>`，或从 Release 下载对应版本；
2. 同时保留目录备份：复制整个 `wayground-auto/` 为 `wayground-auto-backup-YYYYMMDD-HHMM/`；
3. 回滚后用备份目录重新“加载解压缩的扩展”；
4. 注意扩展 ID 可能随路径变化，旧页面需刷新。

后续优先补 CI 静态检查，并把 mock 迁入仓库（见 NEXT_STEPS）。

## 9. 发布流程（当前手工）

1. 修改 `manifest.json` 的 `version`；
2. 运行第 4 节校验命令；
3. 重载扩展，跑第 5 节 mock；
4. 跑第 6 节真机清单；
5. 更新 `docs/DEVELOPMENT_HISTORY.md` 与 `docs/KNOWN_ISSUES.md`；
6. 备份当前目录（或 Git commit + tag）。

## 10. 测试现状与缺口

- ✅ 语法/JSON 校验可复现。
- ✅ mock 扫描回归（10/10）在审计日复跑通过。
- ✗ 无仓库内测试脚本、无 CI、无自动化 UI 测试。
- ✗ 无 LLM 调用 mock（依赖真实 Key 与网络）。
- ✗ 无真实学习通/ Wayground 的回归样本保存。
- ✗ 无性能基准（大页面探测耗时未量化）。
