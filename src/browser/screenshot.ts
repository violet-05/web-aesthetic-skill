import { createHash } from "node:crypto";
import type { Page } from "playwright";
import type { ReviewConfig, Viewport } from "../config.js";
import type { Screenshot } from "../reports/types.js";
import { safeSlug, within } from "../utils/safety.js";
export async function capture(
  page: Page,
  config: ReviewConfig,
  viewport: Viewport,
  directory: string,
  runId: string,
  phase: string,
  state?: { scenario: string; stepIndex: number; action: string },
): Promise<Screenshot> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const truncated = !state && config.fullPage && height > config.maxScreenshotHeight;
  const fullPage = !state && config.fullPage && !truncated;
  const maskSelectors = config.pixelBaseline.enabled
    ? config.pixelBaseline.masks.map((mask) => mask.selector)
    : [];
  const maskLocators = maskSelectors.map((selector) => page.locator(selector));
  const maskMissing = (
    await Promise.all(
      maskSelectors.map(async (selector, index) =>
        ((await maskLocators[index]?.count()) ?? 0) === 0 ? selector : "",
      ),
    )
  ).filter(Boolean);
  const file =
    "screenshots/" +
    safeSlug(new URL(config.url).pathname) +
    "-" +
    viewport.name +
    "-" +
    viewport.width +
    "x" +
    viewport.height +
    "-" +
    safeSlug(phase).slice(0, 55) +
    "-" +
    createHash("sha256").update(phase).digest("hex").slice(0, 8) +
    "-" +
    runId +
    ".png";
  const png = await page.screenshot({
    path: within(directory, file),
    fullPage,
    ...(maskLocators.length ? { mask: maskLocators, maskColor: "#000000" } : {}),
    animations: state ? "allow" : "disabled",
    timeout: config.timeoutMs,
  });
  return {
    viewport: viewport.name,
    path: file,
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    phase,
    capturedAt: new Date().toISOString(),
    truncated,
    scope: fullPage ? "page" : "viewport",
    kind: "browser",
    ...(maskSelectors.length ? { maskSelectors, maskMissing } : {}),
    ...state,
  };
}
