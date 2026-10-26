# Web Aesthetic Skill · AestheticFlow

**让设计选择服务产品，让真实浏览器提供证据。**

[![CI](https://github.com/violet-05/web-aesthetic-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/violet-05/web-aesthetic-skill/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

开源仓库：[violet-05/web-aesthetic-skill](https://github.com/violet-05/web-aesthetic-skill) · [问题反馈](https://github.com/violet-05/web-aesthetic-skill/issues)

面向 AI 编程工具的 Web 视觉审美、交互设计与浏览器审查 Skill。当前版本 **0.2.0** 是可运行的本地 Skill + TypeScript CLI，不是 SaaS，也不是自动给网页打审美分的模型。

## 已实现

- 根目录 SKILL.md、12 份设计参考、8 种风格、7 个工作流、5 份清单与4个使用案例。
- Playwright Chromium 真实导航、三种默认视口与自定义尺寸、PNG 截图与元数据。
- 溢出、主体、坏图、控制台/运行时/资源错误、关键元素检查；名称/裁切/遮挡/焦点等启发式提示。
- 显式交互场景：点击、输入、按键、可见/隐藏/可操作/文本/值/URL/焦点断言。
- 可选有界文档滚动，触发懒加载；到达次数/时间上限保持未知，结束后恢复滚动位置。
- 可选逐步/断言后截图，保留菜单、弹窗与表单的中间状态；每视口独立数量预算。
- 整轮浏览器时限和取消支持，保留已完成证据，中止项不冒充网站故障。
- JSON + 离线 HTML 报告、P0–P3、证据、建议、覆盖率及未执行/未知状态。
- 精确 origin 允许列表、DNS 全结果检查、固定已验证 IP 的本地出口代理、重定向检查、元数据地址拒绝。
- inspect-project、skill-check、review、compare；修复后对比不会把未复查算作修复。

## 能力边界

不自动改目标代码；不调用视觉模型或付费 API；不上传截图。审美分数始终为 null。没有实现完整 WCAG 审计、像素差、真实触屏、全动画验证、跨浏览器矩阵、登录态导入或独立 Agent 修复控制器。WebSocket、Service Worker、下载、新窗口流程受限；依赖这些机制的页面会标明验证不完整。

## 最短可运行示例

要求 Node.js 22+ 和 npm，推荐 Node.js 24 LTS。先获取源码，再从仓库根目录运行：

~~~sh
git clone https://github.com/violet-05/web-aesthetic-skill.git
cd web-aesthetic-skill
~~~

~~~sh
npm ci
npx playwright install chromium
npm run build
npm run skill-check
npm run demo:serve
~~~

保持服务运行，在另一个终端执行：

~~~sh
npm run demo:review
node dist/cli.js review --config templates/broken-review.json
~~~

第一条审查正常页面，第二条审查故意带问题的页面，**第二条预期退出码为 1**。报告写入 artifacts/demo 或 artifacts/broken 的独立运行子目录。打开运行输出中的 report.html，点击截图可查看原图。服务器只绑定 127.0.0.1，默认端口 4173。

## 安装 CLI 与 Skill

在源码目录构建后，npm link 可将 CLI 注册到本机。也可 npm pack，然后 npm install -g ./web-aesthetic-skill-0.2.0.tgz 安装本地包；本项目没有声称已经发布 npm registry。

~~~sh
npm run build
npm link
web-aesthetic --help
npm run install:skill -- --target codex
npm run install:skill -- --target cursor
~~~

两个 Skill 命令分别复制到用户级 ~/.agents/skills/web-aesthetic 和 ~/.cursor/skills/web-aesthetic。**已有目录拒绝覆盖**。用 --project 指定另一目标项目；安装器只复制知识库，不安装 CLI、不修改宿主设置、不自动升级旧版本。详细分工具说明与官方依据见 [安装文档](docs/installation.md)。

在支持的 AI 工具里请求：“使用 web-aesthetic，为这个页面选择适合产品定位的设计方向，实现后检查手机与桌面的真实页面，执行核心交互，再根据证据修复。”

## 审查自己的页面

先按项目说明启动开发服务器，确认真实端口：

~~~sh
web-aesthetic inspect-project
web-aesthetic review --url http://127.0.0.1:3000
web-aesthetic review --url http://127.0.0.1:3000 --viewports 1440x900,768x1024,390x844 --output artifacts/review
web-aesthetic review --config review-config.json
~~~

复制 [配置模板](templates/review-config.example.json) 到你的项目，填写实际交互。可以参考 [正常页完整场景](templates/demo-review.json) 和 [缺陷页场景](templates/broken-review.json)。默认不会随机点击按钮；没有配置交互就标记 skipped。

## 报告与迭代

每个运行目录包含 report.json、report.html、metadata.json、screenshots/、diagnostics/。measured 表示程序测量，heuristic 是待解释提示，manual/ai 表示需要视觉判断的来源；本版没有 AI 审查执行器。

0.2 使用报告 schema 1.1；compare 仍可比较两个 1.0 旧报告，但不会跨规则版本宣称修复。

coverage = (pass + fail) / 全部检查数。它表示当前列出的检查完成比例，**不是审美得分、页面总体覆盖率或无障碍合规率**。unknown/skipped/error 不计通过，未配置视觉评审会让正常页面仍显示 incomplete。

~~~sh
web-aesthetic compare --before artifacts/before/report.json --after artifacts/after/report.json --iteration 1
~~~

先由已获授权的开发者或 Agent 小范围修改代码，再用相同 URL/视口/场景复查。默认最多3轮，compare 给出停止建议，不执行代码修改。详见 [迭代流程](workflows/iterative-refinement.md)。

## 开发与测试

~~~sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run skill-check
npm run validate
~~~

集成测试启动真实 Chromium 与本地服务器，不依赖 AI 密钥。首次安装浏览器需联网；Linux 缺少系统依赖时参考 Playwright 官方安装说明。生产环境不应无条件关闭 sandbox。

## 文档导航

- [安装](docs/installation.md) · [使用与配置](docs/usage.md) · [浏览器检查](docs/browser-review.md)
- [故障排查](docs/troubleshooting.md) · [架构](docs/architecture.md) · [路线图](docs/roadmap.md)
- [安全边界](SECURITY.md) · [贡献](CONTRIBUTING.md) · [变更记录](CHANGELOG.md)

## 常见问题

- 页面打不开：确认服务、端口、路由与网络授权；失败会生成诊断，不能视为通过。
- 第三方字体/图片缺失：默认不允许外部 origin，核实用途后显式添加允许列表。
- 正常页为什么不是全部通过：视觉判断、未配置交互和未加载资源不能伪报成功。
- 能否只看建议：可以；Skill 遵守请求范围，不要求每次重构。
- 能否自动修复：目前由 Skill 指导开发者/Agent 修复，CLI 只审查和比较。

后续按 [路线图](docs/roadmap.md) 增加视觉审查适配器、严格输出校验、可回滚修复与有界 Agent 编排，而非先做账户、数据库与管理后台。

### 可执行修复回归演示

运行 npm run demo:iteration，会在 artifacts 中生成自己的测试页面，先审查，再对固定宽度与失效按钮做两处预定修改，最后复查和比较。该演示不修改用户项目，也不是自主代码修复器。发布安装包验证另用 npm run test:package（会在临时目录打包、安装、启动浏览器并测试 Skill 复制）。

### 0.2 新能力演示

运行 npm run demo:followup，将自动启动并关闭本地测试服务，依次验证过程截图、懒加载关闭/开启/预算不足，以及故意挂起页面的总时限退出。所有报告与截图写入新的 artifacts/followup-* 目录，并输出 index.html/manifest.json 索引。该演示仅在源码目录使用。已有服务运行时，也可 node dist/cli.js review --config templates/advanced-review.json。
