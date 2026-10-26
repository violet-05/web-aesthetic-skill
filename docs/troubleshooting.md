# 故障排查

## 找不到所选浏览器

默认引擎是 Chromium，可在本工具目录运行 npx playwright install chromium；跨引擎验证还需 npx playwright install firefox webkit。Playwright 包更新可能要求匹配的新浏览器；不要使用无关联的系统浏览器冒充已安装版本。Linux 缺系统依赖可参考官方 --with-deps 安装；受限容器可能不支持 sandbox，本项目不会自动禁用。

## 页面打不开或导航失败

先手动确认开发服务器已启动、端口正确、路由存在。查看 navigation 的原始错误和 diagnostics。服务器不可达、HTTP错误或 waitFor 超时均不会生成成功结论。不要改用浏览器错误页截图当目标页面。

## 外部图片/字体/接口失效

默认仅目标本机 origin。检查 blocked 诊断，确认资源可信且用户允许后加入精确 allowOrigins。跨端口也算不同 origin。内网需要 allowPrivateNetwork；云元数据、链路本地和特殊地址不可放行。

## 实时应用加载异常

当前版本禁用 WebSocket 与 Service Worker，自动关闭新窗口/下载，不导入登录状态。Vite HMR 连接可能被阻止但静态渲染仍可检查；报告会注明不完整。不要为了得到绿色报告删除这些诊断。

## 场景定位失败

role 的 name 是精确可访问名称，检查空格、换行、aria-label 和语言。匹配多个元素会失败，应收窄定位器而不是随意 first()。每场景重新打开页面，不继承上一个场景登录或存储。给异步业务设置适当 timeoutMs 与明确结果断言。

## 懒加载、嵌套滚动与超长截图

未完成图片标记 unknown。可开启 lazyLoad.enabled，在有限次数和时间内滚动文档；再开启 lazyLoad.scrollContainers.enabled 扫描自动可识别的 overflow:auto/scroll 容器。容器、frame、transform 驱动或需要业务操作才能出现的虚拟列表仍可能不在覆盖范围；达到 max-scrolls/container-limit/time-budget 时保持unknown，不使用无限networkidle。超过 maxScreenshotHeight 的页面只截首屏，metadata.truncated 为 true。

## tap 提示需要 touch:true

tap 只在 touch:true 的视口执行。为对应 viewport 设置 touch:true，并确认测试场景确实代表触屏任务；不要为了消除错误把 tap 改成 click，因为两者验证的输入路径不同。touch:true 不模拟真实手机型号、软键盘或复杂手势。

## matrix 部分完成或超时

查看 matrix.json 的 execution 与每个 run 的 execution。partial 表示部分引擎完成；timed-out/cancelled 表示整个矩阵总时限或用户取消，剩余引擎为 not-run。不要只看已完成引擎的通过数，也不要把 matrix.status 的 incomplete/error 改成 pass。先缩小视口/场景、修复挂起页面或提高合理总时限，再重跑同一引擎集合。

## 像素基线缺失、尺寸不同或遮罩未匹配

先确认 browser、完整 URL、viewport 与 touch 上下文一致，并查看 manifest 的浏览器版本和截图尺寸。缺失基线时使用 --update-pixel-baseline 写入；浏览器升级、页面高度变化或遮罩 selector 未命中时保持 unknown，不应直接改成 fail 或 pass。动态时间、轮播与随机内容先添加 mask；mask 只做证据遮挡，不保证隐私脱敏。diff 超阈值时比较截图和 diff PNG，排除字体、抗锯齿与有意改版后再判断回归。

## Skill 未被宿主发现

先核对对应工具的安装路径、目录名与 frontmatter。CLI 的 skill-check 检查文件包，不证明宿主实际加载。安装后按官方文档重新载入客户端。安装器拒绝覆盖旧目录；先备份并确认升级，不直接删除用户文件。

## 报告不是 pass

正常页面没有视觉模型仍会 incomplete，因为六个视觉维度待评审。退出0只表示没有触发失败阈值。不要把未知改成通过来满足验收。报告HTML无脚本、外部字体或在线依赖，可离线打开；分享须包含screenshots子目录并检查敏感内容。

## 审查达到总时限或被取消

查看execution.status与review.deadline/review.cancelled。已通过步骤会保留，当前中断步骤为error，后续步骤skipped。先修正挂起页面或缩小审查范围，再合理提高reviewTimeoutMs；不要降低断言来制造通过。大量逐步截图也会消耗总预算。清理/落盘另需时间，强制结束进程不能保证报告完整。

## Ubuntu 的 Chromium sandbox 启动失败

如果诊断包含“No usable sandbox”或“Chromium sandboxing failed”，先确认操作系统是否限制未授权的user namespace。Ubuntu 23.10+的AppArmor策略可能阻止下载到用户目录的Chromium。不要把chromiumSandbox改为false，也不要为方便全局关闭AppArmor。

本仓库GitHub CI在临时Ubuntu24.04运行器中，按已安装Chromium可执行文件的准确路径加载仅允许userns的AppArmor例外；产品代码继续启用Chromium sandbox。普通用户机器需要管理员评估并配置环境，本工具不会自行修改系统安全策略。配置依据：Chromium官方文档 https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md 。
