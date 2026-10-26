import type { Page } from "playwright";
import { locate } from "../browser/locators.js";
import type { PageSnapshot } from "../browser/page-inspector.js";
import type { ReviewConfig } from "../config.js";
import type { Collector } from "../reports/collector.js";
import { abortable, throwIfAborted } from "../utils/cancellation.js";
import { message, redactUrl } from "../utils/safety.js";
export async function runPageChecks(
  page: Page,
  s: PageSnapshot,
  v: string,
  c: Collector,
  config: ReviewConfig,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const over = s.documentWidth > s.viewportWidth + 2;
  const overflow = c.check(
    v,
    "layout.overflow",
    "responsive",
    over ? "fail" : "pass",
    over ? "文档出现横向溢出" : "文档宽度未超出视口",
    { documentWidth: s.documentWidth, viewportWidth: s.viewportWidth, candidates: s.overflow },
  );
  if (over)
    c.issue(
      overflow,
      "P1",
      "横向内容超出视口",
      "检查候选元素的固定宽度、min-width、网格 minmax(0,1fr) 和长文本换行；不要仅给 body 设置 overflow:hidden。",
    );
  const lacksTextAndMedia = s.bodyTextLength === 0 && !s.hasVisualMedia;
  const empty = lacksTextAndMedia && !s.hasPaintedContent;
  const body = c.check(
    v,
    "layout.content",
    "layout",
    empty ? "fail" : lacksTextAndMedia ? "unknown" : "pass",
    empty
      ? "未检测到可见正文或媒体"
      : lacksTextAndMedia
        ? "仅检测到 CSS 绘制内容，需要人工判断页面主体"
        : "检测到正文或媒体",
    {
      textLength: s.bodyTextLength,
      hasVisualMedia: s.hasVisualMedia,
      hasPaintedContent: s.hasPaintedContent,
    },
  );
  if (empty)
    c.issue(
      body,
      "P0",
      "页面主体可能为空",
      "检查应用挂载、加载状态及脚本异常；纯 CSS 图形页面需人工确认此结果。",
    );
  const broken = s.images.filter((i) => i.complete && i.naturalWidth === 0 && i.src);
  const pending = s.images.filter((i) => !i.complete || !i.src);
  const images = c.check(
    v,
    "images.loaded",
    "layout",
    broken.length ? "fail" : pending.length ? "unknown" : "pass",
    broken.length
      ? "存在加载失败图片"
      : pending.length
        ? "部分图片尚未加载（含懒加载）"
        : "当前样本中的图片均已加载",
    {
      count: s.images.length,
      broken: broken.map((i) => ({ ...i, src: redactUrl(i.src) })),
      pending: pending.map((i) => ({ selector: i.selector, loading: i.loading, top: i.top })),
    },
  );
  if (broken.length)
    c.issue(
      images,
      "P1",
      "图片加载失败",
      "核对资源路径、响应状态、CORS 和允许列表。若资源被策略拦截，先核实授权，不能直接归因于网站。",
    );
  const badRatios = s.images.filter(
    (i) =>
      i.naturalWidth > 0 &&
      i.height > 0 &&
      i.width > 0 &&
      Math.abs(i.width / i.height - i.naturalWidth / i.naturalHeight) > 0.5,
  );
  const ratios = c.check(
    v,
    "images.geometry",
    "layout",
    badRatios.length ? "unknown" : "pass",
    badRatios.length ? "图片比例不同，可能为有意裁切" : "未发现明显比例差异",
    {
      candidates: badRatios.map((i) => ({
        selector: i.selector,
        width: i.width,
        height: i.height,
        naturalWidth: i.naturalWidth,
        naturalHeight: i.naturalHeight,
      })),
    },
    "heuristic",
  );
  if (badRatios.length)
    c.issue(
      ratios,
      "P3",
      "确认图片裁切是否保留主体",
      "在截图中确认 object-fit、容器比例和焦点位置，不要自动把裁切认定为拉伸。",
    );
  const missingAlt = s.images.filter((i) => i.alt === null);
  const alt = c.check(
    v,
    "a11y.image-alt",
    "accessibility",
    missingAlt.length ? "fail" : "pass",
    "检查 img 的 alt 属性（不评判描述质量）",
    { missing: missingAlt.map((i) => i.selector) },
  );
  if (missingAlt.length)
    c.issue(alt, "P2", "图片缺少 alt 属性", '内容图片写出用途相关的替代文本；装饰图片使用 alt=""。');
  const unnamed = s.controls.filter((x) => !x.name);
  const names = c.check(
    v,
    "a11y.control-name",
    "accessibility",
    unnamed.length ? "unknown" : "pass",
    "常见控件名称启发式检查；不是完整可访问名称算法",
    { candidates: unnamed },
    "heuristic",
  );
  if (unnamed.length)
    c.issue(
      names,
      "P2",
      "部分控件可能缺少可访问名称",
      "优先使用可见 label 和按钮文字，检查浏览器无障碍树；图标按钮补充准确名称。",
    );
  const obscured = s.controls.filter((x) => x.obscured);
  const occlusion = c.check(
    v,
    "layout.occlusion",
    "layout",
    obscured.length ? "unknown" : "pass",
    "首屏控件中心点遮挡采样",
    { candidates: obscured },
    "heuristic",
  );
  if (obscured.length)
    c.issue(
      occlusion,
      "P2",
      "控件中心点可能被遮挡",
      "检查截图及浮层状态、z-index、固定页头；可能是合法打开的遮罩，需人工确认。",
    );
  const clipping = c.check(
    v,
    "responsive.clipping",
    "responsive",
    s.clipped.length ? "unknown" : "pass",
    "标题、导航、按钮的裁切启发式检查",
    { candidates: s.clipped },
    "heuristic",
  );
  if (s.clipped.length)
    c.issue(
      clipping,
      "P2",
      "关键文字可能被裁切",
      "检查小屏幕下的高度限制和换行；明确区分有意的省略与内容丢失。",
    );
  const small = s.controls.filter((x) => x.width < 24 || x.height < 24);
  const targets = c.check(
    v,
    "a11y.target-size",
    "accessibility",
    small.length ? "unknown" : "pass",
    "24px 目标尺寸筛查（不评估间距等例外）",
    { candidates: small },
    "heuristic",
  );
  if (small.length)
    c.issue(
      targets,
      "P3",
      "部分交互目标较小",
      "检查触屏误触风险，适当增加内边距或目标间距；文字链接例外需人工判断。",
    );
  c.check(
    v,
    "a11y.landmarks",
    "accessibility",
    s.mainCount === 1 && s.lang ? "pass" : "unknown",
    "文档语言和主内容地标筛查",
    { mainCount: s.mainCount, lang: s.lang, h1Count: s.h1Count },
    "heuristic",
  );
  c.check(
    v,
    "sampling.completeness",
    "layout",
    s.elementCount > 2500 || s.images.length >= 200 || s.controls.length >= 200 ? "unknown" : "pass",
    "DOM 扫描有界采样",
    { elementCount: s.elementCount, maxElements: 2500, maxImages: 200, maxControls: 200 },
  );
  for (const [i, target] of config.requiredElements.entries()) {
    throwIfAborted(signal);
    try {
      const loc = locate(page, target),
        count = await abortable(loc.count(), signal);
      const visible = count === 1 && (await abortable(loc.isVisible(), signal));
      const check = c.check(
        v,
        `required.${i}`,
        "layout",
        visible ? "pass" : "fail",
        "关键元素必须唯一且可见",
        { target, count, visible },
      );
      if (!visible)
        c.issue(
          check,
          "P1",
          "关键元素缺失、重复或不可见",
          "检查定位器、路由、加载条件及当前视口下内容优先级。",
        );
    } catch (error) {
      throwIfAborted(signal);
      c.check(v, `required.${i}`, "layout", "error", "关键元素检查出错", { target, error: message(error) });
    }
  }
}
