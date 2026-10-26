import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { configSchema } from "../../src/config.js";
import { review } from "../../src/reviewer.js";
import { startFixtureServer } from "../fixtures/server.js";

const viewport = { name: "mobile", width: 390, height: 844 };
const base = { viewports: [viewport], waitMs: 80, timeoutMs: 10000 };
async function temp(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}
test("pixel baseline update then masked compare tolerates a changing dynamic region", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const pixelBaselineDir = await temp("aesthetic-pixels-");
    const common = {
      ...base,
      url: `${server.url}/cases/pixel-dynamic`,
      pixelBaseline: {
        enabled: true,
        directory: pixelBaselineDir,
        masks: [{ selector: "#dynamic-box", reason: "random color fixture" }],
        maxDiffPixelRatio: 0.005,
      },
    };
    const baseline = await review(
      configSchema.parse({
        ...common,
        pixelBaseline: { ...common.pixelBaseline, mode: "update" },
        output: await temp("aesthetic-pixel-update-"),
      }),
    );
    const update = baseline.report.checks.find((check) => check.id === "pixel.baseline");
    assert.equal(update?.status, "unknown");
    assert.match(update.summary, /基线已更新/);
    assert.equal(baseline.report.screenshots[0]?.maskSelectors?.[0], "#dynamic-box");
    const manifest = JSON.parse(await readFile(join(pixelBaselineDir, "manifest.json"), "utf8"));
    assert.equal(Object.keys(manifest.entries).length, 1);
    const entry = Object.values(manifest.entries)[0] as { file: string };
    await access(join(pixelBaselineDir, entry.file));

    const compared = await review(
      configSchema.parse({
        ...common,
        output: await temp("aesthetic-pixel-compare-"),
      }),
    );
    const pixel = compared.report.checks.find((check) => check.id === "pixel.baseline");
    assert.equal(pixel?.status, "pass");
    assert.equal(pixel.evidence.withinThreshold, true);
    assert.equal(
      compared.report.issues.some((issue) => issue.ruleId === "pixel.baseline"),
      false,
    );
    assert.equal(compared.report.summary.errors, 0);
  } finally {
    await server.close();
  }
});
test("unmasked dynamic content produces a measured diff, diff PNG and non-aesthetic P2 issue", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const pixelBaselineDir = await temp("aesthetic-pixels-unmasked-");
    const common = {
      ...base,
      url: `${server.url}/cases/pixel-dynamic`,
      pixelBaseline: {
        enabled: true,
        directory: pixelBaselineDir,
        maxDiffPixelRatio: 0.001,
      },
    };
    await review(
      configSchema.parse({
        ...common,
        pixelBaseline: { ...common.pixelBaseline, mode: "update" },
        output: await temp("aesthetic-pixel-unmasked-update-"),
      }),
    );
    const compared = await review(
      configSchema.parse({
        ...common,
        output: await temp("aesthetic-pixel-unmasked-compare-"),
      }),
    );
    const pixel = compared.report.checks.find((check) => check.id === "pixel.baseline");
    assert.equal(pixel?.status, "fail");
    assert.ok(Number(pixel.evidence.diffPixels) > 0);
    assert.ok(Number(pixel.evidence.diffPixelRatio) > 0.001);
    const issue = compared.report.issues.find((item) => item.ruleId === "pixel.baseline");
    assert.equal(issue?.priority, "P2");
    assert.match(issue?.suggestion ?? "", /不是审美下降证明/);
    const diff = compared.report.screenshots.find((shot) => shot.kind === "diff");
    assert.ok(diff);
    assert.equal(diff.phase, "pixel-diff");
    assert.equal(diff.width, 390);
    await access(join(compared.directory, diff.path));
    assert.equal(pixel.evidence.diffFile, diff.path);
    assert.ok((await readFile(join(compared.directory, "report.html"), "utf8")).includes("像素差异图"));
  } finally {
    await server.close();
  }
});
test("missing baseline and missing mask remain unknown instead of failing the site", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const missing = await review(
      configSchema.parse({
        ...base,
        url: `${server.url}/cases/pixel-dynamic`,
        output: await temp("aesthetic-pixel-missing-"),
        pixelBaseline: { enabled: true, directory: await temp("aesthetic-pixel-empty-") },
      }),
    );
    const pixel = missing.report.checks.find((check) => check.id === "pixel.baseline");
    assert.equal(pixel?.status, "unknown");
    assert.equal(pixel.evidence.baselineMissing, true);
    assert.equal(
      missing.report.issues.some((item) => item.ruleId === "pixel.baseline"),
      false,
    );

    const masked = await review(
      configSchema.parse({
        ...base,
        url: `${server.url}/cases/pixel-dynamic`,
        output: await temp("aesthetic-pixel-bad-mask-"),
        pixelBaseline: {
          enabled: true,
          mode: "update",
          directory: await temp("aesthetic-pixel-bad-mask-store-"),
          masks: [{ selector: "#not-present" }],
        },
      }),
    );
    const check = masked.report.checks.find((item) => item.id === "pixel.baseline");
    assert.equal(check?.status, "unknown");
    assert.deepEqual(check.evidence.maskMissing, ["#not-present"]);
    assert.equal(masked.report.checks.find((item) => item.id === "screenshot.baseline")?.status, "unknown");
  } finally {
    await server.close();
  }
});
test("CLI can update and compare a pixel baseline", { timeout: 30000 }, async () => {
  const server = await startFixtureServer();
  try {
    const pixelDir = await temp("aesthetic-pixel-cli-store-");
    const output = await temp("aesthetic-pixel-cli-");
    const run = (args: string[]) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult) => {
        execFile(
          process.execPath,
          ["--import", "tsx", resolve("src/cli.ts"), "review", ...args],
          { encoding: "utf8", timeout: 25000, windowsHide: true },
          (error, stdout, stderr) =>
            resolveResult({ code: error && "code" in error ? Number(error.code) : 0, stdout, stderr }),
        );
      });
    const common = [
      "--url",
      `${server.url}/good`,
      "--output",
      output,
      "--viewports",
      "390x844",
      "--pixel-baseline-dir",
      pixelDir,
      "--wait-ms",
      "80",
    ];
    const updated = await run([...common, "--update-pixel-baseline"]);
    assert.equal(updated.code, 0, updated.stderr || updated.stdout);
    assert.equal(JSON.parse(updated.stdout).status, "incomplete");
    const compared = await run([...common, "--pixel-baseline"]);
    assert.equal(compared.code, 0, compared.stderr || compared.stdout);
    const result = JSON.parse(compared.stdout);
    const json = JSON.parse(await readFile(result.json, "utf8"));
    assert.equal(json.checks.find((check: { id: string }) => check.id === "pixel.baseline")?.status, "pass");
  } finally {
    await server.close();
  }
});
