# CLI 与配置

## 命令

skill-check [目录] 验证工具包的 Skill 元信息、必要文件和 Markdown 本地引用；默认检查 CLI 所属包而不是当前被审查网站。inspect-project [目录] 读取 package.json、常见框架和测试入口，不执行脚本。

review --url <URL> 或 review --config <JSON> 启动真实审查。命令行提供的字段覆盖配置；相对 output 路径以当前工作目录为准，配置文件路径不改变此规则。每轮建立唯一子目录，不覆盖已有报告。

compare --before <JSON> --after <JSON> [--iteration 1] [--output diff.json] 对比同目标、同视口报告。输出文件已存在则拒绝覆盖。

## 配置字段

- url：必填 HTTP/HTTPS。拒绝 URL 凭据。
- project：报告标识；output：显式选择的输出根目录，默认 artifacts。
- viewports：1–8 个唯一 name 与 width/height。宽240–3840，高240–2160。
- timeoutMs：500–60000，每次浏览器操作超时；waitMs：0–10000，默认300。
- reviewTimeoutMs：1000–600000，默认120000；限制整轮浏览器工作，不包括输出目录创建、关闭清理与报告落盘。CLI 可用 --review-timeout-ms。
- lazyLoad：enabled 默认false；maxScrolls 默认12（1–40），waitMs 默认150（25–2000），maxDurationMs 默认5000（100–30000）。只滚动文档，基线检查前执行，交互场景不额外预滚动。
- stepScreenshots：mode 为 none/all/assertions，默认none；maxPerViewport 默认20（1–80）。all 在每个已执行步骤后截图，assertions 仅对 expect 开头的步骤截图；首个失败步骤也尝试保留截图，未执行步骤不会截图。
- waitFor：可选定位器，等待可见；不使用无限 networkidle。
- fullPage：默认 true；maxScreenshotHeight：默认12000。超过高度改截首屏并标记 truncated；PNG 元数据取实际文件尺寸。
- requiredElements：最多30个定位器，必须唯一且可见。
- interactions：最多20个场景，每个最多50步；名称必须唯一、稳定。priority 默认 P1。
- allowOrigins：精确协议/主机/端口列表，不允许路径、通配符、查询参数。
- allowPrivateNetwork：默认 false，私网测试必须同时显式允许 origin。元数据/链路本地不受此选项放行。
- weights：hierarchy/layout/color/interaction/responsive/accessibility 的非负权重，默认20/20/15/20/15/10；总和需大于0。不用于伪造自动审美分数。
- maxIterations：1–10，默认3，仅用于迭代建议，尚无自动修复循环。
- failOn：P0/P1/P2/P3/none，默认 P1；designGoals：报告与未来视觉适配器的设计目标上下文。

未知字段、拼错动作和无效类型会被拒绝。配置 schema 源于 src/config.ts，避免文档和实现分叉。

## 定位器与动作

定位器只选一种形式：role + name（精确匹配）、label、testId 或 css。文本名称由浏览器可访问名称规则确定，换行可能规范化为空格。多个匹配不任意选第一个，以免测试错对象。

~~~json
{
  "name": "open-details",
  "steps": [
    {"action":"click","target":{"role":"button","name":"查看详情"}},
    {"action":"expectVisible","target":{"role":"dialog","name":"详情"}},
    {"action":"press","target":{"role":"dialog","name":"详情"},"key":"Escape"},
    {"action":"expectHidden","target":{"role":"dialog","name":"详情"}}
  ]
}
~~~

动作：click、fill(value)、press(key)。断言：expectVisible、expectHidden、expectEnabled、expectText(text，包含匹配)、expectValue(value，精确匹配)、expectUrl(url，按当前 URL 解析后精确比较)、expectFocused。checkFocusIndicator 检查已聚焦元素的 outline/box-shadow，只能给启发式提示。

每场景使用独立上下文，从配置 url 重新加载；不跨场景保存登录状态。无结果断言场景是 unknown，不是 pass。首个失败后其余步骤 skipped。fill 的值不直接写入步骤证据，但网页截图、错误或后续文本仍可能暴露内容。

## 外部资源示例

~~~sh
web-aesthetic review --url https://example.com --allow-origin https://example.com
web-aesthetic review --url http://192.168.1.20:3000 --allow-origin http://192.168.1.20:3000 --allow-private-network
~~~

以上仅是语法示例，未访问示例远程目标。若主站跳转至 www 或从另一个端口加载资源，需分别授权相应 origin。不要为方便允许不认识的第三方。

## 退出码

取消或总超时会保留报告，执行状态为 cancelled/timed-out，未完成项为error或skipped，不伪造网站P0缺陷。终端 Ctrl+C / SIGTERM 和库调用的 AbortSignal 都可中止；强制杀进程可能无法保存报告。

0：没有触发所设问题阈值，但可能有 unknown/skipped/incomplete。1：发现达到 failOn 的问题，通常是质量门槛失败。2：配置、浏览器启动、截图、执行等错误。failOn=none 只关闭问题阈值，不掩盖执行错误。

## 对比语义

fixed 需要相同规则/视口在后一轮明确 pass。remaining 是相同指纹仍存在，added 是新增问题，unverified 是问题消失但没有通过证据，regressions 包含原先通过而后来失败/缺失的检查。stopReason 可以是 max-iterations、automated-gates-clear 或 continue-review。比较不分析截图像素，也不代表代码自动修复或视觉质量提高。

报告还保存 verificationProfile（检查配置的 SHA-256，不含明文配置）。对比要求该指纹一致，防止改 URL 查询、删除断言、更换定位器或等待条件后把结果差异误称为代码修复。若必须修正测试配置，应重新建立一致基线。

## 0.2 高级检查配置

~~~json
{
  "url":"http://127.0.0.1:4173/good",
  "reviewTimeoutMs":120000,
  "lazyLoad":{"enabled":true,"maxScrolls":12,"waitMs":150,"maxDurationMs":5000},
  "stepScreenshots":{"mode":"assertions","maxPerViewport":20}
}
~~~

仍需加入interactions才能产生步骤截图。templates/advanced-review.json 包含实际可运行的菜单、弹窗、表单、键盘与导航场景；templates/lazy-review.json 对应自带懒加载页。

步骤截图计数是实际尝试次数，不只统计成功截图，避免反复失败耗尽磁盘/时间。超预算在步骤里写skipped，并将screenshots.step-coverage标记unknown；断言仍可继续执行。失败的截图检查为error，不以截图失败推断业务失败。图片文件名带阶段哈希，长场景名和baseline同名场景不会覆盖其他图。

库调用支持 review(config, { signal: controller.signal })。报告execution区分completed/timed-out/cancelled/error；completed只表示浏览器工作结束，不代表视觉质量通过。旧1.0报告仍可彼此compare，但升级到1.1后需建立新基线；所有新证据预算计入verificationProfile。

懒加载图片采样最多200张，达到稳定底部但超出样本范围时记录sample-limit/unknown。compare在后一轮被取消、超时或执行失败时，不将消失问题算已验证修复；尚有自动证据unknown/skipped时不建议automated-gates-clear。
