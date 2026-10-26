#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { compareReports, configSchema, review } from "../dist/index.js";

// Only this generated local demo file is edited. The CLI never edits a target project.
const output = resolve("artifacts", `iteration-${Date.now()}`);
await mkdir(output, { recursive: true });
const source = join(output, "demo-page.html");
const html =
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Controlled repair demonstration</title><style>body{margin:0;font:16px/1.6 system-ui}main{padding:24px}.content{width:1700px;background:#dcebc4;padding:20px;box-sizing:border-box}button{font:inherit;padding:12px}button:focus-visible{outline:3px solid #763915}</style><main><h1>可复查的修复示例</h1><section class="content">故意固定宽度的内容</section><button type="button" id="save">保存</button><p id="status" role="status">待保存</p></main><script>document.getElementById("save").onclick=()=>{};</script></html>';
await writeFile(source, html, "utf8");
await writeFile(join(output, "before-source.html"), html, "utf8");
const server = createServer(async (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(await readFile(source));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
try {
  const address = server.address();
  const config = configSchema.parse({
    url: `http://127.0.0.1:${address.port}`,
    output,
    project: "受控修复回归示例",
    timeoutMs: 600,
    waitMs: 50,
    interactions: [
      {
        name: "save",
        steps: [
          { action: "click", target: { role: "button", name: "保存" } },
          { action: "expectText", target: { css: "#status" }, text: "保存成功" },
        ],
      },
    ],
  });
  const before = await review(config);
  const fixed = html
    .replace("width:1700px", "width:100%;max-width:100%")
    .replace("onclick=()=>{}", 'onclick=()=>{document.getElementById("status").textContent="保存成功"}');
  await writeFile(source, fixed, "utf8");
  await writeFile(join(output, "after-source.html"), fixed, "utf8");
  const after = await review(config);
  const comparison = compareReports(before.report, after.report, 1);
  await writeFile(join(output, "comparison.json"), `${JSON.stringify(comparison, null, 2)}\n`);
  assert.equal(comparison.fixed.length, 6);
  assert.equal(comparison.added.length, 0);
  assert.equal(comparison.regressions.length, 0);
  assert.equal(comparison.stopReason, "automated-gates-clear");
  const result = {
    output,
    before: before.directory,
    after: after.directory,
    comparison: join(output, "comparison.json"),
    fixed: comparison.fixed.length,
    remaining: comparison.remaining.length,
    added: comparison.added.length,
    stopReason: comparison.stopReason,
    note: "这是演示脚本对自己生成页面的两处预定修改，不是自主代码修复功能。",
  };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
