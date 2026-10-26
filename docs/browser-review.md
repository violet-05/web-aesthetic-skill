# 浏览器审查实现与证据

## 执行次序

严格配置 → 输出独立运行目录 → 目标 URL/DNS 检查 → 本地认证出口代理 → 所选浏览器引擎（Chromium/Firefox/WebKit）→ 按视口创建上下文 → domcontentloaded/有界等待 → 可选有界文档/嵌套容器滚动 → DOM检查 → 基线截图 → 各交互独立上下文 → 可选步骤截图 → 场景截图 → 汇总诊断 → JSON/HTML/元数据。

matrix 使用同一单引擎流程顺序运行多个引擎。每个引擎在矩阵根目录下拥有自己的运行目录；全部引擎完成后额外生成跨引擎状态差异页。当前引擎超时或用户取消时，剩余引擎写为 not-run，已经完成的报告保留。

启用 pixelBaseline 后，基线截图会按浏览器、URL、视口和 touch 上下文匹配稳定 key；Playwright mask 在截图阶段以黑色覆盖动态区域。缺失基线、尺寸/浏览器版本变化、截图截断或 mask 未命中不计算为 fail，而是 unknown。阈值差异写入 pixel.baseline 并提供 diff PNG，只用于回归调查。

每个视口独立，交互场景也相互隔离。touch:true 使用 Playwright hasTouch 上下文，允许 tap 和触摸指针事件；它不设置具体手机 UA，也不代表真实设备手感。截图是 Playwright 的真实 PNG，phase 区分 baseline 与场景结束状态。可选 stepScreenshots 保存已执行步骤后的视口截图，携带 scenario、零基 stepIndex、action；HTML显示一基步骤编号。该截图不强制结束动画，以避免改变被测中间状态；不代表动画录像。默认仍仅保存基线和场景结束/失败状态。截图异常显式为 error。

## 已执行的自动规则

layout.overflow 测量文档与可见视口宽度并提供候选元素；layout.content 检查可见文本与常见媒体；images.loaded 区分坏图与未完成加载；a11y.image-alt 检查属性；required.N 检查唯一可见元素；runtime.errors 收集 console/pageerror/requestfailed/HTTP>=400。

DOM 扫描最多2500元素，图片/控件各200，诊断最多500；超限与采样限制不能被解释为全站无问题。图片几何、标题/导航/按钮裁切、控件中心遮挡、名称与24px目标筛查均为 heuristic；不评估例外和全部布局语义。嵌套滚动默认关闭；开启后自动发现最多 maxContainers 个 overflow:auto/scroll 容器，共享总滚动与时间预算并恢复原位置。transform 驱动、需业务操作或未进入 DOM 的虚拟列表仍可能无法覆盖。

## 状态

pass 是指定规则在本轮条件下通过；fail 是指定规则/断言失败；unknown 是证据不足、启发式待确认或未自动化视觉判断；skipped 是前提失败/未配置而没有执行；error 是工具执行异常。覆盖率只统计 pass+fail，未执行不计通过。

六维度包含 score:null、状态、权重、检查计数、问题引用与需要人工评审标记。没有任意随机分数，也没有将未知默认100分。

## 诊断来源

请求 URL 与 console location 可用于区分 first-party/third-party；无法确定的 pageerror 标记 unknown。策略拦截标记 environment，并给出验证不完整提示。HTTP403 的代理拒绝不能被误写成网站业务故障。

## 建议补充

自行查看截图并使用视觉清单；对不透明页面、Canvas/WebGL、复杂遮挡、屏幕阅读器、完整对比、动画时间线、网络离线恢复、真实设备手势和跨引擎矩阵另外测试。单次 review 只代表所选引擎；运行真实脚本有风险，出口限制不是操作系统沙箱，详情见安全说明。
