import type { Page } from "playwright";
import { eventually, locate } from "../browser/locators.js";
import type { ReviewConfig, Scenario, Step } from "../config.js";
import type { Collector } from "../reports/collector.js";
import { abortable, throwIfAborted } from "../utils/cancellation.js";
import { message, redactUrl } from "../utils/safety.js";
export async function executeStep(
  page: Page,
  step: Step,
  timeoutMs: number,
  signal?: AbortSignal,
  hasTouch = false,
): Promise<Record<string, unknown>> {
  if (step.action === "expectUrl") {
    const expected = new URL(step.url, page.url()).href;
    await eventually(async () => page.url() === expected, timeoutMs, signal);
    return { url: redactUrl(page.url()) };
  }
  const loc = locate(page, step.target);
  switch (step.action) {
    case "click":
      await loc.click();
      return { action: "click", target: step.target };
    case "tap":
      if (!hasTouch) throw new Error("tap 需要当前视口配置 touch: true");
      await loc.tap();
      return { action: "tap", target: step.target };
    case "fill":
      await loc.fill(step.value);
      return { action: "fill", target: step.target, value: "[not recorded]" };
    case "press":
      await loc.press(step.key);
      return { action: "press", target: step.target, key: step.key };
    case "expectVisible":
      await loc.waitFor({ state: "visible" });
      break;
    case "expectHidden":
      await loc.waitFor({ state: "hidden" });
      break;
    case "expectEnabled":
      await eventually(
        async () => (await loc.count()) === 1 && (await loc.isVisible()) && (await loc.isEnabled()),
        timeoutMs,
        signal,
      );
      break;
    case "expectText":
      await eventually(
        async () => (await loc.count()) === 1 && ((await loc.textContent()) ?? "").includes(step.text),
        timeoutMs,
        signal,
      );
      break;
    case "expectValue":
      await eventually(async () => (await loc.inputValue()) === step.value, timeoutMs, signal);
      break;
    case "expectFocused":
      await eventually(
        async () => await loc.evaluate((el) => document.activeElement === el),
        timeoutMs,
        signal,
      );
      break;
    case "checkFocusIndicator": {
      const styles = await loc.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          focused: el === document.activeElement,
          focusVisible: el.matches(":focus-visible"),
          outlineWidth: s.outlineWidth,
          outlineStyle: s.outlineStyle,
          outlineColor: s.outlineColor,
          boxShadow: s.boxShadow,
        };
      });
      if (!styles.focused) throw new Error("目标未获得焦点");
      const likelyVisible =
        (parseFloat(styles.outlineWidth) > 0 &&
          styles.outlineStyle !== "none" &&
          !["transparent", "rgba(0, 0, 0, 0)"].includes(styles.outlineColor)) ||
        styles.boxShadow !== "none";
      return { ...styles, likelyVisible };
    }
  }
  return { action: step.action, target: step.target, asserted: true };
}

export interface StepCapture {
  status: "pass" | "error" | "skipped";
  path?: string;
  reason?: string;
}
export interface ScenarioOptions {
  signal?: AbortSignal;
  captureStep?: (index: number, step: Step) => Promise<StepCapture>;
}
export async function runScenario(
  page: Page,
  scenario: Scenario,
  viewport: string,
  c: Collector,
  config: ReviewConfig,
  options: ScenarioOptions = {},
) {
  const results: Array<Record<string, unknown>> = [];
  let failed = false;
  let interrupted = false;
  let focusUncertain = false;
  const hasTouch =
    config.viewports.find((viewportConfig) => viewportConfig.name === viewport)?.touch ?? false;
  for (const [index, step] of scenario.steps.entries()) {
    if (failed || interrupted) {
      results.push({
        index,
        action: step.action,
        status: "skipped",
        reason: interrupted ? "审查被中止" : "前置步骤失败",
      });
      continue;
    }
    const entry: Record<string, unknown> = { index, action: step.action };
    try {
      throwIfAborted(options.signal);
      const evidence = await abortable(
        executeStep(page, step, config.timeoutMs, options.signal, hasTouch),
        options.signal,
      );
      if (step.action === "checkFocusIndicator" && evidence.likelyVisible === false) focusUncertain = true;
      Object.assign(entry, { status: "pass", evidence });
    } catch (error) {
      interrupted = options.signal?.aborted ?? false;
      failed = !interrupted;
      Object.assign(entry, {
        status: interrupted ? "error" : "fail",
        error: message(interrupted ? options.signal?.reason : error),
        ...("target" in step ? { target: step.target } : {}),
      });
    }
    const shouldCapture =
      config.stepScreenshots.mode === "all" ||
      (config.stepScreenshots.mode === "assertions" && step.action.startsWith("expect"));
    if (shouldCapture && !interrupted && options.captureStep) {
      try {
        entry.screenshot = await options.captureStep(index, step);
      } catch (error) {
        entry.screenshot = { status: "error", reason: message(error) };
        interrupted = options.signal?.aborted ?? false;
      }
    }
    results.push(entry);
  }
  const asserted = scenario.steps.some((step) => step.action.startsWith("expect"));
  const check = c.check(
    viewport,
    `interaction.${scenario.name}`,
    "interaction",
    interrupted ? "error" : failed ? "fail" : asserted ? "pass" : "unknown",
    interrupted
      ? "审查中止；场景没有完整执行"
      : failed
        ? "交互场景未达到预期"
        : asserted
          ? "显式交互断言通过"
          : "只有动作，没有结果断言，不能确认功能正确",
    { scenario: scenario.name, steps: results },
  );
  if (failed && !interrupted)
    c.issue(
      check,
      scenario.priority,
      `交互场景失败：${scenario.name}`,
      "定位首个失败步骤，核对事件处理、可见性、状态反馈及断言。修复后重跑整个场景，不要删除失败断言。",
    );
  if (focusUncertain) {
    const focus = c.check(
      viewport,
      `a11y.focus.${scenario.name}`,
      "accessibility",
      "unknown",
      "焦点元素未检测到 outline/box-shadow，需要检查其他焦点反馈",
      { scenario: scenario.name, steps: results.filter((s) => s.action === "checkFocusIndicator") },
      "heuristic",
    );
    c.issue(
      focus,
      "P2",
      "键盘焦点可能不可见",
      "为 :focus-visible 提供清晰指示，并确认背景或边框状态；本检测不覆盖所有焦点绘制方式。",
    );
  }
  throwIfAborted(options.signal);
  return !failed;
}
