import { writeFile } from "node:fs/promises";
import { within } from "../utils/safety.js";
import { renderHtml } from "./html-reporter.js";
import type { Report } from "./types.js";
export async function writeReport(report: Report, directory: string): Promise<void> {
  const json = (file: string, value: unknown) =>
    writeFile(within(directory, file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await Promise.all([
    json("report.json", report),
    writeFile(within(directory, "report.html"), renderHtml(report), "utf8"),
    json("metadata.json", {
      schemaVersion: report.schemaVersion,
      toolVersion: report.toolVersion,
      execution: report.execution,
      runId: report.runId,
      verificationProfile: report.verificationProfile,
      targetUrl: report.targetUrl,
      browser: report.browser,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      viewports: report.viewports,
      screenshots: report.screenshots,
    }),
    json("diagnostics/console-errors.json", report.diagnostics),
    json(
      "diagnostics/lazy-load-results.json",
      report.checks.filter((c) => c.id === "images.lazy-load"),
    ),
    json(
      "diagnostics/layout-findings.json",
      report.checks.filter((c) => c.dimension === "layout" || c.dimension === "responsive"),
    ),
    json(
      "diagnostics/interaction-results.json",
      report.checks.filter((c) => c.dimension === "interaction" || c.id.startsWith("a11y.focus.")),
    ),
  ]);
}
