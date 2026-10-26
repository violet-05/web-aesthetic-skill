# 真实浏览器审查

## 前置
检查目标服务器已经启动，确认真实 URL、页面路由和授权范围。默认允许目标本机 origin；跨端口资源也需要精确 allowOrigins。内网还需要 allowPrivateNetwork，元数据地址始终拒绝。

## 执行
从 templates/review-config.example.json 创建配置，加入关键元素和核心交互场景。运行 web-aesthetic review --config review-config.json；跨引擎时分别设置 browser 并保留独立报告。页面等待采用 domcontentloaded + 有界字体等待 + waitFor/waitMs，不无限等 networkidle。需要懒加载证据时显式开启lazyLoad，并记录文档/容器、滚动与时间上限；截图前恢复原滚动位置。需要像素回归时先记录稳定基线，再使用同浏览器/URL/视口/遮罩比较。reviewTimeoutMs限制整轮浏览器工作，用户取消或到期后保留部分报告，不算网站质量失败。

## 检查证据
打开本轮 report.html 与截图。逐视口看导航是否成功、截图是否完整、资源是否被策略阻止、错误属于网站还是环境。横向溢出用文档/视口宽度和候选元素定位，不能只隐藏 body 溢出。

## 解释边界
启发式裁切、遮挡、控件名称与目标大小需要人工确认。未加载的懒加载图是 unknown。缺失基线、尺寸/浏览器版本变化或遮罩缺失时像素检查是 unknown。未配置交互是 skipped。touch+tap 只验证触摸输入路径，不证明真实设备手感；单引擎结果不证明其他引擎通过。没有视觉模型时所有审美评分为 null。像素差与截图正常都不代表审美通过。
