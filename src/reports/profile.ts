import { createHash } from "node:crypto";
import type { ReviewConfig } from "../config.js";
export function verificationProfile(config: ReviewConfig): string {
  const {
    url,
    browser,
    viewports,
    reviewTimeoutMs,
    lazyLoad,
    stepScreenshots,
    pixelBaseline,
    timeoutMs,
    waitMs,
    waitFor,
    fullPage,
    maxScreenshotHeight,
    requiredElements,
    interactions,
    allowOrigins,
    allowPrivateNetwork,
  } = config;
  return createHash("sha256")
    .update(
      JSON.stringify({
        engine: "0.5",
        browser,
        reviewTimeoutMs,
        lazyLoad,
        stepScreenshots,
        pixelBaseline,
        url,
        viewports,
        timeoutMs,
        waitMs,
        waitFor,
        fullPage,
        maxScreenshotHeight,
        requiredElements,
        interactions,
        allowOrigins,
        allowPrivateNetwork,
      }),
    )
    .digest("hex");
}
