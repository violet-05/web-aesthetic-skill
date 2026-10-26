# 交互审查

为每个核心任务定义独立场景。每个场景从目标 URL 的干净上下文开始，Cookie/localStorage 不跨场景保存。场景名字用稳定英文标识，避免修复前后名字漂移导致对比失效。

优先 role + 精确 name、label、testId；CSS 作为后备。动作支持 click、tap、fill、press；tap 只用于 touch:true 视口，且不能以 click 替代触摸路径。结果支持 expectVisible/Hidden/Enabled/Text/Value/Url/Focused。每个场景至少有一个业务结果断言；只有动作不能算通过。

菜单分别测试打开与关闭，弹窗测试打开/关闭/焦点返回，表单测试输入/反馈/恢复，导航测试确切 URL。checkFocusIndicator 只是 outline/box-shadow 启发式，必须先用键盘移动到目标，其他焦点表达仍需人工看图。

需要保留菜单/弹窗打开或表单中间状态时配置stepScreenshots.mode为assertions或all；每视口设置maxPerViewport，截图不足会明确标记。它增加运行时间并可能捕获输入内容，不默认开启。

第一个失败步骤后，其余步骤标记 skipped，不继续在错误状态下执行潜在有害动作。不要批量点击未知按钮。付款、消息发送、生产删除必须有单独授权与安全测试环境。
