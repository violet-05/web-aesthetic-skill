# 架构与扩展边界

## 模块职责

src/config.ts：Zod 严格配置、视口、定位器与交互 DSL。src/cli.ts：命令解析与退出码。src/project.ts：只读项目识别与 Skill 文件检查。

src/browser/network-policy.ts：URL/精确 origin/DNS 地址分类；egress-proxy.ts：认证代理并连接已验证 IP，降低 DNS 重绑定竞态；session.ts：Chromium 生命周期、请求/协议限制与诊断；page-inspector.ts：有界 DOM 采样；screenshot.ts：真实 PNG 与尺寸元数据；lazy-load.ts：有界文档滚动和原位置恢复；utils/cancellation.ts：整轮时限、调用方取消、迟到资源清理。

src/checks/：页面规则与交互执行。src/reports/：稳定类型、Collector、汇总、HTML转义、本地文件输出与前后对比。src/reviewer.ts 编排上述真实实现，没有空的 RequirementAnalyzer/CodeRepairer 类。

## 数据模型

Report.schemaVersion 当前为1.1，新增可选 toolVersion/execution 和步骤截图元数据；compare保留旧1.0对旧1.0的读取兼容，但拒绝混合规则版本。Check 带 id、viewport、dimension、method、status、summary、evidence。Issue 带 priority、fingerprint、suggestion 与证据。规则+视口+可选selector生成稳定指纹；比较要求 URL/视口一致。日志查询参数与常见密钥模式脱敏，截图仍需用户自行审查。

## 未来视觉接口

VisualReviewer 类型定义输入截图、工件目录、pageType、designGoals、AbortSignal，返回结构化观察与置信级别。目前只有公开接口契约，没有模型适配器、自动调用入口或“已经分析”的假结果。后续实现必须增加超时、速率限制、输出 schema 校验、来源标记与明确上传许可。

## 迭代边界

当前 Skill 驱动开发者/Agent 修改，CLI 提供证据和 compare。maxIterations 控制停止建议，不假装是已运行的自动循环。阶段C控制器需要独立的文件范围授权、补丁审查、版本快照、回滚、预算与严格终止机制。

## 取舍

不引入数据库、账户、远程服务和 UI 框架。HTML 报告静态、可读、可离线，不执行页面文本。浏览器上下文无用户凭据，场景隔离便于重复；代价是登录态、实时应用和跨场景流程暂不支持。专用代理降低误访问风险，但不把 Chromium 当绝对安全隔离层。
