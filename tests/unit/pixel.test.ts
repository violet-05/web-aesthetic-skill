import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { configSchema } from "../../src/config.js";
import { baselineKey, comparePngBuffers } from "../../src/pixel/baseline.js";

function image(color: [number, number, number], width = 10, height = 10): Buffer {
  const png = new PNG({ width, height });
  for (let index = 0; index < width * height; index++) {
    png.data[index * 4] = color[0];
    png.data[index * 4 + 1] = color[1];
    png.data[index * 4 + 2] = color[2];
    png.data[index * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}
test("pixel baseline defaults are opt-in, bounded and mask selectors are unique", () => {
  const config = configSchema.parse({ url: "http://127.0.0.1:3000" });
  assert.equal(config.pixelBaseline.enabled, false);
  assert.equal(config.pixelBaseline.mode, "compare");
  assert.equal(config.pixelBaseline.maxDiffPixelRatio, 0.005);
  assert.equal(config.pixelBaseline.maxPixels, 20000000);
  assert.deepEqual(config.pixelBaseline.masks, []);
  for (const pixelBaseline of [
    { mode: "always" },
    { threshold: 1.1 },
    { maxDiffPixelRatio: -0.1 },
    { maxPixels: 999 },
    { masks: [{ selector: ".clock" }, { selector: ".clock" }] },
    { typo: true },
  ])
    assert.throws(() => configSchema.parse({ url: "http://127.0.0.1:3000", pixelBaseline }));
});
test("baseline keys isolate browser, URL, viewport and touch context", () => {
  const base = configSchema.parse({
    url: "http://127.0.0.1:3000/good",
    browser: "chromium",
    viewports: [{ name: "mobile", width: 390, height: 844, touch: false }],
  });
  const originalViewport = base.viewports[0];
  assert.ok(originalViewport);
  const original = baselineKey(base, originalViewport);
  assert.equal(original, baselineKey(base, originalViewport));
  for (const changed of [
    { ...base, browser: "firefox" as const },
    { ...base, url: "http://127.0.0.1:3000/other" },
    { ...base, viewports: [{ name: "mobile", width: 391, height: 844, touch: false }] },
    { ...base, viewports: [{ name: "mobile", width: 390, height: 844, touch: true }] },
    { ...base, fullPage: false },
    {
      ...base,
      pixelBaseline: { ...base.pixelBaseline, masks: [{ selector: "#clock" }] },
    },
  ]) {
    const changedViewport = changed.viewports[0];
    assert.ok(changedViewport);
    assert.notEqual(original, baselineKey(changed, changedViewport));
  }
});
test("PNG comparison reports exact identical and changed images", () => {
  const red = image([255, 0, 0]),
    blue = image([0, 0, 255]);
  const identical = comparePngBuffers(red, red, { threshold: 0.1, includeAA: false });
  assert.equal(identical.dimensionMismatch, false);
  assert.equal(identical.diffPixels, 0);
  assert.equal(identical.diffPixelRatio, 0);
  assert.ok(identical.diffBuffer);
  const changed = comparePngBuffers(red, blue, { threshold: 0.1, includeAA: false });
  assert.equal(changed.dimensionMismatch, false);
  assert.equal(changed.diffPixels, 100);
  assert.equal(changed.diffPixelRatio, 1);
});
test("PNG dimension changes stay explicit instead of inventing a pixel ratio", () => {
  const comparison = comparePngBuffers(image([0, 0, 0]), image([0, 0, 0], 8, 8), {
    threshold: 0.1,
    includeAA: false,
  });
  assert.equal(comparison.dimensionMismatch, true);
  assert.equal(comparison.diffPixels, 0);
  assert.equal(comparison.diffBuffer, undefined);
  assert.deepEqual(
    [comparison.baselineWidth, comparison.baselineHeight, comparison.currentWidth, comparison.currentHeight],
    [10, 10, 8, 8],
  );
});
test("PNG decode is rejected before work when the pixel budget is exceeded", () => {
  assert.throws(
    () =>
      comparePngBuffers(image([0, 0, 0], 100, 100), image([0, 0, 0], 100, 100), {
        threshold: 0.1,
        includeAA: false,
        maxPixels: 1000,
      }),
    /maxPixels/,
  );
});
