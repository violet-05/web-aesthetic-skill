import { writeFile } from "node:fs/promises";
import { type BrowserEngine, browserListSchema, configSchema, type ReviewConfig } from "./config.js";
import {
  type MatrixExecutionStatus,
  type MatrixReport,
  type MatrixRun,
  matrixRunFromReport,
  notRunMatrixRun,
  renderMatrixHtml,
  summarizeMatrixRuns,
} from "./reports/matrix.js";
import { review } from "./reviewer.js";
import { createReviewDeadline, ReviewTimeoutError } from "./utils/cancellation.js";
import { createRunDirectory, message, redactUrl, within } from "./utils/safety.js";
import { VERSION } from "./version.js";
export interface MatrixOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export async function reviewMatrix(
  input: ReviewConfig,
  browsers: BrowserEngine[],
  options: MatrixOptions = {},
): Promise<{ report: MatrixReport; directory: string }> {
  const config = configSchema.parse(input);
  const engines = browserListSchema.parse(browsers);
  const timeoutMs = options.timeoutMs ?? Math.min(900000, config.reviewTimeoutMs * engines.length);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000)
    throw new Error("矩阵总时限必须是 1000–1800000 之间的整数毫秒");
  const { directory, runId } = await createRunDirectory(config.output, "matrix");
  const startedAt = new Date().toISOString();
  const deadline = createReviewDeadline(timeoutMs, options.signal);
  const runs: MatrixRun[] = [];
  for (const engine of engines) {
    if (deadline.signal.aborted) {
      runs.push(notRunMatrixRun(engine, message(deadline.signal.reason ?? "矩阵已停止")));
      continue;
    }
    const engineOutput = within(directory, engine);
    try {
      const result = await review(
        { ...config, browser: engine, output: engineOutput },
        { signal: deadline.signal },
      );
      runs.push(matrixRunFromReport(engine, result.report, result.directory, directory));
    } catch (error) {
      runs.push({
        ...notRunMatrixRun(engine, message(error)),
        status: "error",
        execution: "error",
      });
    }
  }
  const elapsedMs = deadline.elapsedMs();
  deadline.dispose();
  const executionStatus: MatrixExecutionStatus = deadline.signal.aborted
    ? deadline.signal.reason instanceof ReviewTimeoutError
      ? "timed-out"
      : "cancelled"
    : runs.some((run) => run.execution === "error")
      ? runs.every((run) => run.execution === "error")
        ? "error"
        : "partial"
      : runs.some((run) => run.execution !== "completed")
        ? "partial"
        : "completed";
  const finishedAt = new Date().toISOString();
  const report = summarizeMatrixRuns(
    engines,
    runs,
    { status: executionStatus, timeoutMs, elapsedMs },
    {
      toolVersion: VERSION,
      runId,
      project: config.project,
      targetUrl: redactUrl(config.url),
      startedAt,
      finishedAt,
    },
  );
  const json = (file: string, value: unknown) =>
    writeFile(within(directory, file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await Promise.all([
    json("matrix.json", report),
    writeFile(within(directory, "report.html"), renderMatrixHtml(report), "utf8"),
    json("metadata.json", {
      schemaVersion: report.schemaVersion,
      toolVersion: report.toolVersion,
      runId: report.runId,
      execution: report.execution,
      status: report.status,
      targetUrl: report.targetUrl,
      browsers: report.browsers,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      runs: report.runs.map((run) => ({
        engine: run.engine,
        browser: run.browser,
        version: run.version,
        status: run.status,
        execution: run.execution,
        reportPath: run.reportPath,
        jsonPath: run.jsonPath,
      })),
    }),
  ]);
  return { report, directory };
}
