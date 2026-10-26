# CLI 与配置

## 命令

skill-check [目录] 验证工具包的 Skill 元信息、必要文件和 Markdown 本地引用；默认检查 CLI 所属包而不是当前被审查网站。inspect-project [目录] 读取 package.json、常见框架和测试入口，不执行脚本。

review --url <URL> 或 review --config <JSON> 启动真实审查。命令行提供的字段覆盖配置；相对 output 路径以当前工作目录为准，配置文件路径不改变此规则。每轮建立唯一子目录，不覆盖已有报告。

review 可用 --browser chromium|firefox|webkit 选择单个浏览器引擎。一次运行只产生一份单引擎报告。

像素基线可由 --update-pixel-baseline 写入，--pixel-baseline 执行比较，--pixel-baseline-dir 指定稳定基线目录。两者不能同时使用。matrix 也可带相同标志，按引擎分别建立或比较基线。

matrix --url <URL> 或 matrix --config <JSON> 使用同一份 URL、视口、场景和检查配置依次运行多个引擎；--browsers 默认 chromium,firefox,webkit，--matrix-timeout-ms 控制整个矩阵总时限。矩阵根目录保存聚合 report.html、matrix.json、metadata.json，每个引擎另有一份完整独立报告。某引擎失败不会删除已完成的证据，但矩阵整体不完整。

compare --before <JSON> --after <JSON> [--iteration 1] [--output diff.json] 对比同目标、同视口报告。输出文件已存在则拒绝覆盖。

## 配置字段

- url：必填 HTTP/HTTPS。拒绝 URL 凭据。
- browser：chromium/firefox/webkit，默认 chromium。选择未安装的引擎会明确报浏览器启动错误，不会自动换引擎冒充成功。
- project：报告标识；output：显式选择的输出根目录，默认 artifacts。
- viewports：1–8 个唯一 name 与 width/height。宽240–3840，高240–2160；可选 touch 默认 false。touch 只启用触屏上下文与 tap，不模拟具体设备型号、UA 或手势轨迹。
- timeoutMs：500–60000，每次浏览器操作超时；waitMs：0–10000，默认300。
- reviewTimeoutMs：1000–600000，默认120000；限制整轮浏览器工作，不包括输出目录创建、关闭清理与报告落盘。CLI 可用 --review-timeout-ms。
- lazyLoad：enabled 默认false；maxScrolls 默认12（1–40），waitMs 默认150（25–2000），maxDurationMs 默认5000（100–30000）。scrollContainers.enabled 默认false，maxContainers 默认8（1–20）。开启后先检测有界 overflow:auto/scroll 容器，再滚动文档；所有目标共享 maxScrolls/时间预算，基线检查前执行，交互场景不额外预滚动。
- stepScreenshots：mode 为 none/all/assertions，默认none；maxPerViewport 默认20（1–80）。all 在每个已执行步骤后截图，assertions 仅对 expect 开头的步骤截图；首个失败步骤也尝试保留截图，未执行步骤不会截图。
- pixelBaseline：enabled 默认false；mode 为 compare/update；directory 默认 artifacts/pixel-baselines；maxDiffPixelRatio 默认0.005（0–1）；threshold 默认0.1（0–1）；includeAA 默认false；maxPixels 默认20000000（1000–50000000）；masks 最多20个唯一 selector。启用后遮罩同时应用到本轮浏览器截图。
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

动作：click、tap、fill(value)、press(key)。tap 要求当前视口 touch:true，否则步骤明确失败而不是静默改用鼠标。断言：expectVisible、expectHidden、expectEnabled、expectText(text，包含匹配)、expectValue(value，精确匹配)、expectUrl(url，按当前 URL 解析后精确比较)、expectFocused。checkFocusIndicator 检查已聚焦元素的 outline/box-shadow，只能给启发式提示。

每场景使用独立上下文，从配置 url 重新加载；不跨场景保存登录状态。无结果断言场景是 unknown，不是 pass。首个失败后其余步骤 skipped。fill 的值不直接写入步骤证据，但网页截图、错误或后续文本仍可能暴露内容。

## 外部资源示例

~~~sh
web-aesthetic review --url https://example.com --allow-origin https://example.com
web-aesthetic review --url http://192.168.1.20:3000 --allow-origin http://192.168.1.20:3000 --allow-private-network
~~~

以上仅是语法示例，未访问示例远程目标。若主站跳转至 www 或从另一个端口加载资源，需分别授权相应 origin。不要为方便允许不认识的第三方。

## 退出码

取消或总超时会保留报告，执行状态为 cancelled/timed-out，未完成项为error或skipped，不伪造网站P0缺陷。终端 Ctrl+C / SIGTERM 和库调用的 AbortSignal 都可中止；强制杀进程可能无法保存报告。

0：没有触发所设问题阈值，但可能有 unknown/skipped/incomplete。1：发现达到 failOn 的问题，通常是质量门槛失败。2：配置、浏览器启动、截图、执行等错误，或矩阵未完整执行。failOn=none 只关闭问题阈值，不掩盖执行错误或缺失引擎。

## 对比语义

fixed 需要相同规则/视口在后一轮明确 pass。remaining 是相同指纹仍存在，added 是新增问题，unverified 是问题消失但没有通过证据，regressions 包含原先通过而后来失败/缺失的检查。stopReason 可以是 max-iterations、automated-gates-clear 或 continue-review。比较不分析截图像素，也不代表代码自动修复或视觉质量提高。

报告还保存 verificationProfile（检查配置的 SHA-256，不含明文配置）。对比要求该指纹一致，防止改 URL 查询、删除断言、更换定位器或等待条件后把结果差异误称为代码修复。若必须修正测试配置，应重新建立一致基线。

## 跨引擎矩阵配置

~~~sh
web-aesthetic matrix --url http://127.0.0.1:3000 --browsers chromium,firefox,webkit --output artifacts/matrix
web-aesthetic matrix --config review-config.json --browsers chromium,firefox --matrix-timeout-ms 240000
~~~

matrix 的输入仍是普通 ReviewConfig；配置中的 browser 不决定矩阵引擎集合，CLI 的 --browsers 才决定。矩阵默认总时限为 reviewTimeoutMs × 引擎数，默认上限900000ms；显式设置范围为1000–1800000ms。完成/部分完成/超时/取消分别记录在 matrix.execution；每份引擎报告保留自己的 browser、version、screenshots 和 execution。

聚合逻辑按 viewport + check id 对齐，只报告状态差异、缺失检查和失败差异。相同状态不等于截图相同，matrix 不分析像素、视觉观感或性能。部分引擎未完成时不会把其他引擎的 pass 解释为整体通过。

## 像素基线配置

~~~json
{
  "pixelBaseline": {
    "enabled": true,
    "mode": "compare",
    "directory": "artifacts/pixel-baselines",
    "maxDiffPixelRatio": 0.005,
    "threshold": 0.1,
    "includeAA": false,
    "maxPixels": 20000000,
    "masks": [
      {"selector": "#live-clock", "reason": "实时变化"},
      {"selector": "[data-carousel]", "reason": "自动轮播"}
    ]
  }
}
~~~

基线 key 隔离浏览器、完整 URL、视口名称/尺寸/touch、fullPage/maxScreenshotHeight、遮罩 selector 集合和 baseline 阶段。文件名只含 key 哈希；manifest 保存脱敏 URL、浏览器版本、尺寸、遮罩和时间。基线目录更新会覆盖同一 key 图片，其他 key 保留。

比较只在同尺寸、同浏览器版本、遮罩都存在时计算。缺失基线、尺寸变化、浏览器版本变化、截图截断或遮罩未匹配保持 unknown；超过阈值产生 fail、P2 issue 和 diff PNG。P2 默认低于 failOn=P1，因此不会自动阻断交付，需要人工查看或显式设置更严格阈值。

像素差不是审美评分。字体、抗锯齿、动态内容、有意改版和不同设备像素比需要人工区分。遮罩区域会以黑色覆盖在所有该轮截图中，截图与基线文件都可能含敏感信息。

## 触屏与嵌套滚动配置

~~~json
{
  "url":"http://127.0.0.1:4173/good",
  "reviewTimeoutMs":120000,
  "browser":"chromium",
  "viewports":[{"name":"mobile-touch","width":390,"height":844,"touch":true}],
  "lazyLoad":{"enabled":true,"maxScrolls":12,"waitMs":150,"maxDurationMs":5000,"scrollContainers":{"enabled":true,"maxContainers":8}},
  "stepScreenshots":{"mode":"assertions","maxPerViewport":20}
}
~~~

仍需加入interactions才能产生步骤截图。templates/advanced-review.json 包含实际可运行的菜单、弹窗、表单、键盘与导航场景；templates/lazy-review.json 对应文档懒加载页；templates/nested-scroll-review.json 验证嵌套滚动扫描；templates/touch-review.json 演示 tap；templates/pixel-baseline-review.json 演示动态区域遮罩。

步骤截图计数是实际尝试次数，不只统计成功截图，避免反复失败耗尽磁盘/时间。超预算在步骤里写skipped，并将screenshots.step-coverage标记unknown；断言仍可继续执行。失败的截图检查为error，不以截图失败推断业务失败。图片文件名带阶段哈希，长场景名和baseline同名场景不会覆盖其他图。

库调用支持 review(config, { signal }) 与 reviewMatrix(config, browsers, { signal, timeoutMs })。单引擎时限仍由 config.reviewTimeoutMs 控制；矩阵总时限由 MatrixOptions.timeoutMs 控制。单引擎报告 execution 区分 completed/timed-out/cancelled/error；completed 只表示浏览器工作结束，不代表视觉质量通过。旧1.0/1.1/1.2报告仍可在相同版本内compare，但升级到1.3后需建立新基线；浏览器、touch、滚动、截图与像素基线配置全部计入verificationProfile。

懒加载图片采样最多200张，达到稳定底部但超出样本范围时记录sample-limit/unknown。容器或总滚动次数耗尽时记录max-scrolls，发现容器数超过 maxContainers 时记录container-limit；这些都不算全页通过。compare在后一轮被取消、超时或执行失败时，不将消失问题算已验证修复；尚有自动证据unknown/skipped时不建议automated-gates-clear。
