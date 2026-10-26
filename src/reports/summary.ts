import { dimensions, type ReviewConfig } from "../config.js";
import type { Report } from "./types.js";
export function summarize(report: Report, config: ReviewConfig): void {
  const checks = report.checks;
  const count = (status: string) => checks.filter((c) => c.status === status).length;
  const executed = count("pass") + count("fail");
  report.summary = {
    executed,
    total: checks.length,
    passed: count("pass"),
    failed: count("fail"),
    unknown: count("unknown"),
    skipped: count("skipped"),
    errors: count("error"),
    coverage: checks.length ? Math.round((executed / checks.length) * 100) : 0,
    byPriority: { P0: 0, P1: 0, P2: 0, P3: 0 },
    aestheticScore: null,
  };
  for (const issue of report.issues) report.summary.byPriority[issue.priority]++;
  report.dimensions = dimensions.map((d) => {
    const own = checks.filter((c) => c.dimension === d);
    const done = own.filter((c) => c.status === "pass" || c.status === "fail").length;
    return {
      dimension: d,
      weight: config.weights[d],
      score: null,
      status: done ? "partial" : "unknown",
      executed: done,
      total: own.length,
      coverage: own.length ? Math.round((done / own.length) * 100) : 0,
      issues: report.issues
        .filter((i) => own.some((c) => c.id === i.ruleId && c.viewport === i.viewport))
        .map((i) => i.id),
      needsHumanReview: true,
    };
  });
  report.status = count("error")
    ? "error"
    : report.issues.length || count("fail")
      ? "attention"
      : count("unknown") || count("skipped")
        ? "incomplete"
        : "pass";
  report.issues.sort(
    (a, b) =>
      a.priority.localeCompare(b.priority) ||
      a.viewport.localeCompare(b.viewport) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}
