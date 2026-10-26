import type { Page } from "playwright";
import { prepareLazyImages } from "./browser/lazy-load.js";
import { inspectPage } from "./browser/page-inspector.js";
import { capture } from "./browser/screenshot.js";
import { createSession, navigate } from "./browser/session.js";
import { runScenario, type StepCapture } from "./checks/interaction-checks.js";
import { runPageChecks } from "./checks/page-checks.js";
import { configSchema, dimensions, type ReviewConfig, type Viewport } from "./config.js";
import { Collector } from "./reports/collector.js";
import { verificationProfile } from "./reports/profile.js";
import { summarize } from "./reports/summary.js";
import type { Dimension, Report, Screenshot } from "./reports/types.js";
import { writeReport } from "./reports/write-report.js";
import { abortable, createReviewDeadline, ReviewTimeoutError, throwIfAborted } from "./utils/cancellation.js";
import { createRunDirectory, message, redactUrl } from "./utils/safety.js";
import { VERSION } from "./version.js";

const limits = [
  "没有连接视觉模型；审美评分为 null。视觉节奏、品牌适配、色彩对比、动效质量与空白分布需要人工或后续视觉评审。",
  "只执行显式配置的交互；未配置按钮不会被随机点击。每个场景使用独立上下文，不共享 Cookie 或存储。",
  "启发式提示不是设计失败事实，也不是 WCAG 合规认证；名称、尺寸、遮挡与焦点绘制均存在例外。",
  "浏览器使用 reduced-motion: reduce、deviceScaleFactor: 1，不模拟真实触屏或完整动画时间线。步骤截图不强制结束动画，但不是动画录像。",
  "网络通过校验并固定解析 IP 的本地代理；精确 origin 允许列表适用于导航、子资源和重定向。WebSocket、Service Worker、下载及弹出窗口流程未验证。",
  "DOM 最多采样 2500 个元素、200 张图片/控件、500 条诊断。超长页面截图降级首屏；未加载图片不算通过。",
  "懒加载预处理默认关闭；开启后只滚动文档，不处理嵌套滚动区、frame 或所有虚拟列表。到达次数/时间限制时标记未知。",
  "步骤截图默认关闭，开启后每视口有数量上限。截图增加时间与隐私暴露；达到上限的证据不会伪报保存成功。",
  "审查总时限覆盖浏览器工作；到期或取消会关闭会话并保留报告。清理和报告落盘可能另需时间，不是操作系统级强制隔离。",
  "URL 查询参数与常见凭据模式已脱敏，但截图、页面正文、错误文本仍可能含敏感信息。",
  "程序不修改目标项目、不上传截图、不调用付费 API；尚无自主代码修复控制器。",
];
const pageChecks: Array<[string, Dimension]> = [
  ["layout.overflow", "responsive"],
  ["layout.content", "layout"],
  ["images.loaded", "layout"],
  ["images.geometry", "layout"],
  ["a11y.image-alt", "accessibility"],
  ["a11y.control-name", "accessibility"],
  ["layout.occlusion", "layout"],
  ["responsive.clipping", "responsive"],
  ["a11y.target-size", "accessibility"],
  ["a11y.landmarks", "accessibility"],
  ["sampling.completeness", "layout"],
];
export interface ReviewOptions {
  signal?: AbortSignal;
}
export async function review(
  input: ReviewConfig,
  options: ReviewOptions = {},
): Promise<{ report: Report; directory: string }> {
  const config = configSchema.parse(input);
  const { directory, runId } = await createRunDirectory(config.output);
  const deadline = createReviewDeadline(config.reviewTimeoutMs, options.signal),
    signal = deadline.signal;
  const report: Report = {
    schemaVersion: "1.1",
    toolVersion: VERSION,
    runId,
    verificationProfile: verificationProfile(config),
    project: config.project,
    targetUrl: redactUrl(config.url),
    startedAt: new Date().toISOString(),
    finishedAt: "",
    browser: { name: "Chromium", version: "not-started" },
    viewports: config.viewports,
    status: "incomplete",
    checks: [],
    issues: [],
    diagnostics: [],
    droppedDiagnostics: {},
    screenshots: [],
    summary: {
      executed: 0,
      total: 0,
      passed: 0,
      failed: 0,
      unknown: 0,
      skipped: 0,
      errors: 0,
      coverage: 0,
      byPriority: { P0: 0, P1: 0, P2: 0, P3: 0 },
      aestheticScore: null,
    },
    dimensions: [],
    config: { maxIterations: config.maxIterations, designGoals: config.designGoals },
    limitations: limits,
  };
  const c = new Collector(report);
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  let executionStatus: "completed" | "timed-out" | "cancelled" | "error" = "completed";
  const has = (v: string, id: string) =>
    report.checks.some((check) => check.viewport === v && check.id === id);
  function markRemaining(v: Viewport, reason: string) {
    for (const dimension of dimensions)
      if (!has(v.name, `manual.${dimension}`))
        c.check(v.name, `manual.${dimension}`, dimension, "skipped", reason, {}, "manual");
    const planned: Array<[string, Dimension]> = [
      ...pageChecks,
      ["navigation", "layout"],
      ["images.lazy-load", "layout"],
      ["screenshot.baseline", "layout"],
      ["runtime.errors", "interaction"],
      ["network.policy", "interaction"],
      ["diagnostics.completeness", "interaction"],
    ];
    for (const [i] of config.requiredElements.entries()) planned.push([`required.${i}`, "layout"]);
    for (const scene of config.interactions)
      planned.push(
        [`interaction.${scene.name}`, "interaction"],
        [`screenshot.scenario-${scene.name}`, "layout"],
      );
    if (config.stepScreenshots.mode !== "none") planned.push(["screenshots.step-coverage", "interaction"]);
    for (const [id, dimension] of planned)
      if (!has(v.name, id)) c.check(v.name, id, dimension, "skipped", reason);
  }
  async function shot(
    page: Page,
    v: Viewport,
    phase: string,
    state?: { scenario: string; stepIndex: number; action: string },
  ): Promise<StepCapture> {
    throwIfAborted(signal);
    try {
      const image = await abortable(capture(page, config, v, directory, runId, phase, state), signal);
      throwIfAborted(signal);
      report.screenshots.push(image);
      c.check(
        v.name,
        `screenshot.${phase}`,
        "layout",
        image.truncated ? "unknown" : "pass",
        image.truncated ? "页面过长，已降级首屏截图" : "真实截图已保存",
        { ...image },
      );
      return { status: "pass", path: image.path };
    } catch (error) {
      c.check(v.name, `screenshot.${phase}`, "layout", "error", "截图未完成", {
        error: message(signal.aborted ? signal.reason : error),
      });
      throwIfAborted(signal);
      return { status: "error", reason: message(error) };
    }
  }
  function recordRuntime(v: Viewport, navigated: boolean) {
    const diagnostics = report.diagnostics.filter((d) => d.viewport === v.name),
      dropped = report.droppedDiagnostics[v.name] ?? 0;
    c.check(
      v.name,
      "diagnostics.completeness",
      "interaction",
      dropped ? "unknown" : "pass",
      dropped ? "诊断已达到采样上限，不能确认全部错误与拦截" : "诊断未超出采样上限",
      { limit: 500, dropped },
    );
    const errors = diagnostics.filter((d) =>
      ["console", "pageerror", "requestfailed", "http"].includes(d.kind),
    );
    const blocked = diagnostics.filter((d) => d.kind === "blocked" || d.kind === "environment");
    const runtime = c.check(
      v.name,
      "runtime.errors",
      "interaction",
      !navigated ? "skipped" : errors.length ? "fail" : dropped ? "unknown" : "pass",
      "页面运行时与资源诊断",
      { errors },
    );
    if (errors.length)
      c.issue(
        runtime,
        errors.some((e) => e.kind === "pageerror") ? "P1" : "P2",
        "页面产生运行时或资源错误",
        "查看诊断中的来源与状态；区分网站代码、第三方资源和策略拦截，不将全部消息归为应用故障。",
      );
    c.check(
      v.name,
      "network.policy",
      "interaction",
      blocked.length || dropped ? "unknown" : "pass",
      blocked.length || dropped ? "部分访问被阻止或诊断已截断，验证不完整" : "未记录策略拦截",
      { blocked },
    );
  }
  try {
    throwIfAborted(signal);
    session = await createSession(config, report, signal);
    for (const viewport of config.viewports) {
      throwIfAborted(signal);
      for (const dimension of dimensions)
        c.check(
          viewport.name,
          `manual.${dimension}`,
          dimension,
          "unknown",
          "需要视觉或人工评审；未自动评分",
          {},
          "manual",
        );
      if (!config.interactions.length)
        c.check(
          viewport.name,
          "interaction.unconfigured",
          "interaction",
          "skipped",
          "未配置显式交互场景；不随机点击",
        );
      const { page, context } = await session.open(viewport);
      let navigated = false;
      try {
        try {
          await navigate(page, config, signal);
          navigated = true;
          c.check(viewport.name, "navigation", "layout", "pass", "页面导航和等待条件完成", {
            url: redactUrl(page.url()),
            waitMs: config.waitMs,
          });
        } catch (error) {
          throwIfAborted(signal);
          const check = c.check(
            viewport.name,
            "navigation",
            "layout",
            "fail",
            "页面无法打开或等待条件未满足",
            { error: message(error) },
          );
          c.issue(
            check,
            "P0",
            "无法完成页面导航",
            "确认开发服务器、URL、网络策略、等待元素及超时配置，不将浏览器错误页当作目标页面。",
          );
        }
        if (navigated) {
          if (config.lazyLoad.enabled) {
            try {
              const result = await prepareLazyImages(page, config.lazyLoad, signal);
              c.check(
                viewport.name,
                "images.lazy-load",
                "layout",
                result.complete ? "pass" : "unknown",
                result.complete
                  ? "文档滚动预处理达到观测范围内的稳定底部"
                  : "懒加载预处理达到限制，不能确认全部内容已加载",
                { ...result, limits: config.lazyLoad },
              );
            } catch (error) {
              c.check(viewport.name, "images.lazy-load", "layout", "error", "懒加载预处理未完成", {
                error: message(signal.aborted ? signal.reason : error),
              });
              throwIfAborted(signal);
            }
          } else
            c.check(
              viewport.name,
              "images.lazy-load",
              "layout",
              "skipped",
              "未开启滚动预处理；未加载图片不会被自动算通过",
            );
          const snapshot = await abortable(inspectPage(page), signal);
          await runPageChecks(page, snapshot, viewport.name, c, config, signal);
          await shot(page, viewport, "baseline");
        }
      } catch (error) {
        throwIfAborted(signal);
        c.check(viewport.name, "inspection", "layout", "error", "页面检查中断", { error: message(error) });
      } finally {
        await context.close().catch((error) => {
          if (!signal.aborted) throw error;
        });
      }
      const stepCounts = { attempted: 0, saved: 0, skipped: 0, errors: 0 };
      if (navigated) {
        for (const scenario of config.interactions) {
          throwIfAborted(signal);
          const scenarioPage = await session.open(viewport);
          try {
            await navigate(scenarioPage.page, config, signal);
            await runScenario(scenarioPage.page, scenario, viewport.name, c, config, {
              signal,
              captureStep: async (index, step) => {
                throwIfAborted(signal);
                if (stepCounts.attempted >= config.stepScreenshots.maxPerViewport) {
                  stepCounts.skipped++;
                  return { status: "skipped", reason: "已达到每视口步骤截图上限" };
                }
                stepCounts.attempted++;
                const image = await shot(
                  scenarioPage.page,
                  viewport,
                  `step-${String(index + 1).padStart(2, "0")}-${scenario.name}`,
                  { scenario: scenario.name, stepIndex: index, action: step.action },
                );
                if (image.status === "pass") stepCounts.saved++;
                else stepCounts.errors++;
                return image;
              },
            });
            await shot(scenarioPage.page, viewport, `scenario-${scenario.name}`);
          } catch (error) {
            if (!has(viewport.name, `interaction.${scenario.name}`))
              c.check(
                viewport.name,
                `interaction.${scenario.name}`,
                "interaction",
                "error",
                signal.aborted ? "审查中止，场景未完成" : "场景初始化失败",
                { error: message(signal.aborted ? signal.reason : error) },
              );
            throwIfAborted(signal);
          } finally {
            await scenarioPage.context.close().catch((error) => {
              if (!signal.aborted) throw error;
            });
          }
        }
      }
      if (config.stepScreenshots.mode !== "none")
        c.check(
          viewport.name,
          "screenshots.step-coverage",
          "interaction",
          !navigated ? "skipped" : stepCounts.errors ? "error" : stepCounts.skipped ? "unknown" : "pass",
          "已执行步骤的截图证据覆盖；不代表未执行步骤已验证",
          { ...stepCounts, limit: config.stepScreenshots.maxPerViewport, mode: config.stepScreenshots.mode },
        );
      recordRuntime(viewport, navigated);
      markRemaining(viewport, "前置导航或页面检查未完成，此检查未执行");
    }
    throwIfAborted(signal);
  } catch (error) {
    if (signal.aborted) {
      executionStatus = signal.reason instanceof ReviewTimeoutError ? "timed-out" : "cancelled";
      c.check(
        "environment",
        executionStatus === "timed-out" ? "review.deadline" : "review.cancelled",
        "interaction",
        "error",
        executionStatus === "timed-out" ? "审查总时限已到，剩余操作被中止" : "用户取消审查，剩余操作被中止",
        { timeoutMs: config.reviewTimeoutMs, elapsedMs: deadline.elapsedMs(), error: message(signal.reason) },
      );
    } else {
      executionStatus = "error";
      const check = c.check(
        "environment",
        session ? "browser.session" : "browser.start",
        "layout",
        "error",
        "无法完成浏览器会话",
        { error: message(error) },
      );
      c.issue(
        check,
        "P0",
        "浏览器会话未完成",
        "检查 Chromium 安装、权限、网络配置与运行诊断；这不等同于网站自身缺陷。",
      );
    }
  } finally {
    // Stop deadline only after the browser work ends. Cleanup and artifact writes are not silently abandoned.
    deadline.dispose();
    if (session)
      await session.close().catch((error) => {
        c.check("environment", "browser.close", "layout", "error", "浏览器清理异常", {
          error: message(error),
        });
        executionStatus = "error";
      });
  }
  for (const v of config.viewports) markRemaining(v, "审查提前停止；尚未执行，不记为通过");
  report.finishedAt = new Date().toISOString();
  report.execution = {
    status: executionStatus,
    timeoutMs: config.reviewTimeoutMs,
    elapsedMs: deadline.elapsedMs(),
  };
  for (const issue of report.issues) {
    const scene = issue.ruleId.startsWith("interaction.")
      ? issue.ruleId.slice("interaction.".length)
      : undefined;
    const relevant = (s: Screenshot) =>
      s.viewport === issue.viewport &&
      (scene ? s.scenario === scene || s.phase === `scenario-${scene}` : s.phase === "baseline");
    issue.evidence = {
      ...issue.evidence,
      screenshots: report.screenshots.filter(relevant).map((s) => s.path),
    };
  }
  summarize(report, config);
  await writeReport(report, directory);
  return { report, directory };
}
