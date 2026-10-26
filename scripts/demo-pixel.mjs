#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { configSchema, review, VERSION } from "../dist/index.js";
import { startFixtureServer } from "../tests/fixtures/server.ts";

const root = resolve("artifacts", `pixel-demo-${Date.now()}`);
await mkdir(root, { recursive: true });
const server = await startFixtureServer();
const results = {};
async function run(name, pixelBaseline) {
  const result = await review(
    configSchema.parse({
      url: `${server.url}/cases/pixel-dynamic`,
      project: "AestheticFlow pixel baseline demo",
      output: join(root, name),
      viewports: [{ name: "mobile", width: 390, height: 844 }],
      waitMs: 80,
      timeoutMs: 10000,
      pixelBaseline,
    }),
  );
  results[name] = {
    directory: result.directory,
    report: join(result.directory, "report.html"),
    json: join(result.directory, "report.json"),
    check: result.report.checks.find((check) => check.id === "pixel.baseline"),
    diff: result.report.screenshots.find((screenshot) => screenshot.kind === "diff"),
  };
  return result;
}
try {
  const maskedDirectory = join(root, "baselines-masked");
  const masked = [{ selector: "#dynamic-box", reason: "random color fixture" }];
  await run("update-masked", { enabled: true, mode: "update", directory: maskedDirectory, masks: masked });
  const pass = await run("compare-masked", { enabled: true, directory: maskedDirectory, masks: masked });
  assert.equal(pass.report.checks.find((check) => check.id === "pixel.baseline")?.status, "pass");

  const unmaskedDirectory = join(root, "baselines-unmasked");
  await run("update-unmasked", { enabled: true, mode: "update", directory: unmaskedDirectory });
  const fail = await run("compare-unmasked", { enabled: true, directory: unmaskedDirectory });
  assert.equal(fail.report.checks.find((check) => check.id === "pixel.baseline")?.status, "fail");

  const manifest = {
    version: VERSION,
    output: root,
    generatedAt: new Date().toISOString(),
    results,
    note: "unmasked diff is intentional fixture volatility, not an aesthetic score or proof of visual decline.",
  };
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const links = Object.entries(results)
    .map(
      ([name, result]) =>
        `<li><a href="${relative(root, result.report).replaceAll("\\", "/")}">${name}</a> · pixel.baseline: ${result.check?.status ?? "missing"}</li>`,
    )
    .join("");
  await writeFile(
    join(root, "index.html"),
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AestheticFlow 0.5 pixel demo</title><style>body{max-width:960px;margin:48px auto;padding:0 24px;background:#f5f4ef;color:#1c2926;font:16px/1.7 system-ui}h1{font-size:40px}li{margin:16px 0}a{color:#26583f}</style><main><small>AESTHETICFLOW / EVIDENCE FIRST</small><h1>0.5 / pixel baseline</h1><p>遮罩动态区域后通过；未遮罩时产生真实像素差异与 diff 图。像素差不是审美评分。</p><ul>${links}</ul><p><a href="manifest.json">manifest.json</a></p></main></html>`,
    "utf8",
  );
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await server.close();
}
