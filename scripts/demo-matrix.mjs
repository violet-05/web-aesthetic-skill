#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { configSchema, reviewMatrix, VERSION } from "../dist/index.js";
import { startFixtureServer } from "../tests/fixtures/server.ts";

const output = resolve("artifacts", `matrix-demo-${Date.now()}`);
await mkdir(output, { recursive: true });
const server = await startFixtureServer();
try {
  const { report, directory } = await reviewMatrix(
    configSchema.parse({
      url: `${server.url}/good`,
      project: "AestheticFlow matrix demo",
      output,
      viewports: [{ name: "mobile", width: 390, height: 844 }],
      waitMs: 100,
      timeoutMs: 10000,
    }),
    ["chromium", "firefox", "webkit"],
    { timeoutMs: 60000 },
  );
  assert.equal(report.execution.status, "completed");
  assert.equal(report.summary.enginesCompleted, 3);
  console.log(
    JSON.stringify(
      {
        version: VERSION,
        status: report.status,
        execution: report.execution,
        summary: report.summary,
        report: join(directory, "report.html"),
        json: join(directory, "matrix.json"),
        engines: report.runs.map((run) => ({
          engine: run.engine,
          execution: run.execution,
          report: join(directory, run.reportPath),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
