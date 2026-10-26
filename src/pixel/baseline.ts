import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { BrowserEngine, ReviewConfig, Viewport } from "../config.js";
import type { Screenshot } from "../reports/types.js";
import { redactUrl, safeSlug, within } from "../utils/safety.js";
import { VERSION } from "../version.js";
export interface PixelComparison {
  width: number;
  height: number;
  baselineWidth: number;
  baselineHeight: number;
  currentWidth: number;
  currentHeight: number;
  dimensionMismatch: boolean;
  diffPixels: number;
  diffPixelRatio: number;
  totalPixels: number;
  diffBuffer?: Buffer;
}
export interface PixelBaselineEvaluation {
  status: "pass" | "fail" | "unknown";
  summary: string;
  evidence: Record<string, unknown>;
  diff?: Screenshot;
}
interface BaselineEntry {
  key: string;
  file: string;
  browser: BrowserEngine;
  viewport: { name: string; width: number; height: number; touch: boolean };
  url: string;
  width: number;
  height: number;
  capturedAt: string;
  toolVersion: string;
  browserVersion: string;
  maskSelectors: string[];
}
interface BaselineManifest {
  schemaVersion: "1.0";
  entries: Record<string, BaselineEntry>;
}
export interface PixelBaselineInput {
  config: ReviewConfig;
  viewport: Viewport;
  screenshot: Screenshot;
  runDirectory: string;
  runId: string;
  browserVersion: string;
}
export function baselineKey(config: ReviewConfig, viewport: Viewport): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema: "pixel-baseline-v1",
        browser: config.browser,
        url: config.url,
        viewport: {
          name: viewport.name,
          width: viewport.width,
          height: viewport.height,
          touch: viewport.touch,
        },
        screenshot: {
          fullPage: config.fullPage,
          maxScreenshotHeight: config.maxScreenshotHeight,
          masks: config.pixelBaseline.masks.map((mask) => mask.selector).sort(),
        },
        phase: "baseline",
      }),
    )
    .digest("hex");
}
export function comparePngBuffers(
  baseline: Buffer,
  current: Buffer,
  options: Pick<ReviewConfig["pixelBaseline"], "threshold" | "includeAA"> & { maxPixels?: number },
): PixelComparison {
  const maxPixels = options.maxPixels ?? 20000000;
  for (const [label, buffer] of [
    ["baseline", baseline],
    ["current", current],
  ] as const) {
    if (buffer.length < 24) throw new Error(`${label} PNG 文件过短`);
    const width = buffer.readUInt32BE(16),
      height = buffer.readUInt32BE(20);
    if (!width || !height) throw new Error(`${label} PNG 尺寸无效`);
    if (width * height > maxPixels)
      throw new Error(`${label} PNG 超过 maxPixels 预算：${width * height} > ${maxPixels}`);
  }
  const before = PNG.sync.read(baseline),
    after = PNG.sync.read(current);
  const baselineWidth = before.width,
    baselineHeight = before.height,
    currentWidth = after.width,
    currentHeight = after.height;
  if (baselineWidth !== currentWidth || baselineHeight !== currentHeight) {
    return {
      width: currentWidth,
      height: currentHeight,
      baselineWidth,
      baselineHeight,
      currentWidth,
      currentHeight,
      dimensionMismatch: true,
      diffPixels: 0,
      diffPixelRatio: 0,
      totalPixels: currentWidth * currentHeight,
    };
  }
  const width = currentWidth,
    height = currentHeight,
    diff = new PNG({ width, height });
  const diffPixels = pixelmatch(before.data, after.data, diff.data, width, height, {
    threshold: options.threshold,
    includeAA: options.includeAA,
    alpha: 0.25,
    aaColor: [255, 210, 0],
    diffColor: [232, 72, 28],
    diffColorAlt: [30, 105, 190],
  });
  const totalPixels = width * height;
  return {
    width,
    height,
    baselineWidth,
    baselineHeight,
    currentWidth,
    currentHeight,
    dimensionMismatch: false,
    diffPixels,
    diffPixelRatio: totalPixels ? diffPixels / totalPixels : 0,
    totalPixels,
    diffBuffer: PNG.sync.write(diff),
  };
}
export async function evaluatePixelBaseline(input: PixelBaselineInput): Promise<PixelBaselineEvaluation> {
  const { config, viewport, screenshot, runDirectory, runId, browserVersion } = input;
  const baselineDirectory = resolve(config.pixelBaseline.directory);
  const key = baselineKey(config, viewport);
  const file = `${safeSlug(`${config.browser}-${viewport.name}`)}-${key.slice(0, 16)}.png`;
  const common = {
    baselineKey: key,
    baselineFile: file,
    baselineDirectory: config.pixelBaseline.directory,
    browser: config.browser,
    browserVersion,
    viewport: viewport.name,
    masks: config.pixelBaseline.masks,
    mode: config.pixelBaseline.mode,
  };
  if (screenshot.kind === "diff") {
    return { status: "unknown", summary: "像素基线检查收到非浏览器截图", evidence: common };
  }
  if (screenshot.truncated)
    return {
      status: "unknown",
      summary: "截图已降级为首屏，不能确认整页像素一致性",
      evidence: { ...common, screenshot: screenshot.path, truncated: true },
    };
  if (screenshot.maskMissing?.length)
    return {
      status: "unknown",
      summary: "部分动态区域遮罩未匹配元素，像素比较证据不完整",
      evidence: { ...common, screenshot: screenshot.path, maskMissing: screenshot.maskMissing },
    };
  if (screenshot.width * screenshot.height > config.pixelBaseline.maxPixels)
    return {
      status: "unknown",
      summary: "截图像素数超过像素基线预算，未执行比较或更新",
      evidence: {
        ...common,
        screenshot: screenshot.path,
        width: screenshot.width,
        height: screenshot.height,
        pixels: screenshot.width * screenshot.height,
        maxPixels: config.pixelBaseline.maxPixels,
      },
    };
  const currentFile = within(runDirectory, screenshot.path);
  if (config.pixelBaseline.mode === "update") {
    await mkdir(baselineDirectory, { recursive: true });
    const manifestPath = within(baselineDirectory, "manifest.json");
    const manifest = await readManifest(manifestPath);
    const baselineFile = within(baselineDirectory, file);
    await copyFile(currentFile, baselineFile);
    manifest.entries[key] = {
      key,
      file,
      browser: config.browser,
      viewport: {
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
        touch: viewport.touch,
      },
      url: redactUrl(config.url),
      width: screenshot.width,
      height: screenshot.height,
      capturedAt: new Date().toISOString(),
      toolVersion: VERSION,
      browserVersion,
      maskSelectors: screenshot.maskSelectors ?? [],
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return {
      status: "unknown",
      summary: "像素基线已更新；本轮没有进行回归比较",
      evidence: {
        ...common,
        screenshot: screenshot.path,
        width: screenshot.width,
        height: screenshot.height,
      },
    };
  }
  const manifestPath = within(baselineDirectory, "manifest.json");
  let manifest: BaselineManifest;
  try {
    manifest = await readManifest(manifestPath);
  } catch {
    return {
      status: "unknown",
      summary: "尚未建立像素基线",
      evidence: { ...common, screenshot: screenshot.path, baselineMissing: true },
    };
  }
  const entry = manifest.entries[key];
  if (!entry)
    return {
      status: "unknown",
      summary: "当前浏览器、URL 或视口尚无像素基线",
      evidence: { ...common, screenshot: screenshot.path, baselineMissing: true },
    };
  if (entry.browserVersion !== browserVersion)
    return {
      status: "unknown",
      summary: "浏览器版本已变化，旧基线可能不再适用",
      evidence: {
        ...common,
        screenshot: screenshot.path,
        baselineBrowserVersion: entry.browserVersion,
        browserVersion,
      },
    };
  let baselineBuffer: Buffer;
  try {
    baselineBuffer = await readFile(within(baselineDirectory, entry.file));
  } catch {
    return {
      status: "unknown",
      summary: "基线清单存在但图片文件缺失",
      evidence: { ...common, screenshot: screenshot.path, baselineMissing: true },
    };
  }
  const currentBuffer = await readFile(currentFile);
  const comparison = comparePngBuffers(baselineBuffer, currentBuffer, config.pixelBaseline);
  const evidence = {
    ...common,
    screenshot: screenshot.path,
    baselineCapturedAt: entry.capturedAt,
    baselineDimensions: { width: comparison.baselineWidth, height: comparison.baselineHeight },
    currentDimensions: { width: comparison.currentWidth, height: comparison.currentHeight },
    diffPixels: comparison.diffPixels,
    totalPixels: comparison.totalPixels,
    diffPixelRatio: comparison.diffPixelRatio,
    maxDiffPixelRatio: config.pixelBaseline.maxDiffPixelRatio,
    threshold: config.pixelBaseline.threshold,
    includeAA: config.pixelBaseline.includeAA,
  };
  if (comparison.dimensionMismatch)
    return {
      status: "unknown",
      summary: "基线与当前截图尺寸不同，无法计算可靠像素差",
      evidence: { ...evidence, dimensionMismatch: true },
    };
  let diff: Screenshot | undefined;
  if (comparison.diffBuffer && comparison.diffPixels > 0) {
    const diffPath =
      "screenshots/" +
      safeSlug(`pixel-diff-${viewport.name}`).slice(0, 55) +
      "-" +
      key.slice(0, 8) +
      "-" +
      runId +
      ".png";
    await mkdir(within(runDirectory, "screenshots"), { recursive: true });
    await writeFile(within(runDirectory, diffPath), comparison.diffBuffer);
    diff = {
      viewport: viewport.name,
      path: diffPath,
      width: comparison.width,
      height: comparison.height,
      phase: "pixel-diff",
      capturedAt: new Date().toISOString(),
      truncated: false,
      scope: screenshot.scope ?? "page",
      kind: "diff",
      ...(screenshot.maskSelectors ? { maskSelectors: screenshot.maskSelectors } : {}),
    };
    evidence.screenshot = screenshot.path;
    Object.assign(evidence, { diffFile: diffPath });
  }
  const pass = comparison.diffPixelRatio <= config.pixelBaseline.maxDiffPixelRatio;
  return {
    status: pass ? "pass" : "fail",
    summary: pass ? "像素差异在配置阈值内" : "像素差异超过配置阈值，需要人工确认是否为真实回归",
    evidence: { ...evidence, withinThreshold: pass },
    ...(diff ? { diff } : {}),
  };
}
async function readManifest(path: string): Promise<BaselineManifest> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as BaselineManifest;
    if (parsed.schemaVersion !== "1.0" || !parsed.entries || typeof parsed.entries !== "object")
      throw new Error("像素基线清单格式无效");
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return { schemaVersion: "1.0", entries: {} };
    throw error;
  }
}
