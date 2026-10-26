# 安装与宿主兼容性

## 运行环境

Node.js >=22、npm、可安装 Playwright Chromium 的系统。跨引擎验证还需 Firefox 与 WebKit。本次开发环境为 Windows、Node 24.11.0、npm 11.6.1。依赖由 package-lock.json 固定，安装使用 npm ci，不用无版本的全局依赖替代。

在本工具源码目录执行：

~~~sh
npm ci
npx playwright install chromium
npm run build
node dist/cli.js --help
npm run skill-check
~~~

仅用默认 Chromium 时保留上述命令；完整验证运行 npx playwright install --with-deps chromium firefox webkit。Linux 安装系统依赖涉及包权限，应在理解影响后执行。不要为了启动方便默认关闭浏览器 sandbox。

## CLI 安装

开发时直接 node dist/cli.js，无需全局安装。希望在其他项目调用时选择一种：

~~~sh
npm link
~~~

或打包安装：

~~~sh
npm pack
npm install -g ./web-aesthetic-skill-0.5.0.tgz
web-aesthetic --version
~~~

没有发布到公共 npm，不能假定 npm install -g web-aesthetic-skill 会安装本项目。Skill 与 CLI 是两层：仅复制 SKILL.md 不会得到可运行的浏览器工具。

## Codex

官方文档确认 Codex 读取 .agents/skills 及用户级 ~/.agents/skills。每个 Skill 一个文件夹，包含有 name/description frontmatter 的 SKILL.md。本项目默认保持可隐式发现，不设置禁止自动调用。

在本工具源码目录执行：

~~~sh
npm run install:skill -- --target codex
npm run install:skill -- --target codex --project "C:/work/my-site"
~~~

第一条是用户级；第二条是另一个项目的 .agents/skills/web-aesthetic。不要两条都运行到相同作用范围，以免重复发现。安装器拒绝覆盖已有目录，旧版升级需要先人工备份/确认。

在 Codex 请求“使用 $web-aesthetic 审查这个页面”。若未出现在 Skill 选择器，按官方文档重启 Codex 并核对路径。不声称已验证所有 Codex 客户端版本的实际发现行为。

## Cursor

官方文档确认项目级 .cursor/skills 与用户级 ~/.cursor/skills。本项目为 Cursor 单独提供明确路径，不依赖兼容目录推断。

~~~sh
npm run install:skill -- --target cursor
npm run install:skill -- --target cursor --project "C:/work/my-site"
~~~

在 Cursor 用自然语言或其技能调用入口请求 web-aesthetic，确认 Skill 被加载。用户级本地 Skill 不应被假定自动同步到所有远程/云环境。

## Claude Code 和其他工具

本轮无法读取 Claude Code 官方 Skill 安装页（访问返回 403），因此**不把其自动安装与兼容性列为已验证功能**。可在目标客户端当前官方文档确认后，使用安装器的 --destination 指定准确目录；不要把 Codex/Cursor 路径照搬到其他工具。也可让支持读取文件的助手显式读取本项目 SKILL.md，CLI 仍独立使用。

~~~sh
node scripts/install-skill.mjs --destination "C:/verified-skill-location/web-aesthetic"
~~~

该命令只是文件复制，不证明宿主支持此目录或 frontmatter。没有可用浏览器时仍可执行设计指导，但必须标记实际渲染与交互尚未验证。

## 第一次审查与查看结果

一个终端 npm run demo:serve；另一个 npm run demo:review。报告路径会直接输出。用浏览器打开 report.html，图像通过相对路径引用，分享时保留整个运行目录而不是只分享 HTML。报告可能包含敏感页面信息，分享前先审查。

## 官方依据

以下页面在 2026-10-26 获取并用于核对；外部产品会变化，升级时应重新核实。

- Codex Skills：https://developers.openai.com/codex/skills/
- Cursor Agent Skills：https://cursor.com/docs/context/skills
- Playwright 浏览器安装：https://playwright.dev/docs/browsers
- Playwright BrowserContext：https://playwright.dev/docs/api/class-browsercontext
- Playwright Route：https://playwright.dev/docs/api/class-route

Claude Code 待核实页面：https://code.claude.com/docs/en/skills （本轮读取失败，不作为已核实依据）。
