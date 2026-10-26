import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { configSchema } from "../../src/config.js";
import { reviewMatrix } from "../../src/matrix.js";
import { startFixtureServer } from "../fixtures/server.js";

const base = {
  waitMs: 50,
  timeoutMs: 10000,
  viewports: [{ name: "mobile", width: 390, height: 844 }],
};
async function output() {
  return mkdtemp(join(tmpdir(), "aesthetic-matrix-"));
}
test("real three-engine matrix writes independent reports, aggregate JSON and static HTML", {
  timeout: 60000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const { report, directory } = await reviewMatrix(
      configSchema.parse({
        ...base,
        url: `${server.url}/good`,
        output: await output(),
        project: "Matrix acceptance",
      }),
      ["chromium", "firefox", "webkit"],
      { timeoutMs: 60000 },
    );
    assert.equal(report.execution.status, "completed");
    assert.equal(report.summary.enginesRequested, 3);
    assert.equal(report.summary.enginesCompleted, 3);
    assert.equal(report.summary.enginesPartial, 0);
    assert.equal(report.summary.enginesNotRun, 0);
    assert.equal(report.summary.failingDivergences, 0);
    assert.ok(report.summary.checksCompared > 0);
    assert.ok(report.summary.passAcrossAll > 0);
    assert.ok(report.summary.unknownOnAny > 0);
    assert.equal(report.status, "incomplete");
    assert.deepEqual(
      report.runs.map((run) => run.engine),
      ["chromium", "firefox", "webkit"],
    );
    for (const run of report.runs) {
      assert.equal(run.execution, "completed");
      assert.notEqual(run.version, "not-started");
      await access(join(directory, run.reportPath));
      await access(join(directory, run.jsonPath));
    }
    const aggregate = JSON.parse(await readFile(join(directory, "matrix.json"), "utf8"));
    assert.equal(aggregate.schemaVersion, "1.1");
    const html = await readFile(join(directory, "report.html"), "utf8");
    assert.ok(html.includes("状态差异"));
    assert.ok(html.includes("独立报告"));
    assert.ok(!html.includes("<script"));
  } finally {
    await server.close();
  }
});
test("matrix timeout stops the current engine and marks remaining engines not run", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const { report, directory } = await reviewMatrix(
      configSchema.parse({
        ...base,
        url: `${server.url}/cases/hung-renderer`,
        output: await output(),
      }),
      ["chromium", "firefox"],
      { timeoutMs: 1200 },
    );
    assert.equal(report.execution.status, "timed-out");
    assert.equal(report.summary.enginesPartial, 1);
    assert.equal(report.summary.enginesNotRun, 1);
    assert.equal(report.runs[0]?.execution, "timed-out");
    assert.equal(report.runs[1]?.execution, "not-run");
    assert.equal(report.status, "incomplete");
    assert.equal(
      JSON.parse(await readFile(join(directory, "matrix.json"), "utf8")).execution.status,
      "timed-out",
    );
  } finally {
    await server.close();
  }
});
test("pre-aborted matrix launches no engine and still writes a cancelled aggregate", {
  timeout: 10000,
}, async () => {
  const controller = new AbortController();
  controller.abort();
  const { report, directory } = await reviewMatrix(
    configSchema.parse({
      ...base,
      url: "http://127.0.0.1:3000",
      output: await output(),
    }),
    ["chromium", "firefox"],
    { signal: controller.signal, timeoutMs: 10000 },
  );
  assert.equal(report.execution.status, "cancelled");
  assert.equal(report.summary.enginesNotRun, 2);
  assert.deepEqual(
    report.runs.map((run) => run.execution),
    ["not-run", "not-run"],
  );
  assert.equal(report.status, "incomplete");
  assert.equal(
    JSON.parse(await readFile(join(directory, "matrix.json"), "utf8")).execution.status,
    "cancelled",
  );
});
test("matrix CLI runs a real engine and prints aggregate and per-engine paths", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const out = await output();
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolveResult) => {
        execFile(
          process.execPath,
          [
            "--import",
            "tsx",
            resolve("src/cli.ts"),
            "matrix",
            "--url",
            `${server.url}/good`,
            "--browsers",
            "chromium",
            "--output",
            out,
            "--viewports",
            "390x844",
            "--matrix-timeout-ms",
            "30000",
          ],
          { encoding: "utf8", timeout: 25000, windowsHide: true },
          (error, stdout, stderr) =>
            resolveResult({ code: error && "code" in error ? Number(error.code) : 0, stdout, stderr }),
        );
      },
    );
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const cli = JSON.parse(result.stdout);
    assert.equal(cli.execution.status, "completed");
    assert.equal(cli.summary.enginesCompleted, 1);
    assert.equal(cli.engines[0].engine, "chromium");
    await access(cli.report);
    await access(cli.json);
    await access(cli.engines[0].report);
  } finally {
    await server.close();
  }
});
