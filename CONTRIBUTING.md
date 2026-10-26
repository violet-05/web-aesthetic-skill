# 参与贡献

先阅读 README、架构和安全边界。新增规则必须说明 measured/heuristic/manual/ai 来源，提供复现 Fixture、证据与建议；未知不能默认通过。不要因为偏好某种风格而增加一刀切规则。

开发流程：npm ci → npx playwright install chromium firefox webkit → npm run validate。修改格式后运行 npm run format；发布前再执行完整验证和 npm pack 安装冒烟测试。提交只包含源文件、知识库和锁文件，不提交 node_modules、截图中的敏感内容或本地凭据。

浏览器测试不得访问未经允许的真实站点。网络策略变更要覆盖 DNS 多地址、重定向、回环/私网/元数据、IPv6 和精确端口边界。跨引擎行为差异必须分别记录，不能用 Chromium 结果代替 Firefox/WebKit。报告字段变化考虑 schemaVersion、verificationProfile 与 compare 兼容性；触屏新增动作覆盖 touch:false 的明确失败路径。

矩阵变更要验证：共享 deadline 能区分超时与取消、剩余引擎为 not-run、部分引擎完成不产生整体 pass、每份独立报告路径存在、汇总 HTML 对外部文本转义。矩阵只比较状态，新增像素或视觉结论必须先定义独立许可与证据语义。

像素基线变更要覆盖 PNG 尺寸不一致、零/非零差异、阈值边界、浏览器/URL/视口/touch key 隔离、缺失 manifest、遮罩未匹配、diff 文件路径与 HTML 标识。像素差不得升级为审美评分；浏览器版本变化必须保持 unknown 而不是伪报回归。

新增风格需包含定位、排版/色彩、交互、误区与浏览器检查重点；不是复制同一模板改名称。新增视觉模型适配器先完成许可、超时、结构校验和失败路径，再宣称可用。

注意：tests/fixtures/broken.html 故意包含无障碍缺陷，代码检查只对这一份文件关闭 lint，正常测试页与工具源码仍检查。浏览器回归会断言缺陷确实被发现。

## GitHub 协作

提交问题：https://github.com/violet-05/web-aesthetic-skill/issues 。先fork仓库，在小范围分支修改后提交Pull Request。CI在Windows/Linux、Node24上执行类型检查、代码检查、真实浏览器回归和安装包测试；不在不可信PR中配置发布凭据。
