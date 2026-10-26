import type { Page } from "playwright";
import type { ReviewConfig } from "../config.js";
import { abortable, pause, throwIfAborted } from "../utils/cancellation.js";
export type ScrollStopReason =
  | "bottom-stable"
  | "max-scrolls"
  | "time-budget"
  | "sample-limit"
  | "container-limit"
  | "target-missing";
export interface ScrollSample {
  y: number;
  documentHeight: number;
  viewportHeight: number;
  images: number;
  pending: number;
}
export interface ContainerScrollResult {
  selector: string;
  label: string;
  stopReason: "bottom-stable" | "max-scrolls" | "sample-limit" | "target-missing";
  complete: boolean;
  scrolls: number;
  samples: ScrollSample[];
  restored: boolean;
}
export interface LazyLoadResult {
  stopReason: ScrollStopReason;
  complete: boolean;
  scrolls: number;
  elapsedMs: number;
  restored: boolean;
  samples: ScrollSample[];
  containerScan: "disabled" | "enabled";
  detectedContainers: number;
  skippedContainers: number;
  containers: ContainerScrollResult[];
}
interface DetectedContainer {
  selector: string;
  label: string;
  scrollTop: number;
}
interface TargetState extends ScrollSample {
  present: boolean;
}
/** Bounded document and optional nested-container scrolling; never clicks or enters frames. */
export async function prepareLazyImages(
  page: Page,
  config: Omit<ReviewConfig["lazyLoad"], "scrollContainers"> & {
    scrollContainers?: ReviewConfig["lazyLoad"]["scrollContainers"];
  },
  signal?: AbortSignal,
): Promise<LazyLoadResult> {
  const scrollContainers = config.scrollContainers ?? { enabled: false, maxContainers: 8 };
  const start = Date.now();
  const local = new AbortController();
  const timer = setTimeout(() => local.abort(new Error("懒加载预处理时间预算已到")), config.maxDurationMs);
  const workSignal = signal ? AbortSignal.any([signal, local.signal]) : local.signal;
  const result: LazyLoadResult = {
    stopReason: "time-budget",
    complete: false,
    scrolls: 0,
    elapsedMs: 0,
    restored: false,
    samples: [],
    containerScan: scrollContainers.enabled ? "enabled" : "disabled",
    detectedContainers: 0,
    skippedContainers: 0,
    containers: [],
  };
  let origin = { x: 0, y: 0 };
  let detected: DetectedContainer[] = [];
  let documentResult: ContainerScrollResult | undefined;
  const remaining = () => Math.max(1, config.maxDurationMs - (Date.now() - start));
  const wait = () => pause(Math.min(config.waitMs, remaining()), workSignal);
  const readTarget = (selector?: string) =>
    page.evaluate((selector) => {
      const element = selector ? (document.querySelector(selector) as HTMLElement | null) : null;
      const images = element ? Array.from(element.querySelectorAll("img")) : Array.from(document.images);
      return {
        present: !selector || !!element,
        y: selector ? (element?.scrollTop ?? 0) : scrollY,
        documentHeight: selector ? (element?.scrollHeight ?? 0) : document.documentElement.scrollHeight,
        viewportHeight: selector ? (element?.clientHeight ?? 0) : innerHeight,
        images: images.length,
        pending: images
          .slice(0, 200)
          .filter((image) => !image.complete || (!image.currentSrc && !image.getAttribute("src"))).length,
      } satisfies TargetState;
    }, selector);
  const scrollTarget = async (
    selector: string | undefined,
    scrollBudget: number,
    kind: "document" | "container",
  ): Promise<ContainerScrollResult> => {
    const samples: ScrollSample[] = [];
    const target: ContainerScrollResult = {
      selector: selector ?? "document",
      label:
        kind === "document"
          ? "文档"
          : (detected.find((item) => item.selector === selector)?.label ?? selector ?? ""),
      stopReason: "max-scrolls",
      complete: false,
      scrolls: 0,
      samples,
      restored: false,
    };
    let atBottomLast = false;
    let previousHeight = -1;
    while (Date.now() - start < config.maxDurationMs) {
      await wait();
      throwIfAborted(workSignal);
      const sample = await abortable(readTarget(selector), workSignal);
      if (!sample.present) {
        target.stopReason = "target-missing";
        break;
      }
      samples.push(sample);
      const { y, documentHeight, viewportHeight, images, pending } = sample;
      const bottom = y + viewportHeight >= documentHeight - 2;
      if (bottom && atBottomLast && documentHeight === previousHeight && pending === 0) {
        target.complete = images <= 200;
        target.stopReason = target.complete ? "bottom-stable" : "sample-limit";
        break;
      }
      atBottomLast = bottom;
      previousHeight = documentHeight;
      if (Date.now() - start >= config.maxDurationMs) break;
      if (!bottom) {
        if (target.scrolls >= scrollBudget) {
          target.stopReason = "max-scrolls";
          break;
        }
        throwIfAborted(workSignal);
        await abortable(
          page.evaluate(
            ({ selector, amount }) => {
              if (selector) {
                const element = document.querySelector(selector) as HTMLElement | null;
                element?.scrollBy({ left: 0, top: amount, behavior: "instant" });
                return;
              }
              window.scrollBy({ left: 0, top: amount, behavior: "instant" });
            },
            {
              selector,
              amount: Math.max(1, Math.floor(viewportHeight * 0.8)),
            },
          ),
          workSignal,
        );
        target.scrolls++;
      }
    }
    return target;
  };
  try {
    const setup = await abortable(
      page.evaluate(
        (maxContainers) => {
          const candidates = Array.from(document.body?.querySelectorAll<HTMLElement>("*") ?? [])
            .slice(0, 2500)
            .filter((element) => {
              if (element === document.body || element === document.documentElement) return false;
              const style = getComputedStyle(element);
              if (!/(auto|scroll|overlay)/.test(style.overflowY)) return false;
              return element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 2;
            });
          const containers = candidates.slice(0, maxContainers).map((element) => {
            let selector = "";
            if (element.id) {
              const idSelector = `#${CSS.escape(element.id)}`;
              if (document.querySelectorAll(idSelector).length === 1) selector = idSelector;
            }
            const testId = element.getAttribute("data-testid");
            if (!selector && testId) {
              const testIdSelector = `[data-testid="${CSS.escape(testId)}"]`;
              if (document.querySelectorAll(testIdSelector).length === 1) selector = testIdSelector;
            }
            if (!selector) {
              const parts: string[] = [];
              let current: Element | null = element;
              while (current && current !== document.body && parts.length < 6) {
                const tag = current.tagName.toLowerCase();
                const parent: Element | null = current.parentElement;
                if (!parent) break;
                const currentTag = current.tagName;
                const sameTag = Array.from(parent.children).filter(
                  (child: Element) => child.tagName === currentTag,
                );
                const suffix = sameTag.length > 1 ? `:nth-of-type(${sameTag.indexOf(current) + 1})` : "";
                parts.unshift(`${tag}${suffix}`);
                current = parent;
              }
              selector = parts.join(" > ");
            }
            return {
              selector,
              label:
                element.getAttribute("aria-label") ||
                element.getAttribute("data-testid") ||
                element.id ||
                element.getAttribute("role") ||
                element.tagName.toLowerCase(),
              scrollTop: element.scrollTop,
            };
          });
          const origin = { x: scrollX, y: scrollY };
          window.scrollTo({ left: 0, top: 0, behavior: "instant" });
          return {
            origin,
            detected: candidates.length,
            containers,
          };
        },
        scrollContainers.enabled ? scrollContainers.maxContainers : 0,
      ),
      workSignal,
    );
    origin = setup.origin;
    result.detectedContainers = setup.detected;
    detected = setup.containers;
    result.skippedContainers = scrollContainers.enabled ? Math.max(0, setup.detected - detected.length) : 0;
    for (const container of detected) {
      const budget = Math.max(0, config.maxScrolls - result.scrolls);
      const containerResult = await scrollTarget(container.selector, budget, "container");
      result.scrolls += containerResult.scrolls;
      result.containers.push(containerResult);
      if (containerResult.stopReason !== "bottom-stable") break;
    }
    if (result.scrolls < config.maxScrolls && result.containers.every((item) => item.complete)) {
      documentResult = await scrollTarget(undefined, config.maxScrolls - result.scrolls, "document");
      result.scrolls += documentResult.scrolls;
      result.samples = documentResult.samples;
    }
    const targets = [...result.containers, ...(documentResult ? [documentResult] : [])];
    const incomplete = targets.find((target) => !target.complete);
    if (result.skippedContainers) {
      result.stopReason = "container-limit";
      result.complete = false;
    } else if (incomplete) {
      result.stopReason = incomplete.stopReason;
      result.complete = false;
    } else if (!documentResult) {
      result.stopReason = "max-scrolls";
      result.complete = false;
    } else {
      result.stopReason = "bottom-stable";
      result.complete = true;
    }
  } catch (error) {
    throwIfAborted(signal);
    if (!local.signal.aborted) throw error;
    result.stopReason = "time-budget";
  } finally {
    clearTimeout(timer);
    if (!signal?.aborted) {
      try {
        await abortable(
          page.evaluate(
            ({ origin, containers }) => {
              for (const container of containers) {
                const element = document.querySelector(container.selector) as HTMLElement | null;
                if (element) element.scrollTop = container.scrollTop;
              }
              window.scrollTo({ left: origin.x, top: origin.y, behavior: "instant" });
            },
            { origin, containers: detected.map(({ scrollTop, ...item }) => ({ ...item, scrollTop })) },
          ),
          signal,
        );
        result.restored = true;
        for (const container of result.containers) container.restored = true;
        if (documentResult) documentResult.restored = true;
      } catch {
        result.restored = false;
      }
    }
    result.elapsedMs = Date.now() - start;
  }
  return result;
}
