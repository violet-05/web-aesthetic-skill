# 架构与扩展边界

## 模块职责

src/config.ts：Zod 严格配置、视口、定位器与交互 DSL。src/cli.ts：命令解析与退出码。src/project.ts：只读项目识别与 Skill 文件检查。

src/browser/network-policy.ts：URL/精确 origin/DNS 地址分类；egress-proxy.ts：认证代理并连接已验证 IP，降低 DNS 重绑定竞态；session.ts：Chromium/Firefox/WebKit 生命周期、触屏上下文、请求/协议限制与诊断；page-inspector.ts：有界 DOM 采样；screenshot.ts：真实 PNG、尺寸元数据与动态遮罩；lazy-load.ts：有界文档/嵌套容器滚动和原位置恢复；utils/cancellation.ts：整轮时限、调用方取消、迟到资源清理。

src/checks/：页面规则与交互执行。src/pixel/baseline.ts：基线 key、manifest、PNG 解码、pixelmatch、diff PNG 与异常状态。src/reports/：稳定类型、Collector、汇总、HTML转义、本地文件输出与前后对比。src/reviewer.ts 编排单引擎真实实现；src/matrix.ts 顺序编排多引擎并共享总时限；src/reports/matrix.ts 负责引擎状态对齐、差异分类和静态汇总页。没有空的 RequirementAnalyzer/CodeRepairer 类。

## 数据模型

Report.schemaVersion 当前为1.3，记录单引擎浏览器、可选 toolVersion/execution、touch 视口、截图遮罩/kind 和像素基线证据；compare可读取相同版本的旧1.0/1.1/1.2/1.3报告，但拒绝混合规则版本。Check 带 id、viewport、dimension、method、status、summary、evidence。Issue 带 priority、fingerprint、suggestion 与证据。规则+视口+可选selector生成稳定指纹；比较要求 URL、视口尺寸与 touch 一致，引擎和预算由 verificationProfile 约束。日志查询参数与常见密钥模式脱敏，截图仍需用户自行审查。

MatrixReport 使用独立 schema 1.1，不伪装成单引擎 Report。它保存每个 engine 的独立报告相对路径、执行状态、摘要、检查状态和最小问题集合，并在根目录写 matrix.json、report.html、metadata.json。Matrix 的 execution 可为 completed/partial/timed-out/cancelled/error；只有数据完整的引擎参与检查对齐，未运行引擎显式保留 not-run。

## 浏览器与滚动边界

`browser` 一次选择一个引擎。Chromium 保留专用 sandbox 和网络参数；Firefox/WebKit 使用同一认证代理与网络路由策略，但浏览器行为差异必须如实保留在各自报告中。`viewports[].touch` 只切换 hasTouch 上下文并允许 tap，不伪造具体设备。

懒加载先发现有界可滚动元素，再按共享 maxScrolls/maxDurationMs 预算滚动容器和文档。结果分 target 记录 stopReason 与恢复状态；任一目标未完成、容器超过 maxContainers 或图片样本超限时整体保持 unknown。该机制覆盖 DOM 内可见滚动容器，不是对 frame、业务操作后内容或所有虚拟化实现的完整遍历。

## 矩阵边界

矩阵顺序启动引擎，避免并发浏览器争抢资源并简化取消与证据落盘。默认总时限为 reviewTimeoutMs × 引擎数，默认上限900000ms；显式设置最高1800000ms。父级 deadline 的 timeout reason 会传播给当前引擎，使报告记录 timed-out 而不是普通 cancelled。剩余引擎在父级停止后写为 not-run。矩阵只按 viewport + check id 比较状态，不进行截图、像素或性能比较，也不把无差异当作视觉一致。

## 像素基线边界

基线 key 由 schema、浏览器、完整 URL、viewport name/width/height/touch、fullPage/maxScreenshotHeight、遮罩 selector 集合与 baseline phase 生成；manifest 只保存脱敏 URL。更新与比较均在单引擎/单视口内进行，不跨引擎共享 baseline。Playwright screenshot mask 在截图阶段写入黑色遮罩，因此所有本轮截图都保持一致遮挡。比较拒绝尺寸或浏览器版本变化，缺失基线/遮罩/截图完整度均保持 unknown；maxPixels 默认20000000限制 PNG/pixelmatch 内存工作集。diff 图进入 screenshots 目录并标记 kind=diff，HTML 单独标识为像素差异图。该结果只支持回归调查，不替代视觉模型、审美评分或人工判断。

## 未来视觉接口

VisualReviewer 类型定义输入截图、工件目录、pageType、designGoals、AbortSignal，返回结构化观察与置信级别。目前只有公开接口契约，没有模型适配器、自动调用入口或“已经分析”的假结果。后续实现必须增加超时、速率限制、输出 schema 校验、来源标记与明确上传许可。

## 迭代边界

当前 Skill 驱动开发者/Agent 修改，CLI 提供证据和 compare。maxIterations 控制停止建议，不假装是已运行的自动循环。阶段C控制器需要独立的文件范围授权、补丁审查、版本快照、回滚、预算与严格终止机制。

## 取舍

不引入数据库、账户、远程服务和 UI 框架。HTML 报告静态、可读、可离线，不执行页面文本。浏览器上下文无用户凭据，场景隔离便于重复；代价是登录态、实时应用和跨场景流程暂不支持。专用代理降低误访问风险，但不把任何浏览器引擎当绝对安全隔离层。
