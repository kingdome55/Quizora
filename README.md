# 题灵 QuizPilot

> 一个运行在 Edge / Chrome 上的 Manifest V3 扩展：在**已经打开**的答题页面上，整卷识别题目、调用大模型判题并自动选择/填写答案——**不自动提交**。

![icon](assets/icon128.png)

## 支持站点

| 站点 | 支持内容 |
| --- | --- |
| Wayground / Quizizz | 单题识别与推进、选择题点击、文本输入 |
| 学习通（超星） | 整卷扫描、单选/多选/判断/填空/简答、图片题、跳过已作答 |
| 通用网页 | 任意含题目、可点击、可填写的页面（radio/checkbox/纯文本选项/textarea/contenteditable） |

## 核心特性

- **整卷扫描**：结构无关识别（容器选择器 + 题型标签 + `typeName` 属性 + 答题控件反推）。
- **大模型判题**：兼容 OpenAI 接口（默认 DeepSeek），支持单选/多选/判断/填空/简答与图片输入。
- **不自动提交**：填完提示检查后手动交卷。
- **演练模式**：只给建议、不写入，默认开启。
- **跳过已作答**：按页面 URL 隔离，不覆盖已有答案。
- **诊断能力**：探测快照、frame 汇总、注入自检、单题异常日志。

## 安装（开发版）

1. 下载/克隆本仓库。
2. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`），开启“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择本仓库根目录（包含 `manifest.json` 的目录）。
4. 点击工具栏中的“题灵”图标打开侧边栏，填写 API Base URL、Key、模型并保存。
5. 打开答题页面 → 点“探测当前页”核对题目 → 先开演练模式 → 再关闭演练并“开始”。

> 修改代码后：扩展页“重新加载” → 关闭并重开侧边栏 → 目标页面 `Ctrl+F5` → 重新探测。

## 目录结构

```
manifest.json                 扩展声明（含图标与学习通静态内容脚本）
assets/                       图标（16/48/128，另含 1024 源图）
src/background.js             Service Worker：注入、路由、运行态、自检
src/background/               配置、缓存、LLM、站点注册、frame 选择
src/content/                  Wayground 单题链路 + 学习通/通用整卷链路
src/panel.*                   侧边栏控制台
docs/                         架构、踩坑、决策、测试、遗留问题等知识库
```

## 当前状态

- 工作树版本：**0.5.3**
- 学习通混合卷已能在真机识别 11 题并完成 10 道客观题；
- 最后一题简答的跨 frame 写入问题在 0.5.3 做了修复，**尚待真机复测**；
- Wayground 在本轮 frame 改动后尚未真机回归。

详细验证记录与已知问题见 [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)、[docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)。

## 文档

完整知识库入口：[docs/README.md](docs/README.md)

- [项目概况](docs/PROJECT_OVERVIEW.md)
- [开发历程](docs/DEVELOPMENT_HISTORY.md)
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [踩坑记录](docs/TROUBLESHOOTING.md)
- [技术决策](docs/TECHNICAL_DECISIONS.md)
- [构建与测试](docs/BUILD_AND_TEST.md)
- [遗留问题](docs/KNOWN_ISSUES.md)
- [下一阶段](docs/NEXT_STEPS.md)

## 说明与边界

- 本工具**不会自动交卷**，也不会实现切屏规避、监考绕过或多账号。
- API Key 以明文保存在 `chrome.storage.local`，请勿在共用电脑上使用。
- 自动答题可能违反平台规则，账号与成绩风险由使用者自行承担；建议仅用于自测、复习与模拟练习。
