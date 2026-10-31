# 贡献指南

感谢你愿意改进题灵（Quizora）。提交前请先阅读本指南。

## 适合贡献的内容

- 新增站点或题型适配（需附真实页面结构说明与复现步骤）。
- 修复已列出的 Bug（见 [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)）。
- 文档、安装教程、诊断信息改进。
- 性能与稳定性优化（不改变现有行为）。

## 不接受的内容

- 自动提交、绕过监考/风控、切屏规避、多账号等功能。
- 以“提高通过率”为名义的作弊或规避策略。
- 引入来源不明、许可证不兼容的代码/图片/字体。
- 为整理仓库而进行的大规模无关重构。

## 开发环境

- Edge / Chrome（Chromium，支持 Manifest V3 与 Side Panel）。
- Node.js（仅用于 `node --check` 与本地测试，不参与构建）。
- 无第三方依赖，无打包器；源码即产物。

## 本地验证

```powershell
# 1. 语法与 manifest
Get-ChildItem -Recurse -File -Filter *.js | ForEach-Object { node --check $_.FullName }
Get-Content manifest.json -Raw | ConvertFrom-Json | Out-Null

# 2. 生产构建
powershell -ExecutionPolicy Bypass -File scripts/build.ps1

# 3. 加载解压目录（dist/quizora-v<version>）或 ZIP 解压目录
# edge://extensions -> 开发人员模式 -> 加载解压缩的扩展
```

真实页面验证请按 [docs/BUILD_AND_TEST.md](docs/BUILD_AND_TEST.md) 第 6 节执行，并注明：

- 浏览器与版本；
- 站点与页面类型（章节测验 / 作业 / 考试 / 通用网页）；
- 探测题数与题型；
- 是否开启演练模式；
- 失败时的日志（隐去 Key 与个人 URL 参数）。

## 代码约定

- 内容脚本均为 IIFE，并以 `window.__wg?.xxx` 守卫防止重复注册。
- 新增脚本必须遵守“每帧只操作自身文档”的约束，避免跨 realm 原生调用。
- 不新增运行时依赖；确需新增时请先开 Issue 讨论。
- 保持“不自动提交”的边界；任何提交行为都应由用户手动触发。
- 修改识别/写入逻辑时，请同步更新 `docs/` 中的架构与踩坑记录。

## Pull Request 清单

- [ ] 已说明动机与改动范围
- [ ] 已通过 `node --check` 与 manifest 校验
- [ ] 已在本地 mock 或真实页面验证（注明验证方式）
- [ ] 未提交 API Key、Cookie、个人信息或截图中的敏感 URL 参数
- [ ] 已更新 CHANGELOG / 相关文档（如行为有变化）
- [ ] 未改变“不自动提交”的边界
