import { createHash } from "node:crypto";
import type { ReviewConfig } from "../config.js";
export function verificationProfile(config: ReviewConfig): string {
  const {
    url,
    viewports,
    reviewTimeoutMs,
    lazyLoad,
    stepScreenshots,
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
        engine: "0.2",
        reviewTimeoutMs,
        lazyLoad,
        stepScreenshots,
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
