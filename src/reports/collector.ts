import { createHash } from "node:crypto";
import type { Check, Dimension, Issue, Method, Priority, Report, Status } from "./types.js";
export class Collector {
  constructor(readonly report: Report) {}
  check(
    viewport: string,
    id: string,
    dimension: Dimension,
    status: Status,
    summary: string,
    evidence: Record<string, unknown> = {},
    method: Method = "measured",
  ): Check {
    const check = { id, viewport, dimension, status, summary, evidence, method };
    this.report.checks.push(check);
    return check;
  }
  issue(check: Check, priority: Priority, title: string, suggestion: string, selector?: string): Issue {
    const fingerprint = createHash("sha256")
      .update([check.id, check.viewport, selector ?? ""].join("|"))
      .digest("hex")
      .slice(0, 20);
    const existing = this.report.issues.find((i) => i.fingerprint === fingerprint);
    if (existing) return existing;
    const issue: Issue = {
      id: `issue-${fingerprint}`,
      ruleId: check.id,
      viewport: check.viewport,
      priority,
      method: check.method,
      title,
      evidence: check.evidence,
      suggestion,
      fingerprint,
      ...(selector ? { selector } : {}),
    };
    this.report.issues.push(issue);
    return issue;
  }
}
