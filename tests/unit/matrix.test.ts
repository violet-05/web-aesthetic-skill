import assert from "node:assert/strict";
import { test } from "node:test";
import { type BrowserEngine, parseBrowsers } from "../../src/config.js";
import {
  type MatrixCheck,
  type MatrixRun,
  notRunMatrixRun,
  renderMatrixHtml,
  summarizeMatrixRuns,
} from "../../src/reports/matrix.js";
import type { Priority, Status } from "../../src/reports/types.js";

const identity = {
  toolVersion: "0.5.0",
  runId: "matrix-test",
  project: "Matrix fixture",
  targetUrl: "http://127.0.0.1:4173/good",
  startedAt: "2026-10-26T00:00:00.000Z",
  finishedAt: "2026-10-26T00:00:01.000Z",
};
const summary = {
  executed: 10,
  total: 12,
  passed: 8,
  failed: 2,
  unknown: 2,
  skipped: 0,
  errors: 0,
  coverage: 83,
  byPriority: { P0: 0, P1: 1, P2: 0, P3: 0 },
  aestheticScore: null as null,
};
function run(
  engine: BrowserEngine,
  checks: Array<{ id: string; status: Status }>,
  issuePriority?: Priority,
): MatrixRun {
  return {
    engine,
    browser: engine,
    version: "test",
    directory: engine,
    reportPath: `${engine}/report.html`,
    jsonPath: `${engine}/report.json`,
    status: issuePriority ? "attention" : "incomplete",
    execution: "completed",
    summary: {
      ...summary,
      failed: issuePriority ? 1 : 0,
      unknown: checks.filter((check) => check.status === "unknown").length,
    },
    checks: checks.map(
      (check): MatrixCheck => ({
        id: check.id,
        viewport: "mobile",
        dimension: "layout",
        status: check.status,
        summary: check.id,
      }),
    ),
    issues: issuePriority
      ? [
          {
            fingerprint: `${engine}-issue`,
            ruleId: "layout.rule-b",
            viewport: "mobile",
            priority: issuePriority,
            title: "Divergent issue",
            method: "measured",
          },
        ]
      : [],
  };
}
test("browser list parser is strict and deterministic", () => {
  assert.deepEqual(parseBrowsers("chromium, firefox,webkit"), ["chromium", "firefox", "webkit"]);
  for (const value of ["", "safari", "chromium,chromium", "chromium,,firefox"])
    assert.throws(() => parseBrowsers(value));
});
test("matrix aggregation identifies status, failure and missing-check divergences", () => {
  const report = summarizeMatrixRuns(
    ["chromium", "firefox", "webkit"],
    [
      run(
        "chromium",
        [
          { id: "layout.rule-a", status: "pass" },
          { id: "layout.rule-b", status: "fail" },
          { id: "layout.rule-c", status: "unknown" },
        ],
        "P1",
      ),
      run("firefox", [
        { id: "layout.rule-a", status: "pass" },
        { id: "layout.rule-b", status: "pass" },
        { id: "layout.rule-c", status: "pass" },
      ]),
      run("webkit", [
        { id: "layout.rule-a", status: "pass" },
        { id: "layout.rule-b", status: "pass" },
      ]),
    ],
    { status: "completed", timeoutMs: 360000, elapsedMs: 100 },
    identity,
  );
  assert.equal(report.schemaVersion, "1.1");
  assert.equal(report.summary.divergentChecks, 2);
  assert.equal(report.summary.failingDivergences, 1);
  assert.equal(report.summary.missingOnAny, 1);
  assert.equal(report.summary.passAcrossAll, 1);
  assert.equal(report.status, "attention");
  assert.equal(
    report.divergences.find((item) => item.id === "layout.rule-b")?.classification,
    "failure-divergence",
  );
  assert.equal(
    report.divergences.find((item) => item.id === "layout.rule-c")?.classification,
    "missing-check",
  );
});
test("partial matrix never reports a pass and HTML escapes project text", () => {
  const report = summarizeMatrixRuns(
    ["chromium", "firefox"],
    [
      run("chromium", [{ id: "layout.rule-a", status: "pass" }]),
      notRunMatrixRun("firefox", "Firefox unavailable"),
    ],
    { status: "partial", timeoutMs: 240000, elapsedMs: 100 },
    { ...identity, project: "<script>alert(1)</script>" },
  );
  assert.equal(report.status, "incomplete");
  assert.equal(report.summary.enginesCompleted, 1);
  assert.equal(report.summary.enginesNotRun, 1);
  assert.equal(report.summary.divergentChecks, 0);
  assert.ok(report.runs[0]);
  report.runs[0].reportPath = "javascript:alert(1)";
  const html = renderMatrixHtml(report);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("javascript:alert(1)"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});
test("a check missing on one engine keeps an otherwise passing matrix incomplete", () => {
  const report = summarizeMatrixRuns(
    ["chromium", "firefox"],
    [
      run("chromium", [
        { id: "layout.rule-a", status: "pass" },
        { id: "layout.rule-b", status: "pass" },
      ]),
      run("firefox", [{ id: "layout.rule-a", status: "pass" }]),
    ],
    { status: "completed", timeoutMs: 240000, elapsedMs: 100 },
    identity,
  );
  assert.equal(report.summary.failingDivergences, 0);
  assert.equal(report.summary.missingOnAny, 1);
  assert.equal(report.status, "incomplete");
});
