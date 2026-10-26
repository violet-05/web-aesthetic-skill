import type { Page } from "playwright";
import type { ReviewConfig } from "../config.js";
import { abortable, pause, throwIfAborted } from "../utils/cancellation.js";
export interface LazyLoadResult {
  stopReason: "bottom-stable" | "max-scrolls" | "time-budget" | "sample-limit";
  complete: boolean;
  scrolls: number;
  elapsedMs: number;
  restored: boolean;
  samples: Array<{
    y: number;
    documentHeight: number;
    viewportHeight: number;
    images: number;
    pending: number;
  }>;
}
/** Document scrolling only; does not click, alter img loading attributes or enter frames. */
export async function prepareLazyImages(
  page: Page,
  config: ReviewConfig["lazyLoad"],
  signal?: AbortSignal,
): Promise<LazyLoadResult> {
  const start = Date.now();
  const local = new AbortController();
  const timer = setTimeout(() => local.abort(new Error("懒加载预处理时间预算已到")), config.maxDurationMs);
  const workSignal = signal ? AbortSignal.any([signal, local.signal]) : local.signal;
  let origin = { x: 0, y: 0 };
  const result: LazyLoadResult = {
    stopReason: "time-budget",
    complete: false,
    scrolls: 0,
    elapsedMs: 0,
    restored: false,
    samples: [],
  };
  let atBottomLast = false;
  let previousHeight = -1;
  try {
    origin = await abortable(
      page.evaluate(() => ({ x: scrollX, y: scrollY })),
      workSignal,
    );
    throwIfAborted(workSignal);
    await abortable(
      page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: "instant" })),
      workSignal,
    );
    while (Date.now() - start < config.maxDurationMs) {
      await pause(
        Math.min(config.waitMs, Math.max(1, config.maxDurationMs - (Date.now() - start))),
        workSignal,
      );
      const sample = await abortable(
        page.evaluate(() => ({
          y: scrollY,
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: innerHeight,
          images: document.images.length,
          pending: Array.from(document.images)
            .slice(0, 200)
            .filter((img) => !img.complete || (!img.currentSrc && !img.getAttribute("src"))).length,
        })),
        workSignal,
      );
      result.samples.push(sample);
      const bottom = sample.y + sample.viewportHeight >= sample.documentHeight - 2;
      if (bottom && atBottomLast && sample.documentHeight === previousHeight && sample.pending === 0) {
        result.stopReason = sample.images > 200 ? "sample-limit" : "bottom-stable";
        result.complete = sample.images <= 200;
        break;
      }
      atBottomLast = bottom;
      previousHeight = sample.documentHeight;
      if (Date.now() - start >= config.maxDurationMs) break;
      if (!bottom) {
        if (result.scrolls >= config.maxScrolls) {
          result.stopReason = "max-scrolls";
          break;
        }
        throwIfAborted(workSignal);
        await abortable(
          page.evaluate(() =>
            window.scrollBy({
              left: 0,
              top: Math.max(1, Math.floor(innerHeight * 0.8)),
              behavior: "instant",
            }),
          ),
          workSignal,
        );
        result.scrolls++;
      }
    }
  } catch (error) {
    throwIfAborted(signal);
    if (!local.signal.aborted) throw error;
    result.stopReason = "time-budget";
  } finally {
    clearTimeout(timer);
    if (!signal?.aborted) {
      await abortable(
        page.evaluate((pos) => window.scrollTo({ left: pos.x, top: pos.y, behavior: "instant" }), origin),
        signal,
      );
      result.restored = true;
    }
    result.elapsedMs = Date.now() - start;
  }
  return result;
}
