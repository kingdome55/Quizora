# 题灵（Quizora）— 项目知识库

> 本目录是该项目阶段性收尾（2026-10-31）沉淀的工程知识库。
> 当前工作树版本：**0.5.4**（见 `manifest.json`）。最近一次真机验证版本：**0.5.2**（简答题写入未通过），0.5.3/0.5.4 的简答修复尚待真机复测；0.5.4 的多空填空修复已通过本地 mock。

## 1. 证据等级约定

由于项目在 0.5.3 之前**没有 Git 仓库**，早期历史无法通过 commit/tag 还原；本章程依据方案文档、开发对话与当前代码交叉重建。0.5.3 起已纳入 Git 管理。

| 标记 | 含义 |
| --- | --- |
| ✅ 已验证 | 有代码、命令输出、mock 结果或用户真机截图作为直接证据 |
| ◐ 合理推断 | 由代码与多轮对话记录交叉还原，未见独立证据 |
| ○ 未验证 | 代码已实现，但没有可复现的测试或真机结果 |
| ✗ 已知未解决 | 有明确失败证据，修复尚未完成 |

历史时间线来自三份原始方案文档（见 `docs/archive/`）、开发过程中的对话记录和当前代码；未标注的细节不应视为已确认事实。

## 2. 阅读路径

| 你想了解 | 先读 |
| --- | --- |
| 项目做什么、现在能不能用 | [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) |
| 从零到现在经历了什么 | [DEVELOPMENT_HISTORY.md](DEVELOPMENT_HISTORY.md) |
| 代码怎么组织、消息怎么走 | [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) |
| 遇到问题怎么排查 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| 为什么这样设计 | [TECHNICAL_DECISIONS.md](TECHNICAL_DECISIONS.md) |
| 怎么加载、测试、回滚 | [BUILD_AND_TEST.md](BUILD_AND_TEST.md) |
| 还有哪些坑没填 | [KNOWN_ISSUES.md](KNOWN_ISSUES.md) |
| 下一步做什么 | [NEXT_STEPS.md](NEXT_STEPS.md) |

## 3. 文档清单

1. [README.md](README.md) — 索引、阅读入口、证据约定（本文件）
2. [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) — 项目概况、能力矩阵、当前真实状态
3. [DEVELOPMENT_HISTORY.md](DEVELOPMENT_HISTORY.md) — 开发历程、已完成/废弃功能、版本线索
4. [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — 架构、模块职责、消息协议、核心流程、数据结构
5. [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — 踩坑记录：表现、根因、排查、修复、验证、复发风险
6. [TECHNICAL_DECISIONS.md](TECHNICAL_DECISIONS.md) — 关键技术决策与取舍
7. [BUILD_AND_TEST.md](BUILD_AND_TEST.md) — 环境、加载、语法校验、mock、真机验证、调试、回滚
8. [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — 遗留问题、技术债务与风险清单
9. [NEXT_STEPS.md](NEXT_STEPS.md) — 下一阶段优先级与验收标准

历史方案原文（不作为当前实现依据，仅保留决策背景）：

- [archive/wayground-auto-answer-extension.md](archive/wayground-auto-answer-extension.md)
- [archive/wayground-auto-extension-delivery-plan.md](archive/wayground-auto-extension-delivery-plan.md)
- [archive/chaoxing-exam-extension-plan.md](archive/chaoxing-exam-extension-plan.md)

## 4. 快速上手（开发者）

```powershell
# 1. 语法与 manifest 校验（无需构建）
cd wayground-auto
node --check src/background.js
node --check src/content/cx-adapter.js
Get-Content manifest.json -Raw | ConvertFrom-Json | Out-Null

# 2. 加载扩展
# edge://extensions -> 开发者模式 -> 加载解压缩的扩展 -> 选择 wayground-auto 目录

# 3. 修改代码后
# 扩展页点“重新加载” -> 关闭并重开侧边栏 -> 目标页面 Ctrl+F5 -> 点“探测当前页”
```

本项目**没有构建步骤、没有依赖安装、没有 package.json**；源码即产物。

## 5. 审计基线（2026-10-31）

- ✅ 全部 20 个 JS 文件通过 `node --check`
- ✅ `manifest.json` JSON 解析通过
- ✅ 本地混合卷 mock：`count=10`，`single×4 / short×5 / multiple×1`
- ✗ 0.5.3/0.5.4 简答题真机写入修复未复测（0.5.2 真机为 10/11，最后一题报 `Illegal invocation`）
- ✓ 已建立 Git 仓库并推送 main / tag；仓库内自动化测试与 CI 仍缺
