#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { configSchema, review, VERSION } from "../dist/index.js";
import { startFixtureServer } from "../tests/fixtures/server.ts";

const output = resolve("artifacts", `followup-${Date.now()}`);
await mkdir(output, { recursive: true });
const server = await startFixtureServer();
const results = {};
async function run(name, input) {
  const result = await review(
    configSchema.parse({
      ...input,
      url: input.url.replace("http://127.0.0.1:4173", server.url),
      output: join(output, name),
    }),
  );
  results[name] = {
    directory: result.directory,
    html: join(result.directory, "report.html"),
    json: join(result.directory, "report.json"),
    summary: result.report.summary,
    execution: result.report.execution,
    screenshots: result.report.screenshots.length,
  };
  return result;
}
try {
  const advanced = JSON.parse(await readFile("templates/advanced-review.json", "utf8"));
  const normal = await run("advanced", advanced);
  assert.equal(normal.report.summary.failed, 0);
  assert.equal(normal.report.summary.errors, 0);
  assert.ok(normal.report.screenshots.some((s) => s.scenario === "dialog" && s.stepIndex === 1));
  const lazy = JSON.parse(await readFile("templates/lazy-review.json", "utf8"));
  const before = await run("lazy-off", { ...lazy, lazyLoad: { enabled: false } });
  assert.equal(before.report.checks.find((c) => c.id === "images.loaded")?.status, "unknown");
  const after = await run("lazy-on", lazy);
  assert.equal(after.report.checks.find((c) => c.id === "images.loaded")?.status, "pass");
  const limited = await run("lazy-limited", { ...lazy, lazyLoad: { enabled: true, maxScrolls: 1 } });
  assert.equal(limited.report.checks.find((c) => c.id === "images.lazy-load")?.status, "unknown");
  const timeout = await run("timeout", {
    url: `${server.url}/cases/hung-renderer`,
    project: "总时限安全退出",
    viewports: [{ name: "mobile", width: 390, height: 844 }],
    timeoutMs: 10000,
    reviewTimeoutMs: 1200,
    failOn: "none",
  });
  assert.equal(timeout.report.execution.status, "timed-out");
  assert.equal(timeout.report.screenshots.length, 0);
  const manifest = {
    version: VERSION,
    output,
    generatedAt: new Date().toISOString(),
    results,
    note: "lazy-off/on 使用不同检查配置，只演示检查能力，不是修复对比。timeout 是故意挂起页面的预期检出，不是测试失败。",
  };
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const links = Object.entries(results)
    .map(
      ([name, result]) =>
        `<li><a href="${relative(output, result.html).replaceAll("\\", "/")}">${name}</a> · ${result.screenshots} 张截图 · ${result.summary.passed} 通过 / ${result.summary.failed} 失败 / ${result.summary.unknown} 未知 · ${result.execution.status}</li>`,
    )
    .join("");
  await writeFile(
    join(output, "index.html"),
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AestheticFlow 0.2 验收索引</title><style>body{margin:40px auto;padding:0 24px;max-width:1000px;background:#f5f4ef;color:#1c2926;font:16px/1.8 system-ui}h1{font-size:36px}a{color:#234d3b;text-underline-offset:4px}li{margin:22px 0;overflow-wrap:anywhere}a:focus-visible{outline:3px solid #547126}small{color:#596862}</style><main><small>AESTHETICFLOW / EVIDENCE FIRST</small><h1>0.2 / 后续工作验收</h1><p>真实浏览器过程截图、有界懒加载与总时限。</p><ul>${links}</ul><p>${manifest.note}</p><p>视觉审美仍未自动评分，未知不计为通过。</p></main></html>`,
  );
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await server.close();
}
