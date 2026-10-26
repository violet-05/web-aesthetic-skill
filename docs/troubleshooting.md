# 故障排查

## 找不到 Chromium

在本工具目录运行 npx playwright install chromium。Playwright 包更新可能要求匹配的新浏览器；不要使用无关联的系统浏览器冒充已安装版本。Linux 缺系统依赖可参考官方 --with-deps 安装；受限容器可能不支持 sandbox，本项目不会自动禁用。

## 页面打不开或导航失败

先手动确认开发服务器已启动、端口正确、路由存在。查看 navigation 的原始错误和 diagnostics。服务器不可达、HTTP错误或 waitFor 超时均不会生成成功结论。不要改用浏览器错误页截图当目标页面。

## 外部图片/字体/接口失效

默认仅目标本机 origin。检查 blocked 诊断，确认资源可信且用户允许后加入精确 allowOrigins。跨端口也算不同 origin。内网需要 allowPrivateNetwork；云元数据、链路本地和特殊地址不可放行。

## 实时应用加载异常

当前版本禁用 WebSocket 与 Service Worker，自动关闭新窗口/下载，不导入登录状态。Vite HMR 连接可能被阻止但静态渲染仍可检查；报告会注明不完整。不要为了得到绿色报告删除这些诊断。

## 场景定位失败

role 的 name 是精确可访问名称，检查空格、换行、aria-label 和语言。匹配多个元素会失败，应收窄定位器而不是随意 first()。每场景重新打开页面，不继承上一个场景登录或存储。给异步业务设置适当 timeoutMs 与明确结果断言。

## 懒加载/超长截图

未完成图片标记 unknown。可开启 lazyLoad.enabled，在有限次数和时间内滚动文档。嵌套滚动区域、frame、某些虚拟列表不在覆盖范围；达到上限仍标记unknown，不使用无限networkidle。超过 maxScreenshotHeight 的页面只截首屏，metadata.truncated 为 true。需要更深区域时调整合理上限或使用其他可控截图流程。

## Skill 未被宿主发现

先核对对应工具的安装路径、目录名与 frontmatter。CLI 的 skill-check 检查文件包，不证明宿主实际加载。安装后按官方文档重新载入客户端。安装器拒绝覆盖旧目录；先备份并确认升级，不直接删除用户文件。

## 报告不是 pass

正常页面没有视觉模型仍会 incomplete，因为六个视觉维度待评审。退出0只表示没有触发失败阈值。不要把未知改成通过来满足验收。报告HTML无脚本、外部字体或在线依赖，可离线打开；分享须包含screenshots子目录并检查敏感内容。

## 审查达到总时限或被取消

查看execution.status与review.deadline/review.cancelled。已通过步骤会保留，当前中断步骤为error，后续步骤skipped。先修正挂起页面或缩小审查范围，再合理提高reviewTimeoutMs；不要降低断言来制造通过。大量逐步截图也会消耗总预算。清理/落盘另需时间，强制结束进程不能保证报告完整。

## Ubuntu 的 Chromium sandbox 启动失败

如果诊断包含“No usable sandbox”或“Chromium sandboxing failed”，先确认操作系统是否限制未授权的user namespace。Ubuntu 23.10+的AppArmor策略可能阻止下载到用户目录的Chromium。不要把chromiumSandbox改为false，也不要为方便全局关闭AppArmor。

本仓库GitHub CI在临时Ubuntu24.04运行器中，按已安装Chromium可执行文件的准确路径加载仅允许userns的AppArmor例外；产品代码继续启用Chromium sandbox。普通用户机器需要管理员评估并配置环境，本工具不会自行修改系统安全策略。配置依据：Chromium官方文档 https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md 。
